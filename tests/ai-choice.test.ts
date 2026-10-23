import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * «Sigo sin IA» is an answer, and it is kept (e5 UX, U39): in this browser, under its own key, with the day it was said and nothing else — no key, nothing of what is sent to a
 * model. It is not an edit of the profile, a browser that cannot remember it asks once more, which is all that can go wrong, and it goes with everything else when the data
 * of the browser is cleared.
 */

type Store = Map<string, string>;

function installStorage(seed: Record<string, string> = {}, { refuseWrites = false } = {}): Store {
  const map: Store = new Map(Object.entries(seed));
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => {
        if (refuseWrites) throw new Error("QuotaExceededError");
        map.set(key, value);
      },
      removeItem: (key: string) => void map.delete(key),
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return map;
}

async function loadModules() {
  vi.resetModules();
  const [store, local] = await Promise.all([import("@/lib/storage/ai-choice"), import("@/lib/storage/local")]);
  return { ...store, local };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  vi.resetModules();
});

describe("the memory of «Sigo sin IA»", () => {
  it("is the day it was said, under its own key, and is read back", async () => {
    const store = installStorage();
    const { rememberWithoutAi, loadWithoutAi, local } = await loadModules();
    expect(loadWithoutAi()).toBe(false);
    rememberWithoutAi(new Date("2026-10-11T12:00:00.000Z"));
    expect(local.AI_CHOICE_KEY).toBe("cvexact.aiChoice.v1");
    expect(JSON.parse(store.get("cvexact.aiChoice.v1")!)).toEqual({ withoutAi: "2026-10-11T12:00:00.000Z" });
    expect(loadWithoutAi()).toBe(true);
  });

  it("is taken back by choosing a way to have an AI, and taking it back twice changes nothing", async () => {
    const store = installStorage();
    const { rememberWithoutAi, forgetWithoutAi, loadWithoutAi } = await loadModules();
    rememberWithoutAi();
    forgetWithoutAi();
    expect(loadWithoutAi()).toBe(false);
    expect(JSON.parse(store.get("cvexact.aiChoice.v1")!)).toEqual({});
    forgetWithoutAi();
    expect(loadWithoutAi()).toBe(false);
  });

  it("writes nothing for a browser that never said it: taking back what was never said is no write at all", async () => {
    const store = installStorage();
    const { forgetWithoutAi } = await loadModules();
    forgetWithoutAi();
    expect(store.has("cvexact.aiChoice.v1")).toBe(false);
  });

  it("is nothing for what is not a day, and never throws on what is not JSON", async () => {
    for (const raw of ["not json", "null", "[]", "42", JSON.stringify({ withoutAi: true }), JSON.stringify({ withoutAi: 7 }), JSON.stringify({})]) {
      installStorage({ "cvexact.aiChoice.v1": raw });
      expect((await loadModules()).loadWithoutAi(), raw).toBe(false);
    }
  });

  it("holds no key and nothing of the profile, and is not an edit of it", async () => {
    const store = installStorage({ "cvexact.profile.v2": "{}", "cvexact.settings.v1": JSON.stringify({ entries: [] }) });
    const { rememberWithoutAi } = await loadModules();
    rememberWithoutAi();
    expect(store.get("cvexact.profile.v2")).toBe("{}");
    expect(store.get("cvexact.settings.v1")).toBe(JSON.stringify({ entries: [] }));
    expect(Object.keys(JSON.parse(store.get("cvexact.aiChoice.v1")!))).toEqual(["withoutAi"]);
  });

  it("is forgotten, without a word, by a browser that refuses to write", async () => {
    installStorage({}, { refuseWrites: true });
    const { rememberWithoutAi, forgetWithoutAi, loadWithoutAi } = await loadModules();
    expect(() => rememberWithoutAi()).not.toThrow();
    expect(() => forgetWithoutAi()).not.toThrow();
    expect(loadWithoutAi()).toBe(false);
  });

  it("goes with everything else when the browser's data is cleared: a shared computer keeps nothing of who was there", async () => {
    const store = installStorage({ "cvexact.aiChoice.v1": JSON.stringify({ withoutAi: "2026-10-11T12:00:00.000Z" }) });
    const { local } = await loadModules();
    await local.clearBrowserData();
    expect(store.has("cvexact.aiChoice.v1")).toBe(false);
  });
});
