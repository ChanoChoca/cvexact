/**
 * Shared text normalization for comparing human-entered labels — skill and
 * technology names, company/title fingerprints, and search text — without
 * conflating strings that are meaningfully different.
 *
 * `#` and `+` are the two symbols preserved by default because they are
 * never used as a word separator in a name (nobody spells "React Router" as
 * "React+Router"), but they are load-bearing for identity in a name like
 * "C#" or "C++": stripping them made "C", "C#" and "C++" collapse to the
 * same token, which is the bug this module exists to fix. `.` and `-` stay
 * treated as separators on purpose — "Node.js" and "Node JS" are the same
 * technology spelled two ways, and preserving the dot would break that
 * equivalence.
 */

export interface NormalizeOptions {
  /** Unicode-aware lowercasing. Default true. */
  caseFold?: boolean;
  /**
   * Fold accented/diacritic characters to their base form (é→e, ñ→n).
   * Default true. Must be false for `normalizeForFingerprint`: the
   * database's generated `company_norm` column deletes an accented letter
   * outright rather than folding it, and this has to match that byte for
   * byte, not introduce a "fixed" behavior that silently desyncs from it.
   */
  stripDiacritics?: boolean;
  /** Collapse runs of whitespace to a single space, and trim. Default true. */
  collapseWhitespace?: boolean;
  /**
   * How to handle characters that are neither letters nor digits (nor,
   * unless folded away above, accents):
   * - "keep": leave every character as-is.
   * - "space" (default): replace with a space, except the characters listed
   *   in `preserveSymbols`. This is what keeps "Node.js" equal to "Node JS"
   *   while keeping "C#" different from "C++" and from bare "C".
   * - "remove": delete with no replacement, so words on either side of a
   *   removed character end up joined. Only meant for the fingerprint
   *   preset below.
   */
  punctuation?: "keep" | "space" | "remove";
  /**
   * Characters exempt from the punctuation rule above (only consulted when
   * `punctuation` isn't "keep"). Default `"#+"` — the minimal set this
   * codebase has needed so far to keep technology names distinct. A caller
   * in a different domain (say "R&D" or "A/B testing") should widen this via
   * options for that call site rather than growing the shared default into
   * a general-purpose exceptions list.
   */
  preserveSymbols?: string;
}

function escapeForCharClass(value: string): string {
  return value.replace(/[\^\]\\-]/g, "\\$&");
}

export function normalizeText(value: string, options: NormalizeOptions = {}): string {
  const {
    caseFold = true,
    stripDiacritics = true,
    collapseWhitespace = true,
    punctuation = "space",
    preserveSymbols = "#+",
  } = options;

  let out = value;

  if (stripDiacritics) {
    out = out.normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  if (caseFold) {
    out = out.toLowerCase();
  }
  if (punctuation !== "keep") {
    const letters = caseFold ? "a-z" : "a-zA-Z";
    const keep = `${letters}0-9${escapeForCharClass(preserveSymbols)}`;
    // In "space" mode existing whitespace is left alone here (and merged by
    // collapseWhitespace below) so it keeps acting as a word separator. In
    // "remove" mode whitespace has to be stripped too — the fingerprint
    // preset needs "Mercado Libre" to concatenate into "mercadolibre", the
    // same way the SQL column's regexp_replace does.
    const untouched = punctuation === "space" ? "\\s" : "";
    const pattern = new RegExp(`[^${keep}${untouched}]`, "gu");
    out = out.replace(pattern, punctuation === "space" ? " " : "");
  }
  if (collapseWhitespace) {
    out = out.replace(/\s+/g, " ").trim();
  }

  return out;
}

/**
 * For comparing or deduplicating skill and technology names entered by a
 * human ("React JS" vs "react.js" vs " React  JS "). Preserves `#`/`+` so
 * "C", "C#" and "C++" don't collapse into the same string.
 */
export function normalizeForComparison(value: string): string {
  return normalizeText(value);
}

/**
 * The same tool under a common longer or shorter spelling, by `skillKey`.
 * Kept to the handful a CV and a LinkedIn export of the same person actually
 * disagree on; a name the key already joins ("Node.js"/"NodeJS",
 * "Tienda Nube"/"Tiendanube") needs no entry.
 */
const SKILL_ALIASES: Readonly<Record<string, string>> = {
  postgres: "postgresql",
  reactjs: "react",
  vuejs: "vue",
  expressjs: "express",
};

/**
 * For telling whether two names are one however each was spaced, cased or
 * punctuated — "CVExact" and "CV Exact", "Tienda Nube" and "Tiendanube" —
 * keeping `#`/`+`, the symbols that tell "C", "C#" and "C++" apart.
 */
export function compactKey(value: string): string {
  return normalizeText(value, { punctuation: "remove" });
}

/**
 * For telling whether two skill names are the same skill however each was
 * spaced, cased or punctuated: "Node.js", "NodeJS" and "node js" are one; "C",
 * "C#" and "C++" stay three; "Postgres" is PostgreSQL. For comparing only —
 * what is stored and shown is always the name as it was written.
 */
export function skillKey(value: string): string {
  const key = compactKey(value);
  return SKILL_ALIASES[key] ?? key;
}

/**
 * For the company/title fuzzy-dedup key used by the tracker. Must stay
 * byte-identical to the generated `company_norm` SQL column
 * (`lower(regexp_replace(value, '[^a-zA-Z0-9]', '', 'g'))`): no accent
 * folding — Postgres deletes an accented letter rather than folding it — and
 * every non-alphanumeric character removed outright, not space-separated.
 */
export function normalizeForFingerprint(value: string): string {
  return normalizeText(value, {
    stripDiacritics: false,
    punctuation: "remove",
    preserveSymbols: "",
  });
}

/**
 * For live search/filter boxes and phrase-matching against multi-word
 * synonyms (CSV header aliases, email keyword rules): fold case and accents,
 * but leave punctuation untouched so phrases and substrings stay intact.
 */
export function normalizeForSearch(value: string): string {
  return normalizeText(value, { punctuation: "keep" });
}

function foldCharacter(char: string): string {
  if (/\s/.test(char)) return " ";
  const lower = char.toLowerCase();
  const base = lower.normalize("NFD").replace(/\p{M}/gu, "");
  return base.length === 1 ? base : lower.length === 1 ? lower : char;
}

/**
 * Lower case and no accents, **one character for each character**: a position in the folded text is a position in the original,
 * so what is found in one can be cut out of the other. White space becomes a space; the punctuation stays where it is. Meant for text
 * in NFC (an accented letter is one character): a decomposed one keeps its accent mark as a character of its own.
 */
export function foldKeepingLength(text: string): string {
  return text.replace(/[\s\S]/g, foldCharacter);
}
