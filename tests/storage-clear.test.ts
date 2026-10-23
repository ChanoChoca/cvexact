import { afterEach, describe, expect, it, vi } from "vitest";
import { INTAKE_KEY } from "@/lib/schemas/intake";

/**
 * `clearBrowserData` backs the destructive half of the sign-out dialog: someone
 * on a shared machine closes their session and asks for everything in this
 * browser to go with it.
 *
 * The contract has two halves, and both are tested here rather than trusted.
 * Everything the user has — profile, applications, settings with their BYOK
 * keys, the interview transcript — must actually leave, or the feature is a
 * lie told to the person handing over the computer. And the tombstones must
 * stay, because losing them would resurrect on the next "Subir a mi cuenta"
 * applications the user deleted before wiping.
 *
 * The fake storage and per-case module reload follow `storage-migration.test.ts`,
 * for the same reason: the module under test runs code at evaluation time.
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

const MINIMAL_APPLICATION = {
  id: "a1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  jobText: "aviso de ejemplo",
  label: "Postulación de prueba",
};

describe("clearBrowserData", () => {
  it("borra el perfil, las postulaciones, las settings con sus keys, el borrador y la entrevista", async () => {
    const store = installStorage({
      "cvexact.profile.v1": JSON.stringify({ version: 1, fullName: "Ana Gómez" }),
      "cvexact.applications.v1": JSON.stringify([MINIMAL_APPLICATION]),
      "cvexact.settings.v1": JSON.stringify({
        entries: [{ provider: "openai", apiKey: "sk-secreto", model: "gpt" }],
      }),
      "cvexact.draftJobText.v1": JSON.stringify("un aviso a medio pegar"),
      "cvexact.dumpDraft.v1": JSON.stringify("trabajé en Nubia Retail desde"),
      [INTAKE_KEY]: JSON.stringify({ version: 1, messages: [] }),
      "cvexact.derived.v1": JSON.stringify({ profileHash: "x" }),
      "cvexact.providerNotes.v1": JSON.stringify({ "openai:gpt": { status: 429, message: "", at: "" } }),
    });

    const local = await loadModule();
    await local.clearBrowserData();

    expect(local.loadProfile().fullName).toBe("");
    expect(await local.listApplications()).toEqual([]);
    expect(local.loadSettings().entries).toEqual([]);
    expect(local.loadDraftJobText()).toBe("");
    expect(local.loadDumpDraft()).toBe("");
    // The raw keys are gone too, not just unread — a wipe that leaves the
    // strings sitting in storage is readable by whoever opens the laptop next.
    expect(store.has("cvexact.profile.v1")).toBe(false);
    expect(store.has("cvexact.applications.v1")).toBe(false);
    expect(store.has("cvexact.settings.v1")).toBe(false);
    expect(store.has("cvexact.draftJobText.v1")).toBe(false);
    expect(store.has("cvexact.dumpDraft.v1")).toBe(false);
    expect(store.has(INTAKE_KEY)).toBe(false);
    expect(store.has("cvexact.derived.v1")).toBe(false);
    expect(store.has("cvexact.providerNotes.v1")).toBe(false);
  });

  it("conserva los tombstones de postulaciones borradas", async () => {
    installStorage({
      "cvexact.deletedApplications.v1": JSON.stringify(["gone"]),
    });

    const local = await loadModule();
    await local.clearBrowserData();

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
    // The sign-out reload follows immediately; a throwing removeItem must not
    // stand between the user and ending their session.
    await expect(local.clearBrowserData()).resolves.toBeUndefined();
  });
});

describe("clearBrowserData: lo que el navegador recuerda de la cuenta y de cómo se usó", () => {
  // «Borrar los datos de este navegador» es para un equipo compartido o para no dejar nada: ni el rastro de con qué cuenta
  // se igualó el perfil ni lo contado de su uso pueden quedar a la vista del que se siente después.
  it("borra el rastro de la sincronización y los contadores de uso", async () => {
    const store = installStorage({
      "cvexact.syncState.v1": JSON.stringify({ userId: "u1", rev: 7, at: "2026-10-03T15:00:00.000Z" }),
      "cvexact.metrics.v1": JSON.stringify({ version: 1, days: { "2026-10-03": { question_answered: 4 } } }),
    });

    const local = await loadModule();
    expect(local.SYNC_STATE_KEY).toBe("cvexact.syncState.v1");
    expect(local.METRICS_KEY).toBe("cvexact.metrics.v1");
    await local.clearBrowserData();

    expect(store.has("cvexact.syncState.v1")).toBe(false);
    expect(store.has("cvexact.metrics.v1")).toBe(false);
  });
});
