import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * What happens when the provider notes cannot be written.
 *
 * The notes are the only memory that reorders Ajustes between requests, so a
 * browser that has run out of storage stops learning: the same candidates are
 * asked first, in the same order, and the page keeps showing the reasons from
 * the last time it *could* write. The one thing that must not happen is a
 * generation that already succeeded failing over a diagnostic — the second is
 * that the state is visible, which is what `providerNotesWritable` is for.
 *
 * Same fake-storage setup as `tests/chain-order.test.ts`, because the notes go
 * through `window.localStorage`.
 */

/** A store whose `setItem` fails while `failing.value` is true. */
function installStorage(): { map: Map<string, string>; failing: { value: boolean } } {
  const map = new Map<string, string>();
  const failing = { value: false };
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => {
        // What a full quota looks like from inside `write`.
        if (failing.value) throw new Error("QuotaExceededError");
        map.set(key, value);
      },
      removeItem: (key: string) => void map.delete(key),
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return { map, failing };
}

async function loadModule() {
  vi.resetModules();
  return import("@/lib/storage/local");
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  vi.restoreAllMocks();
});

const note = { provider: "groq", modelId: "llama-3.3-70b-versatile", status: 429, message: "sin cuota" };

describe("notas de proveedores sin espacio para escribirse", () => {
  it("no rompe la generación, pero deja de decir que puede guardarlas", async () => {
    const { failing } = installStorage();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await loadModule();

    expect(store.providerNotesWritable()).toBe(true);

    failing.value = true;
    expect(() => store.recordProviderNotes([note])).not.toThrow();
    expect(store.providerNotesWritable()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);

    // A second failure does not shout again: the state is already on screen.
    store.recordProviderNotes([note]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("vuelve a decir que sí cuando el próximo intento entra", async () => {
    const { failing } = installStorage();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await loadModule();

    failing.value = true;
    store.recordProviderNotes([note]);
    expect(store.providerNotesWritable()).toBe(false);

    failing.value = false;
    store.recordProviderNotes([note]);
    expect(store.providerNotesWritable()).toBe(true);
    expect(store.loadProviderNotes()["groq:llama-3.3-70b-versatile"]).toBeDefined();
  });

  it("lo mismo al borrar la nota de una fila que el usuario acaba de editar", async () => {
    const { failing } = installStorage();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await loadModule();

    store.recordProviderNotes([note]);
    expect(store.loadProviderNotes()["groq:llama-3.3-70b-versatile"]).toBeDefined();

    failing.value = true;
    expect(() => store.clearProviderNote("groq", "llama-3.3-70b-versatile")).not.toThrow();
    expect(store.providerNotesWritable()).toBe(false);
  });

  it("un almacenamiento que siempre funcionó no dice nada", async () => {
    installStorage();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await loadModule();

    store.recordProviderNotes([note]);
    expect(store.providerNotesWritable()).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
