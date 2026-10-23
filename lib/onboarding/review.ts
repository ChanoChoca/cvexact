import { findUrls, linkLabel } from "@/lib/parse/patterns";
import { countPendingFromSource } from "@/lib/parse/to-profile";
import type { ParsedDocument } from "@/lib/parse/types";
import { normalizeUrl, practicalSchema } from "@/lib/schemas/profile";
import { emailProblem } from "@/lib/profile/email";
import { MAX_LINKS, linkKey } from "@/lib/profile/links";
import { withoutCurrent, type DateValue, type EndDateValue } from "@/lib/profile/dates";
import {
  archiveEntity,
  editContext,
  editedField,
  editFieldAt,
  getAt,
  isBlankList,
  isBlankText,
  jsonEqual,
  recordChange,
  saysNothing,
  setAt,
  type EditContext,
  type Path,
} from "@/lib/profile/edit";
import {
  isMeaningfulExperience,
  isPersonSource,
  type Conflict,
  type EmploymentType,
  type Field,
  type ImportedSource,
  type ReadCounts,
  type Source,
  type Status,
  type StoredEducation,
  type StoredExperience,
  type StoredProfile,
  type Unassigned,
  type WorkMode,
} from "@/lib/schemas/profile-v2";
import { skillKey } from "@/lib/text/normalize";
import { declineTools } from "./answer";
import { isExperienceLeftover } from "./convert";
import { SELF_EMPLOYED } from "./entries";
import { keepStoryAsNote, takeFromTray } from "./notes";
import { isKnownTool } from "./tools";

/**
 * What the person can do to what was read, on the review screen.
 *
 * Each of these edits a draft and returns whether it found what it was asked
 * about. They go through the same primitives as every other edit — an edited
 * value remembers where it came from and what it was, a removed one is archived —
 * so nothing done here is more permanent than an edit anywhere else.
 */

/**
 * A value the person has stood behind: a proposal becomes theirs, and — whatever it was — the day they said so is kept (`confirmedAt`),
 * so that what is asked about later, «¿sigue igual?», counts from it. Nothing is stamped on an empty value: there is nothing there to
 * have stood behind, and a date on it would say a review happened where there was nothing to review.
 */
const confirmField = <T>(field: Field<T>, now: string): Field<T> => {
  const status = field.status === "proposed" ? "confirmed" : field.status;
  return saysNothing(field.value) ? (status === field.status ? field : { ...field, status }) : { ...field, status, confirmedAt: now };
};

const confirmed = (status: Status): Status => (status === "proposed" ? "confirmed" : status);

/** The moment the person confirmed, by their own clock: a review is one act, and every value it confirms is stamped with the same instant. */
const stampNow = (): string => new Date().toISOString();

export function confirmExperience(draft: StoredProfile, id: string, now: string = stampNow()): boolean {
  const job = draft.experience.find((entry) => entry.id === id);
  if (!job) return false;
  job.company = confirmField(job.company, now);
  job.role = confirmField(job.role, now);
  job.city = confirmField(job.city, now);
  job.country = confirmField(job.country, now);
  job.start = confirmField(job.start, now);
  job.end = confirmField(job.end, now);
  if (job.employmentType) job.employmentType = confirmField(job.employmentType, now);
  if (job.workMode) job.workMode = confirmField(job.workMode, now);
  for (const fact of job.facts) {
    fact.status = confirmed(fact.status);
    if (fact.text.trim() !== "") fact.confirmedAt = now;
  }
  delete job.review;
  return true;
}

export function confirmEducation(draft: StoredProfile, id: string, now: string = stampNow()): boolean {
  const entry = draft.education.find((item) => item.id === id);
  if (!entry) return false;
  entry.institution = confirmField(entry.institution, now);
  entry.degree = confirmField(entry.degree, now);
  entry.city = confirmField(entry.city, now);
  entry.country = confirmField(entry.country, now);
  entry.start = confirmField(entry.start, now);
  entry.end = confirmField(entry.end, now);
  entry.honors = confirmField(entry.honors, now);
  entry.status = confirmField(entry.status, now);
  delete entry.review;
  return true;
}

/**
 * What a document filled in outside the timeline — "Sobre vos", the headline, the practical facts — is shown on the review
 * with a way to take it out, and moving on past it is standing behind it, like the tools and the contact details. Left
 * "proposed" it was never anything else: nothing ever asked about it again, and "proposed" stopped meaning anything.
 */
function confirmLegacy(draft: StoredProfile, now: string): void {
  draft.legacy.about = confirmField(draft.legacy.about, now);
  draft.legacy.headline = confirmField(draft.legacy.headline, now);
  draft.legacy.practical = confirmField(draft.legacy.practical, now);
}

/** "Los N marcados están bien": everything still waiting on a tap is taken as right. */
export function confirmAll(draft: StoredProfile, now: string = stampNow()): void {
  for (const job of draft.experience) confirmExperience(draft, job.id, now);
  for (const entry of draft.education) confirmEducation(draft, entry.id, now);
  // The tools read out of the jobs' own lines, listed apart on the same screen
  // with a way to take each out: moving on past them is standing behind them.
  for (const skill of draft.skills) skill.name = confirmField(skill.name, now);
  confirmContact(draft, now);
  confirmLegacy(draft, now);
}

/**
 * "Seguir": what nobody had a doubt about is taken as right, and what somebody did is left
 * exactly as it was — still marked, still a thing to look at, in the review's own words and in
 * the profile's — instead of being confirmed by a button that never showed it. Moving on is not
 * the same as saying they are all fine, which is what `confirmAll` is for.
 */
export function confirmUnflagged(draft: StoredProfile, now: string = stampNow()): void {
  for (const job of draft.experience) if (!needsAttention(job, draft.conflicts)) confirmExperience(draft, job.id, now);
  for (const entry of draft.education) if (!needsAttention(entry, draft.conflicts)) confirmEducation(draft, entry.id, now);
  for (const skill of draft.skills) skill.name = confirmField(skill.name, now);
  confirmContact(draft, now);
  confirmLegacy(draft, now);
}

// --- What "Los N marcados están bien" would take as right ---------------------------------------------------

/** "2021–2024", "2021–hoy", "2021": the years of a stretch, as short as a line of a list can say them. */
function yearsOf(start: DateValue, end: EndDateValue): string {
  const from = start.year;
  const to = end.current ? "hoy" : end.year;
  if (from === undefined) return to === undefined ? "" : String(to);
  return to === undefined || to === from ? String(from) : `${from}–${to}`;
}

/** A job in one line, for a list of what is about to be taken as right: "Analista · Nubia Retail · 2021–hoy". */
export function jobLine(job: StoredExperience): string {
  return [job.role.value.trim(), job.company.value.trim(), yearsOf(job.start.value, job.end.value)].filter(Boolean).join(" · ");
}

/** A study in one line, the same way: "Licenciatura en Economía · UBA · 2013–2017". */
export function studyLine(entry: StoredEducation): string {
  return [entry.degree.value.trim(), entry.institution.value.trim(), yearsOf(entry.start.value, entry.end.value)].filter(Boolean).join(" · ");
}

/**
 * The blocks still waiting on a tap, one line each, in the order the review lists them: what "Los N marcados están
 * bien" would take as right. The same ones `reviewCounts` counts as doubtful — not the disagreements between documents,
 * which a button of this kind does not settle.
 */
export function doubtfulLines(profile: StoredProfile): string[] {
  return [
    ...profile.experience.filter((job) => isMeaningfulExperience(job) && needsAttention(job)).map(jobLine),
    ...profile.education.filter((entry) => (entry.institution.value.trim() || entry.degree.value.trim()) && needsAttention(entry)).map(studyLine),
  ];
}

/** The button: it says how many, so that it is not a blanket "todo está bien". */
export const markedLabel = (count: number): string => (count === 1 ? "El marcado está bien" : `Los ${count} marcados están bien`);

/** What is asked before taking the marked blocks as right: the list of them, since an explanation of the risk does not change what people do and the list does. */
export function confirmMarkedPrompt(lines: readonly string[], shown = 8): string {
  const listed = lines.slice(0, shown).map((line) => `• ${line}`).join("\n");
  const more = lines.length > shown ? `\n… y ${lines.length - shown} más` : "";
  const what = lines.length === 1 ? "la lectura marcada" : `las ${lines.length} lecturas marcadas`;
  return `Vas a dar por buenas ${what}, tal como están:\n\n${listed}${more}\n\nLas podés cambiar cuando quieras desde tu perfil.`;
}

export type LowConfidenceSource = { sourceId: string; name: string };

/**
 * Which imported documents the pattern-based reader was not sure of — for
 * "Mejorar la lectura con tu IA": the ones with at least one block still
 * carrying `review` (one the person has already confirmed is not a reason to
 * re-read the document that gave it), and the ones whose experience section it
 * could not cut at all — no dates to cut it at, so not one job came of it — and
 * left whole in "Sin asignar", which is the least it can be unsure of.
 *
 * A data export (`linkedin_csv`) is excluded even if it left something in
 * `review`: it is rows, not lines of text — `saveSource` never gets anything
 * to keep for it (`ParsedDocument.lines` is only ever set for the readers that
 * work over text) — so a second, AI-assisted pass has nothing to read and
 * would fail every time it was offered. It is also already the more
 * structured of the two LinkedIn imports, not the one this offer exists for.
 */
export function lowConfidenceSources(profile: StoredProfile): LowConfidenceSource[] {
  const docIds = new Set<string>();
  for (const job of profile.experience) {
    if (job.review?.confidence === "low") {
      const id = job.company.source?.docId ?? job.role.source?.docId;
      if (id) docIds.add(id);
    }
  }
  for (const entry of profile.education) {
    if (entry.review?.confidence === "low") {
      const id = entry.institution.source?.docId ?? entry.degree.source?.docId;
      if (id) docIds.add(id);
    }
  }
  // A document that gave some jobs did cut its experience section: what is left under that heading is a stray line or two.
  const gaveJobs = new Set(profile.experience.flatMap((job) => [job.company.source?.docId, job.role.source?.docId]));
  for (const item of profile.unassigned) {
    if (item.sourceId && !gaveJobs.has(item.sourceId) && isExperienceLeftover(item)) docIds.add(item.sourceId);
  }
  return [...docIds].flatMap((sourceId) => {
    const source = profile.sources.find((entry) => entry.id === sourceId);
    // What someone said freely was already read by a model if it was read at all, and a data export is rows, not text.
    return source && source.kind !== "linkedin_csv" && source.kind !== "dump" ? [{ sourceId, name: source.name || "tu documento" }] : [];
  });
}

export type AiReadingPlan =
  | { action: "reject"; message: string }
  | { action: "confirm"; message: string; removing: number; adding: number }
  | { action: "replace" };

/**
 * Whether "Mejorar la lectura con tu IA" is safe to apply outright, needs the
 * person's OK first, or should be refused — decided by comparing what this
 * document's still-unconfirmed blocks are today (`countPendingFromSource`,
 * what `replaceSource` would clear) against what the fresh AI reading found
 * for it, *before either touches the profile*.
 *
 * A reading that found nothing checkable at all — every block failed
 * `verifyExtraction`'s citation check — must not quietly empty out what the
 * heuristic parser already had; that is exactly the "si falla, se usa el
 * resultado heurístico" the spec promises. One that found *fewer* blocks than
 * are there today is the one shape that can only mean something was lost,
 * not merely reworded, so it asks rather than silently trusting the smaller
 * number. Anything else — equal or more — replaces without asking, as it
 * already did before this check existed.
 */
export function aiReadingPlan(profile: StoredProfile, sourceId: string, parsed: Pick<ParsedDocument, "experience" | "education">): AiReadingPlan {
  const removing = countPendingFromSource(profile, sourceId);
  const adding = parsed.experience.length + parsed.education.length;

  if (adding === 0) {
    return { action: "reject", message: "Tu IA no encontró nada que pudiéramos comprobar; dejamos la lectura anterior." };
  }
  if (adding < removing) {
    return {
      action: "confirm",
      removing,
      adding,
      message: `Tu IA encontró ${adding} de los ${removing} bloques que ya teníamos leídos. ¿La usamos igual?`,
    };
  }
  return { action: "replace" };
}

/**
 * Whether a block still needs the person's attention: not read with confidence,
 * not confirmed, or waiting on a conflict between two sources. `conflicts`
 * defaults to none for call sites that only have the block on hand.
 */
export function needsAttention(block: StoredExperience | StoredEducation, conflicts: readonly Conflict[] = []): boolean {
  if (conflicts.some((entry) => entry.entityId === block.id)) return true;
  if (block.review && block.review.confidence !== "high") return true;
  const fields: Array<Field<unknown>> =
    "company" in block
      ? [block.company, block.role, block.start, block.end]
      : [block.institution, block.degree, block.start, block.end];
  return fields.some((field) => field.status === "proposed");
}

export type ReviewCounts = {
  /** Jobs and studies read without enough confidence, or not yet confirmed. */
  doubtful: number;
  /** Disagreements between two documents, each one a choice to make. */
  conflicts: number;
  /** Texts that fit no section. */
  unplaced: number;
  /** Everything above: how many things there are to look at. */
  total: number;
};

/**
 * What still wants a look, told apart — a doubtful reading, two documents that disagree and
 * a text nobody could place are three different things to do, and one number for all of them
 * says nothing about which. Only blocks that show on the review count: an empty entry is a
 * ghost, not a reading.
 */
export function reviewCounts(profile: StoredProfile): ReviewCounts {
  const doubtful =
    profile.experience.filter((job) => isMeaningfulExperience(job) && needsAttention(job)).length +
    profile.education.filter((entry) => (entry.institution.value.trim() || entry.degree.value.trim()) && needsAttention(entry)).length;
  const conflicts = profile.conflicts.length;
  const unplaced = profile.unassigned.length;
  return { doubtful, conflicts, unplaced, total: doubtful + conflicts + unplaced };
}

/** What a PDF reader leaves where it could not recover a letter. */
const UNREADABLE = "�";

const hasUnreadable = (value: unknown): boolean => JSON.stringify(value).includes(UNREADABLE);

export type UnreadableIn = {
  experience: ReadonlySet<string>;
  education: ReadonlySet<string>;
  /** In something that is not a card of the review — contact, skills, languages… — where a mark on the card cannot point at it. */
  elsewhere: boolean;
};

/**
 * Where a letter the reader could not recover ended up. Never guessed at, so it is always
 * worth a look by eye — and worth pointing at the block it is in instead of at the whole screen.
 */
export function unreadableIn(profile: StoredProfile): UnreadableIn {
  return {
    experience: new Set(profile.experience.filter(hasUnreadable).map((job) => job.id)),
    education: new Set(profile.education.filter(hasUnreadable).map((entry) => entry.id)),
    elsewhere: hasUnreadable({
      contact: profile.contact,
      skills: profile.skills,
      languages: profile.languages,
      certifications: profile.certifications,
      projects: profile.projects,
      legacy: profile.legacy,
      unassigned: profile.unassigned,
    }),
  };
}

// --- What was read, said back ---------------------------------------------------------------

const READ_WORDS: ReadonlyArray<readonly [Exclude<keyof ReadCounts, "unassigned" | "conflicts">, string, string]> = [
  ["experience", "puesto", "puestos"],
  ["education", "estudio", "estudios"],
  ["facts", "tarea", "tareas"],
  ["skills", "habilidad", "habilidades"],
  ["languages", "idioma", "idiomas"],
  ["certifications", "certificación", "certificaciones"],
  ["projects", "proyecto", "proyectos"],
];

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "4 puestos, 2 estudios y 23 tareas": a list said the way it is read out. */
function said(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

/** "2 lecturas dudosas, 1 diferencia entre tus documentos y 3 textos sin ubicar": what there is to look at, told apart. */
export function reviewSummary(counts: Pick<ReviewCounts, "doubtful" | "conflicts" | "unplaced">): string {
  return said(
    [
      counts.doubtful > 0 ? plural(counts.doubtful, "lectura dudosa", "lecturas dudosas") : "",
      counts.conflicts > 0 ? plural(counts.conflicts, "diferencia entre tus documentos", "diferencias entre tus documentos") : "",
      counts.unplaced > 0 ? plural(counts.unplaced, "texto sin asignar", "textos sin asignar") : "",
    ].filter(Boolean),
  );
}

/**
 * A document read again with a model is the same document: it keeps what it was. The model is asked for a CV
 * whatever the file was — it has the instructions for a CV and for a story, none for a LinkedIn PDF — and the reading
 * came back saying "cv", so a LinkedIn profile read again was labelled «De tu CV» and lost the name the conflicts use
 * for it («De LinkedIn: …»). Only the label changes; what was extracted does not. A story is not touched: it is read
 * as the CV it is asked as, and has no other origin to go back to.
 */
export function asOriginalKind(reading: ParsedDocument, original: ImportedSource["kind"] | undefined): ParsedDocument {
  if (original !== "linkedin_pdf" && original !== "linkedin_csv") return reading;
  return reading.kind === original ? reading : { ...reading, kind: original };
}

/** A job or a study to build a career on, whatever else was read. */
const hasCareer = (profile: Pick<StoredProfile, "experience" | "education">): boolean =>
  profile.experience.some(isMeaningfulExperience) || profile.education.some((entry) => entry.institution.value.trim() || entry.degree.value.trim());

/** What a reading left to look at twice: what `reviewCounts` counts, and what it cannot. */
export type Marked = ReviewCounts & {
  /** A letter the reader could not recover, in a card of the profile or outside one. */
  unreadable: boolean;
  /** Some of it was written by a model from a photo: what it is checked against is that text, and not the photo. */
  photo: boolean;
  /** No job and no study, whatever else was read. */
  noCareer: boolean;
};

export function markedIn(profile: StoredProfile): Marked {
  const letters = unreadableIn(profile);
  return {
    ...reviewCounts(profile),
    unreadable: letters.experience.size + letters.education.size > 0 || letters.elsewhere,
    photo: profile.sources.some((source) => source.photo === true),
    noCareer: !hasCareer(profile),
  };
}

/**
 * Whether a reading has nothing to look at twice: nothing doubtful, nothing two documents disagree on, no text without a place, no lost
 * letter, nothing a model wrote from a photo, and a career to build on. Such a reading is done and says so; any other goes to the
 * profile, where what is marked is looked at (`afterImportStep`).
 */
export function readCleanly(profile: StoredProfile): boolean {
  const found = markedIn(profile);
  return found.total === 0 && !found.unreadable && !found.photo && !found.noCareer;
}

/**
 * What to tell someone whose review has no job and no study to show: what there is, and that the career is what is
 * missing — with where to put it. A document that brought only a skills list or a story that the reading could not
 * cut into jobs used to send the person back to the start with nothing said, as if it had not been read; it was,
 * and the review is where the rest is added. `null` when there is a career, or nothing else either.
 */
export function noCareerNotice(profile: Pick<StoredProfile, "experience" | "education" | "skills" | "languages" | "certifications" | "projects" | "unassigned">): string | null {
  if (hasCareer(profile)) return null;
  const found = [
    profile.skills.length > 0 ? "tus habilidades" : "",
    profile.languages.length > 0 ? "tus idiomas" : "",
    profile.certifications.length > 0 ? "tus certificaciones" : "",
    profile.projects.some((project) => project.name.value.trim()) ? "tus proyectos" : "",
  ].filter(Boolean);
  if (found.length > 0) {
    return `Leímos ${said(found)}, pero no encontramos puestos ni estudios. Podés agregarlos más abajo, en «¿Falta algo?».`;
  }
  if (profile.unassigned.length > 0) {
    return "No pudimos armar puestos ni estudios con lo que cargaste. Lo que no supimos dónde poner está más abajo, en «Sin asignar»: desde ahí podés convertirlo en puestos, o agregarlos en «¿Falta algo?».";
  }
  return null;
}

/** How much newer one document has to be than the other to be called newer: a day. Less is the same afternoon. */
const NEWER_BY_MS = 24 * 60 * 60 * 1000;

/**
 * When a document is from, as far as it can be known: what it says itself (a PDF's metadata) before what the device says of the file,
 * which a download or a copy changes. `null` when neither is there — a pasted text, a Word file, an export that kept no date.
 */
export function sourceDate(source: Pick<ImportedSource, "madeAt" | "modifiedAt"> | undefined): number | null {
  for (const value of [source?.madeAt, source?.modifiedAt]) {
    const at = value ? Date.parse(value) : Number.NaN;
    if (Number.isFinite(at)) return at;
  }
  return null;
}

export type Suggestion = { side: "current" | "incoming"; newer: number; older: number };

/**
 * Which version of a disagreement to suggest: the one from the newer document, when both versions come from documents and the
 * date of each is known, and one is newer by more than a day. Nothing otherwise — a version the person wrote, a document with no
 * date, two files from the same afternoon: it does not know, and says nothing. The date of a file is not the date of what it says
 * (a download, a copy), so this is only ever offered as a suggestion and never chosen for them.
 */
export function suggestedSide(profile: Pick<StoredProfile, "sources">, conflict: Pick<Conflict, "current" | "incoming">): Suggestion | null {
  const find = (docId: string | undefined) => (docId ? profile.sources.find((source) => source.id === docId) : undefined);
  const current = find(conflict.current.source?.docId);
  const incoming = find(conflict.incoming.source?.docId);
  if (!current || !incoming || current.id === incoming.id) return null;
  const a = sourceDate(current);
  const b = sourceDate(incoming);
  if (a === null || b === null || Math.abs(a - b) < NEWER_BY_MS) return null;
  return a > b ? { side: "current", newer: a, older: b } : { side: "incoming", newer: b, older: a };
}

export type ReadReceipt = {
  sourceId: string;
  name: string;
  text: string;
  via?: "ai";
  /** The text was written by a model from a photo of the document: see `ImportedSource.photo`. */
  photo?: true;
  /** How many lines of the document are in no field and no tray, not yet dealt with — see `looseLineCount`. Absent when none. */
  loose?: number;
};

/** What one reading added, in a sentence. `null` for a document read before this was kept. */
export function readReceipt(source: ImportedSource): ReadReceipt | null {
  const { read } = source;
  if (!read) return null;
  const found = READ_WORDS.flatMap(([key, one, many]) => (read[key] > 0 ? [plural(read[key], one, many)] : []));
  const notes = [
    read.conflicts > 0 ? plural(read.conflicts, "diferencia con lo que ya tenías", "diferencias con lo que ya tenías") : null,
    read.unassigned > 0 ? plural(read.unassigned, "texto sin asignar", "textos sin asignar") : null,
  ].filter((note): note is string => note !== null);
  const text = [found.length > 0 ? said(found) : "nada nuevo: ya estaba en tu perfil", ...notes].join(" · ");
  const loose = looseLineCount(source.loose);
  return {
    sourceId: source.id,
    name: source.name.trim() || "tu documento",
    text,
    ...(source.via ? { via: source.via } : {}),
    ...(source.photo ? { photo: true as const } : {}),
    ...(loose > 0 ? { loose } : {}),
  };
}

/**
 * What the most recent readings found, in the order they were read — the last few, so a long life of
 * imports is not a long list. Two files dropped together read in the order they were dropped.
 */
export function readReceipts(profile: StoredProfile, max = 3): ReadReceipt[] {
  const all = profile.sources
    .map((source, index) => ({ source, index }))
    .sort((a, b) => a.source.importedAt.localeCompare(b.source.importedAt) || a.index - b.index)
    .flatMap(({ source }) => {
      const receipt = readReceipt(source);
      return receipt ? [receipt] : [];
    });
  return all.slice(Math.max(0, all.length - max));
}

// --- Conflicts between sources ------------------------------------------------------------

export const CONFLICT_PATH: Record<Conflict["entity"], (entityId: string, field: string) => Path> = {
  experience: (entityId, field) => ["experience", entityId, field],
  education: (entityId, field) => ["education", entityId, field],
  language: (entityId, field) => ["languages", entityId, field],
  contact: (_entityId, field) => ["contact", field],
  legacy: (_entityId, field) => ["legacy", field],
};

export type ConflictChoice = "current" | "incoming" | { value: unknown };

/** The field as settled by picking a whole version rather than typing something new — see `resolveConflict`. */
function confirmedFrom<T>(value: T, source: Source | undefined, now: string): Field<T> {
  // Picking a version is the person saying it is so, whichever document it came from: the day they said it is kept.
  return { value, status: "confirmed", ...(source ? { source } : {}), confirmedAt: now };
}

/**
 * Settles one conflict the cross-source merge raised.
 *
 * "current" or "incoming" picks one whole version: the value was already
 * someone's own document, so it becomes `confirmed` under *that* version's
 * source, never `edited` — `edited` is for a value nobody's source produced.
 * A custom value (typed in, for the date case the spec calls "Otra fecha")
 * is the one real edit here: `editedField` marks it `edited` and keeps what
 * was there as `original`, so it can be undone like any other correction.
 * False when the conflict, or the field it points at, is gone.
 */
export function resolveConflict(
  draft: StoredProfile,
  conflictId: string,
  choice: ConflictChoice,
  ctx: EditContext = editContext(),
): boolean {
  const index = draft.conflicts.findIndex((entry) => entry.id === conflictId);
  if (index === -1) return false;
  const conflict = draft.conflicts[index]!;
  draft.conflicts.splice(index, 1);

  const path = CONFLICT_PATH[conflict.entity](conflict.entityId, conflict.field);
  const current = getAt(draft, path) as Field<unknown> | undefined;
  if (!current || typeof current !== "object" || !("value" in current) || !("status" in current)) return false;
  const next =
    choice === "current"
      ? confirmedFrom(conflict.current.value, conflict.current.source, ctx.now)
      : choice === "incoming"
        ? confirmedFrom(conflict.incoming.value, conflict.incoming.source, ctx.now)
        : editedField(current, choice.value, { isEmpty: () => false, origin: "manual", now: ctx.now });
  if (!jsonEqual(next, current)) {
    setAt(draft, path, next);
    recordChange(draft, { op: "set", path, before: current, after: next }, ctx);
  }
  return true;
}

export type ConflictSide = "cv" | "linkedin";

/** Which kind of document a value came from, for choosing by document; `null` for anything else — what someone said, wrote or had before. */
function sideOf(source: Source | undefined): ConflictSide | null {
  if (source?.kind === "cv") return "cv";
  if (source?.kind === "linkedin_pdf" || source?.kind === "linkedin_csv") return "linkedin";
  return null;
}

/**
 * The conflicts a choice "use my CV for all of it" would settle: those where exactly one
 * side comes from that kind of document. Where both do, or neither, the question was never
 * "CV or LinkedIn", and it is left for the person to settle on its own.
 */
export function conflictsFavouring(conflicts: readonly Conflict[], side: ConflictSide): Conflict[] {
  return conflicts.filter((conflict) => (sideOf(conflict.current.source) === side) !== (sideOf(conflict.incoming.source) === side));
}

/** Settles every conflict `conflictsFavouring` names, each as picking that whole version. Says how many it settled. */
export function resolveConflictsFrom(draft: StoredProfile, side: ConflictSide, ctx: EditContext = editContext()): number {
  let settled = 0;
  for (const conflict of conflictsFavouring(draft.conflicts, side)) {
    const choice = sideOf(conflict.current.source) === side ? "current" : "incoming";
    if (resolveConflict(draft, conflict.id, choice, ctx)) settled += 1;
  }
  return settled;
}

// --- Correcting ---------------------------------------------------------------------------

export type ExperiencePatch = {
  company?: string;
  role?: string;
  city?: string;
  country?: string;
  start?: DateValue;
  end?: EndDateValue;
  employmentType?: EmploymentType;
  workMode?: WorkMode;
};

const isBlankDate = (value: EndDateValue): boolean => value.year === undefined && !value.raw && !value.current;

function apply<T>(
  draft: StoredProfile,
  holder: Record<string, unknown>,
  key: string,
  path: string[],
  value: T,
  isEmpty: (value: T) => boolean,
  ctx: EditContext,
) {
  const current = holder[key] as Field<T>;
  const next = editedField(current, value, { isEmpty, origin: "manual", now: ctx.now });
  if (next === current) return;
  recordChange(draft, { op: "set", path, before: current, after: next }, ctx);
  holder[key] = next;
}

/**
 * A closed choice — employment type, work mode — that may not be there yet: they are only ever set when a
 * source said so outright, so picking one for the first time creates it, and picking another edits it.
 * Either way it is the person's own choice, never inferred from the role.
 */
function applyChoice<T extends string>(draft: StoredProfile, holder: Record<string, unknown>, key: string, path: string[], value: T, ctx: EditContext) {
  const current = holder[key] as Field<T> | undefined;
  if (current?.value === value) return;
  const next: Field<T> = current
    ? editedField(current, value, { isEmpty: () => false, origin: "manual", now: ctx.now })
    : { value, status: "confirmed", source: { kind: "manual", at: ctx.now } };
  if (next === current) return;
  recordChange(draft, { op: "set", path, before: current, after: next }, ctx);
  holder[key] = next;
}

/**
 * "Por mi cuenta", for a job that has no employer: it is saved as the place, and the kind of work as freelance — unless a
 * source already said which kind it was, in which case that stays: someone can be on their own and full time, and a
 * button about the place is not a correction of what a document said about the contract.
 */
export function setSelfEmployed(draft: StoredProfile, id: string, ctx: EditContext = editContext()): boolean {
  const job = draft.experience.find((entry) => entry.id === id);
  if (!job) return false;
  return editExperience(draft, id, { company: SELF_EMPLOYED, ...(job.employmentType ? {} : { employmentType: "freelance" as const }) }, ctx);
}

/** Applies what the person typed to a job, field by field, keeping what did not change. */
export function editExperience(draft: StoredProfile, id: string, patch: ExperiencePatch, ctx: EditContext = editContext()): boolean {
  const job = draft.experience.find((entry) => entry.id === id);
  if (!job) return false;
  const at = ["experience", id];
  const holder = job as unknown as Record<string, unknown>;
  for (const key of ["company", "role", "city", "country"] as const) {
    const value = patch[key];
    if (value !== undefined) apply(draft, holder, key, [...at, key], value.trim(), isBlankText, ctx);
  }
  if (patch.start !== undefined) apply<EndDateValue>(draft, holder, "start", [...at, "start"], withoutCurrent(patch.start), isBlankDate, ctx);
  if (patch.end !== undefined) apply<EndDateValue>(draft, holder, "end", [...at, "end"], patch.end, isBlankDate, ctx);
  if (patch.employmentType !== undefined) applyChoice(draft, holder, "employmentType", [...at, "employmentType"], patch.employmentType, ctx);
  if (patch.workMode !== undefined) applyChoice(draft, holder, "workMode", [...at, "workMode"], patch.workMode, ctx);
  return true;
}

export type EducationPatch = {
  institution?: string;
  degree?: string;
  city?: string;
  country?: string;
  honors?: string;
  start?: DateValue;
  end?: EndDateValue;
  /** "Actualmente" for a study: there is no `current` on its end date, only this. */
  status?: "completed" | "in_progress";
};

export function editEducation(draft: StoredProfile, id: string, patch: EducationPatch, ctx: EditContext = editContext()): boolean {
  const entry = draft.education.find((item) => item.id === id);
  if (!entry) return false;
  const at = ["education", id];
  const holder = entry as unknown as Record<string, unknown>;
  for (const key of ["institution", "degree", "city", "country", "honors"] as const) {
    const value = patch[key];
    if (value !== undefined) apply(draft, holder, key, [...at, key], value.trim(), isBlankText, ctx);
  }
  if (patch.start !== undefined) apply<EndDateValue>(draft, holder, "start", [...at, "start"], withoutCurrent(patch.start), isBlankDate, ctx);
  if (patch.end !== undefined) apply<EndDateValue>(draft, holder, "end", [...at, "end"], patch.end, isBlankDate, ctx);
  if (patch.status !== undefined) apply(draft, holder, "status", [...at, "status"], patch.status, (value) => value === "completed", ctx);
  return true;
}

/**
 * What a card can resolve of its own doubts without opening the whole form: the one missing thing, said where the doubt is.
 * A doubt is a missing or unreadable field, and what settles it is that field — so it is asked right under the doubt, and
 * the rest of the card is left as it was read.
 */
export type DoubtFix =
  /** The company or the role of a job, the institution or the degree of a study. */
  | { doubt: "no_company" | "no_role" | "no_institution" | "no_degree"; value: string }
  /** The whole stretch: when nothing of it was found, or a date could not be read and it is written again. */
  | { doubt: "no_dates" | "unreadable_date"; start: DateValue; end: DateValue; current: boolean }
  /** Only the end. */
  | { doubt: "no_end"; end: DateValue; current: boolean };

/** The doubts each kind of card can resolve itself; the others (which line is which, a guessed city) are looks and not blanks. */
export const FIXABLE_DOUBTS = {
  experience: ["no_company", "no_role", "no_dates", "unreadable_date", "no_end"],
  education: ["no_institution", "no_degree", "no_dates", "unreadable_date", "no_end"],
} as const;

/** What the person gave, as the edit it is: the stretch's end is "current" or a date, never both. */
function datesPatch(fix: Extract<DoubtFix, { doubt: "no_dates" | "unreadable_date" | "no_end" }>): { start?: DateValue; end: EndDateValue } {
  const end: EndDateValue = fix.current ? { current: true } : fix.end;
  return fix.doubt === "no_end" ? { end } : { start: fix.start, end };
}

/** A field the person wrote or changed, as opposed to one a reading filled in: only their hand puts a doubt right. */
const byPerson = (field: Field<unknown>): boolean => field.status === "edited" || isPersonSource(field.source?.kind);

/**
 * Whether the person has put a doubt right, judged by what the block holds now: a blank that is filled in, a stretch with its start, an
 * end. The two «looks» (which line is which, a guessed city) have nothing to fill, so they count once the person has changed the field
 * they are about — and a doubt this does not know is never settled by itself.
 */
function doubtSettled(block: StoredExperience | StoredEducation, doubt: string): boolean {
  const [first, second] = "company" in block ? [block.company, block.role] : [block.institution, block.degree];
  const filled = (field: Field<string>) => field.value.trim() !== "" && byPerson(field);
  // A study's end has no `current`: «Actualmente» is its status.
  const end: EndDateValue = block.end.value;
  switch (doubt) {
    case "no_company":
    case "no_institution":
      return filled(first);
    case "no_role":
    case "no_degree":
      return filled(second);
    case "no_dates":
    case "unreadable_date":
      return block.start.value.year !== undefined && (byPerson(block.start) || byPerson(block.end));
    case "no_end":
      return ((end.year !== undefined || Boolean(end.current)) && byPerson(block.end)) || ("status" in block && block.status.value === "in_progress" && byPerson(block.status));
    case "company_or_role":
      return byPerson(first) || byPerson(second);
    case "location_guess":
      return byPerson(block.city) || byPerson(block.country);
    default:
      return false;
  }
}

/** Drops the doubts the person has put right, and says whether none is left: then correcting it was standing behind it. */
function settleDoubts(block: StoredExperience | StoredEducation): boolean {
  const { review } = block;
  if (!review) return true;
  review.doubts = review.doubts.filter((doubt) => !doubtSettled(block, doubt));
  if (!review.doubts.includes("company_or_role")) delete review.candidates;
  return review.doubts.length === 0;
}

/** One doubt the person answered from its own control goes whatever the block holds; the rest are judged by what it holds. */
function settleDoubt(block: StoredExperience | StoredEducation, doubt: string): boolean {
  if (!block.review) return true;
  block.review.doubts = block.review.doubts.filter((entry) => entry !== doubt);
  return settleDoubts(block);
}

/**
 * After the person changed a field of a job by hand: the doubts that change put right go, and with the last one the block is theirs —
 * as when it is answered from the doubt's own control. A block marked only for being unsure has no doubt an edit could answer, and stays
 * for «Está bien». Says whether the job ended up confirmed.
 */
export function settleExperienceDoubts(draft: StoredProfile, id: string): boolean {
  const job = draft.experience.find((entry) => entry.id === id);
  if (!job?.review?.doubts.length) return false;
  return settleDoubts(job) && confirmExperience(draft, id);
}

/** The same, for a study. */
export function settleEducationDoubts(draft: StoredProfile, id: string): boolean {
  const entry = draft.education.find((item) => item.id === id);
  if (!entry?.review?.doubts.length) return false;
  return settleDoubts(entry) && confirmEducation(draft, id);
}

/**
 * A doubt of a job, resolved from its card. Refuses what does not settle it — a blank, or a stretch with no year in its start
 * — and says so by returning `false`, leaving the doubt where it was.
 */
export function resolveExperienceDoubt(draft: StoredProfile, id: string, fix: DoubtFix, ctx: EditContext = editContext()): boolean {
  const job = draft.experience.find((entry) => entry.id === id);
  if (!job) return false;
  if (fix.doubt === "no_company" || fix.doubt === "no_role") {
    const value = fix.value.trim();
    if (!value) return false;
    editExperience(draft, id, fix.doubt === "no_company" ? { company: value } : { role: value }, ctx);
  } else if (fix.doubt === "no_dates" || fix.doubt === "unreadable_date" || fix.doubt === "no_end") {
    // A stretch needs its start to be one; an end alone is what «no_end» is for.
    if (fix.doubt !== "no_end" && fix.start.year === undefined) return false;
    if (fix.doubt === "no_end" && fix.end.year === undefined && !fix.current) return false;
    editExperience(draft, id, datesPatch(fix), ctx);
  } else {
    return false;
  }
  if (settleDoubt(job, fix.doubt)) confirmExperience(draft, id);
  return true;
}

/** The same, for a study: its institution, its degree, its dates. */
export function resolveEducationDoubt(draft: StoredProfile, id: string, fix: DoubtFix, ctx: EditContext = editContext()): boolean {
  const entry = draft.education.find((item) => item.id === id);
  if (!entry) return false;
  if (fix.doubt === "no_institution" || fix.doubt === "no_degree") {
    const value = fix.value.trim();
    if (!value) return false;
    editEducation(draft, id, fix.doubt === "no_institution" ? { institution: value } : { degree: value }, ctx);
  } else if (fix.doubt === "no_dates" || fix.doubt === "unreadable_date" || fix.doubt === "no_end") {
    if (fix.doubt !== "no_end" && fix.start.year === undefined) return false;
    if (fix.doubt === "no_end" && fix.end.year === undefined && !fix.current) return false;
    const patch = datesPatch(fix);
    // "Actualmente" for a study is its status, not a flag on its end: the end is cleared, as the card's own form does.
    editEducation(
      draft,
      id,
      {
        ...(patch.start ? { start: patch.start } : {}),
        end: fix.current ? {} : patch.end,
        ...(fix.current ? { status: "in_progress" as const } : {}),
      },
      ctx,
    );
  } else {
    return false;
  }
  if (settleDoubt(entry, fix.doubt)) confirmEducation(draft, id);
  return true;
}

/**
 * The company was read as the role and the role as the company. Swapping is one
 * tap, and it is a correction: both values are the person's now, marked edited.
 */
export function swapCompanyAndRole(draft: StoredProfile, id: string, ctx: EditContext = editContext()): boolean {
  const job = draft.experience.find((entry) => entry.id === id);
  if (!job) return false;
  const company = job.company.value;
  const role = job.role.value;
  editExperience(draft, id, { company: role, role: company }, ctx);
  // Once the person has said which is which, the doubt is settled — and with it the block, if it was the last.
  if (job.review && settleDoubt(job, "company_or_role")) confirmExperience(draft, id);
  return true;
}

// --- Removing ------------------------------------------------------------------------------

type ListKind = "experience" | "education" | "skill" | "language" | "certification" | "project" | "note";

/** Where each kind of entity lives in the profile. */
const LIST_OF: Record<ListKind, "experience" | "education" | "skills" | "languages" | "certifications" | "projects" | "notes"> = {
  experience: "experience",
  education: "education",
  skill: "skills",
  language: "languages",
  certification: "certifications",
  project: "projects",
  note: "notes",
};

function removeFrom<T extends { id: string }>(
  draft: StoredProfile,
  list: T[],
  id: string,
  kind: ListKind,
  label: (entry: T) => string,
  ctx: EditContext,
): boolean {
  const index = list.findIndex((entry) => entry.id === id);
  if (index === -1) return false;
  const [entry] = list.splice(index, 1);
  const where = LIST_OF[kind];
  const archived = archiveEntity(draft, kind, [where], entry!, label(entry!), ctx, index);
  recordChange(
    draft,
    { op: "remove", path: [where, id], label: label(entry!), before: { archiveId: archived.id } },
    ctx,
  );
  return true;
}

export const removeExperience = (draft: StoredProfile, id: string, ctx: EditContext = editContext()) =>
  removeFrom(draft, draft.experience, id, "experience", (job) => [job.company.value, job.role.value].filter(Boolean).join(" — "), ctx);

export const removeEducation = (draft: StoredProfile, id: string, ctx: EditContext = editContext()) =>
  removeFrom(draft, draft.education, id, "education", (entry) => [entry.institution.value, entry.degree.value].filter(Boolean).join(" — "), ctx);

/**
 * A skill, taken out — and, when it is a tool the list knows, turned down as a
 * suggestion as well: the person's own lines may still name it, and the next
 * "¿Las agrego?" would offer back exactly what they just removed. Undoing the
 * removal brings the skill back, and a skill is never offered anyway.
 */
export function removeSkill(draft: StoredProfile, id: string, ctx: EditContext = editContext()): boolean {
  const name = draft.skills.find((skill) => skill.id === id)?.name.value ?? "";
  if (!removeFrom(draft, draft.skills, id, "skill", (skill) => skill.name.value, ctx)) return false;
  if (isKnownTool(name)) declineTools(draft, [name], ctx);
  return true;
}

export const removeLanguage = (draft: StoredProfile, id: string, ctx: EditContext = editContext()) =>
  removeFrom(draft, draft.languages, id, "language", (language) => language.name.value, ctx);

/** A note — what someone said freely, or a text kept from a document — taken out. It goes to the archive and can come back. */
export const removeNote = (draft: StoredProfile, id: string, ctx: EditContext = editContext()) =>
  removeFrom(draft, draft.notes, id, "note", (note) => note.text.replace(/\s+/g, " ").trim().slice(0, 60), ctx);

export const removeCertification = (draft: StoredProfile, id: string, ctx: EditContext = editContext()) =>
  removeFrom(draft, draft.certifications, id, "certification", (cert) => cert.name.value, ctx);

export const removeProject = (draft: StoredProfile, id: string, ctx: EditContext = editContext()) =>
  removeFrom(draft, draft.projects, id, "project", (project) => project.name.value, ctx);

// --- Contact ----------------------------------------------------------------------------------------

/**
 * Moving on past the contact card: what was read as it was is confirmed — that is the whole point of
 * showing it — and one they changed is already an edit. An email that does not look like one is left as
 * it was read: standing behind it would be saying it is right, and the card is still saying otherwise.
 */
export function confirmContact(draft: StoredProfile, now: string = stampNow()): void {
  const { contact } = draft;
  contact.fullName = confirmField(contact.fullName, now);
  if (!emailProblem(contact.email.value)) contact.email = confirmField(contact.email, now);
  contact.phone = confirmField(contact.phone, now);
  contact.city = confirmField(contact.city, now);
  contact.country = confirmField(contact.country, now);
  contact.links = confirmField(contact.links, now);
}

// --- What was in a document and ended nowhere ---------------------------------------------------------------------

/** First and last line of a stretch of an original, both included. */
export type LooseRange = readonly [number, number];

/** How many lines the stretches a reading left over add up to. */
export const looseLineCount = (ranges: ReadonlyArray<LooseRange> | undefined): number =>
  (ranges ?? []).reduce((total, [from, to]) => total + (to - from + 1), 0);

/** «7 líneas de tu CV no quedaron en ningún lado»: what a reading left over, in the terms of the document it was left over from. */
export function looseSummary(lines: number, kind: ImportedSource["kind"]): string {
  const whose = kind === "linkedin_pdf" ? "tu perfil de LinkedIn" : "tu CV";
  return `${plural(lines, "línea", "líneas")} de ${whose} ${lines === 1 ? "no quedó" : "no quedaron"} en ningún lado`;
}

/** What a stretch says, as it is in the original: its lines, without the empty ones. */
export function looseText(lines: readonly string[], [from, to]: LooseRange): string {
  return lines
    .slice(from, to + 1)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

/** A stretch the person has dealt with comes off the list: whichever way, it was looked at. */
function takeLoose(draft: StoredProfile, sourceId: string, [from, to]: LooseRange): boolean {
  const source = draft.sources.find((entry) => entry.id === sourceId);
  const at = source?.loose?.findIndex((range) => range[0] === from && range[1] === to) ?? -1;
  if (!source?.loose || at === -1) return false;
  source.loose.splice(at, 1);
  if (source.loose.length === 0) delete source.loose;
  return true;
}

/** Kept as a note — which the questions then offer to the job it is about — and off the list. Nothing is lost by choosing this. */
export function looseToNote(draft: StoredProfile, sourceId: string, range: LooseRange, text: string, ctx: EditContext = editContext()): boolean {
  if (!takeLoose(draft, sourceId, range)) return false;
  keepStoryAsNote(draft, text, sourceId, ctx.now, ctx.newId);
  return true;
}

/** The person says this is not needed. It goes off the list; the document it came from still has it. */
export function dismissLoose(draft: StoredProfile, sourceId: string, range: LooseRange): boolean {
  return takeLoose(draft, sourceId, range);
}

/** All of what a document left over, let go in one go. */
export function dismissAllLoose(draft: StoredProfile, sourceId: string): boolean {
  const source = draft.sources.find((entry) => entry.id === sourceId);
  if (!source?.loose) return false;
  delete source.loose;
  return true;
}

// --- The tray of what fit nowhere ------------------------------------------------------------------

/** Text that fit no section, kept as a note. Nothing is lost by choosing this. */
export function unassignedToNote(draft: StoredProfile, id: string, ctx: EditContext = editContext()): boolean {
  const index = draft.unassigned.findIndex((item) => item.id === id);
  if (index === -1) return false;
  const [item] = draft.unassigned.splice(index, 1);
  draft.notes.push({ id: ctx.newId(), text: item!.text, ...(item!.sourceId ? { sourceId: item!.sourceId } : {}), at: ctx.now });
  return true;
}

/** The person says this text is not needed. It goes; the document it came from still has it. */
export function dismissUnassigned(draft: StoredProfile, id: string): boolean {
  const index = draft.unassigned.findIndex((item) => item.id === id);
  if (index === -1) return false;
  draft.unassigned.splice(index, 1);
  return true;
}

function takeUnassigned(draft: StoredProfile, id: string): Unassigned | null {
  const index = draft.unassigned.findIndex((item) => item.id === id);
  if (index === -1) return null;
  return draft.unassigned.splice(index, 1)[0]!;
}

/**
 * A `summary`-kind item becomes "Sobre vos", replacing whatever was there —
 * the screen confirms with the person first when there is something to lose;
 * this just does it. The one case importing already handles on its own
 * (`lib/parse/to-profile.ts`'s own summary merge) is a document's *first*
 * summary landing in "Sobre vos" automatically; this is for everything that
 * still ended up in the tray — a second summary in the same document, or one
 * the person would rather use than what is already there.
 */
export function unassignedToAbout(draft: StoredProfile, id: string, ctx: EditContext = editContext()): boolean {
  const item = takeUnassigned(draft, id);
  if (!item) return false;
  editFieldAt(draft, ["legacy", "about"], item.text.slice(0, 2000), isBlankText, ctx);
  return true;
}

/**
 * A `link`-kind item is added to the profile's own links, same cap as anywhere else
 * they are edited. One already there — however it was written, see `linkKey` — is
 * simply done: the item leaves the tray and the links stay as they were, instead of
 * a button that does nothing and an item that never goes. The list already full:
 * the text stays put and nothing changes.
 */
export function unassignedToLink(draft: StoredProfile, id: string, ctx: EditContext = editContext()): boolean {
  const index = draft.unassigned.findIndex((item) => item.id === id);
  if (index === -1) return false;
  const item = draft.unassigned[index]!;
  const url = findUrls(item.text)[0] ?? item.text.trim();
  if (!url) return false;
  const absolute = normalizeUrl(url);
  const links = draft.contact.links.value;
  if (links.some((link) => linkKey(link.url) === linkKey(absolute))) {
    draft.unassigned.splice(index, 1);
    return true;
  }
  if (links.length >= MAX_LINKS) return false;
  draft.unassigned.splice(index, 1);
  editFieldAt(draft, ["contact", "links"], [...links, { label: linkLabel(absolute).slice(0, 60), url: absolute }], isBlankList, ctx);
  return true;
}

/** A `skill`-kind item is added as one more skill — the same list "Habilidades" already shows, just arrived from the tray instead of the document's own skills section. */
export function unassignedToSkill(draft: StoredProfile, id: string, ctx: EditContext = editContext()): boolean {
  const index = draft.unassigned.findIndex((item) => item.id === id);
  if (index === -1) return false;
  const item = draft.unassigned[index]!;
  const name = item.text.trim();
  if (!name || name.length > 80 || draft.skills.some((skill) => skillKey(skill.name.value) === skillKey(name))) return false;
  draft.unassigned.splice(index, 1);
  const skillId = ctx.newId();
  draft.skills.push({ id: skillId, name: { value: name, status: "confirmed", source: { kind: "manual", ...(item.sourceId ? { docId: item.sourceId } : {}), quote: item.text, at: ctx.now } }, experienceIds: [] });
  recordChange(draft, { op: "add", path: ["skills", skillId], label: name }, ctx);
  return true;
}

/** An `awards`/`interests` item joins "Otros datos" — one more line, in the person's own words, rather than sitting unexplained in the tray. */
export function unassignedToExtra(draft: StoredProfile, id: string, ctx: EditContext = editContext()): boolean {
  const item = takeUnassigned(draft, id);
  if (!item) return false;
  const line = item.text.replace(/\s+/g, " ").trim();
  if (!line) return true;
  editFieldAt(draft, ["legacy", "extras"], [...draft.legacy.extras.value, line], isBlankList, ctx);
  return true;
}

/**
 * "Quitar" on the review screen's own "De tu documento" block: undoes what a
 * document's summary or practical facts just filled in, right where the
 * person can see it was filled, rather than making them go find it in the
 * hub. False, and nothing touched, once the person has already confirmed it
 * (edited it, or just moved on) — this is only for a value still `proposed`.
 */
export function clearProposedAbout(draft: StoredProfile): boolean {
  if (draft.legacy.about.status !== "proposed") return false;
  draft.legacy.about = { value: "", status: "confirmed" };
  return true;
}

/** As `clearProposedAbout`, for the headline a document proposed — shown on the review since it is confirmed by moving on from it. */
export function clearProposedHeadline(draft: StoredProfile): boolean {
  if (draft.legacy.headline.status !== "proposed") return false;
  draft.legacy.headline = { value: "", status: "confirmed" };
  return true;
}

/** As `clearProposedAbout`, for the practical facts a document proposed — all five at once, since `legacy.practical` is one field, not five. */
export function clearProposedPractical(draft: StoredProfile): boolean {
  if (draft.legacy.practical.status !== "proposed") return false;
  draft.legacy.practical = { value: practicalSchema.parse({}), status: "confirmed" };
  return true;
}

/**
 * The text belongs under a job: it becomes one of its facts, in the words it had.
 * The person chose where it goes, so it is confirmed.
 */
export function assignUnassigned(draft: StoredProfile, id: string, experienceId: string, ctx: EditContext = editContext()): boolean {
  return takeFromTray(draft, id, experienceId, "responsibility", ctx) !== null;
}
