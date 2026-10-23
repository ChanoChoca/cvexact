"use client";

import { useSyncExternalStore } from "react";
import { BACKUP_REMINDER_KEY, readRaw, subscribeToStorage, write } from "./local";

/**
 * «Guardá una copia de tus postulaciones»: the reminder in /postulaciones.
 *
 * Everything the app keeps lives in this browser unless the person uploads it
 * or downloads it, and a browser can lose it — cleared site data, Safari's
 * seven days without a visit, a new laptop. The one moment worth interrupting
 * for is when enough has piled up since the last copy that losing it would
 * hurt: `REMIND_EVERY` new applications, or any new one after
 * `REMIND_AFTER_DAYS`.
 *
 * A copy is any of the three ways out: exporting the account, archiving to a
 * file, or uploading to the account (`recordBackupMade` is called from each).
 */

export const REMIND_EVERY = 10;
export const REMIND_AFTER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type BackupReminderState = {
  /** When the last copy was made. Absent: never, in this browser. */
  lastBackupAt?: string;
  /** «Ahora no» on the profile's own reminder: until when it is not shown again. */
  profileSnoozedUntil?: string;
};

/** How long «Ahora no» silences the profile's reminder. A fortnight: long enough not to nag, short enough not to be forgotten. */
export const PROFILE_SNOOZE_DAYS = 14;

function parse(raw: string | null): BackupReminderState {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as BackupReminderState) : {};
  } catch {
    return {};
  }
}

function save(state: BackupReminderState): void {
  try {
    write(BACKUP_REMINDER_KEY, state);
  } catch {
    // A reminder that cannot remember being dismissed shows once more. Nothing worse.
  }
}

export function recordBackupMade(_applicationCount: number, now = new Date()): void {
  save({ lastBackupAt: now.toISOString() });
}

/**
 * «Ahora no» on the profile's reminder: not again for a while — `days`, which is a fortnight unless the browser deletes sooner than that
 * (`snoozeDays` in `./durability`). The copies already made are kept as they were.
 */
export function snoozeProfileBackup(now = new Date(), days: number = PROFILE_SNOOZE_DAYS): void {
  save({ ...parse(readRaw(BACKUP_REMINDER_KEY)), profileSnoozedUntil: new Date(now.getTime() + days * DAY_MS).toISOString() });
}

/**
 * Whether the profile itself should be offered a copy: it has something in it worth keeping, and no copy of it has been
 * made — by file or by upload — or the last one is old and the profile has changed since. «Ahora no» silences it for
 * a while. The applications have their own reminder below; the profile, which is the thing everything else is made
 * from, had none: exporting it was not even counted as a copy.
 *
 * `windowDays` is how old a copy may be: a month, or a week in a Safari tab, which deletes a site's data after seven days
 * without a visit (`copyWindowDays` in `./durability`).
 *
 * Pure, for the tests and for the two screens that ask (the profile's task list and the end of a session).
 */
export function profileBackupDue(
  profile: { updatedAt: string },
  state: Pick<BackupReminderState, "lastBackupAt" | "profileSnoozedUntil">,
  hasSubstance: boolean,
  now = new Date(),
  windowDays: number = REMIND_AFTER_DAYS,
): boolean {
  if (!hasSubstance) return false;
  if (state.profileSnoozedUntil && state.profileSnoozedUntil > now.toISOString()) return false;
  if (!state.lastBackupAt) return true;
  const changedSince = profile.updatedAt > state.lastBackupAt;
  return changedSince && now.getTime() - new Date(state.lastBackupAt).getTime() >= windowDays * DAY_MS;
}

/**
 * Whether to remind, and how many applications the copy would be missing.
 * Pure, for the tests: `state` and `now` are arguments.
 */
export function backupReminderDue(
  state: BackupReminderState,
  applications: ReadonlyArray<{ createdAt: string }>,
  now = new Date(),
): { due: boolean; newSince: number } {
  const since = state.lastBackupAt;
  const fresh = since ? applications.filter((app) => app.createdAt > since) : applications;
  const newSince = fresh.length;
  if (newSince === 0) return { due: false, newSince };
  if (newSince >= REMIND_EVERY) return { due: true, newSince };
  // Few new ones, but old enough that losing them would still hurt.
  const oldestFresh = fresh.reduce((oldest, app) => (app.createdAt < oldest ? app.createdAt : oldest), fresh[0]!.createdAt);
  const reference = since ?? oldestFresh;
  const due = now.getTime() - new Date(reference).getTime() >= REMIND_AFTER_DAYS * DAY_MS;
  return { due, newSince };
}

let cachedRaw: string | null | undefined;
let cachedState: BackupReminderState = {};
const snapshot = (): BackupReminderState => {
  const raw = readRaw(BACKUP_REMINDER_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedState = parse(raw);
  }
  return cachedState;
};
const SERVER_STATE: BackupReminderState = {};

export function useBackupReminderState(): BackupReminderState {
  return useSyncExternalStore(subscribeToStorage, snapshot, () => SERVER_STATE);
}
