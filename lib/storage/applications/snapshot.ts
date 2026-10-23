import type { AppDatabase, SnapshotRow } from "../db";

/**
 * The history exactly as localStorage held it before the move to IndexedDB,
 * kept for a while after the move.
 *
 * The migration verifies every record it writes, so this is not what makes it
 * safe. It is insurance against the one thing verification cannot see: the
 * normalisation itself being wrong in a way nobody has noticed yet. For its
 * lifetime the person can download it from Ajustes as an archive, which the
 * import merges rather than replaces.
 *
 * It follows the person's deletions — `remove` and `clear` in `./engine` filter
 * it in the same transaction — because an application someone deleted must not
 * survive in a table they cannot see.
 */
export const SNAPSHOT_KEY = "applications.v1";

/** Long enough to notice a problem, short enough not to become a second history. */
export const SNAPSHOT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export async function loadLegacySnapshot(db: AppDatabase, now = new Date()): Promise<SnapshotRow | null> {
  const row = await db.legacySnapshot.get(SNAPSHOT_KEY);
  if (!row) return null;
  if (row.expiresAt <= now.toISOString()) return null;
  return row;
}

/** Best-effort: an expired snapshot left for one more load costs nothing. */
export async function purgeExpiredSnapshot(db: AppDatabase, now = new Date()): Promise<void> {
  try {
    const row = await db.legacySnapshot.get(SNAPSHOT_KEY);
    if (row && row.expiresAt <= now.toISOString()) await db.legacySnapshot.delete(SNAPSHOT_KEY);
  } catch {
    // Tried again on the next load.
  }
}
