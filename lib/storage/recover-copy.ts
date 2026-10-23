"use client";

import { recordMetric } from "@/lib/metrics/store";
import { hasSubstance, importProfilePrompt, restoreBackupPrompt } from "@/lib/profile/replace-guard";
import { copyKindOf, openCopy, type AskToOpen } from "./copy-file";
import { downloadAccountBackup } from "./download";
import { importFile, importProfile, loadStoredProfile, readProfileFile } from "./local";
import { saveProfileFile } from "./profile-copy";
import { summarizeRestore } from "./restore-guard";

/**
 * Bringing a copy back, once, whatever the copy is and wherever it is brought back from.
 *
 * It was three screens with three readers: the empty start took a profile file or a whole backup, «Importar perfil» in the profile's menu
 * took only the first and sent the second «a Ajustes», and «Importar copia completa» in Ajustes took the second and sent the first back to
 * «tu perfil». Someone who had one file and no idea which kind it was found out by being sent from one screen to the other. The file says
 * what it is (`kind`), so the reading is one: a profile, a whole backup or an archive of postings, open or with a password. What it would
 * replace is said first, with both sides in numbers, and what goes is written down before it does — the same everywhere something is replaced.
 *
 * It asks through what it is given (`confirm`, `ask`) and touches no screen: the caller says what came of it, where it is.
 */

type Confirm = (message: string, options?: { title?: string; confirmLabel?: string; confirmTone?: "danger" | "primary" }) => Promise<boolean>;

export type Recovery =
  | { status: "cancelled" }
  | { status: "recovered"; kind: "profile" | "backup" | "archive"; message: string }
  | { status: "failed"; message: string };

/** Said for a file that is none of the three. The one that brings the copy back is told where copies come from, in the names the screens use. */
export const NOT_A_COPY = "Ese archivo no es una copia de cvexact. Una copia se baja desde Ajustes, con «Descargar perfil», y su nombre empieza con «cvexact-».";

/** What a profile brought back says, apart from what a backup says (`importFile` has its own words for those). */
export const PROFILE_RECOVERED = "Listo: recuperamos tu perfil.";

const isArchive = (raw: string): boolean => {
  try {
    return (JSON.parse(raw) as { kind?: unknown } | null)?.kind === "cvexact-archive";
  } catch {
    return false;
  }
};

export async function recoverCopy(file: File, { confirm, ask }: { confirm: Confirm; ask: AskToOpen }): Promise<Recovery> {
  try {
    const opened = await openCopy(await file.text(), ask);
    if (opened.status === "cancelled") return { status: "cancelled" };
    const raw = opened.raw;
    const hadNothing = !hasSubstance(loadStoredProfile());
    const kind = copyKindOf(raw);

    if (kind === "profile") {
      const read = readProfileFile(raw);
      if (!read.ok) return { status: "failed", message: read.error };
      const current = loadStoredProfile();
      if (hasSubstance(current)) {
        const ok = await confirm(importProfilePrompt(current, read.profile), { title: "Recuperar tu perfil", confirmLabel: "Bajar la copia y reemplazar" });
        if (!ok) return { status: "cancelled" };
        saveProfileFile(current, "perfil-anterior");
      }
      const failed = importProfile(raw);
      if (failed) return { status: "failed", message: failed };
      if (hadNothing && hasSubstance(loadStoredProfile())) recordMetric("profile_recovered");
      return { status: "recovered", kind: "profile", message: PROFILE_RECOVERED };
    }

    if (kind === "backup") {
      // A backup replaces: said with both sides in numbers, and the copy of what goes is taken before it does.
      const restore = await summarizeRestore(raw);
      if (restore && (hasSubstance(restore.here.profile) || restore.here.applications > 0)) {
        const ok = await confirm(restoreBackupPrompt(restore.here, restore.file), { title: "Recuperar una copia completa", confirmLabel: "Bajar la copia y reemplazar" });
        if (!ok) return { status: "cancelled" };
        await downloadAccountBackup();
      }
      const result = await importFile(raw);
      if (!result.ok) return { status: "failed", message: result.message };
      if (hadNothing && hasSubstance(loadStoredProfile())) recordMetric("profile_recovered");
      return { status: "recovered", kind: "backup", message: result.message };
    }

    // An archive of postings adds to what is here and replaces nothing: it is not asked about.
    if (isArchive(raw)) {
      const result = await importFile(raw);
      return result.ok ? { status: "recovered", kind: "archive", message: result.message } : { status: "failed", message: result.message };
    }

    return { status: "failed", message: NOT_A_COPY };
  } catch {
    return { status: "failed", message: "No pudimos leer ese archivo. Probá de nuevo." };
  }
}
