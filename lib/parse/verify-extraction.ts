import { toDateValue, withoutCurrent, type DateValue, type EndDateValue } from "@/lib/profile/dates";
import { normalizeForComparison } from "@/lib/text/normalize";
import type { Extraction } from "@/lib/ai/prompts/extract";
import { roleAndCompanyOrder } from "./cv-heuristic";
import { LOOSE_HEADING, looseSentencesAsCards } from "./coverage";
import { REDACTED, isStruckOut, redactPersonalData } from "./redact";
import type { SplitResult } from "@/lib/ai/prompts/split";
import type {
  Doubt,
  ParsedCertification,
  ParsedContact,
  ParsedDocument,
  ParsedEducation,
  ParsedExperience,
  ParsedLanguage,
  ParsedProject,
  Quoted,
} from "./types";

/**
 * Turns what a model claims into what the app is willing to store.
 *
 * The contract is the same one the deterministic parsers meet by construction —
 * every value carries the fragment of the source it came from — checked here
 * instead of trusted, because a model can misquote in a way a pattern match
 * cannot. Two things have to hold, once case, accents and spacing are folded:
 * the quote itself has to actually appear in the document, and the value has
 * to appear inside that quote — otherwise a model could hand back a real quote
 * paired with a value it never says (a title upgraded, a number changed) and
 * pass on the quote alone. Either failure means it is discarded, the same as
 * a heuristic block that found nothing. What survives of a document is marked
 * `medium` confidence across the board: even a value that checks out is a
 * model's reading, not a pattern match, and the review still asks for a tap
 * before it counts as the person's own.
 *
 * What someone wrote themselves — "Contámelo a mi manera" — is the exception,
 * and only for what came out whole: a block whose every value is quoted from
 * their own words and that names, places and dates what it is about is theirs
 * already, and asking them to tap it would be asking them to confirm what they
 * just typed. What is missing, or what the words say might be the wrong way
 * round (a role read as the company), stays `medium` and is still asked about.
 */

type Field = { value: string; quote: string } | null;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether `quote`, once normalised, appears in `text` as whole words — never
 * merely as a run of characters inside a longer one. A plain substring check
 * let "B2" pass against "B2B", and a truncated value against any word that
 * happens to contain it letter for letter; word boundaries close both.
 */
function quoteFound(text: string, quote: string): boolean {
  const needle = normalizeForComparison(quote);
  // The mark that stands where a personal detail was struck out is in the text the model was sent, and is not something it read.
  if (!needle || isStruckOut(quote)) return false;
  return new RegExp(`\\b${escapeRegExp(needle)}\\b`).test(normalizeForComparison(text));
}

/** A field whose quote checks out against the source and whose value checks out against that quote, trimmed and capped; `undefined` otherwise. */
function verifyField(text: string, field: Field, max: number): Quoted<string> | undefined {
  if (!field) return undefined;
  const value = field.value.trim().slice(0, max);
  if (!value || !quoteFound(text, field.quote) || !quoteFound(field.quote, value)) return undefined;
  return { value, quote: field.quote.slice(0, 600) };
}

function verifyFacts(text: string, facts: readonly Field[]): Quoted<string>[] {
  const out: Quoted<string>[] = [];
  for (const fact of facts) {
    const verified = verifyField(text, fact, 600);
    if (verified) out.push(verified);
  }
  return out;
}

/** A date field, verified as text first and only then read — never trusted as already-parsed. */
function verifyStartDate(text: string, field: Field): Quoted<DateValue> | undefined {
  const verified = verifyField(text, field, 40);
  if (!verified) return undefined;
  const date = withoutCurrent(toDateValue(verified.value));
  return date.year === undefined ? undefined : { value: date, quote: verified.quote };
}

function verifyEndDate(text: string, field: Field): Quoted<EndDateValue> | undefined {
  const verified = verifyField(text, field, 40);
  if (!verified) return undefined;
  const date = toDateValue(verified.value);
  return date.year === undefined && !date.current ? undefined : { value: date, quote: verified.quote };
}

// --- Finding where a block sits in the document, for "Ver en el original" -----------------

function lineIndexOf(lines: readonly string[], quote: string): number | null {
  const needle = normalizeForComparison(quote);
  if (!needle) return null;
  for (let i = 0; i < lines.length; i++) {
    if (normalizeForComparison(lines[i]!).includes(needle)) return i;
  }
  return null;
}

/** The narrowest range covering every field this block kept, or the whole document if none could be placed. */
function spanOf(lines: readonly string[], quotes: ReadonlyArray<Quoted<unknown> | undefined>): [number, number] {
  const indices = quotes.flatMap((q) => {
    const i = q ? lineIndexOf(lines, q.quote) : null;
    return i === null ? [] : [i];
  });
  if (indices.length === 0) return [0, Math.max(0, lines.length - 1)];
  return [Math.min(...indices), Math.max(...indices)];
}

/**
 * Words that actually say a degree is unfinished — "en curso", "incompleto"
 * and the like. A quote merely existing somewhere in the document said
 * nothing about *this* degree's status; the model could quote the degree's
 * own name again and have it pass. Checked after the usual normalising, so
 * accents, case and the odd space do not matter.
 */
const STATUS_WORDS = /\b(en curso|cursando|actualidad|incompleto|trunc[oa]|sin terminar|in progress|expected)\b/;

// --- Entities --------------------------------------------------------------------------

function verifyExperience(text: string, lines: readonly string[], entry: Extraction["experience"][number], own: boolean): ParsedExperience | null {
  const company = verifyField(text, entry.company, 120);
  const role = verifyField(text, entry.role, 120);
  if (!company && !role) return null;

  const city = verifyField(text, entry.city, 80);
  const country = verifyField(text, entry.country, 80);
  const start = verifyStartDate(text, entry.start);
  const end = verifyEndDate(text, entry.end);
  const facts = verifyFacts(text, entry.facts);

  const doubts: Doubt[] = [];
  if (!company) doubts.push("no_company");
  if (!role) doubts.push("no_role");
  if (!start) doubts.push("no_dates");
  else if (!end) doubts.push("no_end");
  // Only when the words say so outright: the model read both, quoted both, and is trusted on which is which
  // unless a company reads like a role and a role like a company.
  const swapped = Boolean(company && role) && roleAndCompanyOrder(role!.value, company!.value) === "swapped";
  if (swapped) doubts.push("company_or_role");

  return {
    kind: entry.kind,
    ...(company ? { company } : {}),
    ...(role ? { role } : {}),
    ...(city ? { city } : {}),
    ...(country ? { country } : {}),
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
    facts,
    confidence: own && company && role && start && end && !swapped ? "high" : "medium",
    doubts,
    ...(swapped ? { candidates: [role!.value, company!.value] } : {}),
    span: spanOf(lines, [company, role, start, end, ...facts]),
  };
}

function verifyEducation(text: string, lines: readonly string[], entry: Extraction["education"][number], own: boolean): ParsedEducation | null {
  const institution = verifyField(text, entry.institution, 160);
  const degree = verifyField(text, entry.degree, 160);
  if (!institution && !degree) return null;

  const city = verifyField(text, entry.city, 80);
  const country = verifyField(text, entry.country, 80);
  const start = verifyStartDate(text, entry.start);
  const end = verifyStartDate(text, entry.end);
  const honors = verifyField(text, entry.honors, 300);
  // A closed two-value enum, not free text, so the value needs no cleanup or
  // cap — but its quote has to actually say the degree is unfinished, not
  // merely exist somewhere in the document.
  const status =
    entry.status && quoteFound(text, entry.status.quote) && STATUS_WORDS.test(normalizeForComparison(entry.status.quote))
      ? { value: entry.status.value, quote: entry.status.quote.slice(0, 600) }
      : undefined;

  const doubts: Doubt[] = [];
  if (!institution) doubts.push("no_institution");
  if (!degree) doubts.push("no_degree");

  return {
    ...(institution ? { institution } : {}),
    ...(degree ? { degree } : {}),
    ...(city ? { city } : {}),
    ...(country ? { country } : {}),
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
    ...(status ? { status } : {}),
    ...(honors ? { honors } : {}),
    // A study asks for no dates to be whole: what it is and where is what a person says of it.
    confidence: own && institution && degree ? "high" : "medium",
    doubts,
    span: spanOf(lines, [institution, degree, start, end]),
  };
}

function verifyCertification(text: string, entry: Extraction["certifications"][number]): ParsedCertification | null {
  const name = verifyField(text, entry.name, 160);
  if (!name) return null;
  const issuer = verifyField(text, entry.issuer, 120);
  const date = verifyStartDate(text, entry.date);
  return { name, ...(issuer ? { issuer } : {}), ...(date ? { date } : {}) };
}

/**
 * A level is only trusted when it is clearly *this* language's, not merely
 * present somewhere in the document: on the same line as the name's own
 * quote, or named inside the level's own quote. Without either, "Native"
 * quoted from a skills list three lines away — "React Native" — would
 * otherwise pass as this language's level, and a level is exactly the kind
 * of thing the spec says is never inferred.
 */
function levelBelongsToLanguage(lines: readonly string[], name: Quoted<string>, level: Quoted<string>): boolean {
  const nameLine = lineIndexOf(lines, name.quote);
  const levelLine = lineIndexOf(lines, level.quote);
  if (nameLine !== null && levelLine !== null && nameLine === levelLine) return true;
  return quoteFound(level.quote, name.value);
}

function verifyLanguage(text: string, lines: readonly string[], entry: Extraction["languages"][number]): ParsedLanguage | null {
  const name = verifyField(text, entry.name, 60);
  if (!name) return null;
  const level = verifyField(text, entry.level, 60);
  return { name, ...(level && levelBelongsToLanguage(lines, name, level) ? { level } : {}) };
}

function verifyProject(text: string, entry: Extraction["projects"][number]): ParsedProject | null {
  const name = verifyField(text, entry.name, 120);
  if (!name) return null;
  const description = verifyField(text, entry.description, 800);
  const url = verifyField(text, entry.url, 300);
  return { name, ...(description ? { description } : {}), ...(url ? { url } : {}) };
}

function verifyContact(text: string, contact: Extraction["contact"]): ParsedContact {
  const fullName = verifyField(text, contact.fullName, 120);
  const headline = verifyField(text, contact.headline, 160);
  const email = verifyField(text, contact.email, 160);
  const phone = verifyField(text, contact.phone, 40);
  const city = verifyField(text, contact.city, 80);
  const country = verifyField(text, contact.country, 80);
  return {
    ...(fullName ? { fullName } : {}),
    ...(headline ? { headline } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(city ? { city } : {}),
    ...(country ? { country } : {}),
    links: contact.links.flatMap((link) => {
      const url = verifyField(text, link.url, 300);
      return url ? [{ value: { label: link.label.trim().slice(0, 60), url: url.value }, quote: url.quote }] : [];
    }),
  };
}

/**
 * The model's response, checked against the text it read and turned into the
 * same shape the deterministic parsers produce. Every block that survives is
 * `medium` confidence, whatever the model's own certainty looked like — that is
 * what sends it to review instead of straight into the profile as confirmed.
 */
export function verifyExtraction(text: string, extracted: Extraction, kind: "cv" | "dump"): ParsedDocument {
  const lines = text.split("\n");
  // Their own words, not a document of someone else's making: see the comment above.
  const own = kind === "dump";

  // Facts that were themselves checked fine, but whose block was not — no
  // company and no role either survived, so there is nothing to call the job
  // that held them. Losing the block is right; losing what it said is not,
  // so what it said moves to "Sin asignar" instead of disappearing with it.
  const orphaned: ParsedDocument["unassigned"] = [];
  const experience = extracted.experience.flatMap((entry) => {
    const verified = verifyExperience(text, lines, entry, own);
    if (verified) return [verified];
    for (const fact of verifyFacts(text, entry.facts)) orphaned.push({ text: fact.value, kind: "other" });
    return [];
  });

  const result: ParsedDocument = {
    kind,
    contact: verifyContact(text, extracted.contact),
    experience,
    education: extracted.education.flatMap((entry) => {
      const verified = verifyEducation(text, lines, entry, own);
      return verified ? [verified] : [];
    }),
    certifications: extracted.certifications.flatMap((entry) => {
      const verified = verifyCertification(text, entry);
      return verified ? [verified] : [];
    }),
    languages: extracted.languages.flatMap((entry) => {
      const verified = verifyLanguage(text, lines, entry);
      return verified ? [verified] : [];
    }),
    skills: extracted.skills.flatMap((entry) => {
      const verified = verifyField(text, entry, 80);
      return verified ? [verified] : [];
    }),
    projects: extracted.projects.flatMap((entry) => {
      const verified = verifyProject(text, entry);
      return verified ? [verified] : [];
    }),
    unassigned: [
      ...orphaned,
      ...extracted.unassigned.flatMap((entry) => {
        const clean = entry.text.trim().slice(0, 2000);
        if (!clean || !quoteFound(text, clean)) return [];
        return [{ text: clean, kind: entry.kind, ...(entry.heading ? { heading: entry.heading.trim().slice(0, 80) } : {}) }];
      }),
    ],
    // The model is never asked for personal data this app does not store — see
    // `EXTRACT_SYSTEM` — so there is nothing here to have omitted on purpose.
    omittedPersonalData: 0,
    confidence: "medium",
    via: "ai",
    lineCount: lines.length,
    lines,
  };

  // What someone told that nothing above was taken from. A value whose quote is not in the text is dropped without
  // a word, so a sentence the model did not carry over would otherwise be nowhere — in a profile that looks complete.
  // It goes to "Sin asignar", where each one is a task, a note, or nothing, and the whole text is kept as a note either way.
  // Only for what someone wrote themselves: a document's lines are headings and bullets, not sentences, and which of
  // them went unread is a question about the file (see `coverage.ts`).
  if (kind === "dump") result.unassigned.push(...looseSentencesAsCards(text, result, LOOSE_HEADING));
  return result;
}

/**
 * The pieces of a split answer that are actually the answer: each one has to be
 * found, once case and spacing are folded, as a run of the original text. A
 * "piece" that fails this is not a finer cut, it is a rewrite, and is dropped —
 * the deterministic sentence-splitter (`lib/onboarding/split.ts`) is what fills
 * whatever that leaves out.
 */
export function verifySplit(answer: string, result: SplitResult): string[] {
  const haystack = normalizeForComparison(answer);
  const pieces: string[] = [];
  for (const piece of result.pieces) {
    const clean = piece.trim();
    if (clean && haystack.includes(normalizeForComparison(clean))) pieces.push(clean);
  }
  return pieces;
}

/**
 * The words a split is allowed to leave to the joins between pieces, rather
 * than to any one piece's own text — the ones whose only job was stitching
 * clauses together, never carrying a clause of their own.
 */
const SPLIT_CONNECTORS = new Set(["y", "e", "o", "u", "tambien", "ademas", "luego", "despues", "pero", "and", "also", "then"]);

/**
 * Whether the pieces of a split, *together*, still say everything the answer
 * did — not whether any one piece is a literal run of it, which `verifySplit`
 * already checked. A model can hand back pieces that each pass that check on
 * their own and still have quietly dropped, or reworded away, a whole clause
 * in between them; this is what catches that, by requiring every content word
 * of the answer to turn up somewhere across the pieces, not necessarily in
 * the same one it started in.
 */
export function splitCovers(answer: string, pieces: readonly string[]): boolean {
  // What the model was sent is the answer without the details the product does not use (`splitWithAi`): it is not for the pieces to say.
  const words = normalizeForComparison(redactPersonalData(answer).text.split(REDACTED).join(" "))
    .split(" ")
    .filter((word) => word && !SPLIT_CONNECTORS.has(word));
  if (words.length === 0) return true;
  const haystack = normalizeForComparison(pieces.join(" "));
  return words.every((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`).test(haystack));
}
