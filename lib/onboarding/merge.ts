import { boundsOf, type DateValue, type EndDateValue } from "@/lib/profile/dates";
import { languageLevelFrom } from "@/lib/profile/from-plain";
import { levelPhrase, namesLevel } from "@/lib/profile/language-levels";
import { compactKey, normalizeForComparison } from "@/lib/text/normalize";
import { pairBySimilarity, similarity } from "@/lib/text/similarity";
import type {
  Conflict,
  ConflictEntity,
  Fact,
  Field,
  Source,
  StoredCertification,
  StoredEducation,
  StoredExperience,
  StoredLanguage,
  StoredProject,
} from "@/lib/schemas/profile-v2";
import type { ParsedCertification, ParsedEducation, ParsedExperience, ParsedProject, Quoted } from "@/lib/parse/types";
import { ENGINE } from "./config";

/**
 * Two documents about the same career, read into one profile.
 *
 * `applyParsedDocument` (`lib/parse/to-profile.ts`) used to recognise the "same
 * job" only when company, role and start date matched *exactly* — which meant a
 * second source (LinkedIn after a CV, a reimported CV) either duplicated every
 * role it described or, when the key happened to match, silently dropped
 * whatever that source added: its facts, a more precise end date. This module
 * is the fusion the spec calls for instead: the same job recognised a little
 * more loosely, its facts unioned, and anything the two sources disagree about
 * turned into a conflict for the person to settle — never resolved on their
 * behalf, and never applied over a value they have already edited themselves.
 *
 * `matchExperiences`/`matchEducations` are the batch form `applyParsedDocument`
 * actually calls: matched against a snapshot of what the profile had *before*
 * this document's own entries, so two roles the same document reads at one
 * company (a promotion, above all) are never mistaken for two readings of each
 * other, and best-paired first so one existing job cannot be claimed by more
 * than one of a document's own candidates.
 */

type SourceOf = (quote: string) => Source;
type NewId = () => string;

// --- Recognising the same thing, read twice -------------------------------------------

/**
 * Legal-entity suffixes, tokenised after `normalizeForComparison`: longest
 * groups first, so "s a de c v" is stripped whole rather than leaving a
 * dangling "de c v" behind. Spanish/Latin American forms and the common
 * English ones — enough for "Nubia Retail" and "Nubia Retail S.L." to compare
 * equal without either name losing a word that was never a suffix.
 */
const SUFFIX_TOKEN_GROUPS: readonly string[][] = [
  ["sociedad", "anonima", "de", "capital", "variable"],
  ["sociedad", "de", "responsabilidad", "limitada"],
  ["sociedad", "anonima"],
  ["sociedad", "limitada"],
  ["sapi", "de", "cv"],
  ["sa", "de", "cv"],
  ["s", "a", "de", "c", "v"],
  ["s", "r", "l"],
  ["s", "a", "s"],
  ["s", "l"],
  ["s", "a"],
  ["srl"],
  ["sas"],
  ["spa"],
  ["sa"],
  ["sl"],
  ["plc"],
  ["llp"],
  ["llc"],
  ["inc"],
  ["ltd"],
  ["gmbh"],
  ["corporation"],
  ["corp"],
  ["company"],
  ["co"],
  ["ag"],
  ["bv"],
].sort((a, b) => b.length - a.length);

/**
 * A company or institution name, for comparing identity rather than wording.
 * Strips a trailing legal-entity suffix (repeatedly, in case one was doubled
 * up) but never past the point of leaving nothing: a company actually named
 * "S.A." keeps its tokens.
 */
export function companyKey(name: string): string {
  let tokens = normalizeForComparison(name).split(" ").filter(Boolean);
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const suffix of SUFFIX_TOKEN_GROUPS) {
      if (tokens.length <= suffix.length) continue;
      const tail = tokens.slice(tokens.length - suffix.length).join(" ");
      if (tail === suffix.join(" ")) {
        tokens = tokens.slice(0, tokens.length - suffix.length);
        stripped = true;
        break;
      }
    }
  }
  return tokens.join(" ");
}

/**
 * How a job was held rather than who it was for, when it is written into the
 * company's own line: "Flash Page · Freelance", "Flash Page (Autónomo)".
 * Whole token groups only, so "Full Stack Labs" keeps its "full".
 */
const EMPLOYMENT_MARKERS: readonly string[][] = [
  ["por", "cuenta", "propia"],
  ["self", "employed"],
  ["tiempo", "completo"],
  ["medio", "tiempo"],
  ["jornada", "completa"],
  ["jornada", "parcial"],
  ["full", "time"],
  ["part", "time"],
  ["freelancer"],
  ["freelance"],
  ["autonomo"],
  ["autonoma"],
  ["independiente"],
  ["contractor"],
].sort((a, b) => b.length - a.length);

/**
 * A company's name as two documents about the same job would both have to
 * reduce to: its employment-type words at either end dropped (before the legal
 * suffix, so "Flash Page S.A. (Freelance)" still loses its "S.A."), then
 * `companyKey`, then its spaces — "FlashPage" and "Flash Page" are one brand
 * written two ways. Never reduced to nothing: a job whose company line was
 * only "Freelance" keeps that as its key.
 */
export function companyMatchKey(name: string): string {
  let tokens = normalizeForComparison(name).split(" ").filter(Boolean);
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const marker of EMPLOYMENT_MARKERS) {
      if (tokens.length <= marker.length) continue;
      const words = marker.join(" ");
      if (tokens.slice(-marker.length).join(" ") === words) tokens = tokens.slice(0, -marker.length);
      else if (tokens.slice(0, marker.length).join(" ") === words) tokens = tokens.slice(marker.length);
      else continue;
      stripped = true;
      break;
    }
  }
  return companyKey(tokens.join(" ")).replace(/ /g, "");
}

/** Articles and prepositions that never carry an institution's own initial: "Universidad Nacional **del** Noroeste" is UN_, not UND_. */
const INITIAL_STOPWORDS = new Set(["de", "del", "la", "las", "los", "da", "das", "do", "dos", "di", "y", "e", "of", "the", "and"]);

/**
 * Whether `acronym` can be spelled out by taking, from each of `words` in
 * order, either its first letter alone or its first two — real institutional
 * acronyms sometimes double up on one word for disambiguation ("UNNOBA":
 * Universidad Nacional del **NO**roeste de la Provincia de Buenos Aires takes
 * two letters from "Noroeste", not one) — without also matching arbitrary
 * text, since every acronym letter still has to land on some word's own
 * initial, in the institution's own word order.
 */
function spelledByInitials(acronym: string, words: readonly string[], wordAt = 0, letterAt = 0): boolean {
  if (letterAt === acronym.length) return true;
  if (wordAt === words.length) return false;
  const word = words[wordAt]!;
  if (word[0] !== acronym[letterAt]) return spelledByInitials(acronym, words, wordAt + 1, letterAt);
  if (word[1] === acronym[letterAt + 1] && spelledByInitials(acronym, words, wordAt + 1, letterAt + 2)) return true;
  return spelledByInitials(acronym, words, wordAt + 1, letterAt + 1);
}

/**
 * Two `companyKey`s name the same institution — either identically, or one is
 * a short, plain-letter acronym for the other's full name ("unnoba" for
 * "universidad nacional del noroeste de la provincia de buenos aires"), which
 * is what a CV and a LinkedIn export each call the same school often enough
 * that requiring an exact match would duplicate it across "Tengo ambos"
 * every time.
 */
function institutionsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < 2 || shorter.length > 10 || !/^[a-z]+$/.test(shorter)) return false;
  const words = longer.split(" ").filter((word) => word && !INITIAL_STOPWORDS.has(word));
  return spelledByInitials(shorter, words);
}

const similarRole = (a: string, b: string): boolean => similarity(a, b) >= ENGINE.merge.roleSimilarity;

/**
 * Whether two spans of time share a month. An end with no year at all — not
 * "actualidad", just unreadable — is read as open, the same way `current` is:
 * a block the parser could not close should not be the reason an otherwise
 * obvious match is missed. Getting this a little generous costs nothing worse
 * than a conflict the person is asked to settle; it never applies a value on
 * its own.
 */
function overlapMonths(
  aStart: DateValue,
  aEnd: EndDateValue,
  bStart: DateValue,
  bEnd: EndDateValue,
  now: Date,
): number | null {
  const nowIndex = now.getFullYear() * 12 + now.getMonth();
  const startA = boundsOf(aStart);
  const startB = boundsOf(bStart);
  if (!startA || !startB) return null;
  const endA = aEnd.current ? { min: nowIndex, max: nowIndex } : (boundsOf(aEnd) ?? { min: nowIndex, max: nowIndex });
  const endB = bEnd.current ? { min: nowIndex, max: nowIndex } : (boundsOf(bEnd) ?? { min: nowIndex, max: nowIndex });
  const from = Math.max(startA.min, startB.min);
  const to = Math.min(endA.max, endB.max);
  return to >= from ? to - from + 1 : null;
}

function overlaps(aStart: DateValue, aEnd: EndDateValue, bStart: DateValue, bEnd: EndDateValue, now: Date): boolean {
  return overlapMonths(aStart, aEnd, bStart, bEnd, now) !== null;
}

/** How many months a span can cover, read the way `overlapMonths` reads one: an open or unreadable end runs to now. */
function spanMonths(start: DateValue, end: EndDateValue, now: Date): number | null {
  const nowIndex = now.getFullYear() * 12 + now.getMonth();
  const from = boundsOf(start);
  if (!from) return null;
  const to = end.current ? { min: nowIndex, max: nowIndex } : (boundsOf(end) ?? { min: nowIndex, max: nowIndex });
  return to.max >= from.min ? to.max - from.min + 1 : null;
}

/**
 * Whether a stored job and a freshly read one fill the same place in a career
 * even though their titles read nothing alike — "Software Engineer" in a CV,
 * "Full Stack Developer" on LinkedIn, for one job at one company: the same
 * company, and most of the longer of the two spans in common. Measured against
 * the *longer* span, so a short stint inside a long job (a volunteer season at
 * the company someone has worked at for years) is never read as the same job.
 * Refused when both sides say how the job was held and they disagree, or when
 * either reading was unsure which line was the company and which the role.
 */
function sameSlot(entry: StoredExperience, candidate: ParsedExperience, now: Date): boolean {
  if (entry.role.value.trim() === "" || !candidate.role?.value.trim() || !candidate.start) return false;
  const company = candidate.company ? companyMatchKey(candidate.company.value) : "";
  if (!company || companyMatchKey(entry.company.value) !== company) return false;
  if (entry.employmentType && candidate.employmentType && entry.employmentType.value !== candidate.employmentType.value) return false;
  if (candidate.doubts.includes("company_or_role") || entry.review?.doubts.includes("company_or_role")) return false;
  const candidateEnd: EndDateValue = candidate.end?.value ?? {};
  const shared = overlapMonths(entry.start.value, entry.end.value, candidate.start.value, candidateEnd, now);
  const a = spanMonths(entry.start.value, entry.end.value, now);
  const b = spanMonths(candidate.start.value, candidateEnd, now);
  if (shared === null || a === null || b === null) return false;
  return shared / Math.max(a, b) >= ENGINE.merge.spanOverlap;
}

/**
 * The stored job a freshly read one is a second reading of: same company (once
 * a legal suffix is looked past), an overlapping span, and a similar-enough
 * title. All three, because any one alone is too weak — two different jobs at
 * the same employer, two unrelated roles that happen to share dates.
 */
export function findMatchingExperience(
  existing: readonly StoredExperience[],
  candidate: ParsedExperience,
  now: Date = new Date(),
): StoredExperience | undefined {
  const candidateCompany = candidate.company ? companyMatchKey(candidate.company.value) : "";
  const candidateRole = candidate.role?.value.trim() ?? "";
  const candidateStart = candidate.start?.value;
  if (!candidateCompany || !candidateRole || !candidateStart) return undefined;
  const candidateEnd: EndDateValue = candidate.end?.value ?? {};
  return existing.find(
    (job) =>
      job.role.value.trim() !== "" &&
      companyMatchKey(job.company.value) === candidateCompany &&
      similarRole(job.role.value, candidateRole) &&
      overlaps(job.start.value, job.end.value, candidateStart, candidateEnd, now),
  );
}

/**
 * Matches freshly read jobs against the profile's existing ones, best pairing
 * first — the same greedy idea as `pairBySimilarity`. A document that reads
 * two roles at one company (a promotion, above all) can otherwise merge them
 * into each other, or into the one job a reimport already has: this way each
 * candidate competes for the job it fits best, one existing job is claimed by
 * at most one candidate, and a candidate that would only have matched an
 * already-claimed job gets none — it becomes its own new entry instead of
 * disappearing into someone else's. Ties favour the strongest signal: an
 * exact title, then the closest wording, then the most months shared.
 *
 * `existing` has to be a snapshot of the profile from *before* this document's
 * own entries were added — the caller's job, since this function has no way to
 * tell "already there" apart from "just added by this same reading" on its own.
 */
export function matchExperiences(
  existing: readonly StoredExperience[],
  candidates: readonly ParsedExperience[],
  now: Date = new Date(),
): Map<number, StoredExperience> {
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  const scored: Array<{ i: number; jobId: string; exact: boolean; similarity: number; months: number }> = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const candidateCompany = candidate.company ? companyMatchKey(candidate.company.value) : "";
    const candidateRole = candidate.role?.value.trim() ?? "";
    const candidateStart = candidate.start?.value;
    if (!candidateCompany || !candidateRole || !candidateStart) continue;
    const candidateEnd: EndDateValue = candidate.end?.value ?? {};

    for (const entry of existing) {
      if (entry.role.value.trim() === "" || companyMatchKey(entry.company.value) !== candidateCompany) continue;
      const roleSimilarity = similarity(entry.role.value, candidateRole);
      if (roleSimilarity < ENGINE.merge.roleSimilarity) continue;
      const months = overlapMonths(entry.start.value, entry.end.value, candidateStart, candidateEnd, now);
      if (months === null) continue;
      const exact = normalizeForComparison(entry.role.value) === normalizeForComparison(candidateRole);
      scored.push({ i, jobId: entry.id, exact, similarity: roleSimilarity, months });
    }
  }
  scored.sort((a, b) => Number(b.exact) - Number(a.exact) || b.similarity - a.similarity || b.months - a.months);

  const matches = new Map<number, StoredExperience>();
  const claimedJobs = new Set<string>();
  const claimedCandidates = new Set<number>();
  for (const candidate of scored) {
    if (claimedJobs.has(candidate.jobId) || claimedCandidates.has(candidate.i)) continue;
    matches.set(candidate.i, byId.get(candidate.jobId)!);
    claimedJobs.add(candidate.jobId);
    claimedCandidates.add(candidate.i);
  }

  // Then, among what is left, the same job under two titles that read nothing
  // alike ("Software Engineer" / "Full Stack Developer", 0.05 apart): see
  // `sameSlot`. Taken only where it is unambiguous — each side the other's one
  // possible partner — so two jobs held at once at one company are never
  // guessed apart; left as two entries, as before. The title that differs is
  // not lost: `mergeExperienceInto` asks which one to keep.
  const pairs: Array<{ i: number; jobId: string }> = [];
  for (let i = 0; i < candidates.length; i++) {
    if (claimedCandidates.has(i)) continue;
    for (const entry of existing) {
      if (!claimedJobs.has(entry.id) && sameSlot(entry, candidates[i]!, now)) pairs.push({ i, jobId: entry.id });
    }
  }
  const partners = (pick: (pair: { i: number; jobId: string }) => string | number, of: string | number) => pairs.filter((pair) => pick(pair) === of).length;
  for (const pair of pairs) {
    if (partners((p) => p.i, pair.i) !== 1 || partners((p) => p.jobId, pair.jobId) !== 1) continue;
    matches.set(pair.i, byId.get(pair.jobId)!);
    claimedJobs.add(pair.jobId);
    claimedCandidates.add(pair.i);
  }
  return matches;
}

/**
 * Whether a stored degree and a freshly read one are close enough to be the
 * same course of study: the same institution, and then either an overlapping
 * span or, when either side is missing a date to compare, an exactly matching
 * title. A similarity score with no date behind it is too weak on its own —
 * unlike a job, which always has a span to check first — so two different
 * degrees at the same university ("Licenciatura" and "Maestría en Economía")
 * are not read as one just because their titles happen to share words.
 */
function sameEducation(
  entry: StoredEducation,
  candidateInstitution: string,
  candidateDegree: string,
  candidateStart: DateValue | undefined,
  candidateEnd: EndDateValue,
  now: Date,
): boolean {
  if (entry.degree.value.trim() === "" || !institutionsMatch(companyKey(entry.institution.value), candidateInstitution)) return false;
  const bothDated = entry.start.value.year !== undefined && candidateStart?.year !== undefined;
  if (bothDated) {
    return (
      overlaps(entry.start.value, entry.end.value, candidateStart!, candidateEnd, now) &&
      similarRole(entry.degree.value, candidateDegree)
    );
  }
  return normalizeForComparison(entry.degree.value) === normalizeForComparison(candidateDegree);
}

/** The stored degree a freshly read one is a second reading of. See `sameEducation`. */
export function findMatchingEducation(
  existing: readonly StoredEducation[],
  candidate: ParsedEducation,
  now: Date = new Date(),
): StoredEducation | undefined {
  const candidateInstitution = candidate.institution ? companyKey(candidate.institution.value) : "";
  const candidateDegree = candidate.degree?.value.trim() ?? "";
  if (!candidateInstitution || !candidateDegree) return undefined;
  const candidateEnd: EndDateValue = candidate.end?.value ?? {};
  return existing.find((entry) =>
    sameEducation(entry, candidateInstitution, candidateDegree, candidate.start?.value, candidateEnd, now),
  );
}

/** The education counterpart of `matchExperiences`: same greedy, claim-once pairing, over `sameEducation`. */
export function matchEducations(
  existing: readonly StoredEducation[],
  candidates: readonly ParsedEducation[],
  now: Date = new Date(),
): Map<number, StoredEducation> {
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  const scored: Array<{ i: number; entryId: string; exact: boolean; similarity: number }> = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const candidateInstitution = candidate.institution ? companyKey(candidate.institution.value) : "";
    const candidateDegree = candidate.degree?.value.trim() ?? "";
    if (!candidateInstitution || !candidateDegree) continue;
    const candidateEnd: EndDateValue = candidate.end?.value ?? {};

    for (const entry of existing) {
      if (!sameEducation(entry, candidateInstitution, candidateDegree, candidate.start?.value, candidateEnd, now)) continue;
      const exact = normalizeForComparison(entry.degree.value) === normalizeForComparison(candidateDegree);
      scored.push({ i, entryId: entry.id, exact, similarity: exact ? 1 : similarity(entry.degree.value, candidateDegree) });
    }
  }
  scored.sort((a, b) => Number(b.exact) - Number(a.exact) || b.similarity - a.similarity);

  const matches = new Map<number, StoredEducation>();
  const claimedEntries = new Set<string>();
  const claimedCandidates = new Set<number>();
  for (const candidate of scored) {
    if (claimedEntries.has(candidate.entryId) || claimedCandidates.has(candidate.i)) continue;
    matches.set(candidate.i, byId.get(candidate.entryId)!);
    claimedEntries.add(candidate.entryId);
    claimedCandidates.add(candidate.i);
  }
  return matches;
}

// --- Merging one field ------------------------------------------------------------------

type FieldMerge<T> = { field: Field<T>; conflict?: { current: T; incoming: T; source: Source } };

/**
 * A text field seen a second time. Never touches a value the person has
 * edited — that is theirs, full stop. An empty one is filled, as `proposed`:
 * the person still gets to look at it, exactly like a contact field filled
 * from a single document. An equal one changes nothing. Anything else is a
 * conflict, not a silent pick.
 */
function mergeTextField(current: Field<string>, incoming: Quoted<string> | undefined, src: SourceOf): FieldMerge<string> {
  if (!incoming || !incoming.value.trim()) return { field: current };
  if (current.status === "edited") return { field: current };
  if (current.value.trim() === "") {
    return { field: { value: incoming.value, status: "proposed", source: src(incoming.quote) } };
  }
  if (normalizeForComparison(current.value) === normalizeForComparison(incoming.value)) return { field: current };
  return { field: current, conflict: { current: current.value, incoming: incoming.value, source: src(incoming.quote) } };
}

/** "2019" against "2019-03": the same year, one of them just more precise. Different years: incompatible. */
function precisionCompare(a: DateValue, b: DateValue): "equal" | "a" | "b" | "incompatible" {
  if (a.year !== b.year) return "incompatible";
  if (a.month === b.month) return "equal";
  if (a.month === undefined) return "b";
  if (b.month === undefined) return "a";
  return "incompatible";
}

function mergeDateField(current: Field<DateValue>, incoming: Quoted<DateValue> | undefined, src: SourceOf): FieldMerge<DateValue> {
  if (current.status === "edited") return { field: current };
  const incomingValue = incoming?.value;
  if (!incomingValue || incomingValue.year === undefined) return { field: current };
  if (current.value.year === undefined) {
    return { field: { value: incomingValue, status: "proposed", source: src(incoming!.quote) } };
  }
  const cmp = precisionCompare(current.value, incomingValue);
  if (cmp === "equal" || cmp === "a") return { field: current };
  if (cmp === "b") return { field: { value: incomingValue, status: "proposed", source: src(incoming!.quote) } };
  return { field: current, conflict: { current: current.value, incoming: incomingValue, source: src(incoming!.quote) } };
}

/**
 * An end date: the same as a start, plus the one thing a start never has —
 * "actualidad" is itself a value, and two sources disagreeing about whether the
 * job is still going is exactly the kind of thing that must not merge itself
 * away.
 */
function mergeEndDateField(current: Field<EndDateValue>, incoming: Quoted<EndDateValue> | undefined, src: SourceOf): FieldMerge<EndDateValue> {
  if (current.status === "edited") return { field: current };
  const incomingValue = incoming?.value;
  const incomingHas = Boolean(incomingValue && (incomingValue.year !== undefined || incomingValue.current));
  if (!incomingValue || !incomingHas) return { field: current };
  const currentHas = current.value.year !== undefined || current.value.current;
  if (!currentHas) {
    return { field: { value: incomingValue, status: "proposed", source: src(incoming!.quote) } };
  }
  if (Boolean(current.value.current) !== Boolean(incomingValue.current)) {
    return { field: current, conflict: { current: current.value, incoming: incomingValue, source: src(incoming!.quote) } };
  }
  if (current.value.current && incomingValue.current) return { field: current };
  const cmp = precisionCompare(current.value, incomingValue);
  if (cmp === "equal" || cmp === "a") return { field: current };
  if (cmp === "b") return { field: { value: incomingValue, status: "proposed", source: src(incoming!.quote) } };
  return { field: current, conflict: { current: current.value, incoming: incomingValue, source: src(incoming!.quote) } };
}

/**
 * The facts of a matched job, plus what a second source adds. Exact repeats and
 * close paraphrases (`ENGINE.merge.factSimilarity`) are recognised as the same
 * statement and kept once — in whichever wording was already there — and
 * anything left over is a genuinely new fact, with its own source and quote.
 */
export function mergeFacts(
  existing: readonly Fact[],
  incoming: readonly Quoted<string>[],
  src: SourceOf,
  newId: NewId,
): { facts: Fact[]; added: number } {
  if (incoming.length === 0) return { facts: [...existing], added: 0 };
  const { added } = pairBySimilarity(
    existing.map((fact) => fact.text),
    incoming.map((fact) => fact.value),
    ENGINE.merge.factSimilarity,
  );
  const facts = [...existing];
  for (const j of added) {
    const entry = incoming[j]!;
    const source = src(entry.quote);
    // A task a model read out of a second document is a reading, not something the person said: proposed, like what a
    // model reads out of the first one, and marked in the review of what is new until they stand behind it.
    facts.push({ id: newId(), kind: "responsibility", text: entry.value, source, status: source.via === "ai" ? "proposed" : "confirmed" });
  }
  return { facts, added: added.length };
}

// --- Building conflict records ----------------------------------------------------------

function conflictOf<T>(
  entity: ConflictEntity,
  entityId: string,
  field: string,
  current: Field<T>,
  merged: FieldMerge<T>,
  newId: NewId,
  now: string,
): Conflict | null {
  if (!merged.conflict) return null;
  return {
    id: newId(),
    entity,
    entityId,
    field,
    current: { value: merged.conflict.current, ...(current.source ? { source: current.source } : {}) },
    incoming: { value: merged.conflict.incoming, source: merged.conflict.source },
    at: now,
  };
}

export type MergeContext = { newId: NewId; now: string };

/**
 * Folds a second reading of an already-stored job into it, in place. Returns
 * the conflicts it raised and how many facts were genuinely new, so the
 * caller — `applyParsedDocument` — can total them the way it already totals
 * everything else it adds.
 *
 * The company is not reconciled: it is what made this a match in the first
 * place (once a legal suffix is looked past), and two spellings of one
 * company name are not a disagreement worth asking about — merging "Nubia
 * Retail" with "Nubia Retail S.L." would only replace one true spelling with
 * another, not add information. The role is different: matching only asks it
 * to be *similar* enough — or, for one job two documents title differently,
 * not even that (`sameSlot`) — so a role that reaches here still reading
 * differently — a title in a second language, "Software Engineer" against
 * "Full Stack Developer", or a promotion the matching itself could not tell
 * apart from the job it grew out of — is a genuine disagreement between two
 * sources, and becomes a conflict like any other field; two spellings that
 * fold to the same thing change nothing.
 */
export function mergeExperienceInto(
  job: StoredExperience,
  candidate: ParsedExperience,
  src: SourceOf,
  ctx: MergeContext,
): { conflicts: Conflict[]; factsAdded: number } {
  const conflicts: Conflict[] = [];
  const push = <T>(field: string, current: Field<T>, merged: FieldMerge<T>) => {
    const conflict = conflictOf("experience", job.id, field, current, merged, ctx.newId, ctx.now);
    if (conflict) conflicts.push(conflict);
  };

  const role = mergeTextField(job.role, candidate.role, src);
  push("role", job.role, role);
  job.role = role.field;

  const city = mergeTextField(job.city, candidate.city, src);
  push("city", job.city, city);
  job.city = city.field;

  const country = mergeTextField(job.country, candidate.country, src);
  push("country", job.country, country);
  job.country = country.field;

  const start = mergeDateField(job.start, candidate.start, src);
  push("start", job.start, start);
  job.start = start.field;

  const end = mergeEndDateField(job.end, candidate.end, src);
  push("end", job.end, end);
  job.end = end.field;

  if (candidate.employmentType && !job.employmentType) {
    job.employmentType = { value: candidate.employmentType.value, status: "proposed", source: src(candidate.employmentType.quote) };
  }
  if (candidate.workMode && !job.workMode) {
    job.workMode = { value: candidate.workMode.value, status: "proposed", source: src(candidate.workMode.quote) };
  }

  const { facts, added } = mergeFacts(job.facts, candidate.facts, src, ctx.newId);
  job.facts = facts;

  return { conflicts, factsAdded: added };
}

/**
 * Folds a second reading of an already-stored degree into it, in place. Same
 * shape as the experience merge, without facts (a degree has none to union),
 * and with the title reconciled the same way a job's role is — see
 * `mergeExperienceInto` — while the institution is left as it was.
 */
export function mergeEducationInto(
  entry: StoredEducation,
  candidate: ParsedEducation,
  src: SourceOf,
  ctx: MergeContext,
): { conflicts: Conflict[] } {
  const conflicts: Conflict[] = [];
  const push = <T>(field: string, current: Field<T>, merged: FieldMerge<T>) => {
    const conflict = conflictOf("education", entry.id, field, current, merged, ctx.newId, ctx.now);
    if (conflict) conflicts.push(conflict);
  };

  const degree = mergeTextField(entry.degree, candidate.degree, src);
  push("degree", entry.degree, degree);
  entry.degree = degree.field;

  const city = mergeTextField(entry.city, candidate.city, src);
  push("city", entry.city, city);
  entry.city = city.field;

  const country = mergeTextField(entry.country, candidate.country, src);
  push("country", entry.country, country);
  entry.country = country.field;

  const start = mergeDateField(entry.start, candidate.start, src);
  push("start", entry.start, start);
  entry.start = start.field;

  const end = mergeDateField(entry.end, candidate.end, src);
  push("end", entry.end, end);
  entry.end = end.field;

  const honors = mergeTextField(entry.honors, candidate.honors, src);
  push("honors", entry.honors, honors);
  entry.honors = honors.field;

  return { conflicts };
}

/**
 * A field seen a second time outside any list — contact details, the headline —
 * the same rules as an experience or education field, just addressed by an
 * entity kind with no id of its own, since the profile has exactly one of each.
 */
export function mergeContactField(
  current: Field<string>,
  incoming: Quoted<string> | undefined,
  entity: Extract<ConflictEntity, "contact" | "legacy">,
  field: string,
  src: SourceOf,
  ctx: MergeContext,
): FieldMerge<string> & { conflictRecord: Conflict | null } {
  const merged = mergeTextField(current, incoming, src);
  return { ...merged, conflictRecord: conflictOf(entity, entity, field, current, merged, ctx.newId, ctx.now) };
}

/**
 * Words a certification's name carries, or leaves out, depending only on who
 * wrote it down: "AWS Cloud Practitioner" in a CV is LinkedIn's "AWS Certified
 * Cloud Practitioner".
 */
const CERTIFICATION_FILLER = new Set(["certified", "certification", "certificate", "certificacion", "certificado", "certificada"]);

/** A certification's name as two documents would both reduce to — see `CERTIFICATION_FILLER`. Never to nothing. */
export function certificationKey(name: string): string {
  const tokens = normalizeForComparison(name).split(" ").filter(Boolean);
  const kept = tokens.filter((token) => !CERTIFICATION_FILLER.has(token));
  return compactKey((kept.length > 0 ? kept : tokens).join(" "));
}

/**
 * A second reading of a project the profile already has: what it adds is
 * kept only where the first said nothing. The first reading's words stay —
 * two descriptions of one project are two wordings, not a choice worth asking
 * about, and there is nowhere to ask it — but a description or a link only
 * the second document had is no longer dropped on the floor.
 */
export function mergeProjectInto(project: StoredProject, candidate: ParsedProject, src: SourceOf): void {
  project.description = mergeTextField(project.description, candidate.description, src).field;
  project.url = mergeTextField(project.url, candidate.url, src).field;
}

/** A second reading of a certification: its issuer and date filled where the first had none, the same way as a project. */
export function mergeCertificationInto(certification: StoredCertification, candidate: ParsedCertification, src: SourceOf): void {
  certification.issuer = mergeTextField(certification.issuer, candidate.issuer, src).field;
  certification.date = mergeDateField(certification.date, candidate.date, src).field;
}

/**
 * A language read a second time: its level fills a gap the same way any
 * other field does, and two different levels — "B2" against "C1" — become a
 * conflict instead of either silently winning. Compared as the words the
 * person actually wrote, not the app's own reading of them: two spellings of
 * the same letter compare equal, but "B2" and "Bilingüe" disagree even where
 * `languageLevelFrom` happens to guess the same `cefr` for both.
 */
export function mergeLanguageInto(
  language: StoredLanguage,
  incoming: Quoted<string> | undefined,
  src: SourceOf,
  ctx: MergeContext,
): { conflicts: Conflict[] } {
  if (!incoming || !incoming.value.trim() || language.level.status === "edited") return { conflicts: [] };
  const currentRaw = language.level.value.raw?.trim();
  if (!currentRaw) {
    language.level = { value: languageLevelFrom(incoming.value), status: "proposed", source: src(incoming.quote) };
    return { conflicts: [] };
  }
  if (normalizeForComparison(currentRaw) === normalizeForComparison(incoming.value)) return { conflicts: [] };
  // A level the person picked from the chips is stored as the phrase on the chip: the same level, said in its word
  // or its code, is the same level.
  const { cefr } = language.level.value;
  if (cefr && currentRaw === levelPhrase(cefr) && namesLevel(cefr, incoming.value)) return { conflicts: [] };
  const conflict = conflictOf(
    "language",
    language.id,
    "level",
    language.level,
    {
      field: language.level,
      conflict: { current: language.level.value, incoming: languageLevelFrom(incoming.value), source: src(incoming.quote) },
    },
    ctx.newId,
    ctx.now,
  );
  return { conflicts: conflict ? [conflict] : [] };
}
