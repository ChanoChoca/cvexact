"use client";

import { useSyncExternalStore } from "react";
import { ENGINE } from "@/lib/onboarding/config";
import { RETURN_REVIEW_KEY, readRaw, subscribeToStorage, write } from "./local";

/**
 * «Ahora no» in «Para revisar» (`components/profile/ReviewBlock.tsx`): until when the block is not shown open, and until when each «no» that a line names is not asked
 * again. Kept in this browser, apart from the profile — it is not a change to it, and it is not part of a copy or of what a sync takes — the way the reminder of a
 * copy is.
 */
export type ReturnReviewState = {
  /** The block as a whole: folded into a line until then. */
  snoozedUntil?: string;
  /** A «no» put off, by the id of the «no»: until when it is not asked about again. */
  putOff?: Record<string, string>;
};

const DAY_MS = 86_400_000;

function parse(raw: string | null): ReturnReviewState {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object") return {};
    const { snoozedUntil, putOff } = value as { snoozedUntil?: unknown; putOff?: unknown };
    const kept: Record<string, string> = {};
    if (putOff && typeof putOff === "object") {
      for (const [id, until] of Object.entries(putOff)) if (typeof until === "string") kept[id] = until;
    }
    return {
      ...(typeof snoozedUntil === "string" ? { snoozedUntil } : {}),
      ...(Object.keys(kept).length > 0 ? { putOff: kept } : {}),
    };
  } catch {
    return {};
  }
}

const fortnight = (now: Date): string => new Date(now.getTime() + ENGINE.currency.returnSnoozeDays * DAY_MS).toISOString();

/** What is kept of a state when it is written again: the «no»s put off whose time has not run out. */
function live(state: ReturnReviewState, now: Date): ReturnReviewState {
  const putOff = Object.fromEntries(Object.entries(state.putOff ?? {}).filter(([, until]) => until > now.toISOString()));
  return { ...(state.snoozedUntil ? { snoozedUntil: state.snoozedUntil } : {}), ...(Object.keys(putOff).length > 0 ? { putOff } : {}) };
}

/** «Ahora no» to the block: shown folded for a fortnight, a time that is the engine's to set and not this file's. A browser that cannot remember it shows it open once more. */
export function snoozeReturnReview(now = new Date()): void {
  try {
    write(RETURN_REVIEW_KEY, { ...live(parse(readRaw(RETURN_REVIEW_KEY)), now), snoozedUntil: fortnight(now) });
  } catch {
    // Nothing worse than being asked once more.
  }
}

/** «Ahora no» to a «no» that a line names: not asked about again for a fortnight. */
export function putOffReviewItem(id: string, now = new Date()): void {
  try {
    const state = live(parse(readRaw(RETURN_REVIEW_KEY)), now);
    write(RETURN_REVIEW_KEY, { ...state, putOff: { ...state.putOff, [id]: fortnight(now) } });
  } catch {
    // Nothing worse than being asked once more.
  }
}

/** What was said, read once and not subscribed to: for what is decided as a page opens. */
export const loadReturnReviewState = (): ReturnReviewState => parse(readRaw(RETURN_REVIEW_KEY));

let cachedRaw: string | null | undefined;
let cachedState: ReturnReviewState = {};
const snapshot = (): ReturnReviewState => {
  const raw = readRaw(RETURN_REVIEW_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedState = parse(raw);
  }
  return cachedState;
};
const SERVER_STATE: ReturnReviewState = {};

export function useReturnReviewState(): ReturnReviewState {
  return useSyncExternalStore(subscribeToStorage, snapshot, () => SERVER_STATE);
}
