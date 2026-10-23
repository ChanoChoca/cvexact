import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How the ordered list of models a request may use gets built.
 *
 * Two sources, and they must not mix. BYOK is the user's own keys, in the order
 * they put them in Ajustes. `pro`/`credits` run our own key at `SERVICE_PROVIDER` plus whatever
 * `AI_FALLBACKS` names — `free` runs neither and is refused outright, since
 * there is no server-funded tier any more. A spent BYOK chain stops where it
 * stops: falling through to our key would turn every user who configured one
 * into a charge against our budget, while telling them their key is working
 * fine.
 */

async function loadProvider() {
  vi.resetModules();
  return import("@/lib/ai/provider");
}

const STANDARD = "modelo-chico";

beforeEach(() => {
  process.env.SERVICE_PROVIDER = "together";
  process.env.SERVICE_API_KEY = "clave-de-servicio";
  process.env.SERVICE_MODEL = STANDARD;
  delete process.env.AI_FALLBACKS;
});

afterEach(() => {
  delete process.env.SERVICE_PROVIDER;
  delete process.env.SERVICE_API_KEY;
  delete process.env.SERVICE_MODEL;
  delete process.env.AI_FALLBACKS;
  vi.restoreAllMocks();
});

describe("la cadena BYOK", () => {
  it("respeta el orden en que el usuario cargó sus proveedores", async () => {
    const { resolveModel } = await loadProvider();

    const chain = await resolveModel({
      tier: "byok",
      action: "cv",
      byok: [
        { provider: "groq", apiKey: "gsk_uno", model: "openai/gpt-oss-120b" },
        { provider: "google", apiKey: "AIza_dos" },
      ],
    });

    expect(chain.candidates.map((c) => c.modelId)).toEqual([
      "openai/gpt-oss-120b",
      // No model named, so the provider's default.
      "gemini-3.5-flash",
    ]);
    expect(chain.used).toBe(chain.candidates[0]);
    expect(chain.switches).toEqual([]);
  });

  it("deja la cadena en el log del servidor, sin ninguna key", async () => {
    /**
     * The line a production log is read for: how many candidates the browser
     * sent and which ones they are. Until it existed, a request whose chain had
     * been quietly reduced — or one that never got past its third candidate —
     * left nothing behind but the switches it happened to make.
     */
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { resolveModel } = await loadProvider();

    await resolveModel({
      tier: "byok",
      action: "cv",
      byok: [
        { provider: "google", apiKey: "test-google-key" },
        { provider: "cohere", apiKey: "test-cohere-key" },
      ],
    });

    const line = info.mock.calls
      .map((call) => String(call[0]))
      .find((message) => message.startsWith("[generate] cv:"));
    expect(line).toContain("tier=byok");
    expect(line).toContain("2 candidato(s)");
    expect(line).toContain("Google Gemini · gemini-3.5-flash (key propia)");
    expect(line).toContain("Cohere · command-a-03-2025 (key propia)");
    expect(line).not.toContain("clave_secreta");
  });

  it("le da a cada candidato las capacidades de su propio proveedor", async () => {
    // The whole reason the fallback lives in `generate` rather than in a
    // middleware: these travel with the candidate, and the request has to be
    // built in the shape of whoever is about to answer it.
    const { resolveModel } = await loadProvider();

    const chain = await resolveModel({
      tier: "byok",
      action: "cv",
      byok: [
        { provider: "groq", apiKey: "gsk_uno", model: "llama-3.3-70b-versatile" },
        { provider: "cohere", apiKey: "co_dos" },
      ],
    });

    const [groq, cohere] = chain.candidates;
    expect(groq.looseJsonSchema).toBe(false);
    expect(groq.maxOutputTokens).toBeUndefined();
    // Not in `REASONING_CAPABLE_MODELS`, and Groq rejects the setting per model.
    expect(groq.reasoningCapable).toBe(false);

    expect(cohere.looseJsonSchema).toBe(true);
    expect(cohere.maxOutputTokens).toBe(8192);
  });

  it("le avisa al router de Requesty que sostiene un schema", async () => {
    /**
     * The one OpenAI-compatible host here whose router takes a JSON Schema in
     * `response_format` and constrained-decodes on it. Without the flag the
     * request goes out as bare `json_object` — no schema over the wire — and
     * the model only meets the ceilings as prose inside `schemaHint`, which is
     * how its default broke the CV's 8-bullet cap in most of ten live runs
     * (see the comment on the `requesty` case in `buildRaw`). The other
     * OpenAI-compatible hosts stay on `json_object`: their catalogues span
     * hundreds of models with per-model schema support and no reliable
     * capability check, which is the same rule that keeps
     * `REASONING_CAPABLE_MODELS` empty for them.
     */
    const { buildRaw } = await loadProvider();
    const { DEFAULT_MODEL } = await import("@/lib/ai/provider-catalog");

    const requesty = buildRaw("requesty", "rqsty_uno", DEFAULT_MODEL.requesty);
    const groq = buildRaw("groq", "gsk_uno", "openai/gpt-oss-120b");

    expect((requesty as unknown as { supportsStructuredOutputs: boolean }).supportsStructuredOutputs).toBe(true);
    expect((groq as unknown as { supportsStructuredOutputs: boolean }).supportsStructuredOutputs).toBe(false);
  });

  it("no cae a la key del servicio cuando la cadena del usuario se agota", async () => {
    const { resolveModel } = await loadProvider();

    const chain = await resolveModel({
      tier: "byok",
      action: "cv",
      byok: [{ provider: "groq", apiKey: "gsk_uno" }],
    });

    expect(chain.candidates).toHaveLength(1);
    expect(chain.candidates.every((c) => c.describe.includes("key propia"))).toBe(true);
  });

  it("ignora las filas que el usuario todavía no terminó de completar", async () => {
    const { resolveModel } = await loadProvider();

    const chain = await resolveModel({
      tier: "byok",
      action: "cv",
      byok: [
        { provider: "groq", apiKey: "   " },
        { provider: "google", apiKey: "AIza_dos" },
      ],
    });

    expect(chain.candidates).toHaveLength(1);
    expect(chain.candidates[0].provider).toBe("google");
  });

  it("se queja si no quedó ninguna key usable", async () => {
    const { resolveModel, ProviderConfigError } = await loadProvider();

    await expect(
      resolveModel({ tier: "byok", action: "cv", byok: [{ provider: "groq", apiKey: "" }] }),
    ).rejects.toBeInstanceOf(ProviderConfigError);
  });

  /**
   * Cloudflare is the only provider whose account is part of the address
   * rather than of the credential, so it is the only one that can be
   * half-configured. Interpolating a missing account id would build
   * `.../accounts/undefined/ai/v1` and Cloudflare would answer 404, which
   * reaches the user as their key having been rejected — the least
   * diagnosable thing this form can say.
   */
  it("rechaza una fila de Cloudflare sin Account ID en vez de armar una URL rota", async () => {
    const { resolveModel, ProviderConfigError } = await loadProvider();

    await expect(
      resolveModel({
        tier: "byok",
        action: "cv",
        byok: [{ provider: "cloudflare", apiKey: "cf_token" }],
      }),
    ).rejects.toBeInstanceOf(ProviderConfigError);

    // Pasting the API token into the Account ID field is the likeliest way to
    // fill it in wrongly, and it has to fail here rather than at Cloudflare.
    await expect(
      resolveModel({
        tier: "byok",
        action: "cv",
        byok: [{ provider: "cloudflare", apiKey: "cf_token", accountId: "cf_token" }],
      }),
    ).rejects.toThrow(/Account ID/);
  });

  it("acepta la fila de Cloudflare cuando trae las dos credenciales", async () => {
    const { resolveModel } = await loadProvider();

    const chain = await resolveModel({
      tier: "byok",
      action: "cv",
      byok: [{ provider: "cloudflare", apiKey: "cf_token", accountId: "a".repeat(32) }],
    });

    expect(chain.candidates).toHaveLength(1);
    expect(chain.candidates[0].provider).toBe("cloudflare");
    // The account id is not a secret and not part of the credential's
    // identity: two rows differing only by it are still one key to cool down.
    expect(chain.candidates[0].cooldownKey).not.toContain("a".repeat(32));
  });

  it("cada candidato tiene su propia identidad de cooldown", async () => {
    // Shared keys would make one user's empty balance silence a provider for
    // everyone, and one candidate's failure discard its neighbour.
    const { resolveModel } = await loadProvider();

    const chain = await resolveModel({
      tier: "byok",
      action: "cv",
      byok: [
        { provider: "google", apiKey: "AIza_uno" },
        { provider: "google", apiKey: "AIza_dos" },
      ],
    });

    const [a, b] = chain.candidates;
    expect(a.cooldownKey).not.toBe(b.cooldownKey);
    // A digest, never the key: this outlives the request that held it.
    expect(a.cooldownKey).not.toContain("AIza_uno");
  });
});

describe("los respaldos del servicio", () => {
  it("pone nuestra key primero y los respaldos detrás, en orden", async () => {
    process.env.AI_FALLBACKS = JSON.stringify([
      { provider: "groq", apiKey: "gsk_respaldo", model: "openai/gpt-oss-120b" },
      { provider: "mistral", apiKey: "mi_respaldo" },
    ]);
    const { resolveModel } = await loadProvider();

    const chain = await resolveModel({ tier: "pro", action: "cv" });

    expect(chain.candidates.map((c) => c.provider)).toEqual(["together", "groq", "mistral"]);
    expect(chain.candidates[0].modelId).toBe(STANDARD);
    // A standby runs the one model it declares; the pro/credits tiering is the
    // primary's alone.
    expect(chain.candidates[1].modelId).toBe("openai/gpt-oss-120b");
    expect(chain.candidates[2].modelId).toBe("open-mistral-nemo");
  });

  it("sirve para rotar varias keys del mismo proveedor", async () => {
    // A daily limit belongs to the key, so a second key at the same provider
    // is a real fallback and not a redundant one.
    process.env.AI_FALLBACKS = JSON.stringify([
      { provider: "together", apiKey: "test-segunda-clave" },
    ]);
    const { resolveModel } = await loadProvider();

    const chain = await resolveModel({ tier: "pro", action: "cv" });

    expect(chain.candidates).toHaveLength(2);
    expect(chain.candidates[0].cooldownKey).not.toBe(chain.candidates[1].cooldownKey);
  });

  it("no le agrega respaldos del servicio a un pedido BYOK", async () => {
    process.env.AI_FALLBACKS = JSON.stringify([
      { provider: "groq", apiKey: "gsk_respaldo" },
    ]);
    const { resolveModel } = await loadProvider();

    const chain = await resolveModel({
      tier: "byok",
      action: "cv",
      byok: [{ provider: "google", apiKey: "test-google-key-usuario" }],
    });

    expect(chain.candidates).toHaveLength(1);
  });

  it.each([
    ["no es JSON", "esto no es json"],
    ["no es un array", JSON.stringify({ provider: "groq", apiKey: "x" })],
  ])("ignora un AI_FALLBACKS que %s, sin tirar", async (_name, raw) => {
    // Read at module load. A typo in an optional resilience feature must not be
    // the reason the app fails to boot.
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.AI_FALLBACKS = raw;
    const { resolveModel } = await loadProvider();

    const chain = await resolveModel({ tier: "pro", action: "cv" });

    expect(chain.candidates).toHaveLength(1);
    expect(chain.candidates[0].provider).toBe("together");
  });

  it("descarta sólo la entrada inválida, no la lista entera", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.AI_FALLBACKS = JSON.stringify([
      { provider: "no-existe", apiKey: "x" },
      { provider: "groq", apiKey: "gsk_bueno" },
    ]);
    const { resolveModel } = await loadProvider();

    const chain = await resolveModel({ tier: "pro", action: "cv" });

    expect(chain.candidates.map((c) => c.provider)).toEqual(["together", "groq"]);
  });

  it("nunca escribe la entrada, que lleva una key, en el log del error", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.AI_FALLBACKS = JSON.stringify([{ provider: "no-existe", apiKey: "gsk_secreta" }]);
    const { resolveModel } = await loadProvider();

    await resolveModel({ tier: "pro", action: "cv" });

    expect(errors.mock.calls.flat().join(" ")).not.toContain("gsk_secreta");
  });

  it("sigue andando con los respaldos si el servicio no tiene key propia", async () => {
    delete process.env.SERVICE_API_KEY;
    process.env.AI_FALLBACKS = JSON.stringify([{ provider: "groq", apiKey: "gsk_respaldo" }]);
    const { resolveModel } = await loadProvider();

    const chain = await resolveModel({ tier: "pro", action: "cv" });

    expect(chain.candidates.map((c) => c.provider)).toEqual(["groq"]);
  });

  it("se queja cuando no hay ni key propia ni respaldos", async () => {
    delete process.env.SERVICE_API_KEY;
    const { resolveModel, ProviderConfigError } = await loadProvider();

    await expect(resolveModel({ tier: "pro", action: "cv" })).rejects.toBeInstanceOf(
      ProviderConfigError,
    );
  });
});

describe("el tier free", () => {
  it("se rechaza siempre, tenga o no key el servicio", async () => {
    // No hay tier gratis con la key del servicio: free exige key propia sin
    // importar si SERVICE_API_KEY está configurada. El check pasa antes de
    // mirar serviceKeyConfigured() — ver lib/ai/provider.ts.
    const { resolveModel, ProviderConfigError } = await loadProvider();

    await expect(resolveModel({ tier: "free", action: "cv" })).rejects.toBeInstanceOf(
      ProviderConfigError,
    );
  });

  it("se rechaza igual cuando el servicio no tiene key propia", async () => {
    delete process.env.SERVICE_API_KEY;
    const { resolveModel, ProviderConfigError } = await loadProvider();

    await expect(resolveModel({ tier: "free", action: "cv" })).rejects.toBeInstanceOf(
      ProviderConfigError,
    );
  });
});
