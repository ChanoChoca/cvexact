import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyProfile, type Profile } from "@/lib/schemas/profile";
import type { InferredSkill } from "@/lib/schemas/job";

/**
 * The cache that stops the app paying twice for work it has already done.
 *
 * `inferSkills` reads the profile and nothing else — `lib/ai/prompts/infer-skills.ts`
 * says so — yet it ran once per application: a whole model call on the critical
 * path, producing an answer identical to the last one. What makes caching it
 * safe is that a profile edit has to invalidate it, and these are the tests
 * that say it does.
 *
 * Same fake-storage setup as `tests/storage-migration.test.ts`: the module
 * migrates keys at evaluation time, so each case installs a store and
 * re-imports.
 */

function installStorage(): Map<string, string> {
  const map = new Map<string, string>();
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

async function loadModule() {
  vi.resetModules();
  return import("@/lib/storage/local");
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  vi.resetModules();
});

const skills: InferredSkill[] = [
  { skill: "SQL", derivedFrom: "reportes mensuales", confidence: "high", rationale: "los armaba" },
];

function withName(name: string): Profile {
  return { ...emptyProfile(), fullName: name };
}

describe("caché de trabajo derivado", () => {
  it("devuelve lo guardado para el mismo perfil", async () => {
    installStorage();
    const store = await loadModule();
    const profile = withName("Ana");

    expect(store.loadCachedInferredSkills(profile)).toBeNull();
    store.saveCachedInferredSkills(profile, skills);
    expect(store.loadCachedInferredSkills(profile)).toEqual(skills);
  });

  /** The whole safety argument: editing the profile must not serve stale skills. */
  it("se invalida cuando el perfil cambia", async () => {
    installStorage();
    const store = await loadModule();

    store.saveCachedInferredSkills(withName("Ana"), skills);
    expect(store.loadCachedInferredSkills(withName("Ana Belén"))).toBeNull();
  });

  /**
   * Key order is an accident of how an object was built — one straight from the
   * store and the same one after an edit that spread it are equal and can
   * serialise differently. Hashing the accident would miss every hit, silently,
   * and only for the users who had edited something.
   */
  it("no depende del orden de las claves del perfil", async () => {
    installStorage();
    const store = await loadModule();
    const profile = withName("Ana");

    store.saveCachedInferredSkills(profile, skills);
    const reordered = Object.fromEntries(
      Object.entries(profile).reverse(),
    ) as unknown as Profile;
    expect(store.loadCachedInferredSkills(reordered)).toEqual(skills);
  });

  it("guarda el análisis por oferta, sin pisar los skills", async () => {
    installStorage();
    const store = await loadModule();
    const profile = withName("Ana");
    const analysis = { title: "Analista" } as never;

    store.saveCachedInferredSkills(profile, skills);
    store.saveCachedAnalysis(profile, "  una oferta  ", analysis);

    // Trimmed on both sides, so trailing whitespace from a paste still hits.
    expect(store.loadCachedAnalysis(profile, "una oferta")).toEqual(analysis);
    expect(store.loadCachedAnalysis(profile, "otra oferta")).toBeNull();
    expect(store.loadCachedInferredSkills(profile)).toEqual(skills);
  });

  it("no crece sin límite al acumular ofertas", async () => {
    installStorage();
    const store = await loadModule();
    const profile = withName("Ana");

    for (let i = 0; i < 25; i++) {
      store.saveCachedAnalysis(profile, `oferta ${i}`, { n: i } as never);
    }

    // The oldest are dropped; the newest stay.
    expect(store.loadCachedAnalysis(profile, "oferta 0")).toBeNull();
    expect(store.loadCachedAnalysis(profile, "oferta 24")).toEqual({ n: 24 });
  });

  /**
   * A cache write that cannot fit must never fail a generation that already
   * succeeded — `write` raises `StorageFullError`, which is right for the
   * user's work and wrong for a derived copy of it.
   */
  it("no rompe la generación cuando no hay espacio", async () => {
    const map = installStorage();
    const store = await loadModule();
    (globalThis as unknown as { window: { localStorage: { setItem: unknown } } }).window
      .localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };

    expect(() => store.saveCachedInferredSkills(withName("Ana"), skills)).not.toThrow();
    expect(map.size).toBe(0);
  });
});

describe("notas de proveedor", () => {
  it("registra el último rechazo por proveedor y modelo", async () => {
    installStorage();
    const store = await loadModule();

    store.recordProviderNotes([
      { provider: "groq", modelId: "llama", status: 402, message: "sin crédito" },
    ]);

    expect(store.loadProviderNotes()["groq:llama"]).toMatchObject({
      status: 402,
      message: "sin crédito",
    });
  });

  /** Editing the row answers what the note was complaining about. */
  it("olvida la nota de una fila corregida", async () => {
    installStorage();
    const store = await loadModule();

    store.recordProviderNotes([
      { provider: "groq", modelId: "llama", status: 401, message: "key rechazada" },
    ]);
    store.clearProviderNote("groq", "llama");

    expect(store.loadProviderNotes()["groq:llama"]).toBeUndefined();
  });
});
