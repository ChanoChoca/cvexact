import { FORM_DRAFTS_KEY, readRaw, write } from "@/lib/storage/local";

/**
 * What a person was in the middle of writing, kept so that a reload does not take it.
 *
 * The first-run flow keeps its big boxes — an answer, the step of the guided profile — as drafts of their
 * own, inside the profile. The small ones did not have that: the text pasted and not yet read, the form of a card
 * being corrected, "¿Falta algo?", a date typed over a disagreement between two documents each lived in a
 * component, and a reload — or a phone switching to another app for a minute, which on a phone is the same thing —
 * emptied them. They are kept here, by name, apart from the profile: a draft saved on every keystroke would
 * otherwise be a new version of the profile on every keystroke, and what is not yet anything is not the profile's.
 *
 * Best-effort, like every draft: losing one costs a retyped line, never a failed screen. They go after a week —
 * a draft is for the next few minutes, not for a month — and are capped so that they cannot become the thing that
 * fills the browser's room.
 */

const MAX_AGE_MS = 7 * 86_400_000;
const MAX_DRAFT_CHARS = 60_000;
const MAX_TOTAL_CHARS = 150_000;

type Entry = { value: unknown; at: string };
type Store = Record<string, Entry>;

function read(): Store {
  const raw = readRaw(FORM_DRAFTS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

/**
 * Whether a draft still has the shape of the form it was a draft of. One written before a form changed would hand it
 * fields it has never heard of, or leave out ones it needs, and a form opened on that breaks where an empty one would
 * not. A key whose sample is `undefined` is optional: it is what a field nobody filled in looks like, and JSON drops it.
 */
export function sameShape(sample: Record<string, unknown>, draft: unknown): boolean {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return false;
  const found = draft as Record<string, unknown>;
  return Object.entries(sample).every(([key, value]) => value === undefined || (key in found && typeof found[key] === typeof value));
}

const isFresh = (entry: Entry | undefined, now: Date): entry is Entry =>
  Boolean(entry && typeof entry.at === "string" && now.getTime() - Date.parse(entry.at) <= MAX_AGE_MS);

/** What was kept under `key`, or `null` when there is nothing, or it is too old to be what they were doing. */
export function loadDraft<T>(key: string, now = new Date()): T | null {
  const entry = read()[key];
  return isFresh(entry, now) ? (entry.value as T) : null;
}

export function saveDraft(key: string, value: unknown, now = new Date()): void {
  const size = JSON.stringify(value)?.length ?? 0;
  // Too big to be a half-written form: not a draft, and not worth the room.
  if (size > MAX_DRAFT_CHARS) return;
  const store: Store = {};
  for (const [name, entry] of Object.entries(read())) if (name !== key && isFresh(entry, now)) store[name] = entry;
  store[key] = { value, at: now.toISOString() };
  // Over the total, the oldest go first — never the one just written.
  const ordered = Object.entries(store).sort((a, b) => a[1].at.localeCompare(b[1].at));
  let total = ordered.reduce((sum, [name, entry]) => sum + name.length + JSON.stringify(entry.value).length, 0);
  while (total > MAX_TOTAL_CHARS && ordered.length > 1) {
    const [name, entry] = ordered.shift()!;
    if (name === key) continue;
    total -= name.length + JSON.stringify(entry.value).length;
    delete store[name];
  }
  try {
    write(FORM_DRAFTS_KEY, store);
  } catch {
    // Best-effort — see the module comment.
  }
}

export function clearDraft(key: string): void {
  const store = read();
  if (!(key in store)) return;
  delete store[key];
  try {
    write(FORM_DRAFTS_KEY, store);
  } catch {
    // As above.
  }
}
