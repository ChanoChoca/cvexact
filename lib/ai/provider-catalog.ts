/**
 * The provider catalogue: which providers exist, what they are called, which
 * model each defaults to, and where the user gets a key.
 *
 * It lives apart from `./provider.ts` because that module is `server-only` —
 * it constructs provider clients and must never reach the browser bundle — yet
 * the settings page needs exactly this data to render the BYOK form. Keeping
 * the facts here is what stops the page from carrying its own copy, which is
 * how it came to advertise `gemini-flash-latest` long after the server had
 * pinned something else.
 *
 * Nothing here imports an SDK, so it is safe on either side.
 */

/**
 * Order matters: it is the order of the `<Select>` in Ajustes and, when the
 * user adds a fallback without changing it, the order the chain is tried in.
 * Cerebras sits second because it is the only free tier here whose per-minute
 * ceiling is high enough to generate a CV — Groq's 8000 tokens/min is not, as
 * its note on the settings page has to say out loud. Cloudflare follows it on
 * the same test: a daily allowance of 10.000 neurons buys several whole CVs and
 * recharges by itself, which is the shape of free tier this list exists to put
 * in front of somebody who cannot pay.
 *
 * The aggregators sit at the bottom, `llm7` among them, because the order here
 * is also the order somebody scrolls — and a reseller should not be the first
 * thing offered to a person who has not read the warning yet.
 *
 * `together` and `deepseek` are last and are not in that scroll at all: they
 * are the providers this deployment runs its *own* key on, and both are
 * prepaid, so they fail the test every other entry here passes — a free
 * allowance for somebody who cannot pay. Both are `ProviderId`s because the
 * metered tiers need a client built for them, and `SERVICE_ONLY_PROVIDERS`
 * below is what keeps them out of the form.
 */
export const PROVIDERS = [

  "google",
  "cerebras",
  "cloudflare",
  "openrouter",
  "groq",
  "mistral",
  "nvidia",
  "requesty",
  "bazaarlink",
  "airforce",
  "cohere",
  "llm7",
  "together",
  "deepseek",
] as const;

export type ProviderId = (typeof PROVIDERS)[number];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

/**
 * One entry of a provider's catalogue, as `./model-list.ts` reads it off the
 * provider and as the settings page renders it. It lives here for the reason
 * everything else in this file does: `./model-list.ts` is `server-only` and
 * the page that displays its result is not.
 */
export type ModelOption = {
  id: string;
  /** The provider's own human-readable name, when it gives one. */
  label?: string;
};

/**
 * Thrown for BYOK configuration problems the user can fix themselves (missing
 * key, model no longer offered by the provider). Lives here rather than in
 * `./provider.ts` to avoid that server-only module needing to be imported
 * just for this type. `./provider.ts` re-exports it so existing imports
 * don't need to change.
 */
export class ProviderConfigError extends Error {
  constructor(
    message: string,
    /**
     * The classification a generation failure of the same kind would carry
     * (401 rejected key, 402 no credit, 429 rate limit, …) — set only when
     * this came from the provider's own response, so callers like `/api/models`
     * can hand the client the same status `asGenerationError` would, instead
     * of flattening every cause to one generic code. Left `undefined` for a
     * problem this app detected itself (a missing field, an unreachable host),
     * which was never the provider's verdict to give.
     */
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * Sensible default per provider, used when the user does not name a model.
 *
 * Google's is pinned rather than tracking the `gemini-flash-latest` alias.
 * The alias moves under us: when it rolled onto a generation that thinks by
 * default, the reasoning tokens started competing with the CV's JSON for the
 * same output budget and generations began coming back truncated. A pin keeps
 * behaviour reproducible and `tests/eval/baseline.json` comparable; bumping it
 * becomes a deliberate change with an eval run attached.
 *
 * The cost of pinning is that a provider can retire the pin out from under
 * us. Groq does: `llama-3.3-70b-versatile` stopped being served and every
 * BYOK generation on the default died with "The model … does not exist or you
 * do not have access to it". Nothing here can prevent that — what it can do
 * is say so clearly, which is `asGenerationError` in `./pipeline.ts`, and
 * let the user see what their key actually serves, which is
 * `./model-list.ts` behind the settings page.
 */
export const DEFAULT_MODEL: Record<ProviderId, string> = {
  google: "gemini-3.5-flash",
  // Cerebras serves the gpt-oss family under bare ids, without the `openai/`
  // vendor prefix Groq and OpenRouter put on the same weights.
  cerebras: "gpt-oss-120b",
  // Cloudflare gates JSON Mode behind a list of nine models rather than
  // offering it catalogue-wide, and this is the only one on that list with the
  // prose to write a CV: everything else there is an 8B, a vision model or a
  // coder. Notably `@cf/openai/gpt-oss-120b` is *not* on it, despite being the
  // same weights four other providers here default to — it is the better and
  // cheaper model and would be the obvious pick, and picking it would mean
  // trusting an undocumented capability with every generation.
  //
  // The cost of the choice is the 24.000-token context window, which is what
  // `MAX_OUTPUT_TOKENS_CAP` below is about.
  cloudflare: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  groq: "openai/gpt-oss-120b",
  openrouter: "google/gemini-2.5-flash",
  /**
   * The account's own tier decides which Mistral models exist at all: a
   * free-tier key answers `mistral-large-latest` with 403 `tier_not_allowed`
   * ("This model is not available in your subscription tier", code 1910) and
   * does not even list it in `/v1/models`. `open-mistral-nemo` is served on
   * that tier (currently as `ministral-8b-2512`), accepts `json_object`, and
   * was the one model there to answer a run of live probes without a 429 —
   * the `small`/`medium` pair is rate-limited hard enough to fail a CV's
   * several back-to-back calls on a free key. Verified against a real
   * free-tier key on 2026-10-01; the tier, not the model, is what broke here.
   */
  mistral: "open-mistral-nemo",
  /**
   * NVIDIA retires models with a hard end-of-life date and no alias to hide
   * behind: `openai/gpt-oss-120b` answered 410 Gone from 2026-09-03 on
   * ("reached its end of life … no longer available"), which is exactly the
   * failure this pin used to cause for every blank-model row. The 20b of the
   * same family is currently served, takes `response_format: json_object` and
   * a graduated `reasoning_effort` — see `REASONING_CAPABLE_MODELS` below.
   * Verified live on 2026-10-01. When it dies, "Ver modelos disponibles" in
   * Ajustes is the way out, and the 410→400 classification in `./pipeline.ts`
   * is what tells the user so.
   */
  nvidia: "openai/gpt-oss-20b",
  // Not a preference so much as the only option. Of the twelve models
  // Requesty prices at zero, this is the one that supports `json_schema` —
  // seven of the others are NVIDIA's trial, reached through one more party
  // than the `nvidia` entry above and training on the prompts besides. It is
  // also the only free one that neither trains nor retains.
  requesty: "mistral/leanstral-1-5",
  // BazaarLink's one persistent free route. Watch this one: it reports
  // `reasoning.default_enabled`, which is the trap described above — a model
  // that thinks by default spends the CV's output budget on reasoning tokens
  // before it writes any JSON. `auto:free` is the fallback if it does.
  bazaarlink: "qwen/qwen3.7-flash:free",
  // One of exactly two models on api.airforce's free tier that accept
  // `response_format` — 48 of its models are free and chat-capable, and 46 of
  // them cannot be held to a schema. The other one is `gpt-oss-20b`.
  airforce: "gpt-oss-120b",
  cohere: "command-a-03-2025",
  // One of six models LLM7 serves without drawing on a balance — the ones its
  // catalogue reports as `usage_based_only: false`. Of those it has the widest
  // context by a distance and reports `json_mode`, which is the filter that
  // matters: every action here runs through `generateObject`.
  llm7: "DeepSeek-V4-Flash-0731",
  /**
   * The same weights `groq`, `nvidia` and `airforce` default to and `cerebras`
   * serves under a bare id, which is the whole reason it is the pin here: the
   * prompts in `./prompts/` have been run against this model on three other
   * providers already, so moving the metered tiers onto Together is a change of
   * vendor rather than a change of model as well.
   *
   * This is the *standard* model, not what a paid tier gets on the steps an
   * employer reads — see `SERVICE_PRO_MODEL` in `./provider.ts`.
   */
  together: "openai/gpt-oss-120b",
  /**
   * DeepSeek's own API, not a host reselling the weights — see the comment on
   * `together` above for why that distinction is here at all. `deepseek-v4-flash`
   * is the unversioned alias DeepSeek keeps pointed at its current flash
   * snapshot (`DeepSeek-V4-Flash-0731` as of this pin — the same family
   * `llm7` defaults to above); `deepseek-v4-pro` is the model
   * `SERVICE_PRO_MODEL` in `./provider.ts` pins to, at exactly 3x this one's
   * price on every axis DeepSeek publishes.
   */
  deepseek: "deepseek-v4-flash",
};

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  google: "Google Gemini",
  cerebras: "Cerebras",
  cloudflare: "Cloudflare Workers AI",
  groq: "Groq",
  openrouter: "OpenRouter",
  mistral: "Mistral",
  nvidia: "NVIDIA NIM",
  requesty: "Requesty",
  bazaarlink: "BazaarLink",
  airforce: "api.airforce",
  cohere: "Cohere",
  llm7: "LLM7.io",
  together: "Together AI",
  deepseek: "DeepSeek",
};

/** Where each provider issues keys, for the settings page. */
export const PROVIDER_KEY_URL: Record<ProviderId, string> = {
  google: "https://aistudio.google.com/apikey",
  cerebras: "https://cloud.cerebras.ai/platform/apikeys",
  cloudflare: "https://dash.cloudflare.com/profile/api-tokens",
  groq: "https://console.groq.com/keys",
  openrouter: "https://openrouter.ai/keys",
  mistral: "https://console.mistral.ai/api-keys/",
  nvidia: "https://build.nvidia.com/settings/api-keys",
  requesty: "https://app.requesty.ai/api-keys",
  // BazaarLink issues the key from the same page it signs you up on.
  bazaarlink: "https://bazaarlink.ai/free",
  // Its `panel.` subdomain only redirects to the root; this is where the keys are.
  airforce: "https://api.airforce/dashboard/",
  cohere: "https://dashboard.cohere.com/api-keys",
  // Hands out a token for an email address alone, with no console behind it.
  llm7: "https://token.llm7.io/",
  // Never rendered — Together is service-only, see `SERVICE_ONLY_PROVIDERS`.
  // Kept because the table is exhaustive by type and a hole here would have to
  // be an `as` cast somewhere else.
  together: "https://api.together.ai/settings/api-keys",
  // Never rendered either, same reason.
  deepseek: "https://platform.deepseek.com/api_keys",
};

/**
 * Providers that need a second, non-secret identifier alongside the key, and
 * what to call it on the settings page.
 *
 * Cloudflare is the only one so far: its OpenAI-compatible base URL is
 * `.../accounts/{account_id}/ai/v1`, so the account is part of the address
 * rather than of the credential. That could have been folded into the key field
 * as an `id:token` convention and was not, because the failure it produces —
 * pasting only the token — is a 404 from a URL the user never sees, which is
 * the least diagnosable error this form is capable of showing.
 *
 * A table rather than a boolean so the field can be labelled with the
 * provider's own word for it; `Partial`, so the absence of an entry is the
 * answer for the other eleven.
 */
export const ACCOUNT_ID_LABEL: Partial<Record<ProviderId, string>> = {
  cloudflare: "Account ID",
};

export function needsAccountId(provider: ProviderId): boolean {
  return provider in ACCOUNT_ID_LABEL;
}

/**
 * Providers the settings page has to warn about before a key is pasted into
 * them, over and above whatever their note says.
 *
 * The bar for landing here is written down deliberately, because a list like
 * this decays into an opinion the moment it stops having one: a provider is
 * experimental when it **resells access to other providers' models and the
 * provenance of that access cannot be verified**, or when the operator has no
 * track record to check. Not "the free tier is small", not "the models are
 * mediocre" — those go in the note. And a provider comes back *off* this list
 * when the same test passes, which is the part an unwritten criterion makes
 * impossible.
 *
 * All three entries are aggregators standing in front of somebody else's models,
 * and this app sends a person's name, contact details and entire employment
 * history through whichever one is picked. The warning is what makes choosing
 * one a decision rather than an accident. The wording lives next to
 * `PROVIDER_NOTE` in the settings page; the fact lives here, because this file
 * is what the page and the server both read.
 */
const EXPERIMENTAL_PROVIDERS = new Set<ProviderId>(["bazaarlink", "airforce", "llm7"]);

export function isExperimental(provider: ProviderId): boolean {
  return EXPERIMENTAL_PROVIDERS.has(provider);
}

/**
 * Providers this deployment runs its own key on, which are therefore *not*
 * offered in the BYOK form.
 *
 * The distinction is not about trust — it is about what the settings page is
 * for. That list answers one question, "where do I get a key that costs me
 * nothing", and every entry on it has a free allowance to point at. Together
 * has none: it is prepaid, so offering it there would put a provider in front
 * of somebody who came to Ajustes precisely because they cannot pay.
 *
 * It stays a `ProviderId` because `buildRaw` in `./provider.ts` is a switch
 * over that type and the metered tiers need a client built for it. Nothing
 * enforces this server-side, and nothing needs to: a hand-written
 * `x-cvp-chain` header naming `together` would run on the *user's* own key,
 * which costs this deployment nothing and works correctly.
 */
export const SERVICE_ONLY_PROVIDERS = new Set<ProviderId>(["together", "deepseek"]);

/**
 * The providers Ajustes offers, which is `PROVIDERS` minus the above.
 *
 * Derived rather than kept by hand so the next service provider cannot reach
 * the form by being added in one place and forgotten in the other —
 * `tests/provider-catalog.test.ts` asserts the two stay disjoint.
 */
export const BYOK_PROVIDERS: readonly ProviderId[] = PROVIDERS.filter(
  (provider) => !SERVICE_ONLY_PROVIDERS.has(provider),
);

/*
 * Providers evaluated for `PROVIDERS` above and deliberately left out, and why.
 *
 * This is a record of decisions taken, **not a list of banned providers**. A
 * free tier can grow, a model can stop training on what it is sent, and an API
 * can start authenticating. The point of writing the reason down is that
 * revisiting one of these becomes a deliberate act with something to check
 * against — the alternative is what actually happened, which is the same
 * endpoints being researched from scratch a second time because the first
 * answer lived only in a conversation.
 *
 * The bar to clear is the same one the list above is chosen by: a key the user
 * can get for free, an allowance that recharges on its own and does not expire,
 * and enough of it to generate a CV. Everything below fails at least one, and
 * the failure is named so it can be re-tested rather than re-argued.
 *
 * - **AionLabs** (`api.aionlabs.ai`). Five own-brand models, every one of them
 *   described by AionLabs as tuned for roleplaying and storytelling — "tension,
 *   crises, and conflict", "mature and darker themes". Wrong tool, and no
 *   general-purpose model to fall back to inside the account. Its free budget
 *   is ~20.000 tokens/day, less than `CV_MAX_OUTPUT_TOKENS` asks for in a
 *   single generation, and its API is not OpenAI-compatible.
 *
 * - **Kilo Code** (`api.kilo.ai`). Two independent reasons, either sufficient.
 *   Its free models answer with **no `Authorization` header at all** — a paid
 *   model on the same endpoint returns `PAID_MODEL_AUTH_REQUIRED`, so the free
 *   tier is anonymous by design. Generations here leave from the server —
 *   `./provider.ts` is `server-only` — so its ~200 requests/hour would meter
 *   against the deployment's IP and be shared by every user, while the key
 *   pasted into Ajustes did nothing and `resolveTier` still called it `byok`.
 *   That is the server-funded free tier this product removed on purpose,
 *   uncontrolled, and presenting to each user as their own key failing.
 *   Separately: all 18 of its `isFree` models are also `mayTrainOnYourPrompts`
 *   — the flag discriminates (23 of 367 models carry it), so the free tier is
 *   precisely the training tier, and there is no non-training free model to
 *   default to the way `DEFAULT_MODEL.requesty` does.
 *
 * - **Hugging Face** (`router.huggingface.co`). Excluded on size, not on trust,
 *   which makes it the likeliest of these to be revisited. It clears all three
 *   criteria — free token, $0,10 credited monthly, no expiry — but there are no
 *   free models behind it: of the 130 the router lists, none has a provider
 *   reporting `is_free`, so that $0,10 is the whole allowance. On the cheapest
 *   schema-capable row it buys roughly 20 to 45 CVs a month, against a
 *   Cerebras day of 1M tokens or several CVs a day on Cloudflare.
 *   If it is ever added, pin the inference provider into the model id
 *   (`openai/gpt-oss-120b:deepinfra`) rather than passing a bare one: the
 *   router's default `:fastest` policy can land on a provider that reports
 *   `supports_structured_output: false` (novita does, for that model), and the
 *   `:cheapest` and `:fastest` suffixes are moving targets for the same reason
 *   `DEFAULT_MODEL.google` is pinned instead of tracking an alias.
 */

/**
 * Which models accept the AI SDK's `reasoning` setting, for providers where
 * that support is per-model rather than catalogue-wide.
 *
 * Groq, OpenRouter, Cerebras and NVIDIA (`openai-compatible`-backed — see
 * `buildRaw` in `./provider.ts`) forward `reasoning` verbatim as the
 * request's `reasoning_effort` field, and Groq's API rejects that field
 * outright on any model that doesn't support it ("reasoning_effort is not
 * supported with this model"). OpenRouter fans out to hundreds of backend
 * models with inconsistent, fast-changing reasoning support and no reliable
 * per-model capability check available here, so none of them are listed as
 * safe yet. NVIDIA, Requesty, BazaarLink and api.airforce are the same shape
 * of problem for the same reason — one key over a catalogue of hundreds of
 * models from every vendor — so they are left empty too, on the rule below: a
 * model earns its place here by having been seen to accept a graduated
 * effort, not by being likely to. api.airforce is the sharpest case of that
 * rule, because it is the one that would tempt you to break it: its catalogue
 * advertises `reasoning_effort` in `supported_parameters` for the model that
 * is our default there. So does Groq's for `qwen/qwen3.6-27b`, which rejects
 * the `low` this app sends.
 *
 * Cerebras serves only the gpt-oss family and Gemma, and the gpt-oss models
 * are the same weights Groq's entry lists (under bare ids — see
 * `DEFAULT_MODEL`), which do take a graduated `reasoning_effort`.
 *
 * Cohere is a native adapter, not an `openai-compatible` one, but has the
 * same failure mode by a different route: `@ai-sdk/cohere` maps any
 * `reasoning` value other than `"none"` to its own `thinking` parameter
 * unconditionally, and Cohere's API rejects `thinking` on every model except
 * `command-a-reasoning-08-2025` ("`thinking` parameter is not supported with
 * the specified model" — hit on the default `command-a-03-2025`). Google and
 * Mistral are not listed here: nothing so far indicates they share this
 * per-model restriction, so they stay unconditionally reasoning-capable (see
 * `PER_MODEL_REASONING_PROVIDERS` in `./provider.ts`).
 *
 * Kept by hand rather than read off the provider's own capability flags,
 * because those flags answer a different question. Groq's `/models` lists
 * `qwen/qwen3.6-27b` with `supported_features: ["…", "reasoning"]`, and that
 * model still rejects the `low` this app sends: "`reasoning_effort` must be
 * one of `none` or `default`". A model belongs on this list only once it has
 * been seen to accept a graduated effort — see `REASONING` in
 * `./pipeline.ts` for which one.
 */
export const REASONING_CAPABLE_MODELS: Partial<Record<ProviderId, readonly string[]>> = {
  groq: ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "openai/gpt-oss-safeguard-20b"],
  cerebras: ["gpt-oss-20b", "gpt-oss-120b"],
  /**
   * NVIDIA serves the same `openai/gpt-oss-*` ids as Groq, and only the
   * default is listed — on the rule every entry here is kept by: a graduated
   * effort seen to be accepted, not inferred from the family. Verified against
   * the live API on 2026-10-01 (200 with `reasoning_effort: "low"`). It
   * matters here for the same reason it does on Groq: a gpt-oss reasons
   * whether or not it is asked to, and an unbounded share of the CV's output
   * ceiling spent thinking is how the JSON comes back truncated.
   */
  nvidia: ["openai/gpt-oss-20b"],
  cohere: ["command-a-reasoning-08-2025"],
  /**
   * The same gpt-oss weights listed for Groq and Cerebras above, under the
   * `openai/` vendor prefix Together serves them with. Listed on the rule this
   * table is kept by — a graduated effort seen to be accepted, not inferred —
   * because it is the identical model behind the identical `openai-compatible`
   * client, differing only in which host answers.
   *
   * It matters more here than anywhere else on this list: this is what the
   * metered tiers run, and `REASONING = "low"` in `./pipeline.ts` is the
   * mitigation that keeps a thinking model from spending the CV's output budget
   * on reasoning tokens and returning truncated JSON.
   */
  together: ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
};

export function supportsReasoningEffort(provider: ProviderId, modelId: string): boolean {
  return (REASONING_CAPABLE_MODELS[provider] ?? []).includes(modelId);
}

/**
 * Four providers need the JSON Schema this app sends relaxed before it

 * reaches them — see `./cohere-schema.ts` for the transform and why each
 * one needs it:
 *
 * - Cohere's structured-outputs endpoint rejects several JSON Schema
 *   keywords Zod emits for nearly every field in these schemas
 *   (minItems/maxItems, minLength/maxLength, oneOf).
 * - Cerebras' structured outputs reject nearly the same set — minItems and
 *   maxItems among them — and additionally require `additionalProperties:
 *   false` on every object under `strict`, which the same transform sets.
 *   Its other documented limits are not a concern here: the schema ceiling
 *   is 5000 characters and the largest this app sends, `cvDocumentSchema`,
 *   serialises to ~4.3k once relaxed (the `projects` section is ~0.5k of it;
 *   measured, so adding a section kind means measuring again).
 * - `@ai-sdk/google` forwards `oneOf` (what `cvSectionSchema`'s
 *   `z.discriminatedUnion()` compiles to) to Gemini unhandled, unlike
 *   `anyOf` — nested inside the CV's `sections` array, that made Gemini lose
 *   the per-`kind` object shape and return `items` as bare strings instead
 *   of objects.
 *
 * Together is the fourth, and is here on the conservative side of an unproven
 * question rather than on a reproduction. Its structured outputs take a
 * `response_format: {type: "json_schema", json_schema: {name, schema}}` without
 * OpenAI's `strict` contract, which is the same shape as the three above, and
 * its constrained decoding is the kind that has historically been uneven about
 * `oneOf` — what `cvSectionSchema`'s `z.discriminatedUnion()` compiles to, and
 * exactly the keyword that broke Gemini. Relaxing costs a few schema
 * constraints the prompts restate anyway; not relaxing risks the CV coming back
 * with `items` as bare strings. If an eval run on the strict schema comes back
 * clean, remove it — that is a decision with evidence, which is the only kind
 * this table should record.
 *
 * None is per-model: all four are the provider's API/converter behaviour
 * account-wide, so it's just a provider check.
 */
export function needsRelaxedJsonSchema(provider: ProviderId): boolean {
  return (
    provider === "cohere" ||
    provider === "google" ||
    provider === "cerebras" ||
    provider === "together" ||
    // DeepSeek's `response_format` accepts `json_object` only — there is no
    // `json_schema` mode, and the AI SDK's own provider page lists no model in
    // this family as supporting "Object Generation". Untested until an eval
    // run against the real API says otherwise; see
    // `CVP_EVAL_PROVIDER=deepseek` in `tests/eval/corpus.test.ts`.
    provider === "deepseek"
  );
}

/**
 * Hard output-token ceilings that a provider enforces server-side, as
 * opposed to `lib/ai/pipeline.ts`'s own budget constants which are just what
 * this app chooses to ask for. Cohere's `command-a` family rejects any
 * `max_tokens` above 8192 outright ("max tokens must be less than or equal
 * to 8192") — which the CV generator's 16384-token budget exceeds (see
 * `CV_MAX_OUTPUT_TOKENS` in `./pipeline.ts`, raised specifically to give
 * thinking models room for reasoning tokens, a concern Cohere's ceiling
 * doesn't share).
 *
 * This is deliberately provider-wide rather than a per-model table: BYOK
 * lets the user type any Cohere model id into settings, so a table keyed to
 * known ids can't be exhaustive. 8192 is a conservative floor — clamping a
 * CV request down to it doesn't lose anything, since 8192 already covers
 * every schema this app generates except the CV's own inflated budget (see
 * `MAX_OUTPUT_TOKENS` in `./pipeline.ts`). A Cohere model this table doesn't
 * know about, with a different real cap, is still handled correctly by the
 * dynamic retry in `./pipeline.ts`'s `reportedCeiling` — this table
 * only exists to skip the wasted round-trip for the common case.
 */
export const MAX_OUTPUT_TOKENS_CAP: Partial<Record<ProviderId, number>> = {
  cohere: 8192,
  /**
   * Cloudflare is here for a different reason than Cohere: nothing rejects the
   * request outright. `@cf/meta/llama-3.3-70b-instruct-fp8-fast` has a
   * 24.000-token *context* window, which output shares with the prompt — so
   * asking for the CV's 16.384 leaves ~7.600 for the profile, the job posting
   * and the schema together, and they do not fit. The generation does not fail
   * cleanly when they don't; it comes back truncated, which is the failure this
   * whole file keeps trying to avoid.
   */
  cloudflare: 8192,
};

export function maxOutputTokensFor(provider: ProviderId): number | undefined {
  return MAX_OUTPUT_TOKENS_CAP[provider];
}

/**
 * A floor under `lib/ai/pipeline.ts`'s own `ATTEMPT_TIMEOUT_MS` (25s), for a
 * provider whose ordinary, successful responses routinely run longer than
 * that assumes — measured against the real API, not a published SLA, because
 * none of these providers publish one.
 *
 * DeepSeek's `deepseek-v4-pro` is the one entry: `inferSkills` — a single
 * generation, `MAX_OUTPUT_TOKENS`-sized like most of this app's calls, not the
 * CV's own inflated budget — took 29 seconds end to end against a live key,
 * measured header-to-full-body rather than time-to-first-byte (DeepSeek
 * returns a 200 in under a second and then holds the connection while the
 * completion finishes, so timing only the response object arriving reports a
 * number nobody could act on). 25 seconds is not a bug being routed around;
 * it is the budget every other provider here has been happy inside of, and
 * this one number says `deepseek-v4-pro` is not one of them. 60 seconds
 * doubles the one measurement taken — a margin, not a proof — until an eval
 * run over a larger sample says otherwise. `deepseek-v4-flash` needed no
 * entry: the same corpus finished every call inside 25 seconds once
 * `deepseekFetch` in `./provider.ts` turned its default reasoning off.
 */
export const MIN_ATTEMPT_TIMEOUT_MS: Partial<Record<ProviderId, number>> = {
  deepseek: 60_000,
};

export function minAttemptTimeoutFor(provider: ProviderId): number | undefined {
  return MIN_ATTEMPT_TIMEOUT_MS[provider];
}
