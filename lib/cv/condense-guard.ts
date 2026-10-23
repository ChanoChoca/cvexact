import {
  buildIndexFrom,
  extractFigures,
  findUnsupportedTerms,
  hardTermsIn,
  normalize,
  supportShare,
  type EvidenceIndex,
} from "@/lib/ai/evidence";
import { cvGaps } from "@/lib/ai/verify";
import type { CVDocument } from "@/lib/schemas/cv";
import type { Profile } from "@/lib/schemas/profile";

/**
 * Whether a shorter line still says the same thing.
 *
 * Three levels, in the order the to-do asks for them (§7): invariants that reject
 * on their own, one heuristic that only marks a rewrite for the person to read,
 * and nothing that pretends to prove equivalence. Keeping many words does not
 * prove fidelity and changing many does not prove infidelity — which is why the
 * last level is a signal and the receipt shows a word-by-word diff beside it.
 *
 * A rewrite that fails anything at all leaves its line exactly as it was: the
 * engine's own ladder then decides what to do with the page, and the person keeps
 * a CV whose every line they have already read.
 */

/** Languages the guard has a lexicon for. Any other language skips the stage, whole. */
type Lexicon = "es" | "en";

/**
 * Below this share of the rewrite's content words that the original stated, the
 * rewrite is not the same line and is rejected.
 */
export const FAITHFUL_FLOOR = 0.6;
/**
 * Below this, the rewrite is accepted but marked: the receipt makes the person
 * read it before the CV is downloaded. Above it, it passes.
 */
export const FAITHFUL_MARK = 0.85;

/**
 * Words that negate. Compared as a *set*: one added or dropped and the line is
 * refused, however good it looks. That a legitimate rephrasing («no X y no Y» →
 * «sin X ni Y») is refused too is the direction this is allowed to fail in — the
 * line stays as the person wrote it.
 */
const NEGATIONS: Record<Lexicon, readonly string[]> = {
  es: ["no", "nunca", "jamas", "ni", "sin", "tampoco", "ningun", "ninguna", "ninguno", "nada", "apenas"],
  en: ["not", "never", "no", "without", "neither", "nor", "none", "nothing", "barely"],
};

/**
 * Words that say how much of the work was the person's. The ones in the original
 * have to survive, and the rewrite may not reach for a stronger one: «colaboré»
 * becoming «lideré» is the exact failure this invariant exists for.
 */
export const SUPPORTIVE: Record<Lexicon, readonly string[]> = {
  es: [
    "participe",
    "colabore",
    "apoye",
    "asisti",
    "contribui",
    "ayude",
    "junto",
    "con el equipo",
    "en equipo",
    "de apoyo",
  ],
  en: [
    "participated",
    "collaborated",
    "supported",
    "assisted",
    "contributed",
    "helped",
    "with the team",
    "as part of",
    "in support",
  ],
};

/** The stronger verbs an authorship nuance must never become. */
export const AUTHORITY: Record<Lexicon, readonly string[]> = {
  es: [
    "lidere",
    "dirigi",
    "gestione",
    "a cargo",
    // Not the bare adjective: «una persona responsable» is a trait, not the claim of having led the work.
    "responsable de",
    "responsable del",
    "coordine",
    "supervise",
    "encabece",
    "llevo adelante",
    // The present, for a role that is still going: «Lidero el equipo» is the same claim.
    "lidero",
    "dirijo",
    "gestiono",
    "coordino",
    "superviso",
    "encabezo",
  ],
  en: ["led", "managed", "owned", "directed", "supervised", "coordinated", "in charge", "responsible for"],
};

export type GuardReason =
  /** The CV is in a language this has no lexicon for: the stage is skipped (§7.6). */
  | "unsupported-language"
  | "not-shorter"
  | "too-long"
  | "figures"
  | "terms"
  | "negations"
  | "authorship"
  /** Below `FAITHFUL_FLOOR`: too little of the line is what the original said. */
  | "unfaithful";

export type GuardVerdict =
  | { ok: true; /** Earned its place in the receipt's diff. */ needsReview: boolean }
  | { ok: false; reason: GuardReason };

/** The lexicon for a language, or `null` — which stops the stage rather than guessing. */
export function lexiconFor(language: string): Lexicon | null {
  const code = normalize(language).trim().slice(0, 2);
  if (code === "es") return "es";
  if (code === "en") return "en";
  return null;
}

/** `normalize`, padded so a whole-word search cannot match inside a longer word. */
function padded(text: string): string {
  return ` ${normalize(text).replace(/\s+/g, " ").trim()} `;
}

function states(text: string, term: string): boolean {
  const needle = normalize(term).trim();
  return needle.length > 0 && padded(text).includes(` ${needle} `);
}

/** The lexicon terms a text contains. */
export function termsIn(text: string, lexicon: readonly string[]): string[] {
  return lexicon.filter((term) => states(text, term));
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((entry) => b.includes(entry));
}

/**
 * Whether one rewrite may be applied.
 *
 * Cheap invariants first — a rewrite longer than what it replaces is not worth the
 * rest of the arithmetic — and the heuristic last, because it is the only one that
 * can be wrong in the direction of accepting a bad line.
 */
export function guardRewrite(input: {
  original: string;
  rewrite: string;
  language: string;
  maxChars: number;
  /** The profile as the evidence index: nothing may appear that the person never stated. */
  profile?: EvidenceIndex;
}): GuardVerdict {
  const { original, rewrite, maxChars } = input;
  const lexicon = lexiconFor(input.language);
  if (!lexicon) return { ok: false, reason: "unsupported-language" };

  const candidate = rewrite.trim();

  // 1. Strictly shorter, and within the ceiling it was given.
  if (candidate.length >= original.trim().length) return { ok: false, reason: "not-shorter" };
  if (candidate.length > maxChars) return { ok: false, reason: "too-long" };

  // 2. The same numbers and dates, neither more nor less.
  const beforeFigures = [...new Set(extractFigures(original))].sort();
  const afterFigures = [...new Set(extractFigures(candidate))].sort();
  if (!sameSet(beforeFigures, afterFigures)) return { ok: false, reason: "figures" };

  // 3. Every technology and every proper name the line already claimed survives,
  //    and nothing new appears against the profile.
  const kept = hardTermsIn(original).map(normalize);
  const stillThere = new Set(hardTermsIn(candidate).map(normalize));
  if (!kept.every((term) => stillThere.has(term))) return { ok: false, reason: "terms" };
  if (input.profile && findUnsupportedTerms(candidate, input.profile).length > 0) {
    return { ok: false, reason: "terms" };
  }

  // 4. Negations, as a set.
  if (!sameSet(termsIn(original, NEGATIONS[lexicon]), termsIn(candidate, NEGATIONS[lexicon]))) {
    return { ok: false, reason: "negations" };
  }

  // 5. Who did the work: the nuances of the original stay, and the verb does not
  //    climb a level.
  const supportiveBefore = termsIn(original, SUPPORTIVE[lexicon]);
  if (!supportiveBefore.every((term) => states(candidate, term))) {
    return { ok: false, reason: "authorship" };
  }
  const authorityAfter = termsIn(candidate, AUTHORITY[lexicon]);
  if (!authorityAfter.every((term) => states(original, term))) {
    return { ok: false, reason: "authorship" };
  }

  // 6. The heuristic: a share, not a verdict.
  const share = supportShare(buildIndexFrom([original]), candidate) ?? 1;
  if (share < FAITHFUL_FLOOR) return { ok: false, reason: "unfaithful" };
  return { ok: true, needsReview: share < FAITHFUL_MARK };
}

/**
 * Whether the summary's own rules still hold with the rewrite in place.
 *
 * Those rules (`cvGaps().summaryRuleViolations` — an English summary is a closing
 * statement and not a cover letter, the paragraph does not name the company) are
 * about the document, so they are read on the document. Only a violation the
 * rewrite **introduced** counts: a summary that already breached one before the
 * fit is not this step's business.
 */
export function summaryStillAllowed(before: CVDocument, after: CVDocument, profile: Profile): boolean {
  // No `analysis`: the rules being read are about the document alone (`cvGaps`
  // passes it to checks this one does not use), and a stand-in relevance would be
  // a made-up fact inside the module whose whole job is not to make them up.
  //
  // Counted, not compared: a violation carries the summary's own text, so two
  // summaries breaching the same rule never look equal. What matters is whether
  // the rewrite *added* a rule, not whether it broke the same one differently.
  const already = cvGaps(before, profile).summaryRuleViolations.length;
  return cvGaps(after, profile).summaryRuleViolations.length <= already;
}
