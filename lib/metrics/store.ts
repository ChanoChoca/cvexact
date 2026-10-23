"use client";

import { useSyncExternalStore } from "react";
import { METRICS_KEY, readRaw, subscribeToStorage, write } from "@/lib/storage/local";
import { emptyMetrics, parseMetrics, recordInto, type MetricName, type MetricsState } from "./counters";

/**
 * The counters in this browser: written where the thing counted happens, read by the card in Ajustes. Never throws —
 * a counter that cannot be kept (a full store, a private window) is worth no error to someone who was answering a question.
 */

export function recordMetric(name: MetricName, amount = 1, now = new Date()): void {
  try {
    write(METRICS_KEY, recordInto(parseMetrics(readRaw(METRICS_KEY)), name, now, amount));
  } catch {
    // Nothing worse than a number one short.
  }
}

/** «Borrar los contadores»: the person's to do, whenever. */
export function clearMetrics(): void {
  try {
    write(METRICS_KEY, emptyMetrics());
  } catch {
    // Storage that cannot be written to has nothing of this to erase.
  }
}

let cachedRaw: string | null | undefined;
let cachedState: MetricsState = emptyMetrics();
const snapshot = (): MetricsState => {
  const raw = readRaw(METRICS_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedState = parseMetrics(raw);
  }
  return cachedState;
};
const SERVER_STATE = emptyMetrics();

export function useMetrics(): MetricsState {
  return useSyncExternalStore(subscribeToStorage, snapshot, () => SERVER_STATE);
}
