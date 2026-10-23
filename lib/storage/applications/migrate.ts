import { applicationSchema, type Application } from "../application";
import type { AppDatabase, QuarantineRow } from "../db";
import { APPLICATIONS_KEY } from "./keys";
import { normalizeStoredApplication, sameJson } from "./normalize";
import { purgeExpiredSnapshot, SNAPSHOT_KEY, SNAPSHOT_TTL_MS } from "./snapshot";

/**
 * Moves applications from localStorage into IndexedDB — once, and then again
 * for anything a tab still running the previous build writes there afterwards.
 *
 * The order is the safety:
 *
 * 1. Everything is written in ONE transaction, with strict durability (see
 *    `db.ts`): the valid rows, the rows that do not validate (to `quarantine`,
 *    never dropped), the raw snapshot, and the marker. All of it lands or none
 *    of it does, so "marker present" means "migration complete" and there is no
 *    half-migrated state to detect.
 * 2. The marker is read INSIDE that transaction. Two tabs loading the new build
 *    at once both reach here; IndexedDB runs their read-write transactions one
 *    after the other, so the second one sees the first one's marker and only
 *    folds in whatever is newer.
 * 3. Every record written is read back and compared with what was meant to be
 *    written. A mismatch on the first run undoes the whole thing and leaves the
 *    app on localStorage; the next load tries again.
 * 4. Only then is the localStorage copy removed — and only if it is still
 *    byte-for-byte what was read, so a stale tab that wrote in the meantime is
 *    picked up on the next pass instead of being lost.
 *
 * A row already in IndexedDB is only ever replaced by a newer one
 * (`updatedAt`). Nothing here deletes an application.
 */

export const MIGRATION_META_KEY = "migration.applications";

export type MigrationReport = {
  /** This call wrote the marker. */
  firstRun: boolean;
  /** Rows written to IndexedDB by this call. */
  written: number;
  quarantined: number;
  /** localStorage no longer holds any of the legacy keys this call read. */
  releasedLegacy: boolean;
};

export class MigrationVerificationError extends Error {
  constructor(readonly mismatched: string[]) {
    super("La copia de las postulaciones en IndexedDB no coincide con la original.");
    this.name = "MigrationVerificationError";
  }
}

type LegacySource = { key: string; raw: string };

function readLegacySources(): LegacySource[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(APPLICATIONS_KEY);
    return raw === null ? [] : [{ key: APPLICATIONS_KEY, raw }];
  } catch {
    // Unreadable storage has nothing to migrate.
    return [];
  }
}

/** Whether localStorage still holds any key a stale tab could have written. */
export function hasLegacyApplications(): boolean {
  return readLegacySources().length > 0;
}

export async function migrateLegacyApplications(db: AppDatabase, now = new Date()): Promise<MigrationReport> {
  const sources = readLegacySources();
  const at = now.toISOString();

  if (sources.length === 0) {
    // Nothing to move. The marker still goes in, so a legacy key that appears
    // later is recognised for what it is — a stale tab's write — and folded in
    // without a snapshot of its own.
    await db.transaction("rw", db.meta, async () => {
      if (!(await db.meta.get(MIGRATION_META_KEY))) {
        await db.meta.put({ key: MIGRATION_META_KEY, value: { completedAt: at, written: 0, quarantined: 0 } });
      }
    });
    await purgeExpiredSnapshot(db, now);
    return { firstRun: false, written: 0, quarantined: 0, releasedLegacy: false };
  }

  const rawItems: unknown[] = [];
  const quarantine: QuarantineRow[] = [];
  const winners = new Map<string, Application>();
  let sourceChars = 0;

  for (const { key, raw } of sources) {
    sourceChars += raw.length;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      quarantine.push({ source: key, reason: "unparseable", raw, at });
      continue;
    }
    if (!Array.isArray(parsed)) {
      quarantine.push({ source: key, reason: "not-an-array", raw: parsed, at });
      continue;
    }
    for (const item of parsed) {
      rawItems.push(item);
      const result = applicationSchema.safeParse(item);
      if (!result.success) {
        quarantine.push({ source: key, reason: "invalid", raw: item, at });
        continue;
      }
      const app = normalizeStoredApplication(result.data);
      const current = winners.get(app.id);
      if (!current || current.updatedAt < app.updatedAt) winners.set(app.id, app);
    }
  }

  let firstRun = false;
  let written: Application[] = [];
  let quarantineIds: number[] = [];

  await db.transaction("rw", [db.applications, db.meta, db.quarantine, db.legacySnapshot], async () => {
    firstRun = !(await db.meta.get(MIGRATION_META_KEY));

    const ids = [...winners.keys()];
    const stored = ids.length > 0 ? await db.applications.bulkGet(ids) : [];
    written = ids
      .map((id, index) => ({ incoming: winners.get(id)!, current: stored[index] }))
      // A stored row wins only when it is known to be at least as new. One
      // without a usable `updatedAt` is not something to keep a valid
      // version out for.
      .filter(
        ({ incoming, current }) =>
          !current || typeof current.updatedAt !== "string" || current.updatedAt < incoming.updatedAt,
      )
      .map(({ incoming }) => incoming);

    if (written.length > 0) await db.applications.bulkPut(written);
    if (quarantine.length > 0) {
      // A second pass over the same keys — another tab that read them in the
      // same moment — must not set the same rows aside twice.
      let rows = quarantine;
      if (!firstRun) {
        const kept = new Set((await db.quarantine.toArray()).map((row) => JSON.stringify(row.raw)));
        rows = quarantine.filter((row) => !kept.has(JSON.stringify(row.raw)));
      }
      if (rows.length > 0) quarantineIds = (await db.quarantine.bulkAdd(rows, { allKeys: true })) as number[];
    }
    if (firstRun) {
      await db.legacySnapshot.put({
        key: SNAPSHOT_KEY,
        items: rawItems,
        takenAt: at,
        expiresAt: new Date(now.getTime() + SNAPSHOT_TTL_MS).toISOString(),
      });
      await db.meta.put({
        key: MIGRATION_META_KEY,
        value: { completedAt: at, written: written.length, quarantined: quarantine.length, sourceChars },
      });
    }
  });

  const readBack = written.length > 0 ? await db.applications.bulkGet(written.map((app) => app.id)) : [];
  const mismatched = written
    .filter((app, index) => !readBack[index] || !sameJson(readBack[index], app))
    .map((app) => app.id);

  if (mismatched.length > 0) {
    if (firstRun) {
      // Undo exactly what this run did. localStorage was not touched, so the
      // app carries on from it as if the migration had never been attempted.
      await db.transaction("rw", [db.applications, db.meta, db.quarantine, db.legacySnapshot], async () => {
        await db.applications.bulkDelete(written.map((app) => app.id));
        if (quarantineIds.length > 0) await db.quarantine.bulkDelete(quarantineIds);
        await db.legacySnapshot.delete(SNAPSHOT_KEY);
        await db.meta.delete(MIGRATION_META_KEY);
      });
      throw new MigrationVerificationError(mismatched);
    }
    // A later pass over a stale tab's writes: IndexedDB already holds the real
    // history, so falling back would hide it. Leave localStorage alone and
    // try again next time.
    return { firstRun, written: written.length, quarantined: quarantine.length, releasedLegacy: false };
  }

  let releasedLegacy = true;
  for (const { key, raw } of sources) {
    try {
      if (window.localStorage.getItem(key) === raw) window.localStorage.removeItem(key);
      else releasedLegacy = false;
    } catch {
      releasedLegacy = false;
    }
  }

  await purgeExpiredSnapshot(db, now);
  return { firstRun, written: written.length, quarantined: quarantine.length, releasedLegacy };
}
