"use client";

import { exportBackup } from "./local";
import { recordBackupMade } from "./backup-reminder";

/**
 * A JSON file, handed to the browser as a download. It gives back the file it handed over, for a screen that offers it to the share sheet of a phone as well
 * (`lib/storage/share-copy.ts`): the one thing a download cannot be taken back from is the person's own copy.
 */
export function downloadJson(filename: string, data: unknown): File {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick rather than at once: some browsers start the
  // download asynchronously and would find the URL already gone.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return new File([blob], filename, { type: "application/json" });
}

/** Any text file, handed to the browser as a download — a calendar file, say. */
export function downloadText(filename: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Today, as the person's own clock has it: the day a file is named after is the day they see, and not the next one — by UTC, between nine and midnight in Buenos Aires
 * a copy taken on the 10th was called the 11th, next to «Tu última copia la hiciste el 10 de octubre».
 */
export function todayStamp(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * The complete copy —the profile and the postings— as a file, the one Ajustes offers. Offered wherever the browser has refused to store something: it includes
 * what is only in memory, so it is a way out that does not depend on the browser at all.
 */
export async function downloadAccountBackup(): Promise<File> {
  const backup = await exportBackup();
  const file = downloadJson(`cvexact-copia-completa-${todayStamp()}.json`, backup);
  recordBackupMade(backup.applications.length);
  return file;
}
