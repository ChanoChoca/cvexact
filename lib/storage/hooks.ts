"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DISMISSED_JOBS_KEY,
  PROFILE_CORRUPT_KEY,
  PROFILE_KEY,
  PROFILE_V1_KEY,
  PROVIDER_NOTES_KEY,
  SEMANTIC_JOBS_KEY,
  SETTINGS_KEY,
  emptySettings,
  pendingProfileProblem,
  pendingProfileSnapshot,
  providerNotesWritable,
  readRaw,
  subscribeToStorage,
  type Application,
  type ProviderNote,
  type Settings,
  type StorageErrorKind,
} from "./local";
import {
  getApplicationsSnapshot,
  getApplicationsStatus,
  getServerApplicationsSnapshot,
  getServerApplicationsStatus,
  subscribeApplications,
  type ApplicationsStatus,
} from "./applications/store";
import { emptyProfile, type Profile } from "@/lib/schemas/profile";
import { emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { readStoredProfile, type ProfileRead } from "@/lib/profile/parse";
import { toPlainProfile } from "@/lib/profile/project";

/**
 * Reactive reads of the browser store.
 *
 * useSyncExternalStore rather than an effect: localStorage is an external
 * system, the server has no snapshot of it, and every writer in the app needs
 * every reader to update. getSnapshot must be referentially stable between
 * changes or React re-renders forever, so each key caches its parsed value
 * against the raw string it came from.
 *
 * Applications are the exception: they live in the applications store's memory
 * (see `./applications/store`), which hands out a stable array of its own.
 */

type Cache<T> = { raw: string | null; value: T };

function makeSnapshot<T>(key: string, parse: (raw: string | null) => T) {
  // A value no stored string can equal, so the first read always parses. Written
  // as an escape: the NUL used to sit in the source as a literal byte, which made
  // tools treat this file as binary.
  const cache: Cache<T> = { raw: "\u0000never", value: undefined as T };
  return () => {
    const raw = readRaw(key);
    if (raw !== cache.raw) {
      cache.raw = raw;
      cache.value = parse(raw);
    }
    return cache.value;
  };
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// Module-level so the cache survives re-renders and is shared by all consumers.
const SERVER_PROFILE = emptyProfile();
const SERVER_STORED_PROFILE = emptyStoredProfile();
const SERVER_SETTINGS = emptySettings();
const SERVER_PROVIDER_NOTES: Record<string, ProviderNote> = {};
const SERVER_DISMISSED_JOBS: string[] = [];

/**
 * The profile, read once per change and shared by the three hooks below.
 *
 * Keyed on the raw text of the current key — or, when that key is absent, on the
 * old one, which is the one case where a browser is reading a profile it has not
 * managed to migrate yet (a full store). Pure: `getSnapshot` runs during render,
 * so it must not write, and quarantining an unreadable profile is the imperative
 * loader's job, not this one's.
 *
 * A profile the browser refused to store (`pendingProfileSnapshot`) wins over
 * what is on disk: it is newer, and showing the older one is exactly how an edit
 * used to vanish from the screen the moment it failed to save.
 */
const profileReadSnapshot = (() => {
  let cachedKey: string | null | undefined;
  let cachedRead: ProfileRead | undefined;
  let cachedPending: StoredProfile | null = null;
  let pendingRead: ProfileRead | undefined;
  return (): ProfileRead => {
    const pending = pendingProfileSnapshot();
    if (pending) {
      if (pending !== cachedPending || !pendingRead) {
        cachedPending = pending;
        pendingRead = { profile: pending, corrupt: false };
      }
      return pendingRead;
    }
    cachedPending = null;
    pendingRead = undefined;
    const rawV2 = readRaw(PROFILE_KEY);
    const rawV1 = rawV2 === null ? readRaw(PROFILE_V1_KEY) : null;
    const key = rawV2 ?? (rawV1 === null ? null : `v1:${rawV1}`);
    if (cachedRead === undefined || key !== cachedKey) {
      cachedKey = key;
      cachedRead = readStoredProfile(rawV2, rawV1);
    }
    return cachedRead;
  };
})();

const corruptCopySnapshot = makeSnapshot(PROFILE_CORRUPT_KEY, (raw) => raw);

const storedProfileSnapshot = (): StoredProfile => profileReadSnapshot().profile;

const profileCorruptSnapshot = (): boolean => profileReadSnapshot().corrupt;

/** The plain projection, recomputed only when the stored profile is a new object. */
const plainProfileSnapshot = (() => {
  let lastStored: StoredProfile | undefined;
  let lastPlain: Profile = SERVER_PROFILE;
  return (): Profile => {
    const stored = storedProfileSnapshot();
    if (stored !== lastStored) {
      lastStored = stored;
      lastPlain = toPlainProfile(stored);
    }
    return lastPlain;
  };
})();

const settingsSnapshot = makeSnapshot(SETTINGS_KEY, (raw) =>
  parseJson<Settings>(raw, emptySettings()),
);

const providerNotesSnapshot = makeSnapshot(PROVIDER_NOTES_KEY, (raw) =>
  parseJson<Record<string, ProviderNote>>(raw, {}),
);

const dismissedJobsSnapshot = makeSnapshot(DISMISSED_JOBS_KEY, (raw) =>
  parseJson<string[]>(raw, []),
);

const semanticJobsSnapshot = makeSnapshot(SEMANTIC_JOBS_KEY, (raw) =>
  parseJson<boolean>(raw, false),
);

/**
 * The profile as the generators and the scorers see it: plain values, no
 * provenance. Everything that only *reads* career data wants this one.
 */
export function useProfile(): Profile {
  return useSyncExternalStore(subscribeToStorage, plainProfileSnapshot, () => SERVER_PROFILE);
}

/** The profile with the provenance of every value — what the onboarding and the hub work on. */
export function useStoredProfile(): StoredProfile {
  return useSyncExternalStore(
    subscribeToStorage,
    storedProfileSnapshot,
    () => SERVER_STORED_PROFILE,
  );
}

/**
 * The text of a profile this browser set aside because it could not be read, or
 * null. It outlives the moment: once the user starts over, the copy is still the
 * only record of what was there, so it stays until they say they have it.
 */
export function useCorruptProfileCopy(): string | null {
  return useSyncExternalStore(subscribeToStorage, corruptCopySnapshot, () => null);
}

/**
 * The stored profile exists and cannot be read. A copy has been set aside
 * untouched (`readCorruptProfile`); nothing should overwrite it silently.
 */
export function useProfileCorrupt(): boolean {
  return useSyncExternalStore(subscribeToStorage, profileCorruptSnapshot, () => false);
}

/**
 * Why the profile on screen is not stored yet, or null when it is. See
 * `pendingProfile` in `./local`: the change is kept either way; this is what
 * the notice reads to say so.
 */
export function useProfileSaveProblem(): StorageErrorKind | null {
  return useSyncExternalStore(subscribeToStorage, pendingProfileProblem, () => null);
}

/**
 * Every application, newest first. Empty until durable storage has been read —
 * check `useApplicationsReady` before treating empty as "none".
 */
export function useApplications(): Application[] {
  return useSyncExternalStore(
    subscribeApplications,
    getApplicationsSnapshot,
    getServerApplicationsSnapshot,
  );
}

export function useApplication(id: string): Application | undefined {
  const applications = useApplications();
  return applications.find((a) => a.id === id);
}

/** Whether storage has been read, which engine holds the applications, and which ones are not saved yet. */
export function useApplicationsStatus(): ApplicationsStatus {
  return useSyncExternalStore(subscribeApplications, getApplicationsStatus, getServerApplicationsStatus);
}

/**
 * True once the applications have been read from storage. Before this, an
 * empty list or a missing application means "not loaded yet": views that say
 * «no encontramos este CV» or «todavía no generaste ninguna» have to wait for
 * it, or they would say it for a moment on every load.
 */
export function useApplicationsReady(): boolean {
  return useSyncExternalStore(
    subscribeApplications,
    () => getApplicationsStatus().ready,
    () => false,
  );
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeToStorage, settingsSnapshot, () => SERVER_SETTINGS);
}

/** What each configured key was last seen refusing. Keyed `provider:modelId`. */
export function useProviderNotes(): Record<string, ProviderNote> {
  return useSyncExternalStore(
    subscribeToStorage,
    providerNotesSnapshot,
    () => SERVER_PROVIDER_NOTES,
  );
}

/**
 * Whether those notes could be written last time. `true` on the server pass:
 * the warning is about this browser's storage, which the server cannot see.
 *
 * A primitive rather than a cached object, so the snapshot is stable by value
 * and needs none of the caching `makeSnapshot` does for parsed keys. See
 * `providerNotesWritable` in ./local for what losing the write costs.
 */
export function useProviderNotesWritable(): boolean {
  return useSyncExternalStore(subscribeToStorage, () => providerNotesWritable(), () => true);
}

/** Ids the user dismissed from `/empleos`. See `dismissJob` in `./local`. */
export function useDismissedJobIds(): string[] {
  return useSyncExternalStore(
    subscribeToStorage,
    dismissedJobsSnapshot,
    () => SERVER_DISMISSED_JOBS,
  );
}

/** Whether `/empleos` should reorder the feed by semantic similarity. Off on
 *  the server pass and until hydration, like every other storage-backed
 *  read here. See `setSemanticJobsEnabled` in `./local`. */
export function useSemanticJobsEnabled(): boolean {
  return useSyncExternalStore(subscribeToStorage, semanticJobsSnapshot, () => false);
}

/**
 * True once the component has hydrated. Storage-backed views render a loading
 * state on the server pass, where the snapshot is always the empty fallback,
 * and only report "not found" after the real read.
 */
export function useHydrated(): boolean {
  const subscribe = useCallback(() => () => {}, []);
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
