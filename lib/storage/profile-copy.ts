"use client";

import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { recordBackupMade } from "./backup-reminder";
import { downloadJson, todayStamp } from "./download";
import { exportProfile } from "./local";

/**
 * A profile as a file the person keeps.
 *
 * Two kinds of copy, and the difference is whether it is the one they asked for. «Bajar una copia» is a copy in the
 * sense the reminder means (`recordBackupMade`): it is what they will come back to if the browser loses this one.
 * The copy taken just before a profile is replaced is a safety net for that tap, and is not counted: it is of a
 * profile that is about to be gone, or of the account's, not of the one they are going on with.
 */

/** Downloads `profile` (the one in this browser when none is given) as a file named after `label` and today. */
export function saveProfileFile(profile?: StoredProfile, label = "perfil"): File {
  return downloadJson(`cvexact-${label}-${todayStamp()}.json`, exportProfile(profile));
}

/** «Bajar una copia»: the copy they asked for, which counts as one — it used to leave the reminder saying they had never made any. */
export function exportOwnProfile(now = new Date()): File {
  const file = saveProfileFile();
  recordBackupMade(0, now);
  return file;
}
