"use client";

import { parseAnyProfile } from "@/lib/profile/parse";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { listApplications, loadStoredProfile } from "./local";

/**
 * What restoring a full backup would replace, and by what — or `null` when the file is not a restore.
 *
 * A backup replaces; an archive adds; and a file that is neither is told so by the import itself. Only the first is
 * worth asking about, and asking needs both sides in numbers: what is here, and what the file holds. Reading them is
 * apart from the import so that nothing is touched while the person decides.
 */
export type RestoreSummary = {
  here: { profile: StoredProfile; applications: number };
  file: { profile: StoredProfile; applications: number };
};

const BACKUP_KINDS = ["cvexact-backup"];

export async function summarizeRestore(raw: string): Promise<RestoreSummary | null> {
  let body: { kind?: unknown; profile?: unknown; applications?: unknown } | null;
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return null;
  }
  if (typeof body?.kind !== "string" || !BACKUP_KINDS.includes(body.kind)) return null;
  // A profile that cannot be read is an error the import reports in its own words.
  const incoming = parseAnyProfile(body.profile);
  if (!incoming) return null;
  return {
    here: { profile: loadStoredProfile(), applications: (await listApplications()).length },
    file: { profile: incoming, applications: Array.isArray(body.applications) ? body.applications.length : 0 },
  };
}
