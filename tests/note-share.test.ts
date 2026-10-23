import { afterEach, describe, expect, it, vi } from "vitest";
import { SHARE_CACHE, SHARE_KEY, SHARE_WORKER, registerShareWorker, sharedText, takeShared } from "@/lib/notes/share";

/**
 * Sharing to the app from another one (e5, O15): what is shared, as the text to write down; the worker that receives it, registered when the app is allowed
 * to; and what it kept, read once. The worker itself is `tests/share-worker.test.ts`.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what was shared, as one text", () => {
  it("is the title, the text and the address, each once", () => {
    expect(sharedText({ title: "Felicitaciones", text: "Cerraste muy bien el trimestre", url: "https://ejemplo.com/n" })).toBe("Felicitaciones\nCerraste muy bien el trimestre\nhttps://ejemplo.com/n");
    expect(sharedText({ text: "Solo el texto" })).toBe("Solo el texto");
    expect(sharedText({})).toBe("");
  });

  it("does not say it twice: the address that Chrome puts inside the text, and the title an app repeats as the text", () => {
    expect(sharedText({ text: "Mirá esto https://ejemplo.com/n", url: "https://ejemplo.com/n" })).toBe("Mirá esto https://ejemplo.com/n");
    expect(sharedText({ title: "Una nota", text: "Una nota" })).toBe("Una nota");
    // What came first and is part of what follows is replaced by it.
    expect(sharedText({ title: "Cerraste el mes", text: "Cerraste el mes con buen resultado" })).toBe("Cerraste el mes con buen resultado");
    expect(sharedText({ title: "  ", text: "\n", url: " " })).toBe("");
  });
});

describe("the worker", () => {
  it("is registered with the whole site as its scope, and said to be", async () => {
    const register = vi.fn(async () => ({}));
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    expect(await registerShareWorker()).toBe(true);
    expect(register).toHaveBeenCalledWith(SHARE_WORKER, { scope: "/" });
  });

  it("is not registered where there is no such thing, and a refusal is not an error", async () => {
    vi.stubGlobal("navigator", {});
    expect(await registerShareWorker()).toBe(false);
    vi.stubGlobal("navigator", { serviceWorker: { register: async () => Promise.reject(new Error("no")) } });
    expect(await registerShareWorker()).toBe(false);
  });
});

/** The cache the worker writes to, with one entry or none. */
function stubCache(entry: unknown | null, options: { failOpen?: boolean } = {}) {
  const deleted: string[] = [];
  vi.stubGlobal("caches", {
    open: async (name: string) => {
      if (options.failOpen) throw new Error("sin cache");
      expect(name).toBe(SHARE_CACHE);
      return {
        match: async (key: string) => (entry !== null && key === SHARE_KEY ? new Response(JSON.stringify(entry), { headers: { "content-type": "application/json" } }) : undefined),
        delete: async (key: string) => void deleted.push(key),
      };
    },
  });
  return deleted;
}

describe("what the worker kept", () => {
  it("is read once: taken out as it is read, and given as the text to write down", async () => {
    const deleted = stubCache({ title: "Felicitaciones", text: "Cerraste el trimestre", url: "", at: 1 });
    expect(await takeShared()).toBe("Felicitaciones\nCerraste el trimestre");
    expect(deleted).toEqual([SHARE_KEY]);
  });

  it("is nothing when nothing is there, when it says nothing, or when the browser has no such cache", async () => {
    expect(stubCache(null)).toEqual([]);
    expect(await takeShared()).toBeNull();
    stubCache({ title: "", text: "  ", url: "" });
    expect(await takeShared()).toBeNull();
    stubCache(null, { failOpen: true });
    expect(await takeShared()).toBeNull();
    vi.stubGlobal("caches", undefined);
    expect(await takeShared()).toBeNull();
  });
});

describe("when the browser's data is deleted", () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    vi.resetModules();
  });

  it("takes with it what was shared and not yet read: it is the person's text", async () => {
    const deleted: string[] = [];
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      caches: { delete: async (name: string) => void deleted.push(name) },
      addEventListener() {},
      removeEventListener() {},
    };
    vi.resetModules();
    const { clearBrowserData } = await import("@/lib/storage/local");
    await clearBrowserData();
    expect(deleted).toEqual([SHARE_CACHE]);
  });

  it("does not mind a browser with no cache, or one that refuses", async () => {
    const window = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, addEventListener() {}, removeEventListener() {} } as Record<string, unknown>;
    (globalThis as unknown as { window: unknown }).window = window;
    vi.resetModules();
    const { clearBrowserData } = await import("@/lib/storage/local");
    await expect(clearBrowserData()).resolves.toBeUndefined();
    window.caches = { delete: async () => Promise.reject(new Error("no")) };
    await expect(clearBrowserData()).resolves.toBeUndefined();
  });
});
