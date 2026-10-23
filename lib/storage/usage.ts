"use client";

import { recordMetric } from "@/lib/metrics/store";

/**
 * How much room this browser gives the site, for the warning that shows before it runs out
 * and the asking of the browser to keep the data.
 *
 * Two different stores, measured two different ways:
 *
 * - localStorage: about 5 MiB per origin in every browser (MDN). No API reports
 *   its use, so it is summed here — keys and values, in characters, which is the
 *   measure that matched the incident this was built for (5.236.841 characters
 *   stored when a 50 KB write failed, against 5 × 1024 × 1024 = 5.242.880).
 * - Everything else (IndexedDB): `navigator.storage.estimate()`, whose numbers
 *   MDN itself calls imprecise — shown as approximations, never as a promise.
 */

export const LOCAL_STORAGE_CHARS = 5 * 1024 * 1024;

/** Past these, warn before a save fails rather than after. */
export const WARN_LOCAL_RATIO = 0.8;
export const WARN_DATABASE_RATIO = 0.9;

export function localStorageUsage(): { chars: number; ratio: number } {
  let chars = 0;
  try {
    const storage = window.localStorage;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key === null) continue;
      chars += key.length + (storage.getItem(key)?.length ?? 0);
    }
  } catch {
    // Unreadable storage uses nothing we can count.
  }
  return { chars, ratio: chars / LOCAL_STORAGE_CHARS };
}

export async function databaseEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    if (typeof usage !== "number" || typeof quota !== "number" || quota <= 0) return null;
    return { usage, quota };
  } catch {
    return null;
  }
}

export type Persistence = "persisted" | "best-effort" | "unsupported";

/**
 * Whether the browser has agreed to keep this site's data under storage
 * pressure. Only in secure contexts (HTTPS, and localhost for development).
 */
export async function persistenceState(): Promise<Persistence> {
  try {
    if (!navigator.storage?.persisted || !navigator.storage.persist) return "unsupported";
    return (await navigator.storage.persisted()) ? "persisted" : "best-effort";
  } catch {
    return "unsupported";
  }
}

/**
 * Asks. Firefox shows the person a permission prompt, which out of nowhere
 * would read as the site asking for something odd, so it is asked after a CV
 * came out (`keepDataQuietly`); Chrome and Safari decide on their own from how
 * the site has been used (MDN).
 */
export async function requestPersistence(): Promise<Persistence> {
  try {
    if (!navigator.storage?.persist) return "unsupported";
    return (await navigator.storage.persist()) ? "persisted" : "best-effort";
  } catch {
    return "unsupported";
  }
}

/** Where the attempts are counted: the same browser is asked a few times at most, because Firefox answers each one with a permission prompt. */
const KEEP_ASKED_KEY = "cvexact.keepAsked.v1";
const KEEP_ASKED_MAX = 3;

/**
 * Asks the browser to keep the data, with no screen of its own: after a CV came out, which is when there is something to lose.
 * Chrome and Safari decide on their own and say no in silence, so a «no» is tried again on the next CV, up to `KEEP_ASKED_MAX`
 * times; in Firefox each try is a permission prompt, which after a CV that worked is less out of nowhere than anywhere else.
 */
export async function keepDataQuietly(): Promise<void> {
  try {
    const asked = Number(window.localStorage.getItem(KEEP_ASKED_KEY)) || 0;
    if (asked >= KEEP_ASKED_MAX || (await persistenceState()) !== "best-effort") return;
    window.localStorage.setItem(KEEP_ASKED_KEY, String(asked + 1));
    // Counted where the person can see it (I7): how often a browser said yes is what says whether asking is worth it.
    if ((await requestPersistence()) === "persisted") recordMetric("persistence_granted");
  } catch {
    // Storage that cannot count the tries is storage this was no use for anyway.
  }
}

/** Which warning, if any. Pure, for the tests. */
export function spaceWarning(
  local: { ratio: number },
  database: { usage: number; quota: number } | null,
): "local" | "database" | null {
  if (local.ratio >= WARN_LOCAL_RATIO) return "local";
  if (database && database.usage / database.quota >= WARN_DATABASE_RATIO) return "database";
  return null;
}

/** For people: KB under a megabyte, MB under a gigabyte, GB above. Approximate on purpose. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
