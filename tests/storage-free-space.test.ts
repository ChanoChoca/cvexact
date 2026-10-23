import { afterEach, describe, expect, it, vi } from "vitest";
import { INTAKE_KEY } from "@/lib/schemas/intake";

/**
 * `freeSpace` is what «Liberar espacio» does when the browser has no room left: everything that can be made again goes, and the profile and the keys stay.
 * Both halves are held here, because the first is the point and the second is the promise the button makes in its dialog.
 *
 * The fake storage and the per-case module reload follow `storage-clear.test.ts`.
 */

type Store = Map<string, string>;

function installStorage(seed: Record<string, string>): Store {
  const map: Store = new Map(Object.entries(seed));
  const localStorage = {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
  (globalThis as unknown as { window: unknown }).window = { localStorage, addEventListener() {}, removeEventListener() {} };
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

describe("freeSpace", () => {
  it("borra las postulaciones, los borradores, los caches, las notas de keys y la actividad", async () => {
    const store = installStorage({
      "cvexact.applications.v1": JSON.stringify([{ id: "a1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", jobText: "aviso", label: "Una" }]),
      "cvexact.draftJobText.v1": JSON.stringify("un aviso a medio pegar"),
      "cvexact.dumpDraft.v1": JSON.stringify("trabajé en Nubia Retail"),
      "cvexact.formDrafts.v1": JSON.stringify({ a: "b" }),
      "cvexact.derived.v1": JSON.stringify({ profileHash: "x" }),
      "cvexact.providerNotes.v1": JSON.stringify({ "openai:gpt": { status: 429, message: "", at: "" } }),
      "cvexact.extractCache.v1": "{}",
      "cvexact.splitCache.v1": "{}",
      "cvexact.metrics.v1": "{}",
    });

    const local = await loadModule();
    await local.freeSpace();

    expect(await local.listApplications()).toEqual([]);
    for (const key of [
      "cvexact.applications.v1",
      "cvexact.draftJobText.v1",
      "cvexact.dumpDraft.v1",
      "cvexact.formDrafts.v1",
      "cvexact.derived.v1",
      "cvexact.providerNotes.v1",
      "cvexact.extractCache.v1",
      "cvexact.splitCache.v1",
      "cvexact.metrics.v1",
    ]) {
      expect(store.has(key), key).toBe(false);
    }
  });

  it("deja el perfil, las keys, la elección de IA, la entrevista, el estado de sync y los tombstones", async () => {
    // The profile is seeded in its old shape and read back through the module, which moves it to the current key on load: what matters is that it is there after.
    const kept = {
      "cvexact.settings.v1": JSON.stringify({ entries: [{ provider: "openai", apiKey: "sk-secreto", model: "gpt" }] }),
      "cvexact.aiChoice.v1": JSON.stringify("sin-ia"),
      [INTAKE_KEY]: JSON.stringify({ version: 1, messages: [] }),
      "cvexact.syncState.v1": "{}",
      "cvexact.deletedApplications.v1": JSON.stringify(["gone"]),
      "cvexact.pendingGenerations.v1": "[]",
    };
    const store = installStorage({ ...kept, "cvexact.profile.v1": JSON.stringify({ version: 1, fullName: "Ana Gómez" }), "cvexact.derived.v1": "{}" });

    const local = await loadModule();
    await local.freeSpace();

    for (const [key, value] of Object.entries(kept)) expect(store.get(key), key).toBe(value);
    expect(local.loadSettings().entries).toEqual([{ provider: "openai", apiKey: "sk-secreto", model: "gpt" }]);
    expect(local.loadProfile().fullName).toBe("Ana Gómez");
    expect(local.loadDeletedApplicationIds()).toEqual(["gone"]);
  });

  it("tolera un storage que no responde", async () => {
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {
          throw new Error("denied");
        },
      },
      addEventListener() {},
      removeEventListener() {},
    };
    const local = await loadModule();
    await expect(local.freeSpace()).resolves.toBeUndefined();
  });
});
