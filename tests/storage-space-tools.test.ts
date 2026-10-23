import { describe, expect, it } from "vitest";
import { classifyStorageError, StorageFullError, storageWriteError } from "@/lib/storage/errors";
import { backupReminderDue, REMIND_EVERY } from "@/lib/storage/backup-reminder";
import { formatBytes, spaceWarning } from "@/lib/storage/usage";

/**
 * The small pieces the storage UX rests on: telling «full» from «blocked»,
 * when to remind about a backup, and when to warn about space.
 */

describe("classifyStorageError", () => {
  it("reconoce la cuota llena como la reporta cada motor", () => {
    expect(classifyStorageError(new DOMException("x", "QuotaExceededError"))).toBe("quota");
    expect(classifyStorageError({ name: "NS_ERROR_DOM_QUOTA_REACHED" })).toBe("quota");
    expect(classifyStorageError({ code: 22 })).toBe("quota");
    expect(classifyStorageError(new Error("The quota has been exceeded."))).toBe("quota");
    // Dexie wraps the native error: an AbortError with the quota in `inner`.
    expect(classifyStorageError({ name: "AbortError", inner: { name: "QuotaExceededError" } })).toBe("quota");
  });

  it("distingue un almacenamiento bloqueado de uno lleno", () => {
    expect(classifyStorageError(new DOMException("denied", "SecurityError"))).toBe("unavailable");
    expect(classifyStorageError({ name: "MissingAPIError" })).toBe("unavailable");
    expect(classifyStorageError(new Error("algo raro"))).toBe("unknown");
  });

  it("sigue entregando StorageFullError para la cuota, que es lo que el resto de la app atrapa", () => {
    expect(storageWriteError(new DOMException("x", "QuotaExceededError"))).toBeInstanceOf(StorageFullError);
    expect(storageWriteError(new DOMException("x", "SecurityError"))).not.toBeInstanceOf(StorageFullError);
    expect(new StorageFullError().message).not.toMatch(/borrá postulaciones/);
  });
});

describe("backupReminderDue", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");
  const at = (day: number) => ({ createdAt: new Date(Date.UTC(2026, 4, day)).toISOString() });

  it("avisa cuando se juntaron suficientes postulaciones desde la última copia", () => {
    // Last copy two weeks ago: only the count decides.
    const since = "2026-05-15T00:00:00.000Z";
    const apps = Array.from({ length: REMIND_EVERY }, (_, i) => at(20 + (i % 5)));
    expect(backupReminderDue({ lastBackupAt: since }, apps, now)).toEqual({ due: true, newSince: REMIND_EVERY });
    expect(backupReminderDue({ lastBackupAt: since }, apps.slice(1), now).due).toBe(false);
  });

  it("avisa por pocas si ya pasó bastante tiempo, y nunca sin nada nuevo", () => {
    expect(backupReminderDue({ lastBackupAt: "2026-04-01T00:00:00.000Z" }, [at(2)], now).due).toBe(true);
    expect(backupReminderDue({ lastBackupAt: "2026-05-31T00:00:00.000Z" }, [at(2)], now)).toEqual({ due: false, newSince: 0 });
  });
});

describe("spaceWarning", () => {
  it("avisa antes de que falte, por el almacenamiento chico o por el disco", () => {
    expect(spaceWarning({ ratio: 0.5 }, { usage: 10, quota: 100 })).toBeNull();
    expect(spaceWarning({ ratio: 0.85 }, null)).toBe("local");
    expect(spaceWarning({ ratio: 0.1 }, { usage: 95, quota: 100 })).toBe("database");
  });

  it("formatea tamaños para personas", () => {
    expect(formatBytes(500)).toBe("1 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3,0 MB");
    expect(formatBytes(2.5 * 1024 ** 3)).toBe("2,5 GB");
  });
});
