import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeStorage, installBrowser, realisticApplication, uninstallBrowser } from "./helpers/browser-storage";

/**
 * The applications store (`lib/storage/applications/store.ts`): memory first,
 * durable storage through a per-record queue, and a refused write as a state of
 * one record rather than an error.
 */

async function load() {
  vi.resetModules();
  const local = await import("@/lib/storage/local");
  const store = await import("@/lib/storage/applications/store");
  return { local, store };
}

afterEach(() => {
  uninstallBrowser();
  vi.useRealTimers();
  vi.resetModules();
});

describe("el store de postulaciones", () => {
  it("guarda de a una en IndexedDB y las encuentra después de recargar", async () => {
    installBrowser({ indexedDB: true });
    let { local } = await load();
    const app = realisticApplication(1);
    expect(await local.saveApplication(app)).toEqual({ ok: true });

    ({ local } = await load());
    expect((await local.listApplications()).map((a) => a.id)).toEqual([app.id]);
  });

  it("sin IndexedDB sigue funcionando sobre localStorage, y dice por qué", async () => {
    const { local: storage } = installBrowser();
    const { local, store } = await load();
    const app = realisticApplication(2);
    expect(await local.saveApplication(app)).toEqual({ ok: true });
    expect(storage.getItem("cvexact.applications.v1")).toContain(app.id);
    expect(store.getApplicationsStatus()).toMatchObject({ ready: true, engine: "legacy", databaseFailure: "missing" });
  });

  it("si IndexedDB no responde nunca, sigue con localStorage pasado el tiempo de espera", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    installBrowser();
    // An IndexedDB whose `open` never answers — what some browsers have shipped.
    const globals = globalThis as unknown as { indexedDB?: unknown; IDBKeyRange?: unknown };
    const { IDBKeyRange } = await import("fake-indexeddb");
    globals.IDBKeyRange = IDBKeyRange;
    globals.indexedDB = {
      open: () => ({}),
      deleteDatabase: () => ({}),
      cmp: (a: unknown, b: unknown) => (a === b ? 0 : String(a) < String(b) ? -1 : 1),
    };

    const { local, store } = await load();
    let settled = false;
    const listing = local.listApplications().then((result) => {
      settled = true;
      return result;
    });
    // Loading Dexie is real I/O, which fake timers do not move — and under a
    // loaded test run it can take a while. Keep moving the fake clock for as
    // long as real time allows, so the open's timer fires whenever it starts.
    const started = performance.now();
    while (!settled && performance.now() - started < 10_000) {
      await new Promise((resolve) => setImmediate(resolve));
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(await listing).toEqual([]);
    expect(store.getApplicationsStatus()).toMatchObject({ engine: "legacy", databaseFailure: "timeout" });
  }, 20_000);

  it("junta una ráfaga de cambios del mismo registro en a lo sumo dos escrituras", async () => {
    const { local: storage } = installBrowser();
    const { local } = await load();
    const app = realisticApplication(3);
    await local.saveApplication(app);
    const before = storage.writes.get("cvexact.applications.v1") ?? 0;

    // Fifty keystrokes in the editor, in the same tick.
    const saves = Array.from({ length: 50 }, (_, i) => local.saveApplication({ ...app, label: `v${i}` }));
    await Promise.all(saves);

    expect((storage.writes.get("cvexact.applications.v1") ?? 0) - before).toBeLessThanOrEqual(2);
    expect(storage.getItem("cvexact.applications.v1")).toContain('"label":"v49"');
  });

  it("guarda el cambio en memoria enseguida, aunque el navegador todavía no respondió", async () => {
    installBrowser({ indexedDB: true });
    const { local } = await load();
    await local.listApplications();
    const app = realisticApplication(4);
    const pending = local.saveApplication(app);
    // Before the write resolves: already there for every reader.
    expect(local.getApplication(app.id)?.label).toBe(app.label);
    await pending;
  });

  it("archivar quita del navegador sin registrar borrados; borrar sí los registra", async () => {
    installBrowser({ indexedDB: true });
    const { local } = await load();
    const [kept, archived, deleted] = [5, 6, 7].map((i) => realisticApplication(i));
    for (const app of [kept, archived, deleted]) await local.saveApplication(app!);

    expect(await local.archiveApplications([archived!.id])).toEqual({ ok: true });
    expect(await local.deleteApplications([deleted!.id])).toEqual({ ok: true });

    expect((await local.listApplications()).map((a) => a.id)).toEqual([kept!.id]);
    expect(local.loadDeletedApplicationIds()).toEqual([deleted!.id]);
  });

  it("un archivo archivado vuelve fusionándose, sin tocar lo que ya había", async () => {
    installBrowser({ indexedDB: true });
    const { local } = await load();
    const here = realisticApplication(8);
    const away = realisticApplication(9);
    await local.saveApplication(here);
    const file = JSON.stringify(local.buildArchive([away, { id: "rota" }]));

    const result = await local.importFile(file);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/Agregamos 1 postulación/);
    expect(result.message).toMatch(/1 no tenían un formato válido/);
    expect((await local.listApplications()).map((a) => a.id).sort()).toEqual([here.id, away.id].sort());
  });

  it("el mensaje del archivo cuenta en plural como se escribe: «postulaciones», sin tilde", async () => {
    installBrowser({ indexedDB: true });
    const { local } = await load();
    const file = JSON.stringify(local.buildArchive([realisticApplication(20), realisticApplication(21)]));
    const result = await local.importFile(file);
    expect(result.message).toMatch(/^Agregamos 2 postulaciones\./);
  });

  it("restaurar una copia reemplaza la lista pero conserva lo que todavía no se guardó", async () => {
    const storage = new FakeStorage(60_000);
    installBrowser({ local: storage });
    const { local, store } = await load();
    await local.listApplications();
    // Too big for this tiny store: it stays in memory, waiting.
    const waiting = realisticApplication(10);
    const filler = realisticApplication(11);
    await local.saveApplication(filler);
    await local.saveApplication(waiting);
    await local.saveApplication({ ...realisticApplication(12), id: "grande", jobText: "x".repeat(40_000) });
    expect(store.getApplicationsStatus().unsaved.map((entry) => entry.id)).toContain("grande");

    const backup = {
      kind: "cvexact-backup",
      version: 2,
      exportedAt: new Date().toISOString(),
      profile: local.loadStoredProfile(),
      applications: [],
    };
    expect(await local.importBackup(JSON.stringify(backup))).toBeNull();
    expect((await local.listApplications()).map((a) => a.id)).toEqual(["grande"]);
  });

  it("borrar una que no se pudo guardar la quita del todo: ni aviso ni copia de espera", async () => {
    const { local: storage } = installBrowser({ local: new FakeStorage(10_000) });
    const { local, store } = await load();
    const app = realisticApplication(14);
    expect((await local.saveApplication(app)).ok).toBe(false);
    expect(store.getApplicationsStatus().unsaved).toHaveLength(1);

    await local.deleteApplications([app.id]);
    expect(store.getApplicationsStatus().unsaved).toHaveLength(0);
    expect(storage.getItem("cvexact.unsaved.v1")).toBeNull();
    expect(await local.listApplications()).toEqual([]);
  });

  it("la copia exportada incluye lo que el navegador no aceptó guardar", async () => {
    installBrowser({ local: new FakeStorage(10_000) });
    const { local } = await load();
    const app = realisticApplication(13);
    expect((await local.saveApplication(app)).ok).toBe(false);
    const backup = await local.exportBackup();
    expect(backup.applications.map((a) => a.id)).toEqual([app.id]);
  });
});
