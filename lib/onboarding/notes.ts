import { editContext, recordChange, type EditContext } from "@/lib/profile/edit";
import { FACT_MAX } from "@/lib/profile/facts";
import type { Fact, StoredProfile, Unassigned } from "@/lib/schemas/profile-v2";
import { normalizeForComparison } from "@/lib/text/normalize";
import { packSentences, splitSentences } from "@/lib/text/sentences";

/**
 * What someone said freely — a story kept as a note, or a stretch of a document kept as one — is not lost
 * to them: it is there to be used, a sentence at a time, wherever a sentence of it is the answer to
 * something the profile still asks. Nothing here decides for them. It finds the sentences that name a
 * job, offers them, and — when they are chosen — writes them down as tasks in the words they were said in.
 */

/** A sentence shorter than this is a crumb — "Sí.", a date on its own — not something anyone did. */
const MIN_SENTENCE = 12;

const fold = (value: string) => normalizeForComparison(value);

/** What someone said freely, one sentence at a time, without the crumbs. */
export function noteSentences(text: string): string[] {
  return splitSentences(text).filter((sentence) => sentence.length >= MIN_SENTENCE);
}

/** Whether these words are already kept as a note, once case, accents and spacing are folded. */
export const hasNote = (profile: Pick<StoredProfile, "notes">, text: string): boolean => profile.notes.some((note) => fold(note.text) === fold(text));

/**
 * How long a note may be: the profile's own limit (`noteSchema`), past which what is read back is cut without a
 * word. A story is longer than that more often than it seems — three paragraphs are — so it is kept as the several
 * notes it takes, each cut between sentences, rather than as one that loses its end.
 */
const NOTE_MAX = 2000;
const NOTE_PART = 1900;

/** A story as the notes that keep it: one when it fits, as it was written; several, cut between sentences, when it does not. */
function partsOf(text: string): string[] {
  const clean = text.trim();
  if (!clean) return [];
  return clean.length <= NOTE_MAX ? [clean] : packSentences(clean, NOTE_PART);
}

/**
 * What someone told, kept as a note — the words as they were said, whichever way the story was read. Read with a
 * model, the note used to go missing: only the way without one kept it, so the person who chose to have it read for
 * them was the one whose words were nowhere afterwards. The same story kept twice (a way back, and on again) is one note.
 */
export function keepStoryAsNote(draft: StoredProfile, text: string, sourceId: string, at: string, newId: () => string): boolean {
  const fresh = partsOf(text).filter((part) => !hasNote(draft, part));
  for (const part of fresh) draft.notes.push({ id: newId(), text: part, sourceId, at });
  return fresh.length > 0;
}

/** Every sentence of every note, once each, in the order they were said. */
export function sentencesOfNotes(notes: ReadonlyArray<{ text: string }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const note of notes) {
    for (const sentence of noteSentences(note.text)) {
      const key = fold(sentence);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(sentence);
    }
  }
  return out;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether `sentence` says `name`, as whole words, once case and accents are folded. Too short a name says nothing. */
function mentions(sentence: string, name: string, shortest: number): boolean {
  const needle = fold(name);
  if (needle.length < shortest) return false;
  return new RegExp(`\\b${escapeRegExp(needle)}\\b`).test(fold(sentence));
}

/**
 * Whether a sentence names a job: by its company, or — only when the role is the one job that has it,
 * because "analista" would name three jobs at once — by its role.
 */
export function namesJob(sentence: string, job: { company: string; role: string }, roleIsDistinct: boolean): boolean {
  if (mentions(sentence, job.company, 3)) return true;
  return roleIsDistinct && mentions(sentence, job.role, 4);
}

const jobsOf = (profile: StoredProfile) => profile.experience.map((job) => ({ id: job.id, company: job.company.value, role: job.role.value }));

/** Whether no other job in the profile has this job's role, so that the role alone can name it. */
export function roleIsDistinct(profile: StoredProfile, jobId: string): boolean {
  const job = profile.experience.find((entry) => entry.id === jobId);
  const role = job ? fold(job.role.value) : "";
  if (!role) return false;
  return profile.experience.every((entry) => entry.id === jobId || fold(entry.role.value) !== role);
}

/** What the profile already says as tasks, folded — a sentence that is one of them is already used. */
export function usedSentences(profile: StoredProfile): Set<string> {
  return new Set(profile.experience.flatMap((job) => job.facts.map((fact) => fold(fact.text))));
}

/** Whether a sentence is already a task of some job. */
export const isUsed = (sentence: string, used: ReadonlySet<string>) => used.has(fold(sentence));

/**
 * The sentences that name a job — the ones to start its "¿De qué te encargabas?" from — and none that
 * are already among its tasks. Nothing to offer is `[]`: a sentence that does not name it is not
 * offered as if it did.
 */
export function sentencesAbout(profile: StoredProfile, jobId: string, max = 6): string[] {
  const job = profile.experience.find((entry) => entry.id === jobId);
  if (!job) return [];
  const taken = new Set(job.facts.map((fact) => fold(fact.text)));
  const named = { company: job.company.value, role: job.role.value };
  const distinct = roleIsDistinct(profile, jobId);
  return sentencesOfNotes(profile.notes)
    .filter((sentence) => !taken.has(fold(sentence)) && namesJob(sentence, named, distinct))
    .slice(0, max);
}

/**
 * Sentences, made tasks of a job: each in the words it was said in, credited to the person — who chose
 * where it goes — and to the document the words were said in, when there is one. A sentence the job
 * already has as a task is not added twice. Says which tasks it added.
 */
function addSaidTasks(
  draft: StoredProfile,
  experienceId: string,
  sentences: readonly string[],
  sourceOf: (sentence: string) => string | undefined,
  ctx: EditContext,
): Fact[] {
  const job = draft.experience.find((entry) => entry.id === experienceId);
  if (!job) return [];
  const taken = new Set(job.facts.map((fact) => fold(fact.text)));
  const added: Fact[] = [];
  for (const sentence of sentences) {
    const text = sentence.replace(/\s+/g, " ").trim().slice(0, FACT_MAX);
    if (!text || taken.has(fold(text))) continue;
    taken.add(fold(text));
    const docId = sourceOf(sentence);
    const fact: Fact = {
      id: ctx.newId(),
      kind: "responsibility",
      text,
      source: { kind: "manual", ...(docId ? { docId } : {}), quote: text, at: ctx.now },
      status: "confirmed",
    };
    job.facts.push(fact);
    recordChange(draft, { op: "add", path: ["experience", experienceId, "facts", fact.id], label: text.slice(0, 80) }, ctx);
    added.push(fact);
  }
  return added;
}

/**
 * Sentences of one note, made tasks of a job. The note itself is left as it is: it is where the words
 * were said, and taking the sentences out of it would make undoing this a two-part affair.
 */
export function passNoteToJob(
  draft: StoredProfile,
  noteId: string,
  experienceId: string,
  sentences: readonly string[],
  ctx: EditContext = editContext(),
): Fact[] {
  const note = draft.notes.find((entry) => entry.id === noteId);
  if (!note) return [];
  return addSaidTasks(draft, experienceId, sentences, () => note.sourceId, ctx);
}

/** Sentences from anywhere in what was said, made tasks of a job: each credited to the note it was said in. */
export function passSentencesToJob(draft: StoredProfile, experienceId: string, sentences: readonly string[], ctx: EditContext = editContext()): Fact[] {
  const sourceOf = (sentence: string) => draft.notes.find((note) => fold(note.text).includes(fold(sentence)))?.sourceId;
  return addSaidTasks(draft, experienceId, sentences, sourceOf, ctx);
}

/** The jobs a note can be passed to: the ones with something to call them by. */
export const passableJobs = (profile: StoredProfile) => jobsOf(profile).filter((job) => job.company || job.role);

// --- What a document could not place ---------------------------------------------------------------------------

/**
 * The kinds of text in the tray that can be about what someone did in a job. References, links, skills and interests
 * say nothing of a job's work, and a line of them that happens to name a company is not a task of it.
 */
const ABOUT_WORK: ReadonlySet<Unassigned["kind"]> = new Set(["awards", "other", "summary"]);

export type TrayLine = { id: string; text: string; sourceId?: string };

/**
 * The lines of the "Sin asignar" tray that name a job, and are not already among its tasks: the same test as
 * `sentencesAbout`, over what a document could not place instead of over what was said at the start. A "Logros"
 * heading is read as awards, and its lines wait in the tray while "¿Hubo algo que mejorara…?" is asked of the very job
 * they are about; this is how that question can see them. Only found: nothing here writes anything.
 */
export function unassignedAbout(profile: StoredProfile, jobId: string, max = 3): TrayLine[] {
  const job = profile.experience.find((entry) => entry.id === jobId);
  if (!job) return [];
  const taken = new Set(job.facts.map((fact) => fold(fact.text)));
  const named = { company: job.company.value, role: job.role.value };
  const distinct = roleIsDistinct(profile, jobId);
  return profile.unassigned
    .filter((item) => ABOUT_WORK.has(item.kind) && !taken.has(fold(item.text)) && namesJob(item.text, named, distinct))
    .slice(0, max)
    .map((item) => ({ id: item.id, text: item.text, ...(item.sourceId ? { sourceId: item.sourceId } : {}) }));
}

/**
 * A line of the tray, made one of a job's facts: in the words it had, credited to the person — who chose where it goes —
 * and to the document it was in. A task by default; an achievement when it is taken as the answer to what improved.
 * Says which fact it made, or that there was nothing to take.
 */
export function takeFromTray(
  draft: StoredProfile,
  id: string,
  experienceId: string,
  kind: "responsibility" | "achievement" = "responsibility",
  ctx: EditContext = editContext(),
): Fact | null {
  const index = draft.unassigned.findIndex((item) => item.id === id);
  const job = draft.experience.find((entry) => entry.id === experienceId);
  if (index === -1 || !job) return null;
  const [item] = draft.unassigned.splice(index, 1);
  const fact: Fact = {
    id: ctx.newId(),
    kind,
    text: item!.text.replace(/\s+/g, " ").trim().slice(0, FACT_MAX),
    source: {
      kind: "manual",
      ...(item!.sourceId ? { docId: item!.sourceId } : {}),
      quote: item!.text.slice(0, FACT_MAX),
      at: ctx.now,
    },
    status: "confirmed",
  };
  job.facts.push(fact);
  recordChange(draft, { op: "add", path: ["experience", experienceId, "facts", fact.id], label: item!.text.slice(0, 80) }, ctx);
  return fact;
}
