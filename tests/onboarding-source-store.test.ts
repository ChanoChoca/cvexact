import { afterEach, describe, expect, it, vi } from "vitest";

function installStorage(seed: Record<string, string> = {}, failOn: (key: string) => boolean = () => false) {
  const map = new Map(Object.entries(seed));
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => {
        if (failOn(key)) throw new Error("QuotaExceededError");
        map.set(key, value);
      },
      removeItem: (key: string) => void map.delete(key),
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return map;
}

async function load() {
  vi.resetModules();
  return import("@/lib/onboarding/source-store");
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  vi.resetModules();
});

describe("the originals", () => {
  it("keeps a document line by line, and gives it back", async () => {
    installStorage();
    const store = await load();
    store.saveSource("a", "cv.pdf", ["Ana Gómez", "Analista"]);
    expect(store.loadSource("a")).toEqual({ name: "cv.pdf", lines: ["Ana Gómez", "Analista"] });
    expect(store.loadSource("otra")).toBeNull();
  });

  it("keeps each line's box too, when there is one, rounded", async () => {
    installStorage();
    const store = await load();
    store.saveSource("a", "cv.pdf", ["Ana Gómez", "Sin posición"], {
      layout: [{ page: 1, x: 50.26, y: 700.04, width: 91.666, size: 12 }, null],
    });
    expect(store.loadSource("a")).toEqual({
      name: "cv.pdf",
      lines: ["Ana Gómez", "Sin posición"],
      layout: [{ page: 1, x: 50.3, y: 700, width: 91.7, size: 12 }, null],
    });
  });

  it("leaves layout out for a source with no positions, same as before this existed", async () => {
    installStorage();
    const store = await load();
    store.saveSource("a", "cv.pdf", ["Ana Gómez"]);
    expect(store.loadSource("a")).toEqual({ name: "cv.pdf", lines: ["Ana Gómez"] });
  });

  it("forgets one", async () => {
    installStorage();
    const store = await load();
    store.saveSource("a", "cv.pdf", ["x"]);
    store.forgetSource("a");
    expect(store.loadSource("a")).toBeNull();
  });

  it("drops the oldest to stay under its cap, and never the one just saved", async () => {
    installStorage();
    const store = await load();
    const big = ["x".repeat(store.MAX_SOURCE_CHARS / 2 - 10)];
    store.saveSource("viejo", "a.pdf", big, { now: "2026-01-01T00:00:00.000Z" });
    store.saveSource("medio", "b.pdf", big, { now: "2026-02-01T00:00:00.000Z" });
    store.saveSource("nuevo", "c.pdf", big, { now: "2026-03-01T00:00:00.000Z" });
    expect(store.loadSource("viejo")).toBeNull();
    expect(store.loadSource("medio")).not.toBeNull();
    expect(store.loadSource("nuevo")).not.toBeNull();
  });

  it("keeps a single original bigger than the cap rather than lose what was just imported", async () => {
    installStorage();
    const store = await load();
    store.saveSource("enorme", "x.pdf", ["y".repeat(store.MAX_SOURCE_CHARS + 100)]);
    expect(store.loadSource("enorme")).not.toBeNull();
  });

  it("never fails an import because the browser store is full", async () => {
    installStorage({}, (key) => key === "cvexact.sources.v1");
    const store = await load();
    expect(() => store.saveSource("a", "cv.pdf", ["x"])).not.toThrow();
    expect(store.loadSource("a")).toBeNull();
  });

  it("copes with a store that is not what it expects", async () => {
    installStorage({ "cvexact.sources.v1": "{roto" });
    const store = await load();
    expect(store.loadSource("a")).toBeNull();
    store.saveSource("a", "cv.pdf", ["x"]);
    expect(store.loadSource("a")).not.toBeNull();
  });

  it("is removed with everything else when the browser is cleared", async () => {
    const map = installStorage();
    const store = await load();
    store.saveSource("a", "cv.pdf", ["x"]);
    const local = await import("@/lib/storage/local");
    await local.clearBrowserData();
    expect(map.has("cvexact.sources.v1")).toBe(false);
  });
});
