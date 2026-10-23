import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FakeStorage,
  fillUntilFree,
  historyOfSize,
  installBrowser,
  QUOTA_CHARS,
  realisticApplication,
  uninstallBrowser,
} from "./helpers/browser-storage";

/**
 * The one-shot move of the history from localStorage to IndexedDB
 * (`lib/storage/applications/migrate.ts`). It handles the only copy of the
 * person's work, so each property its safety rests on gets a case: one
 * transaction or nothing; verified before localStorage is touched; a second tab
 * at the same moment; a tab still on the previous build writing afterwards;
 * nothing ever deleted along the way.
 */

const KEY = "cvexact.applications.v1";

async function load() {
  vi.resetModules();
  const local = await import("@/lib/storage/local");
  const { openAppDatabase } = await import("@/lib/storage/db");
  const store = await import("@/lib/storage/applications/store");
  const migrate = await import("@/lib/storage/applications/migrate");
  return { local, openAppDatabase, store, migrate };
}

async function database(openAppDatabase: typeof import("@/lib/storage/db").openAppDatabase) {
  const { db } = await openAppDatabase();
  if (!db) throw new Error("expected a database");
  return db;
}

afterEach(() => {
  uninstallBrowser();
  vi.resetModules();
});

describe("mudanza del historial a IndexedDB", () => {
  it("mueve todo en una transacción, lo verifica, y recién entonces libera localStorage", async () => {
    const history = Array.from({ length: 10 }, (_, i) => realisticApplication(i, { legacyCopy: true }));
    const { local } = installBrowser({ indexedDB: true });
    local.setItem(KEY, JSON.stringify([...history, { id: "rota" }, "no es un objeto"]));

    const { local: api, openAppDatabase } = await load();
    const loaded = await api.listApplications();

    expect(loaded.map((a) => a.id).sort()).toEqual(history.map((a) => a.id).sort());
    // Lossless compaction: the duplicate `cvOriginal` is gone, the CV is not.
    expect(loaded.every((a) => a.cv && a.cvOriginal === undefined)).toBe(true);
    expect(local.has(KEY)).toBe(false);

    const db = await database(openAppDatabase);
    expect(await db.applications.count()).toBe(10);
    // The rows that did not validate are kept, not dropped.
    expect(await db.quarantine.count()).toBe(2);
    // The raw snapshot holds every row exactly as it was, for its lifetime.
    const snapshot = await db.legacySnapshot.get("applications.v1");
    expect(snapshot?.items).toHaveLength(12);
    expect(await db.meta.get("migration.applications")).toBeDefined();
  });

  it("es idempotente: una segunda carga no cambia nada", async () => {
    const history = Array.from({ length: 5 }, (_, i) => realisticApplication(i));
    const { local } = installBrowser({ indexedDB: true });
    local.setItem(KEY, JSON.stringify(history));

    const first = await load();
    await first.local.listApplications();
    const db = await database(first.openAppDatabase);
    const before = await db.applications.toArray();

    const second = await load();
    expect((await second.local.listApplications()).map((a) => a.id).sort()).toEqual(history.map((a) => a.id).sort());
    expect(await db.applications.toArray()).toEqual(before);
    expect(await db.quarantine.count()).toBe(0);
  });

  it("si la transacción falla a mitad, no queda nada a medias y localStorage sigue intacto", async () => {
    const history = Array.from({ length: 6 }, (_, i) => realisticApplication(i));
    const { local } = installBrowser({ indexedDB: true });
    const raw = JSON.stringify(history);
    local.setItem(KEY, raw);

    const { local: api, openAppDatabase, store } = await load();
    const db = await database(openAppDatabase);
    // The fourth row is refused mid-transaction.
    db.applications.hook("creating", (_key, row) => {
      if ((row as { id: string }).id === history[3]!.id) throw new Error("QuotaExceededError");
    });

    const loaded = await api.listApplications();
    // Nothing lost: the app carries on from localStorage.
    expect(loaded).toHaveLength(6);
    expect(store.getApplicationsStatus()).toMatchObject({ engine: "legacy", databaseFailure: "migration" });
    expect(local.getItem(KEY)).toBe(raw);
    // All or nothing: no row, no marker, no snapshot.
    expect(await db.applications.count()).toBe(0);
    expect(await db.meta.get("migration.applications")).toBeUndefined();
    expect(await db.legacySnapshot.count()).toBe(0);
  });

  it("si lo que se lee de vuelta no coincide, deshace todo y deja localStorage como estaba", async () => {
    const history = Array.from({ length: 4 }, (_, i) => realisticApplication(i));
    const { local } = installBrowser({ indexedDB: true });
    const raw = JSON.stringify(history);
    local.setItem(KEY, raw);

    const { openAppDatabase, migrate } = await load();
    const db = await database(openAppDatabase);
    // A store that returns something other than what was written.
    db.applications.hook("reading", (row) => (row ? { ...row, jobText: "corrompido" } : row));

    await expect(migrate.migrateLegacyApplications(db)).rejects.toBeInstanceOf(migrate.MigrationVerificationError);
    expect(local.getItem(KEY)).toBe(raw);
    expect(await db.applications.count()).toBe(0);
    expect(await db.meta.get("migration.applications")).toBeUndefined();
  });

  it("dos pestañas migrando a la vez terminan con una sola copia", async () => {
    const history = Array.from({ length: 8 }, (_, i) => realisticApplication(i));
    const { local } = installBrowser({ indexedDB: true });
    local.setItem(KEY, JSON.stringify([...history, { id: "rota" }]));

    // Two module graphs: two pages, each with its own connection.
    const first = await load();
    const second = await load();
    await Promise.all([first.local.listApplications(), second.local.listApplications()]);

    const db = await database(second.openAppDatabase);
    expect(await db.applications.count()).toBe(8);
    expect(await db.quarantine.count()).toBe(1);
    expect(local.has(KEY)).toBe(false);
  });

  it("incorpora lo que escribió después una pestaña con la versión anterior, sin borrar nada", async () => {
    const history = Array.from({ length: 3 }, (_, i) => realisticApplication(i));
    const { local } = installBrowser({ indexedDB: true });
    local.setItem(KEY, JSON.stringify(history));

    let { local: api } = await load();
    await api.listApplications();
    expect(local.has(KEY)).toBe(false);

    // The stale tab reads the (now empty) key and writes back only what it has.
    const late = realisticApplication(50);
    const edited = { ...history[0]!, label: "Editada en la pestaña vieja", updatedAt: "2027-01-01T00:00:00.000Z" };
    local.setItem(KEY, JSON.stringify([late, edited]));

    ({ local: api } = await load());
    const loaded = await api.listApplications();
    expect(loaded).toHaveLength(4);
    expect(loaded.find((a) => a.id === history[0]!.id)?.label).toBe("Editada en la pestaña vieja");
    expect(loaded.some((a) => a.id === late.id)).toBe(true);
    // The other two were not in the stale tab's array — and are still here.
    expect(loaded.some((a) => a.id === history[1]!.id)).toBe(true);
    expect(local.has(KEY)).toBe(false);
  });

  it("al liberar localStorage, completa en la misma sesión la migración del perfil que no entraba", async () => {
    const history = historyOfSize(5_165_000);
    const local = new FakeStorage(QUOTA_CHARS);
    local.setItem(KEY, JSON.stringify(history));
    local.setItem("cvexact.profile.v1", JSON.stringify({ version: 1, fullName: "Ana Gómez" }));
    // Less room than the profile takes in its new format.
    fillUntilFree(local, 100);
    installBrowser({ local, indexedDB: true });

    const { local: api } = await load();
    // On a store this full the profile could not be written in its new format.
    expect(local.has("cvexact.profile.v2")).toBe(false);

    await api.listApplications();
    expect(local.has(KEY)).toBe(false);
    expect(local.has("cvexact.profile.v2")).toBe(true);
    expect(api.loadProfile().fullName).toBe("Ana Gómez");
  });

  it("la copia previa a la mudanza sigue a los borrados, se vacía con «Eliminar todas» y vence sola", async () => {
    const history = Array.from({ length: 4 }, (_, i) => realisticApplication(i));
    const { local } = installBrowser({ indexedDB: true });
    local.setItem(KEY, JSON.stringify(history));

    const { local: api, openAppDatabase } = await load();
    await api.listApplications();
    const db = await database(openAppDatabase);

    await api.deleteApplications([history[0]!.id]);
    const snapshot = await db.legacySnapshot.get("applications.v1");
    expect(snapshot?.items.map((item) => (item as { id: string }).id)).not.toContain(history[0]!.id);
    expect(await api.legacySnapshotInfo()).toMatchObject({ count: 3 });
    const archive = await api.exportLegacySnapshot();
    expect(archive?.kind).toBe("cvexact-archive");

    // Expired: no longer offered.
    await db.legacySnapshot.update("applications.v1", { expiresAt: "2000-01-01T00:00:00.000Z" });
    expect(await api.legacySnapshotInfo()).toBeNull();

    await api.clearApplications();
    expect(await db.legacySnapshot.count()).toBe(0);
  });
});
