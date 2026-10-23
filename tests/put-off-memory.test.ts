import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowser, uninstallBrowser, type FakeStorage } from "./helpers/browser-storage";

/**
 * What this browser remembers when someone says «Ahora no» to a reminder about where their profile lives (U06): for how long, and — for the
 * account — which notice it was said to. Neither is an edit of the profile. What can go wrong is only that a browser that cannot remember
 * says it once more.
 */

const NOW = new Date("2026-10-10T12:00:00.000Z");
const DAY = 86_400_000;

let local: FakeStorage;

beforeEach(() => {
  ({ local } = installBrowser());
  vi.resetModules();
});

afterEach(() => {
  uninstallBrowser();
  vi.resetModules();
});

describe("«Ahora no» to the reminder to make a copy", () => {
  it("is a fortnight when nothing says otherwise", async () => {
    const { snoozeProfileBackup, PROFILE_SNOOZE_DAYS } = await import("@/lib/storage/backup-reminder");
    snoozeProfileBackup(NOW);
    const saved = JSON.parse(local.getItem("cvexact.backupReminder.v1")!);
    expect(PROFILE_SNOOZE_DAYS).toBe(14);
    expect(Date.parse(saved.profileSnoozedUntil) - NOW.getTime()).toBe(14 * DAY);
  });

  it("is the days it is told, which in a Safari tab are the seven that Safari takes to delete", async () => {
    const { snoozeProfileBackup } = await import("@/lib/storage/backup-reminder");
    snoozeProfileBackup(NOW, 7);
    const saved = JSON.parse(local.getItem("cvexact.backupReminder.v1")!);
    expect(Date.parse(saved.profileSnoozedUntil) - NOW.getTime()).toBe(7 * DAY);
  });

  it("keeps the copies already made as they were", async () => {
    local.setItem("cvexact.backupReminder.v1", JSON.stringify({ lastBackupAt: "2026-09-01T00:00:00.000Z" }));
    const { snoozeProfileBackup } = await import("@/lib/storage/backup-reminder");
    snoozeProfileBackup(NOW, 7);
    expect(JSON.parse(local.getItem("cvexact.backupReminder.v1")!).lastBackupAt).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("«Ahora no» to a notice about the account", () => {
  it("is a fortnight, and remembers which notice it was said to", async () => {
    const { snoozeSyncNotice, SYNC_SNOOZE_DAYS, readSyncState } = await import("@/lib/storage/sync-state");
    snoozeSyncNotice("paused", NOW);
    const state = readSyncState();
    expect(SYNC_SNOOZE_DAYS).toBe(14);
    expect(state.snoozedFor).toBe("paused");
    expect(Date.parse(state.snoozedUntil!) - NOW.getTime()).toBe(14 * DAY);
  });

  it("keeps what the person asked for: the automatic upload stays on", async () => {
    const { setAutoSync, snoozeSyncNotice, readSyncState } = await import("@/lib/storage/sync-state");
    setAutoSync("u1", true, NOW);
    snoozeSyncNotice("diverged", NOW);
    expect(readSyncState().auto).toMatchObject({ userId: "u1" });
  });

  it("is forgotten when the profile and the account meet again, because it belonged to the state before", async () => {
    const { recordSynced, snoozeSyncNotice, readSyncState } = await import("@/lib/storage/sync-state");
    snoozeSyncNotice("pending", NOW);
    recordSynced("u1", 7, "2026-10-10T10:00:00.000Z", NOW);
    expect(readSyncState().snoozedUntil).toBeUndefined();
    expect(readSyncState().snoozedFor).toBeUndefined();
  });
});
