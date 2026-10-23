"use client";

import { useSyncExternalStore } from "react";
import { experimentOn, experimentOnServer, type ExperimentId } from "@/lib/experiments";
import { subscribeToStorage } from "@/lib/storage/local";

/**
 * Whether one of the switches of `lib/experiments.ts` is on, for a component. A server and the first render of a browser see what the build said;
 * what this browser kept (outside production) comes in as soon as it is looked at, so that a page is never built twice from two different truths.
 */
export function useExperiment(id: ExperimentId): boolean {
  return useSyncExternalStore(
    subscribeToStorage,
    () => experimentOn(id),
    () => experimentOnServer(id),
  );
}
