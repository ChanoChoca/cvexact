"use client";

import { useSyncExternalStore } from "react";
import { AI_CHOICE_KEY, readRaw, subscribeToStorage, write } from "./local";

/**
 * «Sigo sin IA»: what the person said when the key was offered, kept in this browser so that the offer does not come back at the end of every session
 * (`components/ai/AiKeyPrompt.tsx`). It was a choice that was said and forgotten: the next session close asked again, as if nothing had been answered.
 *
 * It holds the day it was said and nothing else — no key, nothing of what is sent to a model. Apart from the profile and the settings, the way the reminder of a copy is:
 * it is not a change to either, it is not synced, and it is not in a copy. Saying the opposite —choosing to make a key— takes it back.
 */
export type AiChoice = {
  /** When «Sigo sin IA» was said. */
  withoutAi?: string;
};

function parse(raw: string | null): AiChoice {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as { withoutAi?: unknown } | null;
    return value && typeof value.withoutAi === "string" ? { withoutAi: value.withoutAi } : {};
  } catch {
    return {};
  }
}

/** «Sigo sin IA»: the offer of a key stays quiet from now on. A browser that cannot remember it asks once more, which is no worse than before. */
export function rememberWithoutAi(now = new Date()): void {
  try {
    write(AI_CHOICE_KEY, { withoutAi: now.toISOString() });
  } catch {
    // Nothing worse than being asked once more.
  }
}

/** The person chose a way to have an AI after all: the offer is not quiet any more. */
export function forgetWithoutAi(): void {
  if (!parse(readRaw(AI_CHOICE_KEY)).withoutAi) return;
  try {
    write(AI_CHOICE_KEY, {});
  } catch {
    // The same.
  }
}

/** What was said, read once and not subscribed to: for what is decided as a page opens. */
export const loadWithoutAi = (): boolean => Boolean(parse(readRaw(AI_CHOICE_KEY)).withoutAi);

const snapshot = (): boolean => loadWithoutAi();

/** Whether «Sigo sin IA» was said here, repainting when it is said or taken back — also from another tab. */
export function useWithoutAi(): boolean {
  return useSyncExternalStore(subscribeToStorage, snapshot, () => false);
}
