"use client";

import { useSyncExternalStore } from "react";
import { CORRECTIONS_SETTLED_KEY, readRaw, subscribeToStorage, write } from "./local";

/**
 * What the person left «solo en este CV» (O11): for each application, the changes they made by hand that were offered to the profile and that they
 * chose to keep out of it. Kept in this browser and apart from the application and the profile — it is not synced and not in a copy, and it is about
 * one CV — so that the card does not ask again, and so that nothing new is kept with the application. Only the last few applications, and a few
 * changes of each: a CV that old is not edited again.
 */

const KEEP_APPLICATIONS = 200;
const KEEP_PER_APPLICATION = 60;

type Entry = { keys: string[]; at: string };
type Store = Record<string, Entry>;

function parse(raw: string | null): Store {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const store: Store = {};
    for (const [id, entry] of Object.entries(value)) {
      const keys = entry && typeof entry === "object" ? (entry as { keys?: unknown }).keys : undefined;
      const at = entry && typeof entry === "object" ? (entry as { at?: unknown }).at : undefined;
      if (Array.isArray(keys) && typeof at === "string") store[id] = { keys: keys.filter((key): key is string => typeof key === "string"), at };
    }
    return store;
  } catch {
    return {};
  }
}

/** What was left in this CV, read once and not subscribed to. */
export const settledCorrections = (applicationId: string): ReadonlySet<string> => new Set(parse(readRaw(CORRECTIONS_SETTLED_KEY))[applicationId]?.keys ?? []);

/** One change of this CV is settled: it is not asked again. A browser that cannot remember it asks once more, which is the worst that can happen. */
export function settleCorrection(applicationId: string, key: string, now = new Date()): void {
  try {
    const store = parse(readRaw(CORRECTIONS_SETTLED_KEY));
    const keys = [...new Set([...(store[applicationId]?.keys ?? []), key])].slice(-KEEP_PER_APPLICATION);
    const entries = Object.entries({ ...store, [applicationId]: { keys, at: now.toISOString() } }).sort((a, b) => a[1].at.localeCompare(b[1].at));
    write(CORRECTIONS_SETTLED_KEY, Object.fromEntries(entries.slice(-KEEP_APPLICATIONS)));
  } catch {
    // Nothing worse than being asked once more.
  }
}

let cachedRaw: string | null | undefined;
let cachedStore: Store = {};
const snapshot = (): Store => {
  const raw = readRaw(CORRECTIONS_SETTLED_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedStore = parse(raw);
  }
  return cachedStore;
};
const NONE: ReadonlySet<string> = new Set();
const SERVER: Store = {};

/** What was left in this CV, as it changes. A set that is the same one for as long as nothing was settled, so that it can sit in a dependency list. */
export function useSettledCorrections(applicationId: string): ReadonlySet<string> {
  const store = useSyncExternalStore(subscribeToStorage, snapshot, () => SERVER);
  const entry = store[applicationId];
  const keys = entry?.keys;
  // The set is built from the stored list; the list is the same object while the storage is unchanged.
  return keys && keys.length > 0 ? setOf(keys) : NONE;
}

const sets = new WeakMap<string[], ReadonlySet<string>>();
function setOf(keys: string[]): ReadonlySet<string> {
  let known = sets.get(keys);
  if (!known) {
    known = new Set(keys);
    sets.set(keys, known);
  }
  return known;
}
