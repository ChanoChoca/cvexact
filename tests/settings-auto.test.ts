import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The AUTO contract for the "Modelo" field.
 *
 * Most users never name a model: they paste a key and leave the field blank.
 * That state has three legs, and one test per leg keeps them from drifting:
 *
 *   1. `model: ""` survives storage, save/load and the legacy migration;
 *   2. no model goes on the wire — `requestHeaders` sends the raw field, so a
 *      blank row contributes no `model` at all;
 *   3. the server resolves the provider's default (see "No model named, so the
 *      provider's default" in `tests/model-chain.test.ts`).
 *
 * The point of the first two is the third: because the blank is never resolved
 * on the way out, a release that fixes a retired or plan-blocked default heals
 * every blank-model row. Persisting the resolved id would freeze whatever the
 * default happened to be at the time — and would have left the NVIDIA and
 * Mistral incidents unfixable for the users who hit them.
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

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("el estado vacío de Modelo es AUTO", () => {
  it("se conserva vacío al guardar y volver a leer", async () => {
    installStorage();
    const store = await import("@/lib/storage/local");

    store.saveSettings({ entries: [{ provider: "nvidia", apiKey: "nvapi-x", model: "" }] });

    const [entry] = store.loadSettings().entries;
    expect(entry.model).toBe("");
    // Reading resolves it; that resolution is never written back.
    expect(store.resolvedModel(entry)).toBe("openai/gpt-oss-20b");
    expect(store.loadSettings().entries[0].model).toBe("");
  });

  it("convierte un settings de un solo proveedor en una cadena", async () => {
    installStorage({
      "cvexact.settings.v1": JSON.stringify({ provider: "mistral", apiKey: "k", model: "" }),
    });
    const store = await import("@/lib/storage/local");

    expect(store.loadSettings().entries).toEqual([
      { provider: "mistral", apiKey: "k", model: "" },
    ]);
  });

  it("viaja como modelo ausente en el request, no como el default resuelto", async () => {
    installStorage();
    vi.spyOn(console, "info").mockImplementation(() => {});
    const store = await import("@/lib/storage/local");
    const { requestHeaders } = await import("@/lib/api/client");

    store.saveSettings({
      entries: [
        { provider: "nvidia", apiKey: "nvapi-x", model: "" },
        { provider: "google", apiKey: "AIza-x", model: "gemini-3.5-flash" },
      ],
    });

    const payload = requestHeaders()["x-cvp-chain"];
    const chain = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as Array<{
      provider: string;
      model?: string;
    }>;

    // A blank row contributes no `model` key at all — the server resolves it.
    expect(chain[0]).toEqual({ provider: "nvidia", apiKey: "nvapi-x" });
    expect("model" in chain[0]).toBe(false);
    // An explicit one travels as typed, unchanged.
    expect(chain[1].model).toBe("gemini-3.5-flash");
  });
});