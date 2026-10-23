"use client";

import { PENDING_GENERATIONS_KEY } from "@/lib/storage/local";
import { RESULT_TTL_MS, type GenerationKind } from "@/lib/generation/idempotency";

/**
 * Generations that have been asked for and whose result is not safely stored
 * yet, by the idempotency key the server knows them by.
 *
 * The server keeps each result, encrypted with that key, for
 * `PENDING_TTL_MS` (see `lib/generation/result-cache.ts`). With the key, a
 * result that never made it into storage — the stream cut after the server had
 * finished, the tab closed before the save, a browser that refused the save and
 * then lost its waiting copy too — can be fetched again without asking the
 * model for it twice or paying for it twice.
 *
 * A marker is written before the request and removed once the result is
 * stored (or kept by the rescue, see `lib/storage/applications/rescue.ts`).
 * One left behind is what `recoverPendingGenerations` looks for on the next
 * load. They are small — a key, a kind, an application id — so they fit where
 * a CV no longer does: localStorage, else sessionStorage, else memory.
 */

export type { GenerationKind };

export type PendingGeneration = {
  key: string;
  kind: GenerationKind;
  /**
   * The application the result belongs to. For a first CV it does not exist
   * yet: its id is chosen before the request, so a result recovered after a
   * crash lands on that same record instead of creating a second one.
   */
  applicationId: string;
  startedAt: string;
};

/** As long as the server keeps a result: past it there is nothing left to ask for. */
export const PENDING_TTL_MS = RESULT_TTL_MS;

const memory = new Map<string, PendingGeneration>();

function stores(): Storage[] {
  if (typeof window === "undefined") return [];
  const found: Storage[] = [];
  try {
    found.push(window.localStorage);
  } catch {
    // Blocked site data: memory still works for this tab.
  }
  try {
    found.push(window.sessionStorage);
  } catch {
    // As above.
  }
  return found;
}

function readFrom(storage: Storage): PendingGeneration[] {
  try {
    const raw = storage.getItem(PENDING_GENERATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PendingGeneration[]) : [];
  } catch {
    return [];
  }
}

function writeTo(storage: Storage, entries: PendingGeneration[]): boolean {
  try {
    if (entries.length === 0) storage.removeItem(PENDING_GENERATIONS_KEY);
    else storage.setItem(PENDING_GENERATIONS_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

/** Every marker still worth asking about, oldest first. Expired ones are dropped as they are found. */
export function listPendingGenerations(now = Date.now()): PendingGeneration[] {
  const byKey = new Map<string, PendingGeneration>();
  for (const storage of stores()) for (const entry of readFrom(storage)) byKey.set(entry.key, entry);
  for (const entry of memory.values()) byKey.set(entry.key, entry);
  const fresh = [...byKey.values()].filter(
    (entry) =>
      entry &&
      typeof entry.key === "string" &&
      now - new Date(entry.startedAt).getTime() < PENDING_TTL_MS,
  );
  if (fresh.length !== byKey.size) {
    for (const storage of stores()) {
      const kept = readFrom(storage).filter((entry) => fresh.some((f) => f.key === entry.key));
      writeTo(storage, kept);
    }
  }
  return fresh.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
}

/** Opens a marker for a generation about to be requested, and returns it with its new key. */
export function beginPendingGeneration(kind: GenerationKind, applicationId: string, key = crypto.randomUUID()): PendingGeneration {
  const entry: PendingGeneration = { key, kind, applicationId, startedAt: new Date().toISOString() };
  for (const storage of stores()) {
    const entries = readFrom(storage).filter((existing) => existing.key !== key);
    if (writeTo(storage, [...entries, entry])) return entry;
  }
  memory.set(key, entry);
  return entry;
}

/** The result is stored, or there is none to recover: nothing left to ask the server for. */
export function resolvePendingGeneration(key: string): void {
  memory.delete(key);
  for (const storage of stores()) {
    const entries = readFrom(storage);
    const kept = entries.filter((entry) => entry.key !== key);
    if (kept.length !== entries.length) writeTo(storage, kept);
  }
}
