import { hasNote, namesJob, noteSentences, passNoteToJob, roleIsDistinct } from "@/lib/onboarding/notes";
import { isMeaningfulExperience, type Note, type NoteVia, type StoredProfile } from "@/lib/schemas/profile-v2";
import { editContext, recordChange, type EditContext } from "./edit";

/**
 * «Anotá algo» (e5, O15; E4, 3a): a sentence the person writes down from wherever they are — or shares to the app from another one — kept as a note with
 * its date, to be put in its place later. The date is the point: it is what people forget first, and a note is the cheapest way to keep it. No model
 * reads it, nothing asks for it, and the only thing the app does with it is offer, once, to put it in the job it names.
 *
 * A note the person dealt with — passed to a job, or left as a note — is *settled*: it stops being «sin ordenar» and stops being asked about, and it stays
 * where it is. Nothing here deletes anything.
 */

/** The longest a note written here can be: a sentence or a few, not a story — a story has its own door (`keepStoryAsNote`). */
export const CAPTURE_MAX = 1000;

export type CaptureProblem = "empty" | "duplicate";
export type CaptureResult = { ok: true; note: Note } | { ok: false; reason: CaptureProblem };

export const CAPTURE_PROBLEM: Record<CaptureProblem, string> = {
  empty: "Escribí algo para anotar.",
  duplicate: "Eso ya lo tenés anotado.",
};

/** What was typed, as a note: line breaks kept, runs of blank lines and trailing spaces not, and no more than a note may be. */
export function cleanCapture(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, CAPTURE_MAX);
}

/** Writes a note down, with today's date and how it came. The same words are not kept twice, however they are cased or spaced. */
export function captureNote(draft: StoredProfile, text: string, via: NoteVia, ctx: EditContext = editContext()): CaptureResult {
  const clean = cleanCapture(text);
  if (clean === "") return { ok: false, reason: "empty" };
  if (hasNote(draft, clean)) return { ok: false, reason: "duplicate" };
  const note: Note = { id: ctx.newId(), text: clean, at: ctx.now, via };
  draft.notes.push(note);
  recordChange(draft, { op: "add", path: ["notes", note.id], label: clean.replace(/\s+/g, " ").slice(0, 60) }, ctx);
  return { ok: true, note };
}

/** A note written down on purpose, as opposed to one read out of a document or told as a story. */
export const isCaptured = (note: Pick<Note, "via">): boolean => note.via !== undefined;

/** The notes that wait to be put somewhere: written down or shared, and not yet dealt with. */
export const unsortedNotes = (profile: Pick<StoredProfile, "notes">): Note[] => profile.notes.filter((note) => isCaptured(note) && !note.settledAt);

/** «Tenés 4 notas sin ordenar.» — said inside the app and nowhere else, and never as something to do: a count of what is there. `null` when there is none. */
export function unsortedLine(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "Tenés 1 nota sin ordenar." : `Tenés ${count} notas sin ordenar.`;
}

/** The person dealt with the note: it is no longer asked about nor counted, and stays as it is. False when there is no such note or it already was. */
export function settleNote(draft: StoredProfile, noteId: string, ctx: EditContext = editContext()): boolean {
  const note = draft.notes.find((entry) => entry.id === noteId);
  if (!note || note.settledAt) return false;
  note.settledAt = ctx.now;
  recordChange(draft, { op: "set", path: ["notes", noteId, "settledAt"], label: note.text.replace(/\s+/g, " ").slice(0, 60), before: undefined, after: ctx.now }, ctx);
  return true;
}

export type Placeable = { note: Note; jobId: string; label: string };

const labelOf = (job: { role: string; company: string }): string => [job.role, job.company].filter(Boolean).join(" · ");

/**
 * The notes that name one job — by its company, or by its role when no other job has it — and so can be offered to it: «¿Esto va en Logística Sur?». A note
 * that names none, or two, is not guessed at: it waits in the list, with «Pasar a un puesto», for the person to say where.
 */
export function placeableNotes(profile: StoredProfile): Placeable[] {
  const jobs = profile.experience.filter(isMeaningfulExperience).map((job) => ({ id: job.id, company: job.company.value, role: job.role.value }));
  const found: Placeable[] = [];
  for (const note of unsortedNotes(profile)) {
    const named = jobs.filter((job) => namesJob(note.text, job, roleIsDistinct(profile, job.id)));
    if (named.length === 1) found.push({ note, jobId: named[0]!.id, label: labelOf(named[0]!) });
  }
  return found;
}

/** What of a note can be a task: its sentences — and, for one too short to have any, the whole of it, which is what the person wrote. */
export function sentencesToPlace(note: Pick<Note, "text">): string[] {
  const sentences = noteSentences(note.text);
  if (sentences.length > 0) return sentences;
  const whole = note.text.replace(/\s+/g, " ").trim();
  return whole.length >= 3 ? [whole] : [];
}

/** The sentences of a note, made tasks of the job it was offered to — in the words it was written in — and the note settled. False when there was nothing to add. */
export function placeNote(draft: StoredProfile, noteId: string, jobId: string, sentences: readonly string[], ctx: EditContext = editContext()): boolean {
  const added = passNoteToJob(draft, noteId, jobId, sentences, ctx);
  if (added.length === 0) return false;
  settleNote(draft, noteId, ctx);
  return true;
}
