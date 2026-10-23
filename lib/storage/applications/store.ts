import { applicationSchema, type Application } from "../application";
import { openAppDatabase, type DatabaseFailure } from "../db";
import { classifyStorageError, type StorageErrorKind } from "../errors";
import { IndexedDbApplicationsEngine, LegacyApplicationsEngine, type ApplicationsEngine } from "./engine";
import { APPLICATIONS_KEY, SYNC_PING_KEY } from "./keys";
import { migrateLegacyApplications } from "./migrate";
import { normalizeStoredApplication, sameJson } from "./normalize";
import {
  forgetAllRescuedApplications,
  forgetRescuedApplication,
  readRescuedApplications,
  rescueApplication,
  type RescueWhere,
} from "./rescue";

/**
 * The applications, in memory — the source of truth for the page that has them
 * open — and the one way anything reads or changes them.
 *
 * Reads are synchronous (`useSyncExternalStore` needs them to be, and so does
 * every component that used to read localStorage directly). Writes change memory
 * first, synchronously, and reach durable storage afterwards through a queue.
 * That order is what fixes the incident this was built for: a CV the model has
 * already written is in memory — on screen, downloadable — before anything tries
 * to store it, so a store that refuses can no longer make it disappear. The
 * refusal becomes a state of that one record, `unsaved`, which the UI shows and
 * which «Reintentar guardado» retries — the write, never the generation.
 *
 * Durable storage is IndexedDB when the browser offers one that works, and the
 * old localStorage array when it does not (see `./engine`). The first load on
 * IndexedDB also moves the old array across (see `./migrate`).
 */

export type SaveOutcome = { ok: true } | { ok: false; kind: StorageErrorKind };

export type UnsavedApplication = {
  id: string;
  label: string;
  kind: StorageErrorKind;
  /** Where the waiting copy was put, for the notice to be honest about a reload. */
  rescued: RescueWhere;
};

export type ApplicationsStatus = {
  /** Durable storage has been read. Before this, an empty list means "not yet", not "none". */
  ready: boolean;
  engine: "indexeddb" | "legacy" | null;
  /** Why IndexedDB is not the engine, when it is not. */
  databaseFailure: DatabaseFailure | "migration" | null;
  unsaved: readonly UnsavedApplication[];
  saving: boolean;
};

type QueuedOp = { op: "put"; app: Application };

const EMPTY: Application[] = [];
const INITIAL_STATUS: ApplicationsStatus = {
  ready: false,
  engine: null,
  databaseFailure: null,
  unsaved: [],
  saving: false,
};

let hydration: Promise<void> | null = null;
let ready = false;
let engine: ApplicationsEngine | null = null;
let databaseFailure: ApplicationsStatus["databaseFailure"] = null;

const records = new Map<string, Application>();
let snapshot: Application[] = EMPTY;
const unsaved = new Map<string, { kind: StorageErrorKind; rescued: RescueWhere }>();
let status: ApplicationsStatus = INITIAL_STATUS;

const listeners = new Set<() => void>();
const releaseCallbacks = new Set<() => void>();

const queued = new Map<string, QueuedOp>();
const inflight = new Map<string, Promise<void>>();
const waiters = new Map<string, Array<(outcome: SaveOutcome) => void>>();

let channel: BroadcastChannel | null = null;
let syncInstalled = false;
let warned = false;

function warnOnce(message: string, error?: unknown): void {
  if (warned) return;
  warned = true;
  console.warn(message, error ?? "");
}

// --- Snapshots --------------------------------------------------------------------

/** Newest first, the order every list in the app has always shown. */
function byNewest(a: Application, b: Application): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function rebuildSnapshot(): void {
  snapshot = records.size === 0 ? EMPTY : [...records.values()].sort(byNewest);
}

/** One record changed in place: a new array, same order, without re-sorting everything on every keystroke. */
function replaceInSnapshot(app: Application): void {
  const index = snapshot.findIndex((entry) => entry.id === app.id);
  if (index === -1 || snapshot[index]!.createdAt !== app.createdAt) {
    rebuildSnapshot();
    return;
  }
  snapshot = snapshot.slice();
  snapshot[index] = app;
}

function publishStatus(): void {
  const nextUnsaved: UnsavedApplication[] = [...unsaved.entries()].map(([id, entry]) => ({
    id,
    label: records.get(id)?.label ?? "",
    kind: entry.kind,
    rescued: entry.rescued,
  }));
  const next: ApplicationsStatus = {
    ready,
    engine: engine?.kind ?? null,
    databaseFailure,
    unsaved: nextUnsaved,
    saving: inflight.size > 0 || queued.size > 0,
  };
  const same =
    next.ready === status.ready &&
    next.engine === status.engine &&
    next.databaseFailure === status.databaseFailure &&
    next.saving === status.saving &&
    next.unsaved.length === status.unsaved.length &&
    next.unsaved.every((entry, index) => {
      const previous = status.unsaved[index]!;
      return (
        previous.id === entry.id &&
        previous.label === entry.label &&
        previous.kind === entry.kind &&
        previous.rescued === entry.rescued
      );
    });
  if (!same) status = next;
}

function notify(): void {
  publishStatus();
  listeners.forEach((listener) => listener());
}

export function subscribeApplications(listener: () => void): () => void {
  listeners.add(listener);
  void ensureApplicationsHydrated();
  return () => {
    listeners.delete(listener);
  };
}

export function getApplicationsSnapshot(): Application[] {
  return snapshot;
}

export function getServerApplicationsSnapshot(): Application[] {
  return EMPTY;
}

export function getApplicationsStatus(): ApplicationsStatus {
  return status;
}

export function getServerApplicationsStatus(): ApplicationsStatus {
  return INITIAL_STATUS;
}

/** What is in memory now. Before `ready`, possibly nothing — see `listApplicationRecords`. */
export function getApplicationRecord(id: string): Application | undefined {
  return records.get(id);
}

/** Every application, once durable storage has been read. Includes the ones not yet saved. */
export async function listApplicationRecords(): Promise<Application[]> {
  await ensureApplicationsHydrated();
  return snapshot;
}

/**
 * Called after this browser's old localStorage copy of the history has been
 * removed. `local.ts` uses it to finish what a full store left undone —
 * `migrateProfileToV2` could not write the new profile while the history took
 * every byte.
 */
export function onLegacyApplicationsReleased(callback: () => void): () => void {
  releaseCallbacks.add(callback);
  return () => {
    releaseCallbacks.delete(callback);
  };
}

function legacyReleased(): void {
  releaseCallbacks.forEach((callback) => {
    try {
      callback();
    } catch (error) {
      console.warn("[storage] after-migration step failed", error);
    }
  });
}

// --- Hydration --------------------------------------------------------------------

/** Reads durable storage once per page, migrating first when there is anything to migrate. */
export function ensureApplicationsHydrated(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  hydration ??= hydrate();
  return hydration;
}

function validate(rows: readonly unknown[]): {
  valid: Application[];
  invalid: Array<{ id: string | undefined; raw: unknown; reason: string }>;
} {
  const valid: Application[] = [];
  const invalid: Array<{ id: string | undefined; raw: unknown; reason: string }> = [];
  for (const row of rows) {
    if (row === undefined || row === null) continue;
    const parsed = applicationSchema.safeParse(row);
    if (parsed.success) {
      valid.push(normalizeStoredApplication(parsed.data));
    } else {
      const id = typeof (row as { id?: unknown }).id === "string" ? (row as { id: string }).id : undefined;
      invalid.push({ id, raw: row, reason: "invalid" });
    }
  }
  return { valid, invalid };
}

async function hydrate(): Promise<void> {
  const opened = await openAppDatabase();
  let chosen: ApplicationsEngine = new LegacyApplicationsEngine();

  if (opened.db) {
    try {
      const report = await migrateLegacyApplications(opened.db);
      chosen = new IndexedDbApplicationsEngine(opened.db);
      if (report.releasedLegacy) legacyReleased();
    } catch (error) {
      databaseFailure = "migration";
      warnOnce("[storage] No pudimos pasar las postulaciones a IndexedDB; seguimos con localStorage.", error);
    }
  } else {
    databaseFailure = opened.failure;
  }

  let rows: unknown[] = [];
  try {
    rows = await chosen.list();
  } catch (error) {
    warnOnce("[storage] No pudimos leer las postulaciones guardadas.", error);
    if (chosen.kind === "indexeddb") {
      databaseFailure = classifyStorageError(error);
      chosen = new LegacyApplicationsEngine();
      rows = await chosen.list();
    }
  }
  engine = chosen;

  const { valid, invalid } = validate(rows);
  if (invalid.length > 0 && chosen.kind === "indexeddb") {
    // Kept, never shown: the same trade `loadApplications` always made, minus
    // the part where the next write destroyed them.
    chosen.quarantine(invalid, { removeFromStore: true }).catch(() => {});
  }
  if (chosen instanceof LegacyApplicationsEngine) {
    try {
      chosen.rewrite((item) => {
        const parsed = applicationSchema.safeParse(item);
        if (!parsed.success) return item;
        const normalized = normalizeStoredApplication(parsed.data);
        return normalized === parsed.data ? item : normalized;
      });
    } catch {
      // Compaction frees room; failing to compact changes nothing.
    }
  }

  // Anything saved while this was loading is newer than what was on disk.
  const early = new Set(records.keys());
  for (const app of valid) {
    if (!early.has(app.id)) records.set(app.id, app);
  }

  const toRetry: string[] = [];
  for (const { app, kind, where } of readRescuedApplications()) {
    const current = records.get(app.id);
    if (!current || current.updatedAt < app.updatedAt) {
      records.set(app.id, app);
      unsaved.set(app.id, { kind, rescued: where });
      toRetry.push(app.id);
    } else {
      // What is stored is at least as new: the waiting copy did its job.
      forgetRescuedApplication(app.id);
    }
  }

  ready = true;
  rebuildSnapshot();
  notify();
  installCrossTabSync();

  for (const id of toRetry) {
    const app = records.get(id);
    if (app) void enqueue(app);
  }
}

// --- Writes -----------------------------------------------------------------------

function settle(id: string, outcome: SaveOutcome): void {
  const pending = waiters.get(id);
  waiters.delete(id);
  pending?.forEach((resolve) => resolve(outcome));
}

function enqueue(app: Application): Promise<SaveOutcome> {
  queued.set(app.id, { op: "put", app });
  const outcome = new Promise<SaveOutcome>((resolve) => {
    const list = waiters.get(app.id) ?? [];
    list.push(resolve);
    waiters.set(app.id, list);
  });
  publishStatus();
  void pump(app.id);
  return outcome;
}

/**
 * At most one write per record in flight, and only the latest version waiting
 * behind it. A burst of keystrokes in the editor becomes two writes, not one
 * per key — and every one of them is a single record, never the whole history.
 */
async function pump(id: string): Promise<void> {
  if (inflight.has(id)) return;
  const next = queued.get(id);
  if (!next) return;
  queued.delete(id);

  const run = (async (): Promise<StorageErrorKind | null> => {
    await ensureApplicationsHydrated();
    try {
      await engine!.put(next.app);
      return null;
    } catch (error) {
      return classifyStorageError(error);
    }
  })();
  inflight.set(
    id,
    run.then(() => undefined),
  );
  publishStatus();
  const failure = await run;
  inflight.delete(id);

  // A newer version arrived while this one was being written: that one decides
  // the outcome everyone waiting on this record is told.
  if (queued.has(id)) {
    void pump(id);
    return;
  }

  // Deleted while this write was in flight: there is nothing left to keep. A
  // failed write here must not bring it back as «sin guardar», and a waiting
  // copy of it would resurrect it on the next load.
  if (!records.has(id)) {
    settle(id, { ok: true });
    notify();
    return;
  }

  if (failure) {
    const latest = records.get(id) ?? next.app;
    unsaved.set(id, { kind: failure, rescued: rescueApplication(latest, failure) });
    settle(id, { ok: false, kind: failure });
  } else {
    unsaved.delete(id);
    forgetRescuedApplication(id);
    broadcast([id]);
    settle(id, { ok: true });
  }
  notify();
}

/**
 * Saves an application. Never throws, never loses it.
 *
 * Memory changes now — every reader sees the new version on the next render —
 * and the returned promise says how the durable write went. `touch: false`
 * keeps `updatedAt` as given, for a record arriving from somewhere else
 * (a restore, a recovered generation) rather than being edited here.
 */
export function saveApplicationRecord(app: Application, options: { touch?: boolean } = {}): Promise<SaveOutcome> {
  const next = options.touch === false ? app : { ...app, updatedAt: new Date().toISOString() };
  const existed = records.has(next.id);
  records.set(next.id, next);
  if (existed) replaceInSnapshot(next);
  else rebuildSnapshot();
  notify();
  return enqueue(next);
}

/** Tries every waiting record again — «Reintentar guardado», a tab coming back into view, space just freed. */
export async function retryUnsavedApplications(): Promise<SaveOutcome[]> {
  const ids = [...unsaved.keys()];
  return Promise.all(
    ids.map((id) => {
      const app = records.get(id);
      return app ? enqueue(app) : Promise.resolve<SaveOutcome>({ ok: true });
    }),
  );
}

/**
 * Removes applications — deleted, or archived to a file. Tombstones are the
 * caller's business (see `local.ts`): archiving is not deleting.
 *
 * Memory first, like a save, and back again if the durable delete fails: a row
 * that reappears on the next load after the page said it was gone is worse than
 * one that stays and says why.
 */
export async function removeApplicationRecords(ids: readonly string[]): Promise<SaveOutcome> {
  if (ids.length === 0) return { ok: true };
  const removed = ids.map((id) => records.get(id)).filter((app): app is Application => Boolean(app));
  for (const id of ids) {
    records.delete(id);
    unsaved.delete(id);
    queued.delete(id);
    settle(id, { ok: true });
  }
  rebuildSnapshot();
  notify();

  await Promise.all(ids.map((id) => inflight.get(id)).filter(Boolean));
  await ensureApplicationsHydrated();
  try {
    await engine!.remove(ids);
  } catch (error) {
    for (const app of removed) records.set(app.id, app);
    rebuildSnapshot();
    notify();
    return { ok: false, kind: classifyStorageError(error) };
  }
  ids.forEach(forgetRescuedApplication);
  broadcast([...ids]);
  // Whatever was waiting for room may fit now.
  void retryUnsavedApplications();
  return { ok: true };
}

/** «Eliminar todas». */
export async function clearApplicationRecords(): Promise<SaveOutcome> {
  await ensureApplicationsHydrated();
  const before = new Map(records);
  records.clear();
  unsaved.clear();
  for (const id of queued.keys()) settle(id, { ok: true });
  queued.clear();
  rebuildSnapshot();
  notify();
  await Promise.all([...inflight.values()]);
  try {
    await engine!.clear();
  } catch (error) {
    for (const [id, app] of before) records.set(id, app);
    rebuildSnapshot();
    notify();
    return { ok: false, kind: classifyStorageError(error) };
  }
  forgetAllRescuedApplications();
  broadcast("all");
  return { ok: true };
}

/**
 * Everything replaced in one durable step: a restore from a backup, a download
 * from the account. Applications only this browser has and has not managed to
 * save are kept — they are newer than anything either source could hold.
 */
export async function replaceAllApplicationRecords(apps: readonly Application[]): Promise<SaveOutcome> {
  await ensureApplicationsHydrated();
  const incoming = new Set(apps.map((app) => app.id));
  const keep = [...unsaved.keys()]
    .filter((id) => !incoming.has(id))
    .map((id) => records.get(id))
    .filter((app): app is Application => Boolean(app));
  try {
    await engine!.replaceAll(apps);
  } catch (error) {
    return { ok: false, kind: classifyStorageError(error) };
  }
  records.clear();
  for (const app of apps) records.set(app.id, app);
  for (const app of keep) records.set(app.id, app);
  for (const id of [...unsaved.keys()]) if (!records.has(id) || incoming.has(id)) unsaved.delete(id);
  rebuildSnapshot();
  notify();
  broadcast("all");
  for (const app of keep) void enqueue(app);
  return { ok: true };
}

/**
 * Adds applications without removing any — an archive brought back. A row
 * already here is replaced only by a newer one, the rule the migration follows.
 */
export async function mergeApplicationRecords(apps: readonly Application[]): Promise<{ added: number; updated: number; outcomes: SaveOutcome[] }> {
  await ensureApplicationsHydrated();
  let added = 0;
  let updated = 0;
  const writes: Array<Promise<SaveOutcome>> = [];
  for (const app of apps) {
    const current = records.get(app.id);
    if (current && current.updatedAt >= app.updatedAt) continue;
    if (current) updated += 1;
    else added += 1;
    writes.push(saveApplicationRecord(app, { touch: false }));
  }
  return { added, updated, outcomes: await Promise.all(writes) };
}

/**
 * Rows from a file that do not validate: kept out of sight rather than dropped,
 * the same courtesy rows found in storage get. Best-effort — the person still
 * has the file they came from.
 */
export async function quarantineApplicationRows(
  rows: ReadonlyArray<{ id: string | undefined; raw: unknown; reason: string }>,
  source: string,
): Promise<void> {
  if (rows.length === 0) return;
  await ensureApplicationsHydrated();
  try {
    await engine?.quarantine(rows, { source });
  } catch {
    // See above.
  }
}

/**
 * Forgets everything in memory and in durable storage — the destructive half of
 * signing out. The browser database's other tables are cleared by the caller.
 */
export async function wipeApplicationRecords(): Promise<void> {
  await ensureApplicationsHydrated();
  records.clear();
  unsaved.clear();
  for (const id of queued.keys()) settle(id, { ok: true });
  queued.clear();
  await Promise.all([...inflight.values()]);
  try {
    await engine?.clear();
  } catch {
    // The reload that follows a sign-out shows whatever is left; nothing here can do better.
  }
  forgetAllRescuedApplications();
  try {
    window.localStorage.removeItem(APPLICATIONS_KEY);
  } catch {
    // As above.
  }
  rebuildSnapshot();
  notify();
}

// --- Other tabs -------------------------------------------------------------------

/** This tab still has a version the others have not seen: theirs must not replace it. */
function locallyPending(id: string): boolean {
  return unsaved.has(id) || queued.has(id) || inflight.has(id);
}

function merge(rows: readonly unknown[], scope: readonly string[] | null): void {
  const incoming = new Map<string, Application>();
  for (const app of validate(rows).valid) incoming.set(app.id, app);
  const ids = scope ?? [...new Set([...records.keys(), ...incoming.keys()])];
  let changed = false;
  for (const id of ids) {
    if (locallyPending(id)) continue;
    const next = incoming.get(id);
    const current = records.get(id);
    if (!next) {
      if (current) {
        records.delete(id);
        changed = true;
      }
    } else if (!current || !sameJson(current, next)) {
      records.set(id, next);
      changed = true;
    }
  }
  if (changed) {
    rebuildSnapshot();
    notify();
  }
}

async function refresh(ids: readonly string[] | "all"): Promise<void> {
  if (!ready || !engine) return;
  try {
    if (ids === "all") merge(await engine.list(), null);
    else merge(await engine.getMany(ids), ids);
  } catch {
    // The next change, or the tab coming back into view, tries again.
  }
}

function broadcast(ids: readonly string[] | "all"): void {
  if (typeof window === "undefined") return;
  const message = { ids };
  if (channel) {
    try {
      channel.postMessage(message);
      return;
    } catch {
      // Falls back to the storage ping below.
    }
  }
  try {
    window.localStorage.setItem(SYNC_PING_KEY, JSON.stringify({ ...message, at: Date.now(), nonce: Math.random() }));
  } catch {
    // Other tabs catch up when they come back into view.
  }
}

async function absorbLegacyWrites(): Promise<void> {
  if (!(engine instanceof IndexedDbApplicationsEngine)) return;
  try {
    const report = await migrateLegacyApplications(engine.db);
    if (report.releasedLegacy) legacyReleased();
    if (report.written > 0) await refresh("all");
  } catch (error) {
    warnOnce("[storage] No pudimos incorporar lo que escribió otra pestaña.", error);
  }
}

function installCrossTabSync(): void {
  if (syncInstalled || typeof window === "undefined") return;
  syncInstalled = true;

  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel("cvexact.applications");
      channel.onmessage = (event: MessageEvent<{ ids?: unknown }>) => {
        const ids = event.data?.ids;
        if (ids === "all") void refresh("all");
        else if (Array.isArray(ids)) void refresh(ids.filter((id): id is string => typeof id === "string"));
      };
      // Node's BroadcastChannel (the tests) keeps the process alive until it
      // is closed; browsers have no such method and need nothing.
      (channel as unknown as { unref?: () => void }).unref?.();
    } catch {
      channel = null;
    }
  }

  if (typeof window.addEventListener !== "function") return;

  window.addEventListener("storage", (event) => {
    if (event.key === SYNC_PING_KEY && event.newValue) {
      try {
        const { ids } = JSON.parse(event.newValue) as { ids?: unknown };
        if (ids === "all") void refresh("all");
        else if (Array.isArray(ids)) void refresh(ids.filter((id): id is string => typeof id === "string"));
      } catch {
        // A malformed ping is just a missed refresh.
      }
      return;
    }
    if (event.key === APPLICATIONS_KEY) {
      // Another tab wrote the array: on the legacy engine that is the store
      // itself; on IndexedDB it is a tab still running the previous build.
      if (engine?.kind === "legacy") void refresh("all");
      else if (engine?.kind === "indexeddb" && event.newValue) void absorbLegacyWrites();
    }
  });

  if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    void refresh("all");
    void retryUnsavedApplications();
    if (engine?.kind === "indexeddb") void absorbLegacyWrites();
  });
}
