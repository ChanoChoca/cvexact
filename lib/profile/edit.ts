import {
  archiveEntrySchema,
  certificationSchema,
  educationSchema,
  experienceSchema,
  factSchema,
  isPersonSource,
  languageSchema,
  noteSchema,
  projectSchema,
  skillSchema,
  sourceBundleSchema,
  type ArchiveEntry,
  type ArchiveKind,
  type Field,
  type HistoryEntry,
  type HistoryOp,
  type SourceBundle,
  type SourceKind,
  type StoredProfile,
} from "@/lib/schemas/profile-v2";

/**
 * How the stored profile changes: an edit says who made it, keeps what was
 * there, and can be undone; a removal archives instead of deleting.
 *
 * The rules are the ones the onboarding spec gives, applied at the one place
 * every writer goes through — the hub's editors, the guided questions and the
 * old importers reached through `reconcileFromPlain` — so none of them has to
 * remember to do it: an edited value becomes `edited` and remembers its
 * `original`; a removed one goes to the archive and can come back.
 *
 * Everything here works on a draft (a clone the caller owns) or returns a new
 * profile; nothing touches storage. `rev` and `updatedAt` are the store's to
 * bump, once per save.
 */

export const MAX_HISTORY = 300;
export const MAX_ARCHIVE = 200;
/** Edits to the same field closer together than this are one edit in the history. */
const COALESCE_MS = 30_000;

export type EditContext = {
  now: string;
  newId: () => string;
};

export const editContext = (overrides: Partial<EditContext> = {}): EditContext => ({
  now: new Date().toISOString(),
  newId: () => crypto.randomUUID(),
  ...overrides,
});

export type Path = readonly string[];

// --- Comparing and cloning JSON-like values --------------------------------------

export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]));
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const key of keys) {
    // An absent key and an `undefined` one are the same in JSON, which is where these came from.
    if (!jsonEqual(x[key], y[key])) return false;
  }
  return true;
}

export const clone = <T>(value: T): T => structuredClone(value);

/**
 * A value without the day the person last stood behind it. What a history entry is about is what changed in the value: an edit that
 * ended where it began did not change it, even though it was the last time the person said it was so — and an entry that shows
 * «Rosario» becoming «Rosario» is one nobody has any use for.
 */
function unstamped(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("confirmedAt" in value)) return value;
  const { confirmedAt: _confirmedAt, ...rest } = value as Record<string, unknown>;
  void _confirmedAt;
  return rest;
}

// --- Addressing by path -------------------------------------------------------------

/**
 * Paths are keys and ids: `["experience", "e1", "facts", "f3"]`. A list is
 * addressed by the `id` of its entries, never by position — positions shift
 * when anything before them is added or removed, which is exactly when a stored
 * path would be needed.
 */
function child(node: unknown, key: string): unknown {
  if (Array.isArray(node)) {
    return node.find((item) => item && typeof item === "object" && (item as { id?: unknown }).id === key);
  }
  if (node && typeof node === "object") return (node as Record<string, unknown>)[key];
  return undefined;
}

export function getAt(root: unknown, path: Path): unknown {
  let node = root;
  for (const key of path) {
    node = child(node, key);
    if (node === undefined) return undefined;
  }
  return node;
}

/** Replaces the value at `path`. False when the parent does not exist. */
export function setAt(root: unknown, path: Path, value: unknown): boolean {
  if (path.length === 0) return false;
  const parent = getAt(root, path.slice(0, -1));
  const key = path[path.length - 1]!;
  if (Array.isArray(parent)) {
    const index = parent.findIndex(
      (item) => item && typeof item === "object" && (item as { id?: unknown }).id === key,
    );
    if (index === -1) return false;
    parent[index] = value;
    return true;
  }
  if (parent && typeof parent === "object") {
    (parent as Record<string, unknown>)[key] = value;
    return true;
  }
  return false;
}

/** Removes the entry at `path` from its list and returns it. */
export function removeAt(root: unknown, path: Path): unknown {
  if (path.length === 0) return undefined;
  const parent = getAt(root, path.slice(0, -1));
  const key = path[path.length - 1]!;
  if (!Array.isArray(parent)) return undefined;
  const index = parent.findIndex(
    (item) => item && typeof item === "object" && (item as { id?: unknown }).id === key,
  );
  if (index === -1) return undefined;
  return parent.splice(index, 1)[0];
}

// --- Editing a value -----------------------------------------------------------------

/**
 * The field after its value was changed by the user.
 *
 * Filling an empty field is not an edit — nothing was there to correct — so it
 * is confirmed and credited to whoever supplied it. Changing or clearing a
 * value that was there is an edit: `edited`, with the first value kept in
 * `original` and never overwritten by later edits, so "deshacer" always has the
 * value the user started from.
 *
 * Whatever the way it changed, when the person is the one who changed it — they typed it, they answered with it — it is the last
 * time they stood behind it, and says so (`confirmedAt`). A reader filling a field is not them, and does not.
 */
export function editedField<T>(
  current: Field<T>,
  value: T,
  opts: { isEmpty: (value: T) => boolean; origin: SourceKind; now: string },
): Field<T> {
  if (jsonEqual(current.value, value)) return current;
  const stood = isPersonSource(opts.origin) ? { confirmedAt: opts.now } : {};
  // Typing the original back is the user standing behind it: confirmed, with
  // nothing left to remember, since the value and its original are the same.
  if (current.original !== undefined && jsonEqual(value, current.original)) {
    return {
      value,
      status: "confirmed",
      ...(current.source ? { source: current.source } : {}),
      ...stood,
    };
  }
  if (opts.isEmpty(current.value) && !opts.isEmpty(value)) {
    return {
      value,
      status: "confirmed",
      source: { kind: opts.origin, at: opts.now },
      ...(current.original !== undefined ? { original: current.original } : {}),
      ...stood,
    };
  }
  return {
    value,
    status: "edited",
    ...(current.source ? { source: current.source } : {}),
    original: current.original !== undefined ? current.original : current.value,
    ...stood,
  };
}

/**
 * Sets the field at `path` to what the person typed: an edit if it changes something
 * that was there, a plain fill if it was empty, and nothing at all if it is the same.
 * The one door for changing a field wherever it lives — a job's company, a project's
 * tags, the objective — so every field says who wrote it and keeps what it had.
 * False when there is no field at `path`.
 */
export function editFieldAt<T>(
  draft: StoredProfile,
  path: Path,
  value: T,
  isEmpty: (value: T) => boolean,
  ctx: EditContext = editContext(),
  origin: SourceKind = "manual",
): boolean {
  const current = getAt(draft, path) as Field<T> | undefined;
  if (!current || typeof current !== "object" || !("value" in current) || !("status" in current)) return false;
  const next = editedField(current, value, { isEmpty, origin, now: ctx.now });
  if (next === current) return true;
  if (!setAt(draft, path, next)) return false;
  recordChange(draft, { op: "set", path, before: current, after: next }, ctx);
  return true;
}

/**
 * Sets the field at `path` to what the person said, creating it when there is none: for the fields a record may not have at all —
 * until when a credential holds, when a job began to be a freelance one. Where there is one it is `editFieldAt`, with all it does;
 * where there is none it is a value they gave, filled in and credited to them, and a step in the history to undo like any other.
 * False when the place it would go does not exist.
 */
export function upsertFieldAt<T>(
  draft: StoredProfile,
  path: Path,
  value: T,
  isEmpty: (value: T) => boolean,
  ctx: EditContext = editContext(),
  origin: SourceKind = "manual",
): boolean {
  const current = getAt(draft, path) as Field<T> | undefined;
  if (current !== undefined) return editFieldAt(draft, path, value, isEmpty, ctx, origin);
  // Nothing was there and nothing is said: there is nothing to create.
  if (isEmpty(value)) return getAt(draft, path.slice(0, -1)) !== undefined;
  const next: Field<T> = { value, status: "confirmed", source: { kind: origin, at: ctx.now }, ...(isPersonSource(origin) ? { confirmedAt: ctx.now } : {}) };
  if (!setAt(draft, path, next)) return false;
  recordChange(draft, { op: "set", path, before: undefined, after: next }, ctx);
  return true;
}

/**
 * «Sigue igual»: the person says what is there is still so. The value is not touched — nothing about it changes but the day they last
 * stood behind it — and a value that was only proposed is now theirs. Not a step in the history: it is not an edit, and a list of
 * edits that lists every confirmation is a list nobody reads. False when there is no such field or it holds nothing to stand behind.
 */
export function confirmFieldAt(draft: StoredProfile, path: Path, now: string): boolean {
  const current = getAt(draft, path) as Field<unknown> | undefined;
  if (!current || typeof current !== "object" || !("value" in current) || !("status" in current)) return false;
  if (saysNothing(current.value)) return false;
  current.confirmedAt = now;
  if (current.status === "proposed") current.status = "confirmed";
  return true;
}

export const isBlankText = (value: string): boolean => value === "";
export const isBlankList = (value: readonly unknown[]): boolean => value.length === 0;

// --- History ---------------------------------------------------------------------------

type Change = {
  op: HistoryOp;
  path: Path;
  label?: string;
  before?: unknown;
  after?: unknown;
};

/**
 * Appends one change to the history, or folds it into the previous one.
 *
 * A field being typed in is saved every few hundred milliseconds; recording each
 * save would fill 300 entries with one sentence's worth of keystrokes and push
 * out everything worth undoing. Consecutive sets of the same field close in time
 * are one edit — the first `before`, the last `after` — and one that ends where
 * it began leaves no entry at all.
 */
export function recordChange(draft: StoredProfile, change: Change, ctx: EditContext): void {
  const last = draft.history[draft.history.length - 1];
  if (
    last &&
    change.op === "set" &&
    last.op === "set" &&
    last.path.join("/") === change.path.join("/") &&
    Date.parse(ctx.now) - Date.parse(last.at) < COALESCE_MS
  ) {
    last.after = clone(change.after);
    last.at = ctx.now;
    if (jsonEqual(unstamped(last.before), unstamped(last.after))) draft.history.pop();
    return;
  }
  const entry: HistoryEntry = {
    id: ctx.newId(),
    at: ctx.now,
    op: change.op,
    path: [...change.path],
    ...(change.label ? { label: change.label.slice(0, 200) } : {}),
    ...(change.before !== undefined ? { before: clone(change.before) } : {}),
    ...(change.after !== undefined ? { after: clone(change.after) } : {}),
  };
  draft.history.push(entry);
  if (draft.history.length > MAX_HISTORY) draft.history.splice(0, draft.history.length - MAX_HISTORY);
}

// --- Archive -----------------------------------------------------------------------------

/** Moves nothing itself: the caller has already taken the entity out of its list. */
export function archiveEntity(
  draft: StoredProfile,
  kind: ArchiveKind,
  parentPath: Path,
  entity: { id: string },
  label: string,
  ctx: EditContext,
  index?: number,
): ArchiveEntry {
  const entry: ArchiveEntry = {
    id: ctx.newId(),
    at: ctx.now,
    kind,
    parentPath: [...parentPath],
    ...(index !== undefined && index >= 0 ? { index } : {}),
    entity: clone(entity),
    label: label.slice(0, 200),
  };
  draft.archive.push(entry);
  if (draft.archive.length > MAX_ARCHIVE) draft.archive.splice(0, draft.archive.length - MAX_ARCHIVE);
  return entry;
}

const ARCHIVE_SCHEMAS = {
  fact: factSchema,
  experience: experienceSchema,
  education: educationSchema,
  certification: certificationSchema,
  language: languageSchema,
  project: projectSchema,
  skill: skillSchema,
  note: noteSchema,
  source: sourceBundleSchema,
} as const;

export type EditResult =
  | { ok: true; profile: StoredProfile }
  | { ok: false; reason: "not_found" | "parent_missing" | "changed" | "invalid" };

/** Whether a value says nothing — what a field holds once it has been emptied, until something fills it again. */
export function saysNothing(value: unknown): boolean {
  if (value === undefined || value === null || value === "" || value === false) return true;
  if (Array.isArray(value)) return value.every(saysNothing);
  if (typeof value === "object") return Object.values(value as object).every(saysNothing);
  return false;
}

/** Puts an entry back in its list at the place it was, unless it is already there. */
function insertAt<T extends { id: string }>(list: T[], entry: T, index: number): void {
  if (list.some((item) => item.id === entry.id)) return;
  list.splice(Math.min(index, list.length), 0, entry);
}

/**
 * A document and what it brought, back where they were. Everything goes back in the order it was in, so
 * the lists come out as they were; a task goes back into its job only if the job is still there; a link
 * from a skill to a job only if the job is; a field that was emptied only if it has stayed empty — what
 * has been put in it since is theirs, and is not written over.
 */
function restoreSourceBundle(draft: StoredProfile, bundle: SourceBundle): void {
  const inOrder = <T extends { index: number }>(items: readonly T[]) => [...items].sort((a, b) => a.index - b.index);

  insertAt(draft.sources, bundle.source, bundle.sourceIndex);
  for (const { entity, index } of inOrder(bundle.experience)) insertAt(draft.experience, entity, index);
  for (const { entity, index } of inOrder(bundle.education)) insertAt(draft.education, entity, index);
  for (const { experienceId, fact, index } of inOrder(bundle.facts)) {
    const job = draft.experience.find((entry) => entry.id === experienceId);
    if (job) insertAt(job.facts, fact, index);
  }
  for (const { entity, index } of inOrder(bundle.skills)) insertAt(draft.skills, entity, index);
  for (const { entity, index } of inOrder(bundle.languages)) insertAt(draft.languages, entity, index);
  for (const { entity, index } of inOrder(bundle.certifications)) insertAt(draft.certifications, entity, index);
  for (const { entity, index } of inOrder(bundle.projects)) insertAt(draft.projects, entity, index);
  for (const { entity, index } of inOrder(bundle.unassigned)) insertAt(draft.unassigned, entity, index);

  const jobIds = new Set(draft.experience.map((job) => job.id));
  for (const { skillId, experienceIds } of bundle.skillLinks) {
    const skill = draft.skills.find((entry) => entry.id === skillId);
    if (!skill) continue;
    for (const id of experienceIds) if (jobIds.has(id) && !skill.experienceIds.includes(id)) skill.experienceIds.push(id);
  }

  for (const { path, before } of bundle.resets) {
    const current = getAt(draft, path) as { value?: unknown } | undefined;
    if (current === undefined || saysNothing(current.value)) setAt(draft, path, before);
  }

  const there = (entity: SourceBundle["conflicts"][number]["entity"]): boolean => {
    switch (entity.entity) {
      case "experience":
        return draft.experience.some((job) => job.id === entity.entityId);
      case "education":
        return draft.education.some((entry) => entry.id === entity.entityId);
      case "language":
        return draft.languages.some((language) => language.id === entity.entityId);
      default:
        return true;
    }
  };
  for (const { entity, index } of inOrder(bundle.conflicts)) if (there(entity)) insertAt(draft.conflicts, entity, index);
}

/** Puts an archived entity back where it came from. */
export function restoreArchived(
  profile: StoredProfile,
  archiveId: string,
  ctx: EditContext = editContext(),
): EditResult {
  const draft = clone(profile);
  const index = draft.archive.findIndex((entry) => entry.id === archiveId);
  if (index === -1) return { ok: false, reason: "not_found" };
  const entry = archiveEntrySchema.parse(draft.archive[index]);

  // A document is not one entity in one list: it is everything it brought, each back in its own.
  if (entry.kind === "source") {
    const bundle = sourceBundleSchema.safeParse(entry.entity);
    if (!bundle.success) return { ok: false, reason: "invalid" };
    restoreSourceBundle(draft, bundle.data);
    draft.archive.splice(index, 1);
    recordChange(draft, { op: "restore", path: ["sources", bundle.data.id], label: entry.label }, ctx);
    return { ok: true, profile: draft };
  }

  const entity = ARCHIVE_SCHEMAS[entry.kind].safeParse(entry.entity);
  if (!entity.success) return { ok: false, reason: "invalid" };

  const list = getAt(draft, entry.parentPath);
  if (!Array.isArray(list)) return { ok: false, reason: "parent_missing" };
  const id = (entity.data as { id: string }).id;
  // A restored id that is already back in the list (undo, then restore) is not added twice.
  if (!list.some((item) => (item as { id?: unknown })?.id === id)) {
    list.splice(entry.index !== undefined ? Math.min(entry.index, list.length) : list.length, 0, entity.data);
  }
  draft.archive.splice(index, 1);
  recordChange(draft, { op: "restore", path: [...entry.parentPath, id], label: entry.label }, ctx);
  return { ok: true, profile: draft };
}

// --- Undo ----------------------------------------------------------------------------------

/**
 * Reverses one history entry, if what it changed is still as it left it.
 *
 * A `set` is undone only while the field still holds what the entry wrote: if
 * something has changed it since — another edit, an import, a sync — putting the
 * old value back would silently discard that. It says so instead. (The day the person
 * last stood behind the value is not part of what an edit wrote: confirming it later
 * does not stand in the way.)
 */
export function undoEntry(
  profile: StoredProfile,
  entryId: string,
  ctx: EditContext = editContext(),
): EditResult {
  const draft = clone(profile);
  const index = draft.history.findIndex((entry) => entry.id === entryId);
  if (index === -1) return { ok: false, reason: "not_found" };
  const entry = draft.history[index]!;

  if (entry.op === "set") {
    // The day the person last stood behind it is not what the entry changed: saying «sigue igual» after an edit does not make it one that
    // can no longer be taken back.
    if (!jsonEqual(unstamped(getAt(draft, entry.path)), unstamped(entry.after))) return { ok: false, reason: "changed" };
    if (!setAt(draft, entry.path, clone(entry.before))) return { ok: false, reason: "parent_missing" };
  } else if (entry.op === "add") {
    if (removeAt(draft, entry.path) === undefined) return { ok: false, reason: "not_found" };
  } else if (entry.op === "remove") {
    const archiveId = (entry.before as { archiveId?: string } | undefined)?.archiveId;
    if (!archiveId) return { ok: false, reason: "invalid" };
    // Restoring records an entry of its own, which is not something to show as
    // history: undoing a removal should leave the trail as if it never happened.
    const restored = restoreArchived(draft, archiveId, ctx);
    if (!restored.ok) return restored;
    restored.profile.history.pop();
    restored.profile.history = restored.profile.history.filter((e) => e.id !== entryId);
    return { ok: true, profile: restored.profile };
  } else {
    return { ok: false, reason: "invalid" };
  }

  draft.history.splice(index, 1);
  return { ok: true, profile: draft };
}

/**
 * Puts what is at `path` back as it was (`before`), if it is still what a change wrote (`wrote`) — «Deshacer» right after one, for a screen that
 * knows the change it made and not the step it left in the history: that step may be one with an edit the person made seconds earlier
 * (`COALESCE_MS`), and undoing it would take that edit with it. Recorded as a change of its own, which folds into the step it undoes: a
 * change taken back leaves nothing in the history. False, and nothing touched, when it has changed since.
 */
export function putBack(draft: StoredProfile, path: Path, before: unknown, wrote: unknown, ctx: EditContext = editContext()): boolean {
  const current = getAt(draft, path);
  if (before === undefined || !jsonEqual(unstamped(current), unstamped(wrote))) return false;
  if (!setAt(draft, path, clone(before))) return false;
  recordChange(draft, { op: "set", path, before: current, after: before }, ctx);
  return true;
}

export function undoLast(profile: StoredProfile, ctx: EditContext = editContext()): EditResult {
  const last = profile.history[profile.history.length - 1];
  return last ? undoEntry(profile, last.id, ctx) : { ok: false, reason: "not_found" };
}
