import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Reading a store written by an older build.
 *
 * The shapes that changed without changing a key — today, settings going from
 * one provider to an ordered list — are migrated by the readers themselves, at
 * module evaluation. Each case installs its own fake storage and re-imports the
 * module with `vi.resetModules()`. Testing it any other way would test a
 * function nobody calls in that order.
 */

type Store = Map<string, string>;

function installStorage(seed: Record<string, string>): Store {
  const map: Store = new Map(Object.entries(seed));
  const localStorage = {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
  (globalThis as unknown as { window: unknown }).window = {
    localStorage,
    addEventListener() {},
    removeEventListener() {},
  };
  return map;
}

async function loadModule() {
  vi.resetModules();
  return import("@/lib/storage/local");
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  vi.resetModules();
});

describe("la forma anterior de la configuración", () => {
  /**
   * Settings went from one provider to an ordered list. There is no key to
   * copy: `loadSettings` is where the old shape converts, so a browser that
   * never opens Ajustes again still keeps generating with the key it had.
   */
  it("convierte la configuración de un solo proveedor en una cadena de uno", async () => {
    installStorage({
      "cvexact.settings.v1": JSON.stringify({
        provider: "groq",
        apiKey: "gsk_vieja",
        model: "openai/gpt-oss-120b",
      }),
    });

    const local = await loadModule();

    expect(local.loadSettings().entries).toEqual([
      { provider: "groq", apiKey: "gsk_vieja", model: "openai/gpt-oss-120b" },
    ]);
  });

  it("no inventa una entrada cuando la configuración vieja estaba vacía", async () => {
    installStorage({
      "cvexact.settings.v1": JSON.stringify({ provider: "", apiKey: "", model: "" }),
    });

    const local = await loadModule();

    expect(local.loadSettings().entries).toEqual([]);
  });
});

describe("copias de seguridad", () => {
  it("importa una copia nueva y exporta siempre con el nombre nuevo", async () => {
    installStorage({});
    const local = await loadModule();

    expect(
      await local.importBackup(
        JSON.stringify({
          kind: "cvexact-backup",
          version: 1,
          exportedAt: "2026-08-23T00:00:00.000Z",
          profile: { version: 1, fullName: "Ana Gómez" },
          applications: [],
        }),
      ),
    ).toBeNull();

    expect((await local.exportBackup()).kind).toBe("cvexact-backup");
  });

  it("sigue rechazando un archivo que no es una copia", async () => {
    installStorage({});
    const local = await loadModule();
    expect(await local.importBackup(JSON.stringify({ kind: "otra-cosa" }))).toMatch(/no es una copia de cvexact/);
  });
});
