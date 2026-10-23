import type { Dexie as DexieDatabase, EntityTable } from "dexie";
import type { Application } from "./application";
import { classifyStorageError, type StorageErrorKind } from "./errors";

/**
 * The browser database behind what grows: applications, the documents the
 * onboarding imported, and the AI responses it caches.
 *
 * Why not localStorage, which is where all of it used to live: localStorage is
 * about 5 MiB per origin in every browser (MDN), shared by every key the app
 * has, and every write rewrites a whole value synchronously on the main thread.
 * A real history of ~200 applications filled it, and once full, a CV the model
 * had already written — and the user had already paid for — could not be saved.
 * IndexedDB's quota is a share of the disk (Chrome and Safari around 60 % per
 * origin, Firefox 10 % up to 10 GiB), each application is its own record, and a
 * write touches only that record.
 *
 * What stays in localStorage is what is small and read synchronously on every
 * request: the profile, the BYOK keys, drafts, preferences.
 *
 * The name is permanent. A database cannot be renamed at all, only copied, so
 * this stays even if the brand changes again.
 */
export const DB_NAME = "cvexact";

/**
 * How long to wait for the database before carrying on without it.
 *
 * Some browsers have shipped an IndexedDB whose `open` never answers — no
 * success, no error — and a page that waits for it forever shows nothing. Past
 * this the app falls back to localStorage for the session, which still works,
 * just with the old limits, and tries again on the next load.
 */
export const OPEN_TIMEOUT_MS = 4000;

export type MetaRow = { key: string; value: unknown };

/** Something found in storage that could not be read as what it claimed to be — kept, never shown, never thrown away. */
export type QuarantineRow = {
  id?: number;
  /** Where it came from, e.g. the localStorage key. */
  source: string;
  reason: string;
  raw: unknown;
  at: string;
};

/** The pre-migration history exactly as it was, kept for a while in case the migration itself got something wrong. */
export type SnapshotRow = { key: string; items: unknown[]; takenAt: string; expiresAt: string };

export type SourceRow = {
  id: string;
  name: string;
  lines: string[];
  layout?: unknown[];
  at: string;
};

export type AiCacheRow = {
  /** `${cache}:${hash of the text sent}`. */
  key: string;
  cache: string;
  result: unknown;
  at: string;
};

export type AppDatabase = DexieDatabase & {
  applications: EntityTable<Application, "id">;
  meta: EntityTable<MetaRow, "key">;
  quarantine: EntityTable<QuarantineRow, "id">;
  legacySnapshot: EntityTable<SnapshotRow, "key">;
  sources: EntityTable<SourceRow, "id">;
  aiCache: EntityTable<AiCacheRow, "key">;
};

/**
 * Why the database is not there, for the one screen that says so (Ajustes) and
 * for the logs. `missing`: this browser has no IndexedDB at all. `timeout`: it
 * never answered. The rest is `classifyStorageError`'s vocabulary.
 */
export type DatabaseFailure = StorageErrorKind | "missing" | "timeout";

export type DatabaseOpen = { db: AppDatabase; failure: null } | { db: null; failure: DatabaseFailure };

let opening: Promise<DatabaseOpen> | null = null;

/**
 * The database, opened once per page and shared by every store.
 *
 * Never rejects: a browser without a usable IndexedDB gets `{ db: null }` and the
 * reason, and each caller falls back to what it did before this existed.
 */
export function openAppDatabase(): Promise<DatabaseOpen> {
  opening ??= open();
  return opening;
}

async function open(): Promise<DatabaseOpen> {
  if (typeof indexedDB === "undefined" || typeof IDBKeyRange === "undefined") {
    return { db: null, failure: "missing" };
  }

  // Imported here rather than at the top: Dexie is ~25 KB gzipped, every page
  // imports the storage layer, and the database is only ever opened after
  // hydration — so nobody downloads it before it is actually needed.
  let Dexie: typeof import("dexie").Dexie;
  try {
    ({ Dexie } = await import("dexie"));
  } catch (error) {
    return { db: null, failure: classifyStorageError(error) };
  }

  const db = new Dexie(DB_NAME, {
    // A saved CV is a document, not a cache: Chrome 121 made "relaxed" the
    // default, which reports a write as done once it reaches the OS buffer, and
    // a power cut in the next few seconds loses it. The migration especially has
    // to know the copy is on disk before the only other copy is removed.
    chromeTransactionDurability: "strict",
    // Explicit rather than whatever Dexie finds on `window`, so the tests can
    // hand every case a fresh fake — and so a page never mixes two factories.
    indexedDB,
    IDBKeyRange,
  }) as AppDatabase;

  db.version(1).stores({
    applications: "id",
    meta: "key",
    quarantine: "++id",
    legacySnapshot: "key",
    sources: "id",
    aiCache: "key",
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), OPEN_TIMEOUT_MS);
  });

  try {
    const outcome = await Promise.race([db.open().then(() => "open" as const), timedOut]);
    if (outcome === "timeout") {
      db.close();
      return { db: null, failure: "timeout" };
    }
    return { db, failure: null };
  } catch (error) {
    db.close();
    return { db: null, failure: classifyStorageError(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Empties some of the tables and leaves the rest: what can be made again, to make room (`freeSpace`). Resolves either way, like `clearAppDatabase`.
 */
export async function clearDatabaseTables(names: ReadonlyArray<"aiCache" | "legacySnapshot">): Promise<void> {
  const { db } = await openAppDatabase();
  if (!db) return;
  try {
    await db.transaction("rw", names.map((name) => db[name]), async () => {
      for (const name of names) await db[name].clear();
    });
  } catch {
    // Room that cannot be made here is made, or not, by the rest.
  }
}

/**
 * Empties every table: the destructive half of «cerrar sesión y borrar mis
 * datos de este navegador». Cleared rather than deleted — `deleteDatabase`
 * waits on every other open tab to let go of it, and a sign-out cannot hang on
 * a tab the person forgot about. Resolves either way: the reload that follows
 * shows whatever could not be removed, which is the most honest thing left.
 */
export async function clearAppDatabase(): Promise<void> {
  const { db } = await openAppDatabase();
  if (!db) return;
  try {
    await db.transaction("rw", db.tables, async () => {
      for (const table of db.tables) await table.clear();
    });
  } catch {
    // See above.
  }
}
