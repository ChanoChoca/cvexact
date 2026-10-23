"use client";

import { recordBackupMade } from "./backup-reminder";
import { downloadJson, todayStamp } from "./download";
import { exportBackup, exportProfile } from "./local";
import { lockCopy, readLockedCopy, unlockCopy, type LockedHolds } from "./locked-copy";

/**
 * Copies with a password, made and opened: the browser's half of `./locked-copy`.
 *
 * A locked copy counts as a copy for the reminder, as an open one does (`recordBackupMade`): what it is for is the same.
 */

/** «Bajar una copia con contraseña»: the profile, locked, as a file. */
export async function downloadLockedProfile(password: string): Promise<File> {
  const file = downloadJson(`cvexact-perfil-protegido-${todayStamp()}.json`, await lockCopy(exportProfile(), password));
  recordBackupMade(0);
  return file;
}

/** The complete copy, locked — the one taken before «Borrar los datos de este navegador» on a shared computer, and the one «Con contraseña» gives for the complete copy. */
export async function downloadLockedAccountBackup(password: string): Promise<File> {
  const backup = await exportBackup();
  const file = downloadJson(`cvexact-copia-completa-protegida-${todayStamp()}.json`, await lockCopy(backup, password));
  recordBackupMade(backup.applications.length);
  return file;
}

/** How a screen asks for the password of a copy it is opening: `use` gets each one typed, and `null` from it means try again. */
export type AskToOpen = (request: { mode: "enter"; holds: LockedHolds; use: (password: string) => Promise<string | null> }) => Promise<string | null>;

export type OpenedCopy =
  /** The file as it would have been without a password: what `readProfileFile` and `importBackup` read. */
  | { status: "open"; raw: string; holds: LockedHolds | null }
  | { status: "cancelled" };

/**
 * A file brought back, opened if it is locked: asks for its password, as many times as it takes or until the person cancels.
 * A file that is not locked is handed on as it is — whether it is a copy at all is for whoever reads it to say.
 */
export async function openCopy(raw: string, ask: AskToOpen): Promise<OpenedCopy> {
  const locked = readLockedCopy(raw);
  if (!locked) return { status: "open", raw, holds: null };
  const opened = await ask({ mode: "enter", holds: locked.holds, use: (password) => unlockCopy(locked, password) });
  return opened === null ? { status: "cancelled" } : { status: "open", raw: opened, holds: locked.holds };
}

const PROFILE_KINDS = ["cvexact-profile"];
const BACKUP_KINDS = ["cvexact-backup"];

/**
 * What an opened copy is, to know where it goes: a profile (`importProfile`), a whole account (`importFile`), or neither — read
 * from what the file says it is, before anything is touched.
 */
export function copyKindOf(raw: string): "profile" | "backup" | null {
  try {
    const kind = (JSON.parse(raw) as { kind?: unknown } | null)?.kind;
    if (typeof kind !== "string") return null;
    if (PROFILE_KINDS.includes(kind)) return "profile";
    if (BACKUP_KINDS.includes(kind)) return "backup";
    return null;
  } catch {
    return null;
  }
}
