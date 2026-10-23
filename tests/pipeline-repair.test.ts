import { describe, expect, it } from "vitest";
import {
  APICallError,
  JSONParseError,
  NoObjectGeneratedError,
  TypeValidationError,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import {
  clipToLimits,
  describeValidationFailure,
  generate,
  unwrapEnvelope,
  type GenerationTelemetry,
} from "@/lib/ai/pipeline";
import { singleTestChain, testCandidate, testChain } from "./model-chain-fixtures";

/**
 * Some models nest the whole object under a key named after the schema
 * (e.g. `{"InferredSkills": {"skills": [...]}}`) instead of returning
 * `{"skills": [...]}` at the top level — see the "InferredSkills ... expected
 * array, received undefined" 502 this guards against.
 */
describe("unwrapEnvelope", () => {
  it("unwraps a value nested under a key matching schemaName", () => {
    const error = new TypeValidationError({
      value: { InferredSkills: { skills: [{ skill: "React" }] } },
      cause: new Error("skills: expected array, received undefined"),
    });

    const result = unwrapEnvelope(error, "InferredSkills");

    expect(result).toBe(JSON.stringify({ skills: [{ skill: "React" }] }));
  });

  it("matches the wrapper key case-insensitively", () => {
    const error = new TypeValidationError({
      value: { inferredskills: { skills: [] } },
      cause: new Error("skills: expected array, received undefined"),
    });

    expect(unwrapEnvelope(error, "InferredSkills")).toBe(JSON.stringify({ skills: [] }));
  });

  it("returns null when the value already has the expected shape", () => {
    const error = new TypeValidationError({
      value: { skills: [] },
      cause: new Error("some other violation"),
    });

    expect(unwrapEnvelope(error, "InferredSkills")).toBeNull();
  });

  it("returns null when there is more than one top-level key", () => {
    const error = new TypeValidationError({
      value: { InferredSkills: { skills: [] }, extra: true },
      cause: new Error("unexpected shape"),
    });

    expect(unwrapEnvelope(error, "InferredSkills")).toBeNull();
  });

  it("returns null when the value is not an object", () => {
    const error = new TypeValidationError({
      value: "not an object",
      cause: new Error("expected object, received string"),
    });

    expect(unwrapEnvelope(error, "InferredSkills")).toBeNull();
  });
});

/**
 * No provider here is reliably told the length limits `lib/schemas/*.ts`
 * encode — Cohere and Google have them stripped by `relaxJsonSchema`, and the
 * OpenAI-compatible clients (Groq, OpenRouter) get no schema at all — so a
 * response that overshoots one is expected rather than aberrant. This guards
 * the "Too big: expected string to have <=100 characters" 502 an OpenRouter
 * run hit on `InferredSkills.skills[26].derivedFrom`.
 */
describe("clipToLimits", () => {
  const schema = z.object({
    skills: z
      .array(
        z.object({
          skill: z.string().max(80),
          derivedFrom: z.string().max(100),
          confidence: z.enum(["high", "medium"]),
        }),
      )
      .max(3),
  });

  /** Builds the error the AI SDK would hand `repairText` for `value`. */
  function rejection(value: unknown, of: z.ZodType = schema): TypeValidationError {
    const result = of.safeParse(value);
    if (result.success) throw new Error("test value was supposed to be invalid");
    return new TypeValidationError({ value, cause: result.error });
  }

  const skill = (over: Partial<{ skill: string; derivedFrom: string; confidence: string }> = {}) => ({
    skill: "Diseño de bases de datos",
    derivedFrom: "PostgreSQL",
    confidence: "high",
    ...over,
  });

  it("trims an over-long string to its limit rather than failing the generation", () => {
    // The real one, at 130 characters.
    const long =
      "PostgreSQL y Redis, aplicando mejoras en 50 consultas SQL, estrategias de " +
      "caching, diseño de índices y manejo de transacciones";
    const value = { skills: [skill({ derivedFrom: long })] };

    const clipped = clipToLimits(rejection(value), schema);

    expect(clipped).not.toBeNull();
    const { derivedFrom } = JSON.parse(clipped!).skills[0];
    expect(derivedFrom.length).toBeLessThanOrEqual(100);
    expect(derivedFrom).toMatch(/…$/);
    expect(long.startsWith(derivedFrom.slice(0, -1))).toBe(true);
  });

  it("drops the surplus elements of an over-long array", () => {
    const value = { skills: [skill(), skill(), skill(), skill()] };

    const clipped = clipToLimits(rejection(value), schema);

    expect(JSON.parse(clipped!).skills).toHaveLength(3);
  });

  it("fixes every violation in one pass, leaving the rest of the value intact", () => {
    const value = {
      skills: [skill({ derivedFrom: "x".repeat(140) }), skill({ skill: "y".repeat(90) })],
    };

    const parsed = JSON.parse(clipToLimits(rejection(value), schema)!);

    expect(parsed.skills[0].derivedFrom).toHaveLength(100);
    expect(parsed.skills[1].skill).toHaveLength(80);
    expect(parsed.skills[0].skill).toBe("Diseño de bases de datos");
    expect(parsed.skills[1].confidence).toBe("high");
  });

  it("returns null for a violation no amount of trimming fixes", () => {
    const value = { skills: [skill({ confidence: "low" })] };

    expect(clipToLimits(rejection(value), schema)).toBeNull();
  });

  it("returns null when only some of the violations are trimmable", () => {
    const value = {
      skills: [skill({ derivedFrom: "x".repeat(140) }), skill({ confidence: "low" })],
    };

    expect(clipToLimits(rejection(value), schema)).toBeNull();
  });

  it("leaves a printed string to the model, which writes a shorter one instead of a line that ends in «…»", () => {
    const value = { skills: [skill({ derivedFrom: "x".repeat(140) })] };

    expect(clipToLimits(rejection(value), schema, (path) => path.at(-1) === "derivedFrom")).toBeNull();
    expect(clipToLimits(rejection(value), schema, (path) => path.at(-1) === "skill")).not.toBeNull();
  });

  it("returns null when the trimmed value still does not validate", () => {
    // Zod stops at the first failing check on a branch, so an object-level
    // refinement never appears in the issue list beside a `too_big` — trimming
    // the string reveals a violation `clipToLimits` was never shown.
    const refined = schema.refine((v) => v.skills.every((s) => s.derivedFrom.length < 100));
    const value = { skills: [skill({ derivedFrom: "x".repeat(140) })] };

    expect(clipToLimits(rejection(value, refined), refined)).toBeNull();
  });

  it("returns null when the cause is not a Zod error at all", () => {
    const error = new TypeValidationError({
      value: { skills: [] },
      cause: new Error("something else entirely"),
    });

    expect(clipToLimits(error, schema)).toBeNull();
  });

  it("does not call the model again, and records the repair as clipped", async () => {
    const telemetry: GenerationTelemetry = {};
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            { type: "text", text: JSON.stringify({ skills: [skill({ derivedFrom: "x".repeat(140) })] }) },
          ],
          finishReason: { unified: "stop", raw: "STOP" },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
          warnings: [],
        },
      ],
    });

    const result = await generate({
      chain: singleTestChain(model),
      schema,
      schemaName: "InferredSkills",
      system: "SYSTEM",
      prompt: "ORIGINAL PROMPT",
      telemetry,
    });

    expect(result.skills[0].derivedFrom).toHaveLength(100);
    expect(telemetry.repaired).toBe("clipped");
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});

/**
 * The repair path itself, driven through `generate` with a scripted model.
 *
 * A truncated response and a schema-violating one need opposite handling, and
 * getting that backwards is what produced the "CVDocument failed schema
 * validation (finishReason=length)" 502: the model was cut off inside a
 * repetition loop, the loop was echoed straight back to it as context, and the
 * unconstrained repair call continued it and returned an object with a section
 * that had no discriminator at all.
 */
describe("repairSchemaViolation", () => {
  const schema = z.object({
    title: z.string(),
    items: z.array(z.object({ kind: z.literal("a"), text: z.string() })).min(1),
  });

  const valid = { title: "ok", items: [{ kind: "a", text: "t" }] };

  // Taken off the mock rather than imported: `@ai-sdk/provider`, where these
  // live, is a transitive dependency and not something to declare for a test.
  type GenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
  type CallOptions = MockLanguageModelV4["doGenerateCalls"][number];

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

  /** The prompt text of a recorded call, system message excluded. */
  function promptOf(call: CallOptions): string {
    return call.prompt
      .filter((m) => m.role === "user")
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");
  }

  function run(replies: GenerateResult[]) {
    const model = new MockLanguageModelV4({ doGenerate: replies });
    return {
      model,
      result: generate({
        chain: singleTestChain(model),
        schema,
        schemaName: "Thing",
        system: "SYSTEM",
        prompt: "ORIGINAL PROMPT",
        preserve: "KEEP THE ITEMS",
      }),
    };
  }

  it("re-asks with the original prompt, not the truncated text, on a cut-off response", async () => {
    const runaway = `{"title":"${"Nombre ".repeat(200)}`;
    const { model, result } = run([reply(runaway), reply(JSON.stringify(valid))]);

    await expect(result).resolves.toEqual(valid);

    const repair = promptOf(model.doGenerateCalls[1]);
    expect(repair).toContain("ORIGINAL PROMPT");
    expect(repair).toContain("KEEP THE ITEMS");
    // The loop must not be handed back to the model as context.
    expect(repair).not.toContain("Nombre Nombre");
  });

  it("echoes the previous response, clipped, on a schema violation", async () => {
    const violating = JSON.stringify({ title: "ok", items: [] });
    const { model, result } = run([reply(violating), reply(JSON.stringify(valid))]);

    await expect(result).resolves.toEqual(valid);

    const repair = promptOf(model.doGenerateCalls[1]);
    expect(repair).toContain("did not satisfy the required schema");
    expect(repair).toContain(violating);
  });

  it("clips an enormous rejected response instead of echoing all of it", async () => {
    // Varied, not repeating — an enormous but non-degenerate response should
    // still take the echo-and-clip path, not the degenerate-repetition one.
    const varied = Array.from({ length: 6_000 }, (_, i) => `word${i}`).join(" ");
    const huge = JSON.stringify({ title: varied, items: [] });
    const { model, result } = run([reply(huge), reply(JSON.stringify(valid))]);

    await expect(result).resolves.toEqual(valid);

    expect(promptOf(model.doGenerateCalls[1])).toContain("chars omitted");
  });

  it("validates the repair against the schema, so a shaped-but-wrong retry still fails", async () => {
    // What the unconstrained `generateText` repair used to let through: right
    // top-level keys, but an item missing its discriminator.
    const shapedButWrong = JSON.stringify({ title: "ok", items: [{ text: "no kind" }] });
    const { result } = run([reply("{"), reply(shapedButWrong)]);

    await expect(result).rejects.toThrow(/formato esperado/);
  });

  it("does not call the model again when the envelope can be unwrapped locally", async () => {
    const { model, result } = run([reply(JSON.stringify({ Thing: valid }))]);

    await expect(result).resolves.toEqual(valid);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  /**
   * A schema violation whose rejected value shows the same repetition-loop
   * shape as a truncated response ("Nombre Nombre Nombre…") is the same
   * degeneration without the truncation — well-formed JSON, but a field full
   * of repeated content. Echoing it back risks the one repair attempt
   * continuing the loop, so it gets the same fresh-prompt treatment as a
   * cut-off response instead of the normal echo-back.
   */
  it("does not echo the previous response when it contains a degenerate repetition", async () => {
    const violating = JSON.stringify({ title: "Nombre ".repeat(200), items: [] });
    const { model, result } = run([reply(violating), reply(JSON.stringify(valid))]);

    await expect(result).resolves.toEqual(valid);

    const repair = promptOf(model.doGenerateCalls[1]);
    expect(repair).toContain("ORIGINAL PROMPT");
    expect(repair).toContain("KEEP THE ITEMS");
    expect(repair).not.toContain("Nombre Nombre");
  });

  /**
   * The failure that actually shipped a 502: Gemini's `header.phone` looped
   * ("+5491100000000" + "2b-9f3a8c1d2-9f3a8c1d2-…") until it ran out of
   * `maxOutputTokens`, cutting the JSON off mid-string — a `JSONParseError`,
   * not a `TypeValidationError`. Before this fix, the degenerate-repetition
   * check was gated on `TypeValidationError` only, so a cut-off repetition
   * loop always got the generic "make it shorter" message, which doesn't
   * address why it looped and gives the model no reason not to loop again.
   */
  it("uses the anti-repetition instruction, not the generic truncation one, when the cut-off text is itself a repetition loop", async () => {
    const runaway = `{"title":"${"Nombre ".repeat(200)}`;
    const { model, result } = run([reply(runaway), reply(JSON.stringify(valid))]);

    await expect(result).resolves.toEqual(valid);

    const repair = promptOf(model.doGenerateCalls[1]);
    expect(repair).toContain("do not repeat any word");
    expect(repair).not.toContain("aim for well under half the length");
  });

  it('keeps telemetry.repaired as "schema", not "truncation", for a degenerate-but-complete response', async () => {
    const violating = JSON.stringify({ title: "Nombre ".repeat(200), items: [] });
    const model = new MockLanguageModelV4({
      doGenerate: [reply(violating), reply(JSON.stringify(valid))],
    });
    const telemetry: GenerationTelemetry = {};

    await generate({
      chain: singleTestChain(model),
      schema,
      schemaName: "Thing",
      system: "SYSTEM",
      prompt: "ORIGINAL PROMPT",
      preserve: "KEEP THE ITEMS",
      telemetry,
    });

    expect(telemetry.repaired).toBe("schema");
  });

  it("omits the reasoning setting when the model is not reasoning-capable", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [reply(JSON.stringify(valid))] });

    await generate({
      chain: singleTestChain(model),
      schema,
      schemaName: "Thing",
      system: "SYSTEM",
      prompt: "ORIGINAL PROMPT",
    });

    expect(model.doGenerateCalls[0].reasoning).toBeUndefined();
  });

  /**
   * Cohere's structured-outputs endpoint rejects `minItems` (this schema's
   * `items` has `.min(1)`) — see lib/ai/cohere-schema.ts. `looseJsonSchema`
   * must strip it from what's sent to the provider without weakening what
   * `generate()` itself accepts as a valid response.
   */
  it("strips minItems from the JSON Schema sent to the provider when looseJsonSchema is set", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [reply(JSON.stringify(valid))] });

    await generate({
      // A per-candidate fact now, so the relaxation follows the model that
      // needs it rather than the call — which is what lets a chain mix Cohere
      // with a provider that takes the schema as written.
      chain: singleTestChain(model, { looseJsonSchema: true }),
      schema,
      schemaName: "Thing",
      system: "SYSTEM",
      prompt: "ORIGINAL PROMPT",
    });

    const sent = JSON.stringify(model.doGenerateCalls[0].responseFormat);
    expect(sent).not.toContain("minItems");
  });

  /**
   * `maxOutputTokensCap` (set from `ModelChoice.maxOutputTokens`, populated by
   * `maxOutputTokensFor` in lib/ai/provider-catalog.ts for Cohere) must lower
   * what's actually requested on the very first call — this is the fast path
   * that avoids a wasted round-trip for Cohere's known default model.
   */
  it("clamps the requested ceiling to maxOutputTokensCap before the first attempt", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [reply(JSON.stringify(valid))] });

    await generate({
      chain: singleTestChain(model, { maxOutputTokens: 8192 }),
      schema,
      schemaName: "Thing",
      system: "SYSTEM",
      prompt: "ORIGINAL PROMPT",
      maxOutputTokens: 16384,
    });

    expect(model.doGenerateCalls[0].maxOutputTokens).toBe(8192);
  });

  /**
   * The bug this guards against: CV generation on Cohere requested 16384
   * output tokens (`CV_MAX_OUTPUT_TOKENS`), Cohere's `command-a-03-2025`
   * rejects anything over 8192 outright, and the raw provider error reached
   * the user as "No pudimos generar el resultado. (too many tokens...)".
   * This is the fallback for a BYOK Cohere model id not covered by the
   * `maxOutputTokensCap` fast path above — `reportedCeiling` in
   * lib/ai/pipeline.ts parses the ceiling straight out of Cohere's own error
   * message and retries once, the same way it already does for OpenRouter's
   * "can only afford" balance rejection.
   */
  it("retries at the ceiling a Cohere-style error reports, when it wasn't already clamped", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls += 1;
        if (calls === 1) {
          throw new APICallError({
            message:
              "too many tokens: max tokens must be less than or equal to 8192, the maximum " +
              "output length for this model - received 16384.",
            url: "https://api.cohere.com/v2/chat",
            requestBodyValues: {},
          });
        }
        return reply(JSON.stringify(valid));
      },
    });

    const result = generate({
      chain: singleTestChain(model),
      schema,
      schemaName: "Thing",
      system: "SYSTEM",
      prompt: "ORIGINAL PROMPT",
      maxOutputTokens: 16384,
    });

    await expect(result).resolves.toEqual(valid);
    expect(calls).toBe(2);
    expect(model.doGenerateCalls[1].maxOutputTokens).toBe(8192);
  });

  /**
   * Groq phrases the same rejection with the numbers in backticks, which the
   * pattern used to walk straight past — leaving `groq/compound`, the one
   * Groq model whose per-minute token budget is large enough to write a CV,
   * unable to write one.
   */
  it("retries at a ceiling quoted in backticks, the way Groq reports it", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls += 1;
        if (calls === 1) {
          throw new APICallError({
            message:
              "`max_tokens` must be less than or equal to `8192`, the maximum value for " +
              "`max_tokens` is less than the `context_window` for this model",
            url: "https://api.groq.com/openai/v1/chat/completions",
            requestBodyValues: {},
          });
        }
        return reply(JSON.stringify(valid));
      },
    });

    const result = generate({
      chain: singleTestChain(model),
      schema,
      schemaName: "Thing",
      system: "SYSTEM",
      prompt: "ORIGINAL PROMPT",
      maxOutputTokens: 16384,
    });

    await expect(result).resolves.toEqual(valid);
    expect(model.doGenerateCalls[1].maxOutputTokens).toBe(8192);
  });

  /**
   * Groq bills the requested ceiling against a per-minute budget before
   * spending any of it, so on the free tier's 8000 a request that would have
   * written 800 tokens is refused for asking for room for 8192. The message
   * names no ceiling, only the arithmetic for one.
   */
  describe("a per-minute token budget smaller than the request", () => {
    const tooLarge = (limit: number, asked: number) =>
      new APICallError({
        message:
          `Request too large for model \`openai/gpt-oss-120b\` in organization \`org_x\` ` +
          `service tier \`on_demand\` on tokens per minute (TPM): Limit ${limit}, ` +
          `Requested ${asked}, please reduce your message size and try again.`,
        url: "https://api.groq.com/openai/v1/chat/completions",
        requestBodyValues: {},
      });

    function scripted(first: APICallError) {
      let calls = 0;
      return new MockLanguageModelV4({
        doGenerate: async () => {
          calls += 1;
          if (calls === 1) throw first;
          return reply(JSON.stringify(valid));
        },
      });
    }

    it("retries at a ceiling that sheds the excess, with room to spare", async () => {
      // Asked for 10301 against 8000: 2301 too many, off a ceiling of 8192.
      const model = scripted(tooLarge(8000, 10301));

      const result = generate({
        chain: singleTestChain(model),
        schema,
        schemaName: "Thing",
        system: "SYSTEM",
        prompt: "ORIGINAL PROMPT",
        maxOutputTokens: 8192,
      });

      await expect(result).resolves.toEqual(valid);
      expect(model.doGenerateCalls[1].maxOutputTokens).toBe(Math.floor((8192 - 2301) * 0.9));
    });

    /**
     * The CV's case: 16384 against the same 8000 budget leaves a ceiling too
     * small to write a CV into. A truncated document repaired into shape is
     * worse than being told the plan cannot do this, so the error stands.
     */
    it("does not retry into a ceiling too small to answer with", async () => {
      const model = scripted(tooLarge(8000, 21384));

      const result = generate({
        chain: singleTestChain(model),
        schema,
        schemaName: "Thing",
        system: "SYSTEM",
        prompt: "ORIGINAL PROMPT",
        maxOutputTokens: 16384,
      });

      await expect(result).rejects.toMatchObject({ status: 413 });
      expect(model.doGenerateCalls).toHaveLength(1);
    });
  });

  /**
   * OpenRouter prices the *requested* ceiling against the account's credit
   * before running anything, so an account with almost nothing left is held
   * to a few thousand output tokens on every call — and says so:
   *
   *   "This request requires more credits, or fewer max_tokens. You requested
   *    up to 16384 tokens, but can only afford 4722."
   *
   * 4722 is enough for a `JobAnalysis` and not for a `CVDocument`, and until
   * the floor below was per-generation it was accepted for both: the CV came
   * back cut off, the truncation repair re-issued it at the same 4722, and
   * the user waited half a minute to be told the model "did not respect the
   * expected format". See `LARGE_MIN_OUTPUT_TOKENS` in `lib/ai/pipeline.ts`.
   */
  describe("a balance too small for the requested ceiling", () => {
    const unaffordable = (asked: number, afford: number) =>
      new APICallError({
        message:
          `This request requires more credits, or fewer max_tokens. You requested up to ` +
          `${asked} tokens, but can only afford ${afford} tokens. To increase, visit ` +
          `https://openrouter.ai/settings/credits and upgrade to a paid account.`,
        url: "https://openrouter.ai/api/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 402,
        isRetryable: false,
      });

    /** A model that fails once with `first`, then answers `rest` in order. */
    function scripted(first: APICallError, ...rest: GenerateResult[]) {
      let calls = 0;
      return new MockLanguageModelV4({
        doGenerate: async () => {
          calls += 1;
          if (calls === 1) throw first;
          return rest[calls - 2] ?? reply(JSON.stringify(valid));
        },
      });
    }

    it("retries at the affordable ceiling when it still fits what is being written", async () => {
      const model = scripted(unaffordable(8192, 4722));

      const result = generate({
        chain: singleTestChain(model),
        schema,
        schemaName: "Thing",
        system: "SYSTEM",
        prompt: "ORIGINAL PROMPT",
      });

      await expect(result).resolves.toEqual(valid);
      expect(model.doGenerateCalls[1].maxOutputTokens).toBe(4722);
    });

    it("refuses rather than write a CV into a ceiling that cannot hold one", async () => {
      const model = scripted(unaffordable(16384, 4722));

      const result = generate({
        chain: singleTestChain(model),
        schema,
        schemaName: "CVDocument",
        system: "SYSTEM",
        prompt: "ORIGINAL PROMPT",
        maxOutputTokens: 16384,
        minOutputTokens: 8192,
      });

      // 402, not the generic 502: the ceiling belongs to the balance, and no
      // amount of changing models in Ajustes raises it.
      await expect(result).rejects.toMatchObject({ status: 402 });
      await expect(result).rejects.toThrow(/crédito/);
      expect(model.doGenerateCalls).toHaveLength(1);
    });

    /**
     * A CV request runs three generations. Without somewhere to record it, the
     * 402 is paid three times — which is exactly what the reported logs show.
     */
    it("remembers the ceiling for the next generation in the same request", async () => {
      // The ceiling belongs to the candidate, so the two generations share one:
      // this is what a CV request looks like, three calls down one chain.
      const first = scripted(unaffordable(8192, 4722));
      const chain = singleTestChain(first);

      await generate({
        chain,
        schema,
        schemaName: "Thing",
        system: "SYSTEM",
        prompt: "ORIGINAL PROMPT",
      });

      expect(chain.candidates[0].budget?.ceiling).toBe(4722);

      const second = new MockLanguageModelV4({ doGenerate: [reply(JSON.stringify(valid))] });
      chain.candidates[0].model = second;
      await generate({
        chain,
        schema,
        schemaName: "Thing",
        system: "SYSTEM",
        prompt: "ORIGINAL PROMPT",
      });

      expect(second.doGenerateCalls).toHaveLength(1);
      expect(second.doGenerateCalls[0].maxOutputTokens).toBe(4722);
    });

    it("refuses without a round-trip once the request is known not to fit", async () => {
      const model = new MockLanguageModelV4({ doGenerate: [reply(JSON.stringify(valid))] });

      const result = generate({
        chain: singleTestChain(model, {
          budget: { ceiling: 4722, message: unaffordable(16384, 4722).message },
        }),
        schema,
        schemaName: "CVDocument",
        system: "SYSTEM",
        prompt: "ORIGINAL PROMPT",
        maxOutputTokens: 16384,
        minOutputTokens: 8192,
      });

      await expect(result).rejects.toMatchObject({ status: 402 });
      expect(model.doGenerateCalls).toHaveLength(0);
    });

    /**
     * The message the user actually saw. A response cut off for want of room
     * reached them as "el modelo devolvió una respuesta que no respeta el
     * formato esperado", which sent them looking for a better model instead of
     * at the ceiling that had just been lowered under them.
     */
    it("says the answer was cut off, not that the format was wrong", async () => {
      const truncated = reply('{"title":"ok","items":[{"kind":"a","text":"unterminat');
      const model = scripted(unaffordable(8192, 4722), truncated, truncated);

      const result = generate({
        chain: singleTestChain(model),
        schema,
        schemaName: "Thing",
        system: "SYSTEM",
        prompt: "ORIGINAL PROMPT",
      });

      await expect(result).rejects.toThrow(/se cortó antes de terminar/);
      await expect(result).rejects.toThrow(/4722/);
    });
  });

  it("still repairs a genuine schema violation when looseJsonSchema is set", async () => {
    const violating = JSON.stringify({ title: "ok", items: [] });
    const model = new MockLanguageModelV4({
      doGenerate: [reply(violating), reply(JSON.stringify(valid))],
    });

    const result = generate({
      chain: singleTestChain(model),
      schema,
      schemaName: "Thing",
      system: "SYSTEM",
      prompt: "ORIGINAL PROMPT",
      preserve: "KEEP THE ITEMS",
    });

    await expect(result).resolves.toEqual(valid);
    expect(promptOf(model.doGenerateCalls[1])).toContain("did not satisfy the required schema");
  });

  describe("a caller's own maxGenerations and allowShortenRepair", () => {
    /** Same shape as `run` above, but exposing the two new options `extractDocument`/`splitNarrative` set. */
    function runWith(replies: GenerateResult[], extra: { maxGenerations?: number; allowShortenRepair?: boolean }) {
      const model = new MockLanguageModelV4({ doGenerate: replies });
      return {
        model,
        result: generate({
          chain: singleTestChain(model),
          schema,
          schemaName: "Thing",
          system: "SYSTEM",
          prompt: "ORIGINAL PROMPT",
          preserve: "KEEP THE ITEMS",
          ...extra,
        }),
      };
    }

    it("never asks for a shorter answer when disallowed, and spends no second call reaching that conclusion", async () => {
      // Cut off, but varied — not a repetition loop, which gets the
      // anti-repetition instruction regardless of `allowShortenRepair`
      // (asking for *different* content is not asking for less of it).
      const cutOffVaried = `{"title":"${Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ")}`;
      const { model, result } = runWith([reply(cutOffVaried), reply(JSON.stringify(valid))], { allowShortenRepair: false });

      await expect(result).rejects.toBeTruthy();
      // The second queued reply — a valid one — is never reached: proof the
      // gate skipped the repair call itself, not merely that it failed.
      expect(model.doGenerateCalls).toHaveLength(1);
    });

    it("still repairs a genuine schema violation (not a truncation) when shortening is disallowed", async () => {
      const violating = JSON.stringify({ title: "ok", items: [] });
      const { result } = runWith([reply(violating), reply(JSON.stringify(valid))], { allowShortenRepair: false });
      await expect(result).resolves.toEqual(valid);
    });

    it("does not even try the next candidate once the cap is spent, though it would otherwise succeed", async () => {
      const first = new MockLanguageModelV4({
        doGenerate: async () => {
          throw new APICallError({
            message: "Rate limit reached for model",
            url: "https://example.invalid/v1/chat/completions",
            requestBodyValues: {},
            statusCode: 429,
            isRetryable: false,
          });
        },
      });
      const second = new MockLanguageModelV4({ doGenerate: async () => reply(JSON.stringify(valid)) });
      const chain = testChain(
        testCandidate(first, { provider: "groq", modelId: "uno" }),
        testCandidate(second, { provider: "google", modelId: "dos" }),
      );

      const result = generate({ chain, schema, schemaName: "Thing", system: "SYSTEM", prompt: "ORIGINAL PROMPT", maxGenerations: 1 });

      // Without a cap this is exactly the "next provider on a 429" case
      // `pipeline-fallback.test.ts` covers, and it would succeed on `second`.
      await expect(result).rejects.toBeTruthy();
      expect(second.doGenerateCalls).toHaveLength(0);
    });

    it("spends the first attempt plus a repair as its one retry, and no more", async () => {
      const cutOffVaried = `{"title":"${Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ")}`;
      const { model, result } = runWith([reply(cutOffVaried), reply(cutOffVaried), reply(JSON.stringify(valid))], { maxGenerations: 2 });

      // The repair itself also comes back cut off, so there is nothing left
      // for a third call to try — the queued valid reply is never reached.
      await expect(result).rejects.toBeTruthy();
      expect(model.doGenerateCalls).toHaveLength(2);
    });

    it("still succeeds within the cap when the retry — a repair — is the one that works", async () => {
      const cutOffVaried = `{"title":"${Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ")}`;
      const { model, result } = runWith([reply(cutOffVaried), reply(JSON.stringify(valid))], { maxGenerations: 2 });
      await expect(result).resolves.toEqual(valid);
      expect(model.doGenerateCalls).toHaveLength(2);
    });

    it("still succeeds within the cap when the retry — the next candidate — is the one that works", async () => {
      const first = new MockLanguageModelV4({
        doGenerate: async () => {
          throw new APICallError({
            message: "Rate limit reached for model",
            url: "https://example.invalid/v1/chat/completions",
            requestBodyValues: {},
            statusCode: 429,
            isRetryable: false,
          });
        },
      });
      const second = new MockLanguageModelV4({ doGenerate: async () => reply(JSON.stringify(valid)) });
      const chain = testChain(
        testCandidate(first, { provider: "groq", modelId: "uno" }),
        testCandidate(second, { provider: "google", modelId: "dos" }),
      );

      const result = generate({ chain, schema, schemaName: "Thing", system: "SYSTEM", prompt: "ORIGINAL PROMPT", maxGenerations: 2 });

      await expect(result).resolves.toEqual(valid);
      expect(second.doGenerateCalls).toHaveLength(1);
    });
  });
});

/**
 * Provider failures the user can fix themselves have to arrive as such.
 *
 * A retired model id is the one BYOK failure with an obvious remedy — pick
 * another model — and it was reaching the user as a bare 502 with the
 * provider's English sentence pasted into it, because the mapping matched
 * only "not found" and Groq says "does not exist". See `MODEL_GONE` in
 * `lib/ai/pipeline.ts`.
 */
describe("asGenerationError", () => {
  const schema = z.object({ title: z.string() });

  /** Drives `generate` with a model that fails the way a provider does. */
  async function statusOf(message: string): Promise<number | undefined> {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({
          message,
          url: "https://example.invalid/v1/chat/completions",
          requestBodyValues: {},
          statusCode: 404,
          isRetryable: false,
        });
      },
    });

    try {
      await generate({
        chain: singleTestChain(model),
        schema,
        schemaName: "Thing",
        system: "SYSTEM",
        prompt: "ORIGINAL PROMPT",
      });
    } catch (error) {
      return (error as { status?: number }).status;
    }
    return undefined;
  }

  it("reports Groq's retired-model wording as a fixable 400", async () => {
    await expect(
      statusOf(
        "The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.",
      ),
    ).resolves.toBe(400);
  });

  it.each([
    ["OpenRouter", "No endpoints found for openai/gone-1. Model not found."],
    ["Google", "models/gemini-1.0-pro is not found for API version v1beta"],
    ["Mistral", "Invalid model: mistral-medium"],
    ["Cohere", "model 'command-nightly' has been deprecated"],
  ])("reports %s's wording the same way", async (_provider, message) => {
    await expect(statusOf(message)).resolves.toBe(400);
  });

  /**
   * Groq's free tier allows 8000 tokens a minute and the CV prompt is around
   * 10300, so this request never fits — the "esperá un momento y probá de
   * nuevo" of the 429 branch would be advice that cannot work.
   */
  it("separates a request too big for the plan from a passing rate limit", async () => {
    await expect(
      statusOf(
        "Request too large for model `openai/gpt-oss-120b` in organization `org_x` service " +
          "tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 10301, please " +
          "reduce your message size and try again.",
      ),
    ).resolves.toBe(413);

    await expect(statusOf("Rate limit reached for model. Try again in 4s.")).resolves.toBe(429);
  });

  /**
   * The failure a BYOK user is likeliest to hit and least able to guess from a
   * generic message: an OpenRouter account out of credit. It is not a rate
   * limit — waiting does not help — and it is not the model's fault, so the
   * remedy is credit or a cheaper model, and the message says both.
   */
  it("reports an exhausted balance as a 402 the user can act on", async () => {
    await expect(
      statusOf(
        "This request requires more credits, or fewer max_tokens. You requested up to 8192 " +
          "tokens, but can only afford 0 tokens.",
      ),
    ).resolves.toBe(402);

    await expect(statusOf("Insufficient credits for this request.")).resolves.toBe(402);
  });

  it("leaves an unrelated provider failure as a 502", async () => {
    await expect(statusOf("Internal server error while serving the request.")).resolves.toBe(
      502,
    );
  });

  it("still recognises a rejected key ahead of the model check", async () => {
    await expect(statusOf("Invalid API key provided for this model.")).resolves.toBe(401);
  });
});

/**
 * `describeValidationFailure` reads the AI SDK's error chain, not a flat one.
 * The shape `generateObject` actually throws is
 * `NoObjectGeneratedError` → `TypeValidationError` → `ZodError` — the issues
 * live two links down — and reading only one level reported every real schema
 * violation as "schema validation failed with no structured issues (unparsable
 * response)". That is verbatim what a production incident's logs showed for
 * `InterviewPrep` on every candidate, so the function is pinned here against
 * the exact chain the SDK produces (ai@7.0.58, `object2.parseCompleteOutput`
 * in `ai/dist/index.js` + `safeValidateTypes` in `@ai-sdk/provider-utils`).
 */
describe("describeValidationFailure", () => {
  const schema = z.object({ title: z.string().max(10) });

  const usage = {
    inputTokens: 1,
    inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    outputTokens: 1,
    outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
    totalTokens: 2,
  };
  const response = { id: "test", timestamp: new Date(0), modelId: "mock" };

  /** The chain `generateObject` throws for a response that parses but violates the schema. */
  function schemaViolation(value: unknown): {
    error: NoObjectGeneratedError;
    rejection: TypeValidationError;
  } {
    const result = schema.safeParse(value);
    if (result.success) throw new Error("test value was supposed to be invalid");
    const rejection = new TypeValidationError({ value, cause: result.error });
    const error = new NoObjectGeneratedError({
      message: "No object generated: response did not match schema.",
      cause: rejection,
      text: JSON.stringify(value),
      response,
      usage,
      finishReason: "stop",
    });
    return { error, rejection };
  }

  it("names the actual violations through the full NoObjectGeneratedError chain", () => {
    const description = describeValidationFailure(
      schemaViolation({ title: "a title that is far too long for its own good" }).error,
    );

    expect(description).toContain("schema violation");
    expect(description).toContain('"title"');
    expect(description).toContain("maximum=10");
    // The rejected value (potentially a whole CV) must not ride along.
    expect(description).not.toContain("far too long");
  });

  it("reports each violation with its own path", () => {
    const description = describeValidationFailure(
      schemaViolation({ title: 42 }).error,
    );

    expect(description).toContain("1 schema violation");
    expect(description).toContain('"title"');
  });

  it("still reads the ZodError when the TypeValidationError is stripped of its context", () => {
    // `TypeValidationError.wrap` keeps the cause; hand-deserialization or a
    // middleware re-throw may not. One level of cause-walking used to be the
    // difference between a named field and "no structured issues".
    const { rejection } = schemaViolation({ title: "way too long a title" });
    const wrapped = new TypeValidationError({
      value: rejection.value,
      cause: new TypeValidationError({ value: rejection.value, cause: rejection.cause }),
    });

    expect(describeValidationFailure(wrapped)).toContain('"title"');
  });

  it("calls a genuine JSON parse failure what it is, instead of 'unparsable schema validation'", () => {
    const parseFailure = new NoObjectGeneratedError({
      message: "No object generated: could not parse the response.",
      cause: new JSONParseError({
        text: '{"title": "unfin',
        cause: new SyntaxError("Unexpected end of JSON input"),
      }),
      text: '{"title": "unfin',
      response,
      usage,
      finishReason: "stop",
    });

    expect(describeValidationFailure(parseFailure)).toBe(
      "the response could not be parsed as JSON",
    );
  });

  it("names an aborted call instead of calling it an unparsable response", () => {
    const abort = new DOMException("This operation was aborted", "AbortError");
    const aborted = new NoObjectGeneratedError({
      message: "No object generated: could not parse the response.",
      cause: new JSONParseError({ text: "", cause: abort }),
      text: "",
      response,
      usage,
      finishReason: "error",
    });

    expect(describeValidationFailure(aborted)).toContain("aborted");
  });

  it("falls back to the error name, not the minified constructor name, when nothing structured is found", () => {
    // What the AI SDK errors look like in a minified production bundle: the
    // class identifier is mangled ("te", "t_"), but every AISDKError sets
    // `name` explicitly in its constructor, so the readable one survives.
    class Opaque extends Error {}
    const error = new Opaque("opaque failure");
    error.name = "AI_OpaqueError";

    expect(describeValidationFailure(error)).toBe(
      "AI_OpaqueError: schema validation failed with no structured issues (unparsable response)",
    );
  });
});
