"use client";

import { useSyncExternalStore } from "react";
import { openAppDatabase, type AppDatabase } from "@/lib/storage/db";
import { EXTRACT_CACHE_KEY, SOURCES_KEY, SPLIT_CACHE_KEY, readRaw, write } from "@/lib/storage/local";

/**
 * The onboarding's own browser data — the originals of imported documents
 * (`./source-store`) and the AI responses it caches (`./ai`) — moved off
 * localStorage for the reason the applications were: together they could take
 * 1 MB or more of the 5 MiB every other key shares, and the store they share is
 * the one whose running out made a finished CV impossible to save.
 *
 * Each is a small keyed collection, and both modules keep their own logic (the
 * caps, what is dropped first) and only swap how the whole collection is read
 * and written, through `readCollection` / `writeCollection` below.
 *
 * Three modes:
 * - `legacy`: no IndexedDB here (or it failed). Exactly the old behaviour: the
 *   collection is one localStorage key, read and written synchronously.
 * - `pending`: IndexedDB exists and has not been read yet. Reads see what
 *   localStorage still holds plus anything written this session; writes go to
 *   memory and are stored once the database is open.
 * - `indexeddb`: memory is the collection, IndexedDB keeps it.
 */

export type CollectionName = "sources" | typeof EXTRACT_CACHE_KEY | typeof SPLIT_CACHE_KEY;

type Mode = "legacy" | "pending" | "indexeddb";

let mode: Mode = typeof indexedDB === "undefined" ? "legacy" : "pending";
let db: AppDatabase | null = null;
let hydration: Promise<void> | null = null;

const memory = new Map<CollectionName, Map<string, unknown>>();
/** Written (or removed) this session before the database answered: these win over what it holds. */
const touched = new Map<CollectionName, Set<string>>();

const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

const LEGACY_KEY: Record<CollectionName, string> = {
  sources: SOURCES_KEY,
  [EXTRACT_CACHE_KEY]: EXTRACT_CACHE_KEY,
  [SPLIT_CACHE_KEY]: SPLIT_CACHE_KEY,
};

function collection(name: CollectionName): Map<string, unknown> {
  let found = memory.get(name);
  if (!found) {
    found = new Map();
    memory.set(name, found);
  }
  return found;
}

function touchedIn(name: CollectionName): Set<string> {
  let found = touched.get(name);
  if (!found) {
    found = new Set();
    touched.set(name, found);
  }
  return found;
}

function parseLegacy(name: CollectionName): Record<string, unknown> {
  const raw = readRaw(LEGACY_KEY[name]);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** The whole collection, as the module that owns it expects it: a plain object keyed by id. */
export function readCollection<T>(name: CollectionName): Record<string, T> {
  if (mode === "legacy") return parseLegacy(name) as Record<string, T>;
  const entries = collection(name);
  if (mode === "indexeddb") return Object.fromEntries(entries) as Record<string, T>;
  // Pending: localStorage still holds the pre-migration copy; this session's
  // writes and removals are laid over it.
  const result: Record<string, unknown> = { ...parseLegacy(name) };
  for (const id of touchedIn(name)) {
    if (entries.has(id)) result[id] = entries.get(id);
    else delete result[id];
  }
  return result as Record<string, T>;
}

/**
 * Replaces the whole collection. On localStorage, one write that throws like
 * every other (the owners already treat these writes as best-effort). On
 * IndexedDB, memory now and the difference stored in the background — never
 * throws, for the same reason: losing an original or a cache entry costs a
 * convenience, never the work that produced it.
 */
export function writeCollection<T>(name: CollectionName, next: Record<string, T>): void {
  if (mode === "legacy") {
    write(LEGACY_KEY[name], next);
    return;
  }
  const entries = collection(name);
  const current = mode === "pending" ? readCollection<T>(name) : Object.fromEntries(entries);
  const changed = Object.keys(next).filter((id) => current[id] !== next[id]);
  const removed = Object.keys(current).filter((id) => !(id in next));
  for (const id of changed) entries.set(id, next[id]);
  for (const id of removed) entries.delete(id);
  if (mode === "pending") {
    for (const id of [...changed, ...removed]) touchedIn(name).add(id);
  } else {
    void persist(name, changed, removed);
  }
  notify();
}

function rowFor(name: CollectionName, id: string, value: unknown) {
  if (name === "sources") return { table: "sources" as const, row: { id, ...(value as object) } };
  const entry = value as { result?: unknown; at?: string };
  return {
    table: "aiCache" as const,
    row: { key: `${name}:${id}`, cache: name, result: entry?.result, at: entry?.at ?? new Date().toISOString() },
  };
}

function dbKey(name: CollectionName, id: string): string {
  return name === "sources" ? id : `${name}:${id}`;
}

async function persist(name: CollectionName, changed: string[], removed: string[]): Promise<void> {
  if (!db || (changed.length === 0 && removed.length === 0)) return;
  const entries = collection(name);
  const table = name === "sources" ? db.sources : db.aiCache;
  try {
    await db.transaction("rw", table, async () => {
      for (const id of changed) {
        if (!entries.has(id)) continue;
        const { row } = rowFor(name, id, entries.get(id));
        await (table as unknown as { put: (row: unknown) => Promise<unknown> }).put(row);
      }
      if (removed.length > 0) await table.bulkDelete(removed.map((id) => dbKey(name, id)));
    });
  } catch {
    // Best-effort, as it always was in localStorage: what is in memory still
    // serves this session.
  }
}

// --- Hydration and migration ------------------------------------------------------

/**
 * Moves what localStorage holds into IndexedDB, verified, and removes each key
 * only if it still holds exactly what was read — the rule the applications'
 * migration follows (see `lib/storage/applications/migrate.ts`). A row already
 * in the database is replaced only by a newer one.
 */
async function migrate(database: AppDatabase): Promise<void> {
  const raws = (Object.keys(LEGACY_KEY) as CollectionName[])
    .map((name) => ({ name, key: LEGACY_KEY[name], raw: readRaw(LEGACY_KEY[name]) }))
    .filter((entry): entry is { name: CollectionName; key: string; raw: string } => entry.raw !== null);
  if (raws.length === 0) return;

  const rows: Array<{ table: "sources" | "aiCache"; row: { at: string } & Record<string, unknown> }> = [];
  const unreadable: Array<{ key: string; raw: string }> = [];
  for (const { name, key, raw } of raws) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      unreadable.push({ key, raw });
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      unreadable.push({ key, raw });
      continue;
    }
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      rows.push(rowFor(name, id, value) as { table: "sources" | "aiCache"; row: { at: string } & Record<string, unknown> });
    }
  }

  await database.transaction("rw", [database.sources, database.aiCache, database.quarantine], async () => {
    for (const { table, row } of rows) {
      const target = table === "sources" ? database.sources : database.aiCache;
      const key = table === "sources" ? (row.id as string) : (row.key as string);
      const existing = (await (target as unknown as { get: (key: string) => Promise<{ at?: string } | undefined> }).get(key));
      if (!existing || (existing.at ?? "") < row.at) {
        await (target as unknown as { put: (row: unknown) => Promise<unknown> }).put(row);
      }
    }
    for (const { key, raw } of unreadable) {
      await database.quarantine.add({ source: key, reason: "unparseable", raw, at: new Date().toISOString() });
    }
  });

  // Verified before anything is removed: every row read must now be there.
  const sourceIds = rows.filter((entry) => entry.table === "sources").map((entry) => entry.row.id as string);
  const cacheKeys = rows.filter((entry) => entry.table === "aiCache").map((entry) => entry.row.key as string);
  const [foundSources, foundCaches] = await Promise.all([
    sourceIds.length ? database.sources.bulkGet(sourceIds) : Promise.resolve([]),
    cacheKeys.length ? database.aiCache.bulkGet(cacheKeys) : Promise.resolve([]),
  ]);
  if ([...foundSources, ...foundCaches].some((row) => !row)) {
    throw new Error("La copia de los documentos importados en IndexedDB está incompleta.");
  }

  for (const { key, raw } of raws) {
    try {
      if (window.localStorage.getItem(key) === raw) window.localStorage.removeItem(key);
    } catch {
      // Tried again on the next load.
    }
  }
}

async function hydrate(): Promise<void> {
  const opened = await openAppDatabase();
  if (opened.db) {
    try {
      await migrate(opened.db);
      db = opened.db;
    } catch (error) {
      console.warn("[storage] Los documentos importados siguen en localStorage por ahora.", error);
    }
  }

  if (!db) {
    // No database after all: back to localStorage, carrying over what was
    // written in the meantime, and the old behaviour from here on.
    const pendingWrites = [...touched.entries()];
    mode = "legacy";
    for (const [name, ids] of pendingWrites) {
      if (ids.size === 0) continue;
      const merged = { ...parseLegacy(name) };
      const entries = collection(name);
      for (const id of ids) {
        if (entries.has(id)) merged[id] = entries.get(id);
        else delete merged[id];
      }
      try {
        write(LEGACY_KEY[name], merged);
      } catch {
        // Best-effort, as before.
      }
    }
    notify();
    return;
  }

  const [sources, caches] = await Promise.all([db.sources.toArray(), db.aiCache.toArray()]);
  for (const row of sources) {
    if (touchedIn("sources").has(row.id)) continue;
    const { id, ...record } = row;
    collection("sources").set(id, record);
  }
  for (const row of caches) {
    const name = row.cache as CollectionName;
    const id = row.key.slice(name.length + 1);
    if (touchedIn(name).has(id)) continue;
    collection(name).set(id, { result: row.result, at: row.at });
  }
  mode = "indexeddb";
  for (const [name, ids] of touched) {
    const entries = collection(name);
    const changed = [...ids].filter((id) => entries.has(id));
    const removed = [...ids].filter((id) => !entries.has(id));
    void persist(name, changed, removed);
  }
  touched.clear();
  notify();
}

/** Opens the database and moves the old keys across, once per page. Never rejects. */
export function ensureOnboardingStoresHydrated(): Promise<void> {
  if (mode === "legacy" || typeof window === "undefined") return Promise.resolve();
  hydration ??= hydrate().catch(() => {
    mode = "legacy";
    notify();
  });
  return hydration;
}

/**
 * Re-renders when the collections change or finish loading — for views that
 * read them during render, which would otherwise keep what they read before
 * the database answered.
 */
export function useOnboardingStoresVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      void ensureOnboardingStoresHydrated();
      return () => {
        listeners.delete(listener);
      };
    },
    () => version,
    () => 0,
  );
}
