import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Reading applications used to trust `JSON.parse` alone: a plausible-looking but
 * malformed row (an old build, a hand-edited backup, a bug upstream) parsed
 * fine and then threw the first time some component reached into it, taking
 * the whole `/postulaciones` route down. It now validates every row against
 * `applicationSchema` and drops what does not fit, the way `loadProfile`
 * already treats a profile that fails `profileSchema`.
 *
 * Storage is faked the way `storage-migration.test.ts` does it.
 */

function installStorage(seed: Record<string, string> = {}): Map<string, string> {
  const map = new Map(Object.entries(seed));
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return map;
}

async function load() {
  vi.resetModules();
  return import("@/lib/storage/local");
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  vi.resetModules();
});

const KEY = "cvexact.applications.v1";

const VALID = {
  id: "a1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  jobText: "aviso de ejemplo",
  label: "Postulación válida",
};

describe("listApplications", () => {
  it("carga una postulación bien formada", async () => {
    installStorage({ [KEY]: JSON.stringify([VALID]) });
    const local = await load();
    expect((await local.listApplications())).toEqual([VALID]);
  });

  it("descarta una fila sin los campos requeridos, sin tirar las demás", async () => {
    installStorage({
      [KEY]: JSON.stringify([VALID, { id: "a2" }, { ...VALID, id: "a3" }]),
    });
    const local = await load();
    expect((await local.listApplications()).map((a) => a.id)).toEqual(["a1", "a3"]);
  });

  it("vuelve a la lista vacía cuando el JSON está corrupto", async () => {
    installStorage({ [KEY]: "{{{ no es json" });
    const local = await load();
    expect((await local.listApplications())).toEqual([]);
  });

  it("vuelve a la lista vacía cuando la clave no guarda un array", async () => {
    installStorage({ [KEY]: JSON.stringify({ not: "an array" }) });
    const local = await load();
    expect((await local.listApplications())).toEqual([]);
  });

  it("no rompe con una fila que no es un objeto", async () => {
    installStorage({ [KEY]: JSON.stringify([VALID, null, "texto", 42]) });
    const local = await load();
    expect((await local.listApplications()).map((a) => a.id)).toEqual(["a1"]);
  });

  it("acepta una postulación con findings, cv y respuestas completas", async () => {
    const rich = {
      ...VALID,
      id: "a4",
      findings: [{ severity: "warning" as const, field: "summary", detail: "no coincide" }],
      dismissedGaps: ["inglés avanzado"],
      cvEdited: true,
    };
    installStorage({ [KEY]: JSON.stringify([rich]) });
    const local = await load();
    expect((await local.listApplications())).toEqual([rich]);
  });

  it("guarda el día en que se contestó la pregunta del aviso, y una postulación de antes, que no lo tiene, sigue leyéndose", async () => {
    const asked = { ...VALID, id: "a5", requirementAskedAt: "2026-09-21T12:00:00.000Z" };
    installStorage({ [KEY]: JSON.stringify([VALID, asked]) });
    const local = await load();
    const [before, after] = await local.listApplications();
    expect(before!.requirementAskedAt).toBeUndefined();
    expect(after).toEqual(asked);
  });

  it("parsea sin cambios una postulación guardada antes de que existiera status/notes", async () => {
    // `status` and `notes` were added later; nothing already on disk has them.
    installStorage({ [KEY]: JSON.stringify([VALID]) });
    const local = await load();
    const [loaded] = (await local.listApplications());
    expect(loaded.status).toBeUndefined();
    expect(loaded.notes).toBeUndefined();
  });

  it("guarda y relee status y notes", async () => {
    const withStatus = { ...VALID, status: "entrevista" as const, notes: "Contacto: RRHH" };
    installStorage({ [KEY]: JSON.stringify([withStatus]) });
    const local = await load();
    expect((await local.listApplications())).toEqual([withStatus]);
  });

  it("migra los cuatro estados de antes del tracker a su equivalente nuevo", async () => {
    const legacy = [
      { ...VALID, id: "a1", status: "borrador" },
      { ...VALID, id: "a2", status: "enviada" },
      { ...VALID, id: "a3", status: "entrevista" },
      { ...VALID, id: "a4", status: "cerrada" },
    ];
    installStorage({ [KEY]: JSON.stringify(legacy) });
    const local = await load();
    expect((await local.listApplications()).map((a) => a.status)).toEqual([
      "guardado",
      "postulado",
      "entrevista",
      "rechazado",
    ]);
  });
});
