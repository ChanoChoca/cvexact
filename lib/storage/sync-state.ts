"use client";

import { useSyncExternalStore } from "react";
import { NOTICE_KINDS, type NoticeKind } from "@/lib/profile/sync-status";
import { SYNC_STATE_KEY, readRaw, subscribeToStorage, write } from "./local";

/**
 * What this browser remembers of its profile's last meeting with an account.
 *
 * Without it nobody could tell whether the account had what is on screen: signing in did not upload anything, an upload
 * left no trace, and the only way to find out was to upload again. This is the trace — with which account, at which
 * `rev` of the profile, and when — and nothing else. It is about this browser and this account, so it is not part of
 * the profile (and does not travel with it), and it is cleared with the rest of what the browser keeps.
 *
 * It changes nothing about what is sent or when, but for one thing the person can ask for: «Mantener sincronizado»
 * (`auto`). Clause 2 of the privacy policy says that nothing is uploaded on its own unless they turned that on, with the
 * permission that asks for it, and what is here is the record of that permission. Everything else only lets the screens
 * say, truthfully, what the account has.
 */

export type SyncState = {
  /** The account the profile last went up to, or came down from. What happened with another account says nothing about this one. */
  userId?: string;
  /** The `rev` the profile had at that moment: any save since is a change the account does not have. */
  rev?: number;
  /** When, for «Subido el 3 de octubre». */
  at?: string;
  /** «Ahora no» on a notice about the account: until when it is not shown again. */
  snoozedUntil?: string;
  /**
   * Which notice that «Ahora no» was said to. It holds off that one and no other: someone who put off «Cambios sin subir» did not say that a
   * stuck upload can wait, and one that says «Se pausó la sincronización» is news they have not heard. Absent in what was saved before this
   * was told apart, and then it covers what that button was for — the account lacking something — and not the two ways of being stuck.
   */
  snoozedFor?: NoticeKind;
  /**
   * The version of the account's profile (its `updatedAt`) this browser has already settled: brought, put there, or turned
   * down. Not offered again — the clocks of two devices are not the same clock, and a profile just brought down can still
   * look newer than the one that replaced it — and a newer version of the account's is offered as the new thing it is.
   */
  accountAt?: string;
  /**
   * «Mantener sincronizado»: the person said, for this account and from this browser, that their profile goes up on its own
   * whenever it changes (`lib/profile/auto-sync.ts`). It is theirs to turn off, and it is about one account: another one
   * signing in on this browser has not said it.
   */
  auto?: { userId: string; at: string };
};

/** How long «Ahora no» silences the notice. The same fortnight as the reminder of a copy: long enough not to nag, short enough not to be forgotten. */
export const SYNC_SNOOZE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseSyncState(raw: string | null): SyncState {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object") return {};
    const { userId, rev, at, snoozedUntil, snoozedFor, accountAt, auto } = value as Record<string, unknown>;
    const asked = auto && typeof auto === "object" ? (auto as Record<string, unknown>) : null;
    return {
      ...(typeof userId === "string" && userId ? { userId } : {}),
      ...(typeof rev === "number" && Number.isInteger(rev) && rev >= 0 ? { rev } : {}),
      ...(typeof at === "string" ? { at } : {}),
      ...(typeof snoozedUntil === "string" ? { snoozedUntil } : {}),
      ...(typeof snoozedFor === "string" && NOTICE_KINDS.includes(snoozedFor as NoticeKind) ? { snoozedFor: snoozedFor as NoticeKind } : {}),
      ...(typeof accountAt === "string" ? { accountAt } : {}),
      ...(asked && typeof asked.userId === "string" && asked.userId && typeof asked.at === "string" ? { auto: { userId: asked.userId, at: asked.at } } : {}),
    };
  } catch {
    return {};
  }
}

export function readSyncState(): SyncState {
  return parseSyncState(readRaw(SYNC_STATE_KEY));
}

function save(state: SyncState): void {
  try {
    write(SYNC_STATE_KEY, state);
  } catch {
    // A trace that cannot be kept means the notice shows once more. Nothing worse.
  }
}

/**
 * The profile and the account now say the same thing: it went up, or it came down. `rev` is the one the profile had
 * when it was sent, not the one it has by the time the answer arrives — a change made while it was going up is not in it —
 * and `accountAt` the `updatedAt` the account's profile has now: the one that was put there, or the one that was brought.
 */
export function recordSynced(userId: string, rev: number, accountAt: string, now = new Date()): void {
  const { auto } = readSyncState();
  // What was put off belongs to the state before this one: the notice starts from nothing again. What the person asked for
  // is not that: keeping it up to date is theirs to turn off, and every upload would otherwise turn it off.
  save({ userId, rev, at: now.toISOString(), accountAt, ...(auto ? { auto } : {}) });
}

/** «Mantener sincronizado», turned on or off for `userId`: the person's, and kept until they say otherwise. */
export function setAutoSync(userId: string, on: boolean, now = new Date()): void {
  const state = readSyncState();
  delete state.auto;
  save(on ? { ...state, auto: { userId, at: now.toISOString() } } : state);
}

/** «Ahora no» on a notice about the account: that one, not again for a while. What was last uploaded stays as it was. */
export function snoozeSyncNotice(kind: NoticeKind, now = new Date()): void {
  save({ ...readSyncState(), snoozedUntil: new Date(now.getTime() + SYNC_SNOOZE_DAYS * DAY_MS).toISOString(), snoozedFor: kind });
}

/** «Ahora no» on the offer of the account's profile: this version of it is not offered again. */
export function declineAccountProfile(accountUpdatedAt: string): void {
  save({ ...readSyncState(), accountAt: accountUpdatedAt });
}

/**
 * The account's version of the profile is now part of this browser's: its changes were joined with the ones made here, so
 * what goes up next overwrites nothing the account had that this browser lacks. The same note as declining it — this
 * version is settled — for the opposite reason.
 */
export const settleAccountVersion = declineAccountProfile;

let cachedRaw: string | null | undefined;
let cachedState: SyncState = {};
const snapshot = (): SyncState => {
  const raw = readRaw(SYNC_STATE_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedState = parseSyncState(raw);
  }
  return cachedState;
};
const SERVER_STATE: SyncState = {};

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribeToStorage, snapshot, () => SERVER_STATE);
}
