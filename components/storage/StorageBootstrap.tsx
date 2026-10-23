"use client";

import { useEffect } from "react";
import { ensureApplicationsHydrated } from "@/lib/storage/local";
import { recoverPendingGenerations } from "@/lib/applications/recovery";
import { ensureOnboardingStoresHydrated } from "@/lib/onboarding/stores";

/**
 * Starts the browser-storage work every page of the app needs, as soon as the
 * shell mounts rather than whenever some view first asks:
 *
 * - reading the applications, which on the first load after this release also
 *   moves them out of localStorage — the sooner that happens, the sooner the
 *   profile, the keys and the drafts have room again;
 * - moving the onboarding's imported documents and AI caches the same way;
 * - bringing back any generation whose result never reached storage
 *   (`recoverPendingGenerations`).
 *
 * Renders nothing.
 */
export function StorageBootstrap() {
  useEffect(() => {
    void ensureApplicationsHydrated().then(() => recoverPendingGenerations());
    void ensureOnboardingStoresHydrated();
  }, []);
  return null;
}
