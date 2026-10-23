"use client";

import { useSyncExternalStore } from "react";
import { probeAccountProfile } from "@/lib/api/account-profile";
import { uploadProfileOnly } from "@/lib/api/sync-client";
import { createAutoSync, type AutoSync, type AutoSyncStatus } from "@/lib/profile/auto-sync";
import { loadStoredProfile } from "@/lib/storage/local";
import { readSyncState } from "@/lib/storage/sync-state";

/**
 * The one «Mantener sincronizado» of this page: `createAutoSync` (`lib/profile/auto-sync.ts`) with the browser's own storage,
 * connection and clock, and the account that is signed in. Mounted by `components/account/AutoSync.tsx`, which tells it when
 * anything that matters changes; the screens that show how it is doing read `useAutoSyncStatus`.
 */

let signedIn: string | null = null;
let engine: AutoSync | null = null;

export function autoSync(): AutoSync {
  engine ??= createAutoSync({
    userId: () => signedIn,
    profile: loadStoredProfile,
    state: readSyncState,
    probe: probeAccountProfile,
    push: uploadProfileOnly,
    online: () => typeof navigator === "undefined" || navigator.onLine !== false,
    now: () => Date.now(),
    schedule: (run, ms) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
  });
  return engine;
}

/** Who is signed in and able to sync (a confirmed address): known to the session, which only a component can read. */
export function setAutoSyncUser(userId: string | null): void {
  signedIn = userId;
}

const OFF: AutoSyncStatus = { phase: "off" };

export function useAutoSyncStatus(): AutoSyncStatus {
  return useSyncExternalStore(
    (listener) => autoSync().subscribe(listener),
    () => autoSync().status(),
    () => OFF,
  );
}
