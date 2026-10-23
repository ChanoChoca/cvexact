import { afterEach, describe, expect, it, vi } from "vitest";
import { listModels } from "@/lib/ai/model-list";
import { ProviderConfigError } from "@/lib/ai/provider-catalog";

/**
 * The Requesty reader is the only one in `lib/ai/model-list.ts` that decides
 * anything from the catalogue's own metadata rather than just transcribing it,
 * and one of those decisions cannot be reached by any response the provider
 * currently serves: every model Requesty flags `data_used_for_training` is
 * also missing `supports_output_json_schema`, so the filter drops all nine
 * before the annotation can fire. That overlap is a fact about today's
 * catalogue, not a guarantee, and the day it stops holding is exactly the day
 * the annotation has to work. A test is the only thing that can hold it.
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

function serving(models: unknown[]): void {
  vi.stubGlobal(
    "fetch",
    async () => new Response(JSON.stringify({ data: models }), { status: 200 }),
  );
}

describe("the Requesty reader", () => {
  it("hides models that cannot be held to a schema", async () => {
    // Every action in lib/ai/pipeline.ts runs through `generateObject`, so a
    // model that cannot produce a schema-shaped answer is not a choice, it is
    // a generation that will fail. 138 of Requesty's 676 are like that.
    serving([
      { id: "keeps/schema", supports_output_json_schema: true },
      { id: "drops/no-schema", supports_output_json_schema: false },
      { id: "drops/unstated" },
    ]);

    expect((await listModels("requesty", "k")).map((m) => m.id)).toEqual(["keeps/schema"]);
  });

  it("warns on a model that trains on the prompt, without hiding its name", async () => {
    // The datalist in Ajustes renders `label ?? id`, so a bare warning would
    // replace the model name the user opened the list to read.
    serving([
      { id: "x/trains", supports_output_json_schema: true, data_used_for_training: true },
      { id: "x/clean", supports_output_json_schema: true, data_used_for_training: false },
    ]);

    const models = await listModels("requesty", "k");
    const trains = models.find((m) => m.id === "x/trains");

    expect(trains?.label).toContain("x/trains");
    expect(trains?.label).toMatch(/entrena/i);
    expect(models.find((m) => m.id === "x/clean")?.label).toBeUndefined();
  });
});

/**
 * Together is the only provider here that answers `/v1/models` with a bare
 * array instead of `{data: […]}`. Read with the shared `rows(body, "data")`
 * helper it comes back empty — an empty catalogue rather than an error, which
 * is the kind of bug that looks like "the provider has no models" and gets
 * found by a person staring at a blank list.
 */
describe("the Together reader", () => {
  function servingArray(models: unknown[]): void {
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify(models), { status: 200 }),
    );
  }

  it("reads a bare array, not a wrapped one", async () => {
    servingArray([
      { id: "openai/gpt-oss-120b", type: "chat", display_name: "GPT OSS 120B" },
    ]);

    expect(await listModels("together", "k")).toEqual([
      { id: "openai/gpt-oss-120b", label: "GPT OSS 120B" },
    ]);
  });

  it("deja afuera lo que no es un modelo de chat", async () => {
    // El catálogo mezcla embeddings, rerankers, moderación e imagen, y nada de
    // eso se puede sujetar a un schema — que es lo único que este producto pide.
    servingArray([
      { id: "chat/si", type: "chat" },
      { id: "embed/no", type: "embedding" },
      { id: "rerank/no", type: "rerank" },
      { id: "imagen/no", type: "image" },
      { id: "sin-tipo/si" },
    ]);

    expect((await listModels("together", "k")).map((m) => m.id)).toEqual([
      "chat/si",
      "sin-tipo/si",
    ]);
  });

  it("deja afuera lo que no tiene contexto para escribir un CV", async () => {
    servingArray([
      { id: "grande/si", type: "chat", context_length: 131072 },
      { id: "chico/no", type: "chat", context_length: 512 },
    ]);

    expect((await listModels("together", "k")).map((m) => m.id)).toEqual(["grande/si"]);
  });
});

describe("the api.airforce reader", () => {

  const operationalChat = {
    supports_chat: true,
    status: "operational",
    supported_parameters: ["max_tokens", "response_format"],
  };

  it("drops what cannot write a CV, including the models reporting an outage", async () => {
    // The outage filter is the one no other provider makes possible: 38 of
    // api.airforce's models report `major_outage`, and the listing exists so
    // the user stops guessing which id still answers.
    serving([
      { id: "keeps/it", ...operationalChat },
      { id: "drops/down", ...operationalChat, status: "major_outage" },
      { id: "drops/degraded", ...operationalChat, status: "degraded" },
      { id: "drops/not-chat", ...operationalChat, supports_chat: false },
      { id: "drops/no-schema", ...operationalChat, supported_parameters: ["max_tokens"] },
    ]);

    expect((await listModels("airforce", "k")).map((m) => m.id)).toEqual(["keeps/it"]);
  });

  it("marks the models that cost credits without hiding their names", async () => {
    serving([
      { id: "free/one", ...operationalChat, tier: "free" },
      { id: "paid/one", ...operationalChat, tier: "paid" },
    ]);

    const models = await listModels("airforce", "k");

    expect(models.find((m) => m.id === "paid/one")?.label).toBe("paid/one — consume créditos");
    expect(models.find((m) => m.id === "free/one")?.label).toBeUndefined();
  });
});

/**
 * BazaarLink answers in OpenRouter's shape field for field, which is why the
 * two share a reader. This is what says so: the same response has to come back
 * the same way from both, or the sharing was a guess.
 */
describe("the shared aggregator reader", () => {
  const catalogue = [
    { id: "vendor/text", name: "Text Model", architecture: { output_modalities: ["text"] } },
    { id: "vendor/image", name: "Image Model", architecture: { output_modalities: ["image"] } },
    // Unannotated models are shown rather than hidden — see `modality()`.
    { id: "vendor/unannotated" },
  ];

  for (const provider of ["openrouter", "bazaarlink"] as const) {
    it(`reads ${provider}`, async () => {
      serving(catalogue);

      const models = await listModels(provider, "k");

      expect(models.map((m) => m.id)).toEqual(["vendor/text", "vendor/unannotated"]);
      expect(models[0].label).toBe("Text Model");
    });
  }
});

/**
 * LLM7 is the only provider here whose catalogue mixes what the free token can
 * reach with what it cannot, and it says which is which. Both flags have to be
 * applied or the datalist offers a 402 (a paid model) or a generation that will
 * fail (a model that cannot be held to a schema) — and at the time of writing
 * that is 38 of its 44 models.
 */
describe("the LLM7 reader", () => {
  it("offers only the models the free token reaches and can hold to a schema", async () => {
    serving([
      { id: "keeps/free-schema", usage_based_only: false, json_mode: true },
      { id: "drops/paid", usage_based_only: true, json_mode: true },
      { id: "drops/no-schema", usage_based_only: false, json_mode: false },
      // Unstated `json_mode` is a no, unlike the modality flags in the
      // aggregator reader: this filter guards a generation, not a display name.
      { id: "drops/unstated", usage_based_only: false },
    ]);

    expect((await listModels("llm7", "k")).map((m) => m.id)).toEqual(["keeps/free-schema"]);
  });
});

/**
 * Cloudflare's listing comes off its native REST API rather than the
 * OpenAI-compatible surface its generations go through — that surface answers a
 * GET to `/v1/models` with a 405. Two things follow, and both are what copying
 * one of the readers above would get wrong.
 */
describe("the Cloudflare reader", () => {
  function servingResult(models: unknown[]): void {
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ result: models, success: true }), { status: 200 }),
    );
  }

  it("reads Cloudflare's own envelope, and the slug rather than the row id", async () => {
    // `data` is OpenAI's key and `id` is a UUID no request ever takes; the
    // chat endpoint wants `name`. Reading either the way the other providers
    // are read yields an empty list or a list of UUIDs, and both look like a
    // working catalogue right up until a generation is attempted.
    servingResult([
      { id: "0d1b-uuid", name: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
      { id: "7f2c-uuid", name: "@cf/openai/gpt-oss-120b" },
    ]);

    expect((await listModels("cloudflare", "k", "0".repeat(32))).map((m) => m.id)).toEqual([
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      "@cf/openai/gpt-oss-120b",
    ]);
  });

  /**
   * The one provider that can be half-configured, so the one that has to say
   * which half is missing. Without this the URL would be built with `undefined`
   * in the account segment and Cloudflare would answer 404, which reaches the
   * user as the provider having rejected a key that is perfectly fine.
   */
  it("says which credential is missing instead of asking for a 404", async () => {
    servingResult([]);

    await expect(listModels("cloudflare", "k")).rejects.toBeInstanceOf(ProviderConfigError);
    await expect(listModels("cloudflare", "k")).rejects.toThrow(/Account ID/);
  });
});
