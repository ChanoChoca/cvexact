import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { generate, lastResortBudgetMs } from "@/lib/ai/pipeline";
import { clearCooldowns } from "@/lib/ai/cooldown";
import { clearHealth, recordOutcome } from "@/lib/ai/health";
import { testCandidate, testChain } from "./model-chain-fixtures";

/**
 * Falling back to the next provider when one cannot serve the request.
 *
 * The five failures this covers — 429, 402, 413, 401, 400 — all used to end the
 * request with some version of "go to Ajustes and pick a different model". They
 * are the ones where retrying the same provider is known not to help and
 * another provider plausibly can, which is exactly the line
 * `GenerationError.switchable` draws. Everything else, including a response
 * that simply broke the schema, must still fail where it failed: those have
 * already spent three repair paths, and re-spending them against every
 * remaining candidate turns one bad response into four.
 */

const schema = z.object({ title: z.string() });
const valid = { title: "ok" };

type GenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

function reply(text: string): GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "STOP" },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  };
}

/** A model that answers correctly, every time. */
function working() {
  return new MockLanguageModelV4({ doGenerate: async () => reply(JSON.stringify(valid)) });
}

/** A model that always fails with `error`. */
function failing(error: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw error;
    },
  });
}

function apiError(message: string, statusCode: number) {
  return new APICallError({
    message,
    url: "https://example.invalid/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    isRetryable: false,
  });
}

const rateLimited = () => apiError("Rate limit reached for model", 429);

function run(chain: ReturnType<typeof testChain>) {
  return generate({
    chain,
    schema,
    schemaName: "Thing",
    system: "SYSTEM",
    prompt: "ORIGINAL PROMPT",
  });
}

beforeEach(() => {
  clearCooldowns();
  // Candidates here are identified by provider and model id, which repeat from
  // test to test — so without this, a candidate that failed in one test is
  // demoted behind its standby in the next and the chain runs in the other
  // order. See `candidateOrder`, which is what this store feeds.
  clearHealth();
  // The fallback logs a line per switch; the assertions are the point, not the
  // noise.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  clearCooldowns();
  clearHealth();
});

describe("fallback de proveedor", () => {
  it("pasa al siguiente candidato cuando el primero está limitado por cuota", async () => {
    const first = failing(rateLimited());
    const second = working();
    const chain = testChain(
      testCandidate(first, { provider: "groq", modelId: "uno" }),
      testCandidate(second, { provider: "google", modelId: "dos" }),
    );

    await expect(run(chain)).resolves.toEqual(valid);

    expect(second.doGenerateCalls.length).toBeGreaterThan(0);
    expect(chain.used.modelId).toBe("dos");
    expect(chain.switches).toEqual([
      {
        from: "groq · uno",
        to: "google · dos",
        status: 429,
        message: "El proveedor está limitando las peticiones. Esperá un momento y probá de nuevo.",
        // Who failed, identified as a settings row is rather than as a display
        // string, so Ajustes can put the reason against the entry it belongs to.
        provider: "groq",
        modelId: "uno",
        kind: "rate_limited",
      },
    ]);
  });

  /**
   * The line a deployment's log is read for when a request gives up: how many
   * candidates were asked, and which ones were left behind. `candidateOrder`
   * caps one pass at three candidates and moves cooling ones to the back, and
   * from outside that is indistinguishable from "every key was dead" — unless
   * it is written down.
   */
  it("deja en el log cuántos candidatos se preguntan y cuáles quedan afuera", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const chain = testChain(
      testCandidate(failing(rateLimited()), { provider: "google", modelId: "uno" }),
      testCandidate(failing(rateLimited()), { provider: "groq", modelId: "dos" }),
      testCandidate(failing(rateLimited()), { provider: "cohere", modelId: "tres" }),
      testCandidate(working(), { provider: "mistral", modelId: "cuatro" }),
    );

    await expect(run(chain)).rejects.toThrow();

    const line = info.mock.calls
      .map((call) => String(call[0]))
      .find((message) => message.includes("candidatos en esta pasada"));
    expect(line).toContain("3 de 4");
    expect(line).toContain("google · uno");
    expect(line).toContain("cohere · tres");
    // The candidate that would have answered never got a turn: that is the
    // whole reason this line exists.
    expect(line).not.toContain("mistral · cuatro");
  });

  it.each([
    ["402 sin crédito", "This request requires more credits, or fewer max_tokens.", 402, 402, "no_credit"],
    ["413 por tokens por minuto", "Request too large for model", 413, 413, "request_too_large"],
    ["401 key rechazada", "Incorrect API key provided", 401, 401, "key_rejected"],
    ["400 modelo retirado", "The model `viejo` does not exist", 404, 400, "model_retired"],
    [
      "403 fuera del plan",
      "This model is not available in your subscription tier",
      403,
      400,
      "model_not_in_plan",
    ],
  ])("también cambia de candidato ante %s", async (_name, message, statusCode, expected, kind) => {
    const chain = testChain(
      testCandidate(failing(apiError(message, statusCode)), { modelId: "uno" }),
      testCandidate(working(), { modelId: "dos" }),
    );

    await expect(run(chain)).resolves.toEqual(valid);
    expect(chain.used.modelId).toBe("dos");
    expect(chain.switches[0].status).toBe(expected);
    expect(chain.switches[0].kind).toBe(kind);
  });

  /**
   * `@ai-sdk/mistral` reports a rejected key as an `APICallError` with an empty
   * message. Every message-matching branch misses it, and before the status was
   * consulted it fell through to a generic 502 — which is not switchable, so
   * the user's second provider was never asked. Measured against a live server
   * with two bad keys: Groq's 401 fell back correctly, Mistral's did not.
   */
  it("clasifica por código de estado cuando el proveedor no dice nada", async () => {
    const second = working();
    const chain = testChain(
      testCandidate(failing(apiError("", 401)), { provider: "mistral", modelId: "uno" }),
      testCandidate(second, { modelId: "dos" }),
    );

    await expect(run(chain)).resolves.toEqual(valid);
    expect(chain.switches[0].status).toBe(401);
  });

  it("le cree al mensaje antes que al estado", async () => {
    // Groq answers a retired model id with 404. That is "ese modelo ya no
    // existe", not a transport failure, and the message is what says so.
    const chain = testChain(
      testCandidate(failing(apiError("The model `viejo` does not exist", 404)), {
        modelId: "uno",
      }),
      testCandidate(working(), { modelId: "dos" }),
    );

    await run(chain);
    expect(chain.switches[0].status).toBe(400);
  });

  it("no convierte un 500 del proveedor en un cambio de candidato", async () => {
    // A transport failure the SDK has already retried twice. Another provider
    // is not the answer to someone else's outage, and burning the chain on it
    // would leave nothing for the failure that is.
    const second = working();
    const chain = testChain(
      testCandidate(failing(apiError("", 500)), { modelId: "uno" }),
      testCandidate(second, { modelId: "dos" }),
    );

    await expect(run(chain)).rejects.toMatchObject({ status: 502 });
    expect(second.doGenerateCalls).toHaveLength(0);
  });

  /**
   * The one failure a different provider does not fix. A response that broke
   * the schema has already been through `unwrapEnvelope`, `clipToLimits` and a
   * model-assisted repair; walking the chain would pay all three again for
   * every candidate.
   */
  it("no cambia de candidato cuando el modelo simplemente rompió el schema", async () => {
    const second = working();
    const chain = testChain(
      testCandidate(
        new MockLanguageModelV4({ doGenerate: async () => reply('{"title":123}') }),
        { modelId: "uno" },
      ),
      testCandidate(second, { modelId: "dos" }),
    );

    await expect(run(chain)).rejects.toMatchObject({ status: 502 });
    expect(second.doGenerateCalls).toHaveLength(0);
    expect(chain.switches).toEqual([]);
  });

  /**
   * NVIDIA NIM retires a model with 410 and the single word "Gone" — a message
   * that names no model, so `MODEL_GONE` missed it and it fell to the generic
   * 502, which is not switchable. A user whose first key pointed at a retired
   * model lost the request, and every key behind it, to a one-word answer; a
   * retired model is exactly what the next candidate fixes.
   */
  it("cambia de candidato cuando el proveedor responde 410 Gone", async () => {
    const chain = testChain(
      testCandidate(failing(apiError("Gone", 410)), { provider: "nvidia", modelId: "uno" }),
      testCandidate(working(), { modelId: "dos" }),
    );

    await expect(run(chain)).resolves.toEqual(valid);
    expect(chain.used.modelId).toBe("dos");
    expect(chain.switches[0].status).toBe(400);
  });

  /**
   * Cloudflare's overload answer, verbatim: a 503 that says "try again later".
   * Nothing matched it, so it fell to the generic 502 — not switchable — and
   * one saturated model ended the request with the user's other keys unasked.
   * A provider that says "try again later" is asking the chain to do that.
   */
  it("cambia de candidato cuando el proveedor está saturado sin decir 429", async () => {
    const chain = testChain(
      testCandidate(
        failing(
          apiError(
            "This model is currently experiencing high demand. Spikes in demand " +
              "are usually temporary. Please try again later.",
            503,
          ),
        ),
        { provider: "cloudflare", modelId: "uno" },
      ),
      testCandidate(working(), { modelId: "dos" }),
    );

    await expect(run(chain)).resolves.toEqual(valid);
    expect(chain.switches[0].status).toBe(503);
  });

  /**
   * The OpenRouter credit advice is only true of OpenRouter, and it used to be
   * the message every provider's 402 got: a Cerebras key told the user to top
   * up at openrouter.ai. The status is 402 either way.
   */
  it("nombra al proveedor en el 402 en vez de mandar siempre a OpenRouter", async () => {
    const chain = testChain(
      testCandidate(failing(apiError("Insufficient credits for this request", 402)), {
        provider: "cerebras",
        modelId: "uno",
      }),
      testCandidate(working(), { modelId: "dos" }),
    );

    await run(chain);
    expect(chain.switches[0].message).not.toContain("OpenRouter");
    expect(chain.switches[0].message).toContain("Cerebras");
  });

  it("conserva la dirección de OpenRouter en su propio 402", async () => {
    const chain = testChain(
      testCandidate(failing(apiError("Insufficient credits for this request", 402)), {
        provider: "openrouter",
        modelId: "uno",
      }),
      testCandidate(working(), { modelId: "dos" }),
    );

    await run(chain);
    expect(chain.switches[0].message).toContain("openrouter.ai/settings/credits");
  });

  it("propaga el error del último candidato cuando fallan todos", async () => {
    const chain = testChain(
      testCandidate(failing(rateLimited()), { modelId: "uno" }),
      testCandidate(failing(apiError("Incorrect API key provided", 401)), { modelId: "dos" }),
    );

    // The last one's, not the first's: it is the one that ran out of options.
    await expect(run(chain)).rejects.toMatchObject({ status: 401 });
    expect(chain.switches).toHaveLength(1);
  });

  /**
   * A CV request runs three or four generations down one chain. Learning the
   * first provider is rate-limited must cost one failed call, not one per
   * generation.
   */
  it("no vuelve a preguntarle a un candidato que ya falló en este pedido", async () => {
    const first = failing(rateLimited());
    const chain = testChain(
      testCandidate(first, { modelId: "uno" }),
      testCandidate(working(), { modelId: "dos" }),
    );

    await expect(run(chain)).resolves.toEqual(valid);
    await expect(run(chain)).resolves.toEqual(valid);

    // Once across both generations, and the SDK's own transport retries.
    expect(first.doGenerateCalls.length).toBeLessThanOrEqual(3);
    expect(chain.failed.has(chain.candidates[0].cooldownKey)).toBe(true);
    // The second generation had nothing to switch away from.
    expect(chain.switches).toHaveLength(1);
  });

  it("falla sin llamar a nadie cuando ya no queda candidato vivo", async () => {
    const only = failing(rateLimited());
    const chain = testChain(testCandidate(only, { modelId: "uno" }));

    await expect(run(chain)).rejects.toMatchObject({ status: 429 });
    const spent = only.doGenerateCalls.length;

    await expect(run(chain)).rejects.toMatchObject({ status: 429 });
    expect(only.doGenerateCalls).toHaveLength(spent);
  });

  /**
   * The reason the fallback lives in `generate` and not in a middleware
   * wrapping one model: `looseJsonSchema` decides the schema handed to
   * `generateObject`, and `maxOutputTokens` the ceiling, both upstream of the
   * model. A standby that needs a relaxed schema and an 8192 cap has to be
   * asked in its own shape, not in the shape that suited whoever came first.
   */
  it("le arma a cada candidato el pedido que ese candidato necesita", async () => {
    const cohere = new MockLanguageModelV4({
      doGenerate: async () => reply(JSON.stringify({ title: "ok", items: ["uno"] })),
    });
    const chain = testChain(
      testCandidate(failing(rateLimited()), {
        provider: "groq",
        modelId: "uno",
        looseJsonSchema: false,
      }),
      testCandidate(cohere, {
        provider: "cohere",
        modelId: "dos",
        looseJsonSchema: true,
        maxOutputTokens: 8192,
      }),
    );

    await generate({
      chain,
      schema: z.object({ title: z.string(), items: z.array(z.string()).min(1) }),
      schemaName: "Thing",
      system: "SYSTEM",
      prompt: "ORIGINAL PROMPT",
      maxOutputTokens: 16384,
    });

    const call = cohere.doGenerateCalls[0];
    expect(call.maxOutputTokens).toBe(8192);
    expect(JSON.stringify(call.responseFormat)).not.toContain("minItems");
  });

  it("manda el ajuste de reasoning sólo al candidato que lo acepta", async () => {
    const capable = working();
    const chain = testChain(
      testCandidate(failing(rateLimited()), { modelId: "uno", reasoningCapable: false }),
      testCandidate(capable, { modelId: "dos", reasoningCapable: true }),
    );

    await run(chain);

    expect(capable.doGenerateCalls[0].reasoning).toBe("low");
  });

  it("atribuye la telemetría al candidato que respondió, no al que falló", async () => {
    const telemetry = {};
    const chain = testChain(
      testCandidate(failing(rateLimited()), { modelId: "uno" }),
      testCandidate(working(), { modelId: "dos" }),
    );

    await generate({
      chain,
      schema,
      schemaName: "Thing",
      system: "SYSTEM",
      prompt: "ORIGINAL PROMPT",
      telemetry,
    });

    expect(chain.used.modelId).toBe("dos");
    expect(telemetry).toMatchObject({ finishReason: "stop" });
  });
});

describe("cooldown entre pedidos", () => {
  /**
   * Our own Gemini key at its daily limit would otherwise make every request
   * for the next several hours spend a failed call before falling back.
   */
  it("saltea un candidato que falló en un pedido anterior", async () => {
    const flaky = failing(rateLimited());
    const first = testChain(
      testCandidate(flaky, { modelId: "uno" }),
      testCandidate(working(), { modelId: "dos" }),
    );
    await run(first);
    const spent = flaky.doGenerateCalls.length;

    // A separate request, so nothing carries over except the cooldown.
    const second = testChain(
      testCandidate(flaky, { modelId: "uno" }),
      testCandidate(working(), { modelId: "dos" }),
    );
    await expect(run(second)).resolves.toEqual(valid);

    expect(flaky.doGenerateCalls).toHaveLength(spent);
    expect(second.used.modelId).toBe("dos");
    // Skipped, not discarded: nothing failed in this request to switch away from.
    expect(second.switches).toEqual([]);
  });

  it("igual pregunta cuando todos los candidatos están en cooldown", async () => {
    const only = working();
    const chain = () => testChain(testCandidate(only, { modelId: "uno" }));

    const cooled = testChain(testCandidate(failing(rateLimited()), { modelId: "uno" }));
    await expect(run(cooled)).rejects.toMatchObject({ status: 429 });

    // Same identity, now answering. Refusing here would fail a request over the
    // memory of one that failed a minute ago.
    await expect(run(chain())).resolves.toEqual(valid);
    expect(only.doGenerateCalls.length).toBeGreaterThan(0);
  });
});

/**
 * The failure a cooldown can never see.
 *
 * Every status above is a provider *refusing* work, and a refusal is fast. A
 * free endpoint that accepts the call and then takes two minutes refuses
 * nothing, so before the attempt budget existed there was nothing to fall back
 * from: `generateObject` ran with no `abortSignal`, the route declared no
 * `maxDuration`, and the proxy in front allowed a day. The request just waited
 * — and a user with several keys configured was *more* likely to land on one of
 * these first, which is what made a long chain feel slow.
 */
describe("presupuesto por intento", () => {
  const aborted = () =>
    Object.assign(new Error("The operation was aborted"), { name: "AbortError" });

  /** A model that never answers until it is aborted. */
  function hanging() {
    return new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) =>
        new Promise<GenerateResult>((_resolve, reject) => {
          if (!abortSignal) return;
          // Checked before subscribing: a signal that fired before the call was
          // made never fires again, and a listener added after the fact would
          // leave this promise pending forever.
          if (abortSignal.aborted) return reject(aborted());
          abortSignal.addEventListener("abort", () => reject(aborted()));
        }),
    });
  }

  it("abandona a un candidato que no contesta y le pregunta al siguiente", async () => {
    const slow = hanging();
    const chain = testChain(
      testCandidate(slow, { modelId: "uno" }),
      testCandidate(working(), { modelId: "dos" }),
    );

    await expect(
      generate({
        chain,
        schema,
        schemaName: "Thing",
        system: "SYSTEM",
        prompt: "ORIGINAL PROMPT",
        timeoutMs: 40,
      }),
    ).resolves.toEqual(valid);

    expect(chain.used.modelId).toBe("dos");
    expect(chain.switches[0].status).toBe(504);
    expect(chain.switches[0].kind).toBe("timeout");
    expect(slow.doGenerateCalls).toHaveLength(1);
  });

  /**
   * A user pressing Cancel and a provider being slow both stop the call, and
   * they are opposite instructions. Walking the chain here would spend the
   * user's tokens on a page they have already left.
   */
  it("no le pregunta a nadie más cuando quien cortó fue el usuario", async () => {
    const second = working();
    const controller = new AbortController();
    const chain = testChain(
      testCandidate(hanging(), { modelId: "uno" }),
      testCandidate(second, { modelId: "dos" }),
    );
    chain.signal = controller.signal;

    const pending = generate({
      chain,
      schema,
      schemaName: "Thing",
      system: "SYSTEM",
      prompt: "ORIGINAL PROMPT",
      timeoutMs: 10_000,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      status: 499,
      kind: "cancelled",
      switchable: false,
    });
    expect(second.doGenerateCalls).toHaveLength(0);
    // Not switchable, so nothing was recorded and no note will be written: a
    // cancel is the user's instruction, not a fact about the provider.
    expect(chain.switches).toEqual([]);
  });

  /**
   * The SDK backs off exponentially between transport retries, so a
   * rate-limited provider costs three calls and several seconds to establish
   * something the chain already knows how to handle. With somewhere to go,
   * going is strictly faster than waiting.
   */
  it("no reintenta a nivel transporte cuando hay otro candidato al que ir", async () => {
    const retryable = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({
          message: "Rate limit reached for model",
          url: "https://example.invalid/v1/chat/completions",
          requestBodyValues: {},
          statusCode: 429,
          isRetryable: true,
        });
      },
    });
    const chain = testChain(
      testCandidate(retryable, { modelId: "uno" }),
      testCandidate(working(), { modelId: "dos" }),
    );

    await expect(run(chain)).resolves.toEqual(valid);
    expect(retryable.doGenerateCalls).toHaveLength(1);
  });

  /**
   * A call the deadline will cut off partway is not a cheaper answer — it is
   * the user's tokens spent on a result nobody will ever see.
   */
  it("no arranca un candidato para el que ya no queda presupuesto", async () => {
    const second = working();
    const chain = testChain(
      testCandidate(
        // Spends the request's budget on its way to failing, which is what a
        // real slow candidate does. Simulated rather than waited out: the gate
        // reads the clock, so moving the deadline is the same experiment.
        new MockLanguageModelV4({
          doGenerate: async () => {
            chain.deadlineAt = Date.now() + 1_000;
            throw rateLimited();
          },
        }),
        { modelId: "uno" },
      ),
      testCandidate(second, { modelId: "dos" }),
    );
    chain.deadlineAt = Date.now() + 30_000;

    // The first candidate's reason, not "we gave up waiting": being told the
    // provider is rate-limited is more use than being told we ran out of time.
    await expect(run(chain)).rejects.toMatchObject({ status: 429 });
    expect(second.doGenerateCalls).toHaveLength(0);
  });

  it("no llama a nadie cuando el pedido ya agotó su presupuesto", async () => {
    const only = working();
    const chain = testChain(testCandidate(only, { modelId: "uno" }));
    chain.deadlineAt = Date.now() + 1_000;

    await expect(run(chain)).rejects.toMatchObject({ status: 504 });
    expect(only.doGenerateCalls).toHaveLength(0);
  });

  it("le avisa a la ruta de cada cambio mientras pasa", async () => {
    const seen: number[] = [];
    const chain = testChain(
      testCandidate(failing(rateLimited()), { modelId: "uno" }),
      testCandidate(working(), { modelId: "dos" }),
    );
    chain.onSwitch = (event) => seen.push(event.status);

    await expect(run(chain)).resolves.toEqual(valid);
    expect(seen).toEqual([429]);
  });
});

/**
 * The last candidate standing gets a longer attempt budget than anyone with a
 * standby behind it: waiting longer delays no fallback when there is no
 * fallback left, and is the difference between a response and a failed
 * request for a user whose only key is a slow one. See
 * `LAST_RESORT_TIMEOUT_MS` in `lib/ai/pipeline.ts`.
 */
describe("presupuesto del último candidato", () => {
  // `ATTEMPT_TIMEOUT_MS` and `LAST_RESORT_TIMEOUT_MS` are private to
  // `lib/ai/pipeline.ts`; spelled out here and pinned by
  // `lastResortBudgetMs aplica piso y techo a la observación` below.
  const ATTEMPT_TIMEOUT_BASE = 25_000;
  const LAST_RESORT_FLOOR = 40_000;

  function captureWarnings(): string[] {
    const lines: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(" "));
    });
    return lines;
  }

  /**
   * Asserted through the signal the attempt is given rather than by waiting
   * out a real abort: the extension raises `AbortSignal.timeout` to at least
   * forty seconds, and the request-deadline gate refuses to start anything
   * with less than `MIN_ATTEMPT_MS` left, so observing the abort itself would
   * cost eight-plus real seconds. The spy passes through to the real
   * `AbortSignal.timeout`, so the one call a mock model makes still behaves.
   */
  function grantedBudgets(): number[] {
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const granted: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation(((ms: number) => {
      granted.push(ms);
      return realTimeout(ms);
    }) as typeof AbortSignal.timeout);
    return granted;
  }

  it("le extiende el presupuesto al único candidato que queda", async () => {
    const chain = testChain(testCandidate(failing(rateLimited()), { modelId: "uno" }));
    const granted = grantedBudgets();

    await expect(run(chain)).rejects.toMatchObject({ status: 429 });

    // The floor: a fresh last candidate gets 40s where the base budget is 25s.
    // No log line accompanies it — the floor is routine for a last candidate,
    // and logging it would put a line under every generation of every
    // single-key user.
    expect(granted).toContain(LAST_RESORT_FLOOR);
  });

  it("no le extiende el presupuesto a quien tiene a quién cederle", async () => {
    const chain = testChain(
      testCandidate(failing(rateLimited()), { modelId: "uno" }),
      testCandidate(working(), { modelId: "dos" }),
    );
    const warnings = captureWarnings();
    const granted = grantedBudgets();

    await expect(run(chain)).resolves.toEqual(valid);

    // "uno" has a standby behind it, so it keeps the base budget. "dos" ends
    // the chain and gets the floor — routine, and logged by nobody.
    expect(granted).toContain(ATTEMPT_TIMEOUT_BASE);
    expect(warnings.filter((line) => line.includes("último candidato"))).toEqual([]);
  });

  it("mide la extensión por lo que la key viene tardando en responder", async () => {
    // The cooldownKey `testCandidate` builds from provider and model id.
    for (let i = 0; i < 3; i++) recordOutcome("google tres test", { ok: true, ms: 60_000 });
    const chain = testChain(
      testCandidate(failing(rateLimited()), { provider: "google", modelId: "tres" }),
    );
    const warnings = captureWarnings();

    await expect(run(chain)).rejects.toMatchObject({ status: 429 });

    // 60s observed, times and a half, capped at `LARGE_ATTEMPT_TIMEOUT_MS`.
    expect(
      warnings.some(
        (line) =>
          line.includes("es el último candidato disponible") &&
          line.includes("viene respondiendo en ~60 segundos") &&
          line.includes("hasta 90"),
      ),
    ).toBe(true);
  });

  it("no mide la extensión por una historia de timeouts", async () => {
    for (let i = 0; i < 3; i++) recordOutcome("google tres test", { ok: false, ms: 90_000 });
    const chain = testChain(
      testCandidate(failing(rateLimited()), { provider: "google", modelId: "tres" }),
    );
    const warnings = captureWarnings();

    await expect(run(chain)).rejects.toMatchObject({ status: 429 });

    // A candidate that only ever failed has not demonstrated a latency worth
    // budgeting for; it gets the floor, and the floor logs nothing.
    expect(warnings.filter((line) => line.includes("último candidato"))).toEqual([]);
  });

  it("lastResortBudgetMs aplica piso y techo a la observación", () => {
    expect(lastResortBudgetMs(undefined)).toBe(40_000);
    expect(lastResortBudgetMs(30_000)).toBe(45_000);
    // Below the floor an extension is not worth the complexity of a branch.
    expect(lastResortBudgetMs(5_000)).toBe(40_000);
    // Above `LARGE_ATTEMPT_TIMEOUT_MS` no attempt may outgrow what the request
    // deadline was sized to hold.
    expect(lastResortBudgetMs(120_000)).toBe(90_000);
  });
});

/**
 * Only demonstrably bad behaviour reorders a chain.
 *
 * The user's order encodes a judgement about *quality* — they put their best
 * model first. Sorting by latency would quietly overrule it with whichever
 * cheap model answers fastest, so a candidate is only ever demoted, never
 * promoted past someone the user preferred.
 */
describe("orden por salud", () => {
  it("deja de preguntarle primero a un candidato que viene fallando", async () => {
    const bad = () => testCandidate(failing(rateLimited()), { modelId: "uno" });
    const good = working();

    // Three failures is `MIN_SAMPLES`: below it the record is not evidence.
    for (let i = 0; i < 3; i++) {
      clearCooldowns(); // isolate the health signal from the cooldown one
      await expect(run(testChain(bad(), testCandidate(working(), { modelId: "dos" })))).resolves.toEqual(
        valid,
      );
    }
    clearCooldowns();

    const chain = testChain(bad(), testCandidate(good, { modelId: "dos" }));
    await expect(run(chain)).resolves.toEqual(valid);

    // Asked first this time, so nothing had to fail to reach it.
    expect(chain.used.modelId).toBe("dos");
    expect(chain.switches).toEqual([]);
  });

  it("no penaliza a un candidato sin historial", async () => {
    const fresh = working();
    const chain = testChain(
      testCandidate(fresh, { modelId: "uno" }),
      testCandidate(working(), { modelId: "dos" }),
    );

    await expect(run(chain)).resolves.toEqual(valid);
    expect(chain.used.modelId).toBe("uno");
  });

  /**
   * A chain is a safety net, not a queue. Someone who pasted six keys into
   * Ajustes did not ask to wait for six providers.
   */
  it("no prueba más de tres candidatos en una generación", async () => {
    const last = working();
    const chain = testChain(
      ...["uno", "dos", "tres"].map((modelId) =>
        testCandidate(failing(rateLimited()), { modelId }),
      ),
      testCandidate(last, { modelId: "cuatro" }),
    );

    await expect(run(chain)).rejects.toMatchObject({ status: 429 });
    expect(last.doGenerateCalls).toHaveLength(0);
    // The three it did try are spent, so the next generation reaches the fourth.
    await expect(run(chain)).resolves.toEqual(valid);
  });
});
