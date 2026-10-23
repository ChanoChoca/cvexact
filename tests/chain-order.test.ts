import { afterEach, describe, expect, it } from "vitest";

/**
 * `orderedChain` is the client's half of the fix for a chain that never
 * learns: a candidate a recent generation saw fail is sunk to the end of the
 * cadena the next generation sends, or dropped outright when the failure is
 * durable (a rejected key, an empty balance) rather than transient — so a
 * returning user does not pay a full attempt timeout on the same dead key
 * every session. See the comment on `orderedChain` in `@/lib/storage/local`
 * for the full argument.
 *
 * `localStorage` is faked per test, the same way `tests/storage-migration.test.ts`
 * does, because `orderedChain` reads its notes through `loadProviderNotes`,
 * which goes through `window.localStorage`.
 */

type Store = Map<string, string>;

function installStorage(seed: Record<string, string> = {}): Store {
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

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

const PROVIDER_NOTES_KEY = "cvexact.providerNotes.v1";

async function loadModule() {
  return import("@/lib/storage/local");
}

function entry(provider: string, apiKey: string, model = "") {
  return { provider: provider as never, apiKey, model };
}

function noteAt(status: number, at: string) {
  return { status, message: "falló", at };
}

describe("orderedChain", () => {
  it("no reordena una cadena sin notas: el orden del usuario es el mejor juicio que hay", async () => {
    installStorage();
    const { orderedChain } = await loadModule();
    const chain = [entry("google", "a"), entry("groq", "b"), entry("cohere", "c")];
    expect(orderedChain(chain)).toEqual(chain);
  });

  it("descarta por completo una entrada con nota fresca de una falla durable (401)", async () => {
    const now = Date.parse("2026-08-28T12:00:00Z");
    installStorage({
      [PROVIDER_NOTES_KEY]: JSON.stringify({
        "groq:llama-3.3-70b-versatile": noteAt(401, new Date(now - 60_000).toISOString()),
      }),
    });
    const { orderedChain } = await loadModule();
    const chain = [
      entry("google", "a"),
      entry("groq", "b", "llama-3.3-70b-versatile"),
      entry("cohere", "c"),
    ];
    expect(orderedChain(chain, now)).toEqual([entry("google", "a"), entry("cohere", "c")]);
  });

  it("hunde al final, sin descartarla, una entrada con nota fresca de una falla transitoria (429)", async () => {
    const now = Date.parse("2026-08-28T12:00:00Z");
    installStorage({
      [PROVIDER_NOTES_KEY]: JSON.stringify({
        "groq:llama-3.3-70b-versatile": noteAt(429, new Date(now - 60_000).toISOString()),
      }),
    });
    const { orderedChain } = await loadModule();
    const chain = [
      entry("google", "a"),
      entry("groq", "b", "llama-3.3-70b-versatile"),
      entry("cohere", "c"),
    ];
    expect(orderedChain(chain, now)).toEqual([
      entry("google", "a"),
      entry("cohere", "c"),
      entry("groq", "b", "llama-3.3-70b-versatile"),
    ]);
  });

  it("hunde al final una entrada con nota fresca de una falla transitoria (503)", async () => {
    const now = Date.parse("2026-08-28T12:00:00Z");
    installStorage({
      [PROVIDER_NOTES_KEY]: JSON.stringify({
        "groq:llama-3.3-70b-versatile": noteAt(503, new Date(now - 60_000).toISOString()),
      }),
    });
    const { orderedChain } = await loadModule();
    const chain = [
      entry("google", "a"),
      entry("groq", "b", "llama-3.3-70b-versatile"),
      entry("cohere", "c"),
    ];
    expect(orderedChain(chain, now)).toEqual([
      entry("google", "a"),
      entry("cohere", "c"),
      entry("groq", "b", "llama-3.3-70b-versatile"),
    ]);
  });

  it("una nota vencida ya no demota", async () => {
    // 429 is trusted for an hour; eight days past it is well outside that.
    const now = Date.parse("2026-08-28T12:00:00Z");
    installStorage({
      [PROVIDER_NOTES_KEY]: JSON.stringify({
        "groq:llama-3.3-70b-versatile": noteAt(429, new Date(now - 2 * 60 * 60 * 1000).toISOString()),
      }),
    });
    const { orderedChain } = await loadModule();
    const chain = [entry("groq", "b", "llama-3.3-70b-versatile"), entry("cohere", "c")];
    expect(orderedChain(chain, now)).toEqual(chain);
  });

  it("una nota de 401 sigue descartando la entrada después de 3 días, pero no después de 10", async () => {
    const now = Date.parse("2026-08-28T12:00:00Z");
    const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
    installStorage({
      [PROVIDER_NOTES_KEY]: JSON.stringify({
        "groq:llama-3.3-70b-versatile": noteAt(401, threeDaysAgo),
      }),
    });
    const { orderedChain } = await loadModule();
    const chain = [entry("groq", "b", "llama-3.3-70b-versatile"), entry("cohere", "c")];
    expect(orderedChain(chain, now)).toEqual([entry("cohere", "c")]);

    const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
    installStorage({
      [PROVIDER_NOTES_KEY]: JSON.stringify({
        "groq:llama-3.3-70b-versatile": noteAt(401, tenDaysAgo),
      }),
    });
    const stale = await loadModule();
    expect(stale.orderedChain(chain, now)).toEqual(chain);
  });

  /**
   * Skipping every entry would leave a request with nothing to try, which
   * explains nothing — so when every entry would be skipped, none are: this
   * falls back to the original order rather than returning an empty chain.
   */
  it("si todas las entradas serían descartadas, no se descarta ninguna: vuelve el orden original", async () => {
    const now = Date.parse("2026-08-28T12:00:00Z");
    const recent = new Date(now - 1000).toISOString();
    installStorage({
      [PROVIDER_NOTES_KEY]: JSON.stringify({
        "google:gemini-3.5-flash": noteAt(402, recent),
        "groq:llama-3.3-70b-versatile": noteAt(401, recent),
      }),
    });
    const { orderedChain } = await loadModule();
    const chain = [entry("google", "a"), entry("groq", "b", "llama-3.3-70b-versatile")];
    expect(orderedChain(chain, now)).toEqual(chain);
  });

  it("con una cadena mixta, descarta la durable, hunde la transitoria y deja la limpia primera", async () => {
    const now = Date.parse("2026-08-28T12:00:00Z");
    const recent = new Date(now - 1000).toISOString();
    installStorage({
      [PROVIDER_NOTES_KEY]: JSON.stringify({
        "groq:llama-3.3-70b-versatile": noteAt(401, recent),
        "cohere:command-a-03-2025": noteAt(429, recent),
      }),
    });
    const { orderedChain } = await loadModule();
    const chain = [
      entry("groq", "a", "llama-3.3-70b-versatile"),
      entry("google", "b"),
      entry("cohere", "c", "command-a-03-2025"),
    ];
    expect(orderedChain(chain, now)).toEqual([
      entry("google", "b"),
      entry("cohere", "c", "command-a-03-2025"),
    ]);
  });

  it("empareja por el modelo resuelto: una fila con el modelo vacío usa el default del proveedor", async () => {
    const now = Date.parse("2026-08-28T12:00:00Z");
    installStorage({
      [PROVIDER_NOTES_KEY]: JSON.stringify({
        // "gemini-3.5-flash" is DEFAULT_MODEL.google.
        "google:gemini-3.5-flash": noteAt(402, new Date(now - 1000).toISOString()),
      }),
    });
    const { orderedChain } = await loadModule();
    // Model left blank in Ajustes — must still resolve to the default to match.
    const chain = [entry("google", "a", ""), entry("groq", "b")];
    // 402 is skip-on-sight: a match drops the entry rather than sinking it.
    expect(orderedChain(chain, now)).toEqual([entry("groq", "b")]);
  });
});

/**
 * La misma ventana que decide si `orderedChain` saltea o hunde una fila es la
 * que /ajustes usa para decir «vencida»: las dos tienen que coincidir, o el
 * panel afirma que un proveedor está roto mientras la cadena lo está usando.
 */
describe("noteIsFresh", () => {
  const now = Date.parse("2026-08-28T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  it("una cuota agotada dura una hora, no dos", async () => {
    installStorage();
    const { noteIsFresh } = await loadModule();
    expect(noteIsFresh(noteAt(429, ago(30 * minute)), now)).toBe(true);
    expect(noteIsFresh(noteAt(429, ago(2 * hour)), now)).toBe(false);
  });

  it("una key rechazada se cree una semana, y una fila vieja ya no", async () => {
    installStorage();
    const { noteIsFresh } = await loadModule();
    expect(noteIsFresh(noteAt(401, ago(3 * day)), now)).toBe(true);
    expect(noteIsFresh(noteAt(401, ago(10 * day)), now)).toBe(false);
  });

  it("sin nota no hay nada que creer", async () => {
    installStorage();
    const { noteIsFresh } = await loadModule();
    expect(noteIsFresh(undefined, now)).toBe(false);
  });
});
