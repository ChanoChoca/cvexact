import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ID_LABEL,
  BYOK_PROVIDERS,
  DEFAULT_MODEL,

  isExperimental,
  isProviderId,
  maxOutputTokensFor,
  needsAccountId,
  needsRelaxedJsonSchema,
  PROVIDER_KEY_URL,
  PROVIDER_LABEL,
  PROVIDERS,
  SERVICE_ONLY_PROVIDERS,
  supportsReasoningEffort,
  type ProviderId,
} from "@/lib/ai/provider-catalog";

import {
  EXPERIMENTAL_WARNING,
  KIND_HEADLINE,
  PROVIDER_NOTE,
} from "@/app/(app)/ajustes/SettingsEditor";
import { GENERATION_ERROR_KINDS } from "@/lib/ai/error-kind";

/**
 * The settings page used to carry its own copy of this table, and it drifted:
 * it advertised `gemini-flash-latest` for months after the server had pinned
 * `gemini-3.5-flash`, so the placeholder in the "Modelo" field named a model
 * the server would never use. The copy is gone — the page reads the catalogue —
 * and what remains to guard is that a provider added to the catalogue does not
 * reach the page without the one thing still written there: its description.
 *
 * `Record<ProviderId, string>` makes the catalogue's own tables exhaustive at
 * compile time; these assertions cover what types cannot see.
 */
describe("provider catalogue", () => {
  it("describes every provider on the settings page", () => {
    for (const id of PROVIDERS) {
      expect(PROVIDER_NOTE[id], `missing note for ${id}`).toBeTruthy();
    }
    expect(Object.keys(PROVIDER_NOTE).sort()).toEqual([...PROVIDERS].sort());
  });

  /**
   * The settings page offers `BYOK_PROVIDERS`, not `PROVIDERS`, because the
   * catalogue now also holds the provider this deployment runs its *own* key
   * on. That one is prepaid and has no free tier, which is the one thing every
   * entry on the page is chosen for — so offering it to somebody who came to
   * Ajustes because they cannot pay is the failure this guards.
   *
   * Asserted on the sets rather than on the name `together`, so the next
   * service provider is covered by the test that already exists.
   */
  it("no ofrece en el formulario los proveedores que corren con nuestra key", () => {
    for (const id of BYOK_PROVIDERS) {
      expect(SERVICE_ONLY_PROVIDERS.has(id), `${id} está en las dos listas`).toBe(false);
    }
    expect([...BYOK_PROVIDERS, ...SERVICE_ONLY_PROVIDERS].sort()).toEqual([...PROVIDERS].sort());
  });

  it("gives every provider a model, a label and somewhere to get a key", () => {

    for (const id of PROVIDERS) {
      expect(DEFAULT_MODEL[id], `missing default model for ${id}`).toBeTruthy();
      expect(PROVIDER_LABEL[id], `missing label for ${id}`).toBeTruthy();
      expect(PROVIDER_KEY_URL[id]).toMatch(/^https:\/\//);
    }
  });

  it("pins Google rather than tracking a moving alias", () => {
    // The pin is deliberate: the alias rolled onto a thinking model whose
    // reasoning tokens competed with the CV's JSON for the output budget and
    // generations started coming back truncated. Changing this is a decision
    // that wants an eval run, not a drive-by edit.
    expect(DEFAULT_MODEL.google).not.toContain("latest");
  });

  /**
   * Same failure the note assertion above guards, one step further along: a
   * provider can be flagged experimental in the catalogue and reach the page
   * with an empty warning box, because `EXPERIMENTAL_WARNING` is `Partial` —
   * it has to be, since most providers have nothing to warn about — and a
   * `Partial` cannot be made exhaustive by the compiler.
   */
  it("says why, for every provider it calls experimental", () => {
    for (const id of PROVIDERS) {
      expect(Boolean(EXPERIMENTAL_WARNING[id]), `warning for ${id}`).toBe(isExperimental(id));
    }
  });

  /**
   * Pinned by name rather than counted, so that widening the list is a
   * deliberate edit here too. The bar is written on `EXPERIMENTAL_PROVIDERS`
   * in the catalogue: reselling third-party access whose provenance cannot be
   * verified, not a small free tier and not a mediocre model.
   */
  it("flags the three resellers and nothing else", () => {
    const experimental = PROVIDERS.filter(isExperimental);
    expect([...experimental].sort()).toEqual(["airforce", "bazaarlink", "llm7"]);
  });

  /**
   * Cloudflare resells nobody: it runs the models on its own hardware and the
   * operator is checkable. It is the case the bar exists to let *through*, and
   * pinning it is what keeps "experimental" from sliding into "small or
   * unfamiliar" — its free tier is one of the smallest here in raw numbers.
   */
  it("does not flag a first-party platform for having a small free tier", () => {
    expect(isExperimental("cloudflare")).toBe(false);
  });

  it("recognises exactly the catalogued ids", () => {
    for (const id of PROVIDERS) expect(isProviderId(id)).toBe(true);

    expect(isProviderId("openai")).toBe(false);
    expect(isProviderId("")).toBe(false);
    expect(isProviderId(undefined)).toBe(false);
  });

  /**
   * `@ai-sdk/openai-compatible` (Groq, OpenRouter) forwards the AI SDK's
   * `reasoning` setting straight through as `reasoning_effort`, which Groq's
   * API rejects outright on a model that doesn't support it. Whatever answer
   * this list gives for Groq's default has to be the true one, or every BYOK
   * generation on the default breaks — either with "reasoning_effort is not
   * supported with this model" for a false positive, or, for a false
   * negative, by letting a thinking model spend an unbounded share of the
   * output ceiling before it writes any JSON.
   *
   * The current default is a gpt-oss, which reasons whether or not it is
   * asked to and defaults to `medium` on Groq. Sending the `low` this app
   * uses is what keeps that spend bounded, so it belongs on the list.
   */
  it("marks Groq's default model as reasoning-capable", () => {
    expect(supportsReasoningEffort("groq", DEFAULT_MODEL.groq)).toBe(true);
  });

  it("recognises Groq's known reasoning models", () => {
    expect(supportsReasoningEffort("groq", "openai/gpt-oss-20b")).toBe(true);
    expect(supportsReasoningEffort("groq", "openai/gpt-oss-120b")).toBe(true);
    expect(supportsReasoningEffort("groq", "openai/gpt-oss-safeguard-20b")).toBe(true);
  });

  /**
   * Groq's `/models` advertises `qwen/qwen3.6-27b` with a `reasoning`
   * feature flag, and it still answers `reasoning_effort: "low"` with
   * "`reasoning_effort` must be one of `none` or `default`". The flag means
   * "this model thinks", not "this model takes a graduated effort", so the
   * list stays hand-maintained rather than derived from it.
   */
  it("keeps a model that only accepts none/default off the list", () => {
    expect(supportsReasoningEffort("groq", "qwen/qwen3.6-27b")).toBe(false);
  });

  it("treats every OpenRouter model as not reasoning-capable", () => {
    expect(supportsReasoningEffort("openrouter", DEFAULT_MODEL.openrouter)).toBe(false);
    expect(supportsReasoningEffort("openrouter", "openai/gpt-oss-120b")).toBe(false);
  });

  /**
   * Cerebras serves the same gpt-oss weights Groq does, but under bare ids
   * without the `openai/` vendor prefix. Listing Groq's ids here would be a
   * silent false negative — the lookup is an exact string match, so the
   * default would quietly stop asking for a bounded `low` and let a model
   * that reasons by default spend the output ceiling on thinking.
   */
  it("recognises Cerebras' reasoning models under their unprefixed ids", () => {
    expect(supportsReasoningEffort("cerebras", DEFAULT_MODEL.cerebras)).toBe(true);
    expect(supportsReasoningEffort("cerebras", "gpt-oss-20b")).toBe(true);
    expect(supportsReasoningEffort("cerebras", "openai/gpt-oss-120b")).toBe(false);
  });

  /**
   * NVIDIA is OpenRouter's situation: one key over a hundred-odd models from
   * every vendor, forwarding `reasoning` verbatim as `reasoning_effort`, with
   * no per-model capability check available here. A model earns its place on
   * the list by having been seen to accept a graduated effort — which the
   * current default now has (verified live on 2026-10-01), while the rest of
   * the catalogue, including the retired 120b, has not.
   */
  it("marks NVIDIA's default reasoning-capable, and only its default", () => {
    expect(DEFAULT_MODEL.nvidia).toBe("openai/gpt-oss-20b");
    expect(supportsReasoningEffort("nvidia", DEFAULT_MODEL.nvidia)).toBe(true);
    // Retired by NVIDIA with a hard end-of-life date (2026-09-03) long before
    // this list had an entry for it.
    expect(supportsReasoningEffort("nvidia", "openai/gpt-oss-120b")).toBe(false);
    expect(supportsReasoningEffort("nvidia", "nvidia/nemotron-3-super-120b-a12b")).toBe(false);
  });

  /**
   * Requesty and BazaarLink are aggregators over hundreds of third-party
   * models, same as OpenRouter and NVIDIA, so the same rule applies: nothing
   * is listed until it has been seen to accept a graduated effort. Worth
   * pinning for BazaarLink's default in particular — it reports
   * `reasoning.default_enabled`, and a model that thinks whether or not it is
   * asked to must at least not be *asked* to on top of that.
   */
  it("treats every aggregator model as not reasoning-capable", () => {
    expect(supportsReasoningEffort("requesty", DEFAULT_MODEL.requesty)).toBe(false);
    expect(supportsReasoningEffort("bazaarlink", DEFAULT_MODEL.bazaarlink)).toBe(false);
  });

  /**
   * The sharp case for the rule above, and the reason it is a rule rather than
   * a habit: api.airforce's catalogue advertises `reasoning_effort` in
   * `supported_parameters` for this exact model, so following the metadata
   * would put it on the list. Groq's catalogue makes the same claim about
   * `qwen/qwen3.6-27b`, which then rejects the `low` this app sends.
   */
  it("does not take an aggregator's word that its default reasons", () => {
    expect(supportsReasoningEffort("airforce", DEFAULT_MODEL.airforce)).toBe(false);
  });

  /**
   * `@ai-sdk/cohere` maps any `reasoning` setting to its own `thinking`
   * parameter unconditionally, and Cohere's API rejects `thinking` on every
   * model except `command-a-reasoning-08-2025` — hit on the default
   * `command-a-03-2025` as "`thinking` parameter is not supported with the
   * specified model". The default model must stay off this list, or every
   * BYOK generation on it breaks the same way.
   */
  it("does not mark Cohere's default model as reasoning-capable", () => {
    expect(supportsReasoningEffort("cohere", DEFAULT_MODEL.cohere)).toBe(false);
  });

  it("recognises Cohere's reasoning model", () => {
    expect(supportsReasoningEffort("cohere", "command-a-reasoning-08-2025")).toBe(true);
  });

  /**
   * Cohere's structured-outputs endpoint rejects minItems/maxItems,
   * minLength/maxLength and oneOf, which Zod emits for nearly every field in
   * these schemas. Cerebras rejects nearly the same set and additionally
   * wants `additionalProperties: false` on every object, which the same
   * transform sets. Google needs the oneOf→anyOf rename for a different
   * reason: `@ai-sdk/google` forwards `oneOf` (what `cvSectionSchema`'s
   * `z.discriminatedUnion()` compiles to) to Gemini unhandled, which made
   * Gemini return `sections[].items` as bare strings instead of objects. See
   * lib/ai/cohere-schema.ts.
   *
   * Together is the fourth and is not a reproduction of a documented failure:
   * its `json_schema` has no `strict` contract and its constrained decoding is
   * the kind that has been uneven about `oneOf`, so it is relaxed on the
   * conservative side of an open question. It is what the metered tiers run,
   * which is the reason to guess safe rather than cheap. An eval run on the
   * strict schema is what would take it back off this list.
   *
   * DeepSeek is the fifth, and the plainest case here: its `response_format`
   * only documents `json_object`, with no `json_schema` mode at all, and the
   * AI SDK's own provider page lists no model in this family as supporting
   * "Object Generation". Also one of the two metered-tier providers, for the
   * same reason as Together — guess safe, not cheap, until an eval says
   * otherwise.
   *
   * Every other provider's adapter tolerates the full schema.
   */
  it("flags only Cohere, Cerebras, Google, Together and DeepSeek as needing a relaxed JSON Schema", () => {
    const relaxed: ProviderId[] = ["cohere", "cerebras", "google", "together", "deepseek"];

    for (const id of PROVIDERS) {
      expect(needsRelaxedJsonSchema(id), id).toBe(relaxed.includes(id));
    }
  });

  /**
   * Cohere's `command-a` family rejects any `max_tokens` above 8192
   * outright ("max tokens must be less than or equal to 8192"), which the
   * CV generator's 16384-token budget exceeds — see `CV_MAX_OUTPUT_TOKENS`
   * in lib/ai/pipeline.ts. `generate()` there clamps to this cap before the
   * first attempt so the common case (Cohere's default model) never has to
   * fall back to the dynamic retry.
   */
  it("caps Cohere and Cloudflare's output tokens and leaves every other provider unclamped", () => {
    expect(maxOutputTokensFor("cohere")).toBe(8192);
    expect(maxOutputTokensFor("cloudflare")).toBe(8192);
    for (const id of PROVIDERS) {
      if (id === "cohere" || id === "cloudflare") continue;
      expect(maxOutputTokensFor(id)).toBeUndefined();
    }
  });

  /**
   * Cloudflare's cap is not Cohere's. Nothing rejects an oversized request —
   * `@cf/meta/llama-3.3-70b-instruct-fp8-fast` has a 24.000-token *context*
   * window that output shares with the prompt, so the CV's 16.384 would leave
   * too little for the profile and the job posting and the answer would come
   * back truncated rather than refused. Pinned to the model it was computed
   * for: changing that default without revisiting this number is the way the
   * cap silently stops matching the window it was derived from.
   */
  it("caps Cloudflare against the context window of the model it defaults to", () => {
    expect(DEFAULT_MODEL.cloudflare).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    expect(maxOutputTokensFor("cloudflare")).toBe(8192);
  });

  /**
   * The account id is half of Cloudflare's credentials, and the half the
   * compiler cannot enforce: `ACCOUNT_ID_LABEL` is `Partial`, so a provider
   * added later that also needs one gets no error, just a form that silently
   * cannot be filled in. What is pinned here is the pair — the flag and the
   * label the field is rendered with — and that nobody else asks for one.
   */
  it("asks for a second credential from Cloudflare alone, and labels it", () => {
    for (const id of PROVIDERS) {
      expect(needsAccountId(id), id).toBe(id === "cloudflare");
      expect(Boolean(ACCOUNT_ID_LABEL[id]), `label for ${id}`).toBe(needsAccountId(id));
    }
  });

  /**
   * Both newcomers forward `reasoning` verbatim as `reasoning_effort` through
   * `@ai-sdk/openai-compatible`, and neither has had a model observed accepting
   * a graduated effort — LLM7 for the aggregator reason (its catalogue is other
   * people's models under its own ids), Cloudflare because its default is a
   * Llama, which does not take the field at all. The rule on
   * `REASONING_CAPABLE_MODELS` is that a model earns its place by having been
   * seen to accept one, and neither has been.
   */

/**
 * Two defaults that are not preferences but reachability requirements, and the
 * headline table the settings page renders. Both defaults were pinned by the
 * same incident: NVIDIA retired `openai/gpt-oss-120b` with a hard end-of-life
 * date (410 Gone from 2026-09-03) and Mistral's free tier answers
 * `mistral-large-latest` with 403 `tier_not_allowed` — so a blank-model row,
 * which is most rows, failed every generation on a default nobody chose.
 */
describe("defaults y titulares que un incidente fijó", () => {
  it("no apunta Mistral a un modelo que su tier gratuito rechaza", () => {
    // `tier_not_allowed` is what a free key got for `mistral-large-latest`,
    // and the free tier is exactly what Ajustes offers Mistral for.
    expect(DEFAULT_MODEL.mistral).not.toContain("large");
    expect(DEFAULT_MODEL.mistral).toBe("open-mistral-nemo");
  });

  it("apunta NVIDIA al miembro de la familia que la API todavía sirve", () => {
    expect(DEFAULT_MODEL.nvidia).toBe("openai/gpt-oss-20b");
  });

  /**
   * `KIND_HEADLINE` is `Record<GenerationErrorKind, string>`, so the compiler
   * guarantees a key per kind; this holds it to words. An empty string would
   * compile, and would leave the settings row leading with nothing.
   */
  it("da un titular no vacío a cada kind", () => {
    for (const kind of GENERATION_ERROR_KINDS) {
      expect(KIND_HEADLINE[kind]?.trim(), kind).not.toBe("");
    }
  });
});

  it("treats Cloudflare and LLM7 models as not reasoning-capable", () => {
    expect(supportsReasoningEffort("cloudflare", DEFAULT_MODEL.cloudflare)).toBe(false);
    expect(supportsReasoningEffort("llm7", DEFAULT_MODEL.llm7)).toBe(false);
  });
});
