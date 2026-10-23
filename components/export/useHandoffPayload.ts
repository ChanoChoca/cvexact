"use client";

import { useCallback, useSyncExternalStore } from "react";
import { HANDOFF_GLOBAL } from "@/lib/export/handoff";

/**
 * Reads the document the headless browser was given before the page loaded.
 * See lib/export/handoff.ts for why it arrives this way.
 *
 * `useSyncExternalStore` rather than an effect, for the same reason
 * `useHydrated` uses it: the global is outside React, the server pass has no
 * snapshot of it, and reading it straight during render would be a hydration
 * mismatch. Returns null on the server and for anyone who opens the route by
 * hand — which is all such a visit should ever show.
 */
export function useHandoffPayload<T>(): T | null {
  const subscribe = useCallback(() => () => {}, []);

  return useSyncExternalStore(
    subscribe,
    () => (window as unknown as Record<string, T | undefined>)[HANDOFF_GLOBAL] ?? null,
    () => null,
  );
}
