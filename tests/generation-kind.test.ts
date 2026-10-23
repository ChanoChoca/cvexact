import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { asGenerationError, generate } from "@/lib/ai/pipeline";
import {
  GENERATION_ERROR_KINDS,
  isGenerationErrorKind,
  type GenerationErrorKind,
} from "@/lib/ai/error-kind";
import { failureMessage } from "@/lib/api/context";
import { clearCooldowns } from "@/lib/ai/cooldown";
import { clearHealth } from "@/lib/ai/health";
import { KIND_HEADLINE, noteHeadline } from "@/app/(app)/ajustes/SettingsEditor";
import { testCandidate, testChain } from "./model-chain-fixtures";

/**
 * `kind`, the classification that travels beside `status`.
 *
 * Two tables with different jobs. The rules table pins what each classifier
 * branch does — including the precedence cases a reordering would break — and
 * the `Record` under it pins that *every* kind has a scenario, so a member
 * added to `GenerationErrorKind` cannot ship untested. The last block walks one
 * classification all the way to the settings row: switch → attempt → note →
 * headline.
 */

const schema = z.object({ title: z.string() });

function apiError(message: string, statusCode: number, responseBody?: string) {
  return new APICallError({
    message,
    url: "https://example.invalid/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    isRetryable: false,
    ...(responseBody === undefined ? {} : { responseBody }),
  });
}

function failing(error: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw error;
    },
  });
}

/** Same fake-storage harness as `tests/storage-migration.test.ts`. */
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

beforeEach(() => {
  clearCooldowns();
  clearHealth();
  // Every classifier *and* every switch logs; the assertions are the point.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  clearCooldowns();
  clearHealth();
  delete (globalThis as unknown as { window?: unknown }).window;
  vi.resetModules();
});

describe("isGenerationErrorKind", () => {
  it("acepta el set cerrado y rechaza cualquier otra cosa", () => {
    for (const kind of GENERATION_ERROR_KINDS) expect(isGenerationErrorKind(kind)).toBe(true);
    expect(isGenerationErrorKind("provider_deprecated")).toBe(false);
    expect(isGenerationErrorKind("")).toBe(false);
    expect(isGenerationErrorKind(undefined)).toBe(false);
    expect(isGenerationErrorKind(400)).toBe(false);
  });
});

describe("clasificación directa de asGenerationError", () => {
  const RULES: Array<{
    name: string;
    error: unknown;
    status: number;
    kind: GenerationErrorKind;
    switchable: boolean;
  }> = [
    {
      name: "401 por mensaje",
      error: apiError("Incorrect API key provided", 401),
      status: 401,
      kind: "key_rejected",
      switchable: true,
    },
    {
      name: "401 con mensaje vacío (Mistral)",
      error: apiError("", 401),
      status: 401,
      kind: "key_rejected",
      switchable: true,
    },
    {
      name: "403 sin mención del plan",
      error: apiError("", 403),
      status: 401,
      kind: "key_rejected",
      switchable: true,
    },
    /**
     * The precedence the whole kind exists for: the same 403, told apart by
     * what the provider said, and classified before `BY_STATUS[403]` can call
     * it a refused credential.
     */
    {
      name: "403 tier_not_allowed por mensaje",
      error: apiError("This model is not available in your subscription tier", 403),
      status: 400,
      kind: "model_not_in_plan",
      switchable: true,
    },
    {
      name: "403 tier_not_allowed sólo en el body",
      error: apiError("", 403, '{"type":"tier_not_allowed","code":"1910"}'),
      status: 400,
      kind: "model_not_in_plan",
      switchable: true,
    },
    {
      name: "410 Gone",
      error: apiError("Gone", 410),
      status: 400,
      kind: "model_retired",
      switchable: true,
    },
    {
      name: "404 con wording de retiro",
      error: apiError("The model `viejo` does not exist or you do not have access to it.", 404),
      status: 400,
      kind: "model_retired",
      switchable: true,
    },
    {
      name: "402 sin crédito",
      error: apiError(
        "This request requires more credits, or fewer max_tokens. You requested up to 16384 " +
          "tokens, but can only afford 4722.",
        402,
      ),
      status: 402,
      kind: "no_credit",
      switchable: true,
    },
    {
      name: "413 por TPM del plan",
      error: apiError(
        "Request too large for model `x` on tokens per minute (TPM): Limit 8000, Requested " +
          "10301, please reduce your message size and try again.",
        413,
      ),
      status: 413,
      kind: "request_too_large",
      switchable: true,
    },
    {
      name: "429",
      error: apiError("Rate limit reached for model. Try again in 4s.", 429),
      status: 429,
      kind: "rate_limited",
      switchable: true,
    },
    {
      name: "429 por cuota diaria",
      error: apiError(
        "Quota exceeded for metric: generate_content_free_tier_requests, limit: 20. Please retry in 3h12m30s.",
        429,
        '{"error":{"code":429,"message":"Quota exceeded","details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]},{"retryDelay":"11550s"}]}}',
      ),
      status: 429,
      kind: "rate_limited",
      switchable: true,
    },
    {
      name: "503 saturado",
      error: apiError("The model is experiencing high demand. Please try again later.", 503),
      status: 503,
      kind: "overloaded",
      switchable: true,
    },
    {
      name: "504 por status",
      error: apiError("Gateway timeout", 504),
      status: 504,
      kind: "timeout",
      switchable: true,
    },
    {
      name: "500 genérico",
      error: apiError("Internal server error while serving the request.", 500),
      status: 502,
      kind: "unclassified",
      switchable: false,
    },
  ];

  it.each(RULES)(
    "$name → status $status, kind $kind, switchable $switchable",
    ({ error, status, kind, switchable }) => {
      const classified = asGenerationError(error);
      expect({
        status: classified.status,
        kind: classified.kind,
        switchable: classified.switchable,
      }).toEqual({ status, kind, switchable });
    },
  );
});

/** The kind of whatever a run threw, or a sentinel if it resolved. */
async function kindFrom(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return (error as { kind?: string }).kind ?? "missing-kind";
  }
  return "resolved";
}

describe("cobertura por kind", () => {
  /**
   * One scenario per member, through `asGenerationError` where it does the
   * classifying and through the pipeline branch that builds it otherwise.
   * `cancelled` is that exception: the 499 is constructed by `generate` itself
   * and is deliberately not switchable.
   *
   * A `Record` over the closed union, so adding a kind fails to compile until
   * it has a scenario here — the same guarantee `KIND_HEADLINE` gives the copy.
   */
  const SCENARIOS: Record<GenerationErrorKind, () => Promise<string>> = {
    key_rejected: async () => asGenerationError(apiError("Incorrect API key provided", 401)).kind,
    no_credit: async () =>
      asGenerationError(apiError("Insufficient credits for this request.", 402)).kind,
    request_too_large: async () =>
      asGenerationError(apiError("Request too large for model", 413)).kind,
    rate_limited: async () => asGenerationError(apiError("Rate limit reached", 429)).kind,
    model_retired: async () => asGenerationError(apiError("Gone", 410)).kind,
    model_not_in_plan: async () =>
      asGenerationError(
        apiError("This model is not available in your subscription tier", 403),
      ).kind,
    overloaded: async () =>
      asGenerationError(apiError("The model is experiencing high demand.", 503)).kind,
    timeout: async () => asGenerationError(apiError("Gateway timeout", 504)).kind,
    unclassified: async () => asGenerationError(apiError("Internal server error", 500)).kind,
    cancelled: () =>
      kindFrom(async () => {
        const aborting = new MockLanguageModelV4({
          doGenerate: async () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            throw error;
          },
        });
        const chain = testChain(testCandidate(aborting, { modelId: "uno" }));
        chain.signal = AbortSignal.abort();
        return generate({
          chain,
          schema,
          schemaName: "Thing",
          system: "SYSTEM",
          prompt: "ORIGINAL PROMPT",
        });
      }),
  };

  it.each(GENERATION_ERROR_KINDS)("produce %s", async (kind) => {
    await expect(SCENARIOS[kind]()).resolves.toBe(kind);
  });
});

describe("de punta a punta", () => {
  it("el kind viaja del failure al switch, a los attempts, a la nota y al titular", async () => {
    const chain = testChain(
      testCandidate(
        failing(apiError("This model is not available in your subscription tier", 403)),
        { provider: "mistral", modelId: "mistral-large-latest" },
      ),
      testCandidate(failing(apiError("Internal server error while serving the request.", 500)), {
        provider: "google",
        modelId: "gemini-3.5-flash",
      }),
    );

    let thrown: unknown;
    try {
      await generate({
        chain,
        schema,
        schemaName: "Thing",
        system: "SYSTEM",
        prompt: "ORIGINAL PROMPT",
      });
    } catch (error) {
      thrown = error;
    }

    // The classification, and the switch the route reports it as.
    expect((thrown as { kind?: string }).kind).toBe("unclassified");
    expect(chain.switches[0].kind).toBe("model_not_in_plan");

    // The attempts the browser is handed, derived from those switches.
    const { attempts } = failureMessage(thrown, { chain, tier: "byok" });
    const mistral = attempts?.find((attempt) => attempt.provider === "mistral");
    expect(mistral?.kind).toBe("model_not_in_plan");

    // The note it becomes, and the words the row leads with.
    installStorage();
    const store = await import("@/lib/storage/local");
    store.recordProviderNotes(attempts ?? []);
    const note = store.loadProviderNotes()["mistral:mistral-large-latest"];
    expect(note?.kind).toBe("model_not_in_plan");
    expect(noteHeadline(note!)).toBe(KIND_HEADLINE.model_not_in_plan);
    expect(noteHeadline(note!)).toBe("Modelo fuera de tu plan");
  });

  /**
   * The backward half of the contract: notes outlive the version that wrote
   * them, so a `kind` this build does not know is dropped and the rest of the
   * note — including the status every policy reads — is kept.
   */
  it("conserva una nota de otra versión y cae al titular por status", async () => {
    const seeded = installStorage();
    const store = await import("@/lib/storage/local");
    seeded.set(
      store.PROVIDER_NOTES_KEY,
      JSON.stringify({
        "groq:viejo": { status: 401, message: "Key rechazada", at: new Date().toISOString() },
        "groq:futuro": {
          status: 400,
          kind: "provider_deprecated",
          message: "algo que esta versión no conoce",
          at: new Date().toISOString(),
        },
      }),
    );

    const notes = store.loadProviderNotes();
    expect(notes["groq:viejo"].kind).toBeUndefined();
    expect(noteHeadline(notes["groq:viejo"])).toBe("Key rechazada");
    // The unknown kind is stripped; status and message survive.
    expect(notes["groq:futuro"].kind).toBeUndefined();
    expect(notes["groq:futuro"].status).toBe(400);
    expect(notes["groq:futuro"].message).toBe("algo que esta versión no conoce");
    expect(noteHeadline(notes["groq:futuro"])).toBe("Modelo inválido");
  });
});