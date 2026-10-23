import "server-only";

import { createGoogle } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createCohere } from "@ai-sdk/cohere";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { extractJsonMiddleware, wrapLanguageModel } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { Action, Tier } from "@/lib/quota";
import { candidateKey } from "./cooldown";
import type { GenerationErrorKind } from "./error-kind";
import { noRetryOnDailyQuota } from "./quota";

/**
 * `@ai-sdk/openai-compatible` warns on every Groq/OpenRouter call that its
 * schema was dropped (expected — `generate()` in `lib/ai/pipeline.ts`
 * compensates for that via `schemaHint()`). Silence the AI SDK's own
 * warning logger rather than let it spam the server console for a condition
 * we already handle.
 */
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

/**
 * Resolves a language model from the request's tier and, for BYOK, the key the
 * browser sent with it.
 *
 * The user's key is used to build a client and then dropped. It is never
 * written to the database, never logged, and `redactKeys` below scrubs it from
 * anything that reaches the client.
 */

/**
 * Which providers exist and how they are configured now lives in
 * ./provider-catalog.ts, so the settings page can read the same facts without
 * pulling this server-only module into the browser. Re-exported here because
 * this is where the rest of the server already imports them from.
 */
export {
  DEFAULT_MODEL,
  isProviderId,
  ProviderConfigError,
  PROVIDER_KEY_URL,
  PROVIDER_LABEL,
  PROVIDERS,
  type ProviderId,
} from "./provider-catalog";

import {
  DEFAULT_MODEL,
  isProviderId,
  maxOutputTokensFor,
  minAttemptTimeoutFor,
  needsRelaxedJsonSchema,
  ProviderConfigError,
  PROVIDER_LABEL,
  PROVIDERS,
  supportsReasoningEffort,
  type ProviderId,
} from "./provider-catalog";

/**
 * Providers whose support for the AI SDK's `reasoning` setting varies by
 * model rather than holding for their whole catalogue — see
 * `REASONING_CAPABLE_MODELS` in `./provider-catalog.ts` for exactly which
 * models. Every `openai-compatible`-backed provider here forwards `reasoning`
 * straight through as `reasoning_effort`, which their APIs reject per-model;
 * Cohere maps it to its own `thinking` parameter, which only one of its models
 * accepts. Every other provider here is assumed reasoning-capable across the
 * board.
 */
const PER_MODEL_REASONING_PROVIDERS = new Set<ProviderId>([
  "groq",
  "openrouter",
  "cerebras",
  "cloudflare",
  "nvidia",
  "requesty",
  "bazaarlink",
  "airforce",
  "cohere",
  "llm7",
  /**
   * Same reason as Groq and Cerebras: `openai-compatible`-backed, so
   * `reasoning` goes out as `reasoning_effort` and is rejected per-model. The
   * gpt-oss pair this deployment runs is what
   * `REASONING_CAPABLE_MODELS.together` lists; anything else typed into
   * `SERVICE_MODEL` is asked without an effort until it is proven to take one.
   */
  "together",
  /**
   * DeepSeek does not take `reasoning_effort` at all — its lever is a
   * `thinking` object (`{type: "enabled" | "disabled"}`), a different shape
   * this app's generic `reasoning` setting was never going to produce. Listing
   * it here (and leaving it out of `REASONING_CAPABLE_MODELS`) just stops the
   * wrong field from being sent; the actual fix is `deepseekFetch` below,
   * which turns `thinking` off directly. Confirmed by hand against the real
   * API: `deepseek-v4-flash` reasons by default and spent 8 of a 10-token
   * budget on `reasoning_content` before this was added, which on a CV's
   * ~8000-token budget is exactly the failure `REASONING` exists to prevent
   * for OpenAI-shaped thinking models — DeepSeek's is just a different knob.
   */
  "deepseek",
]);

/**
 * A ceiling the provider forced on this request, remembered across the
 * generations that share it.
 *
 * OpenRouter refuses a `maxOutputTokens` its balance cannot pay for and names
 * what it can afford instead, which `lib/ai/pipeline.ts` can only learn by
 * spending a failed round-trip. A CV request runs three generations, so with
 * nowhere to put the answer it is learnt three times — and the expensive one
 * discovers only at the end that the budget was never going to hold a CV.
 *
 * Mutable, and created fresh per `resolveModel` call — which is once per
 * request, from `openRequest` in `lib/api/context.ts` — so it cannot outlive
 * the key it describes.
 */
export type TokenBudget = {
  /** Largest `maxOutputTokens` the provider has said it will accept. */
  ceiling?: number;
  /** The provider's own words, so a later refusal can give the real reason. */
  message?: string;
};

/**
 * One row of the user's provider list, as `byokChain` in
 * `lib/api/context.ts` decodes it off the request.
 *
 * Named rather than spelled out at each of the three places that take it: the
 * shape was already duplicated between `resolveModel` and `candidatesFor`, and
 * `accountId` would have been the field that got added to two of the three.
 */
export type ByokEntry = {
  provider: ProviderId;
  apiKey: string;
  model?: string;
  /** Only for the providers in `ACCOUNT_ID_LABEL`; not a secret. */
  accountId?: string;
};

export type ModelChoice = {
  model: LanguageModel;
  /** For logging and the UI. Never includes the key. */
  describe: string;
  /**
   * Identity for the cross-request cooldown in `./cooldown.ts`. A digest of the
   * key, not the key: this outlives the request, and the credential must not.
   */
  cooldownKey: string;
  /**
   * The two identifiers `describe` renders for a human, kept separately so they
   * can be stored with the application. `tests/eval/score.ts` scores a real
   * export, and a corpus generated across several providers reports one average
   * that belongs to none of them.
   */
  provider: ProviderId;
  modelId: string;
  /** Whether `lib/ai/pipeline.ts` may send the `reasoning` setting for this model. */
  reasoningCapable: boolean;
  /** Whether `lib/ai/pipeline.ts` must relax the JSON Schema sent to this provider. */
  looseJsonSchema: boolean;
  /** Hard output-token ceiling `lib/ai/pipeline.ts` must clamp requests to, if the provider has one. */
  maxOutputTokens?: number;
  /**
   * Floor under `lib/ai/pipeline.ts`'s own `ATTEMPT_TIMEOUT_MS`, for a
   * provider whose ordinary responses run longer than that budget assumes.
   * See `minAttemptTimeoutFor` in `./provider-catalog.ts`.
   */
  minAttemptTimeoutMs?: number;
  /**
   * Shared scratch space for a ceiling discovered mid-request; see
   * `TokenBudget`. Optional so a test stub does not have to build one.
   */
  budget?: TokenBudget;
};

/**
 * The ordered list of models one request may use, and what has happened to it.
 *
 * A single `ModelChoice` was the unit here until a provider running out of
 * quota mid-request had nowhere to go. Five of the failures `asGenerationError`
 * in `./pipeline.ts` classifies — 429, 402, 413, 401, 400 — already told the
 * user to go and pick a different provider or model in Ajustes; a chain is that
 * same remedy, applied without making them do it.
 *
 * Each candidate keeps its *own* `looseJsonSchema`, `reasoningCapable`,
 * `maxOutputTokens` and `budget`, which is the reason the fallback lives here
 * and not in an `ai` middleware wrapping one model. `looseJsonSchema` decides
 * the Zod schema handed to `generateObject`, upstream of the model: a Cohere
 * standby needs a relaxed schema and an 8192 ceiling, and a wrapper only ever
 * sees the request after both have been settled by whoever came first.
 */
/**
 * One candidate giving up and handing the work to the next.
 *
 * `from` and `to` are for reading — they are `describe`, which never contains a
 * key. The provider and model id beside them identify the candidate that
 * *failed* as a settings row does, so Ajustes can put "sin crédito" against the
 * entry it belongs to instead of asking the browser to reverse-engineer it from
 * a display string.
 */
export type SwitchEvent = {
  from: string;
  to: string;
  status: number;
  message: string;
  provider: ProviderId;
  modelId: string;
  /**
   * The classification `asGenerationError` assigned — see `./error-kind.ts`.
   * Carried alongside `status` so the settings page can name the failure
   * without inferring meaning from an HTTP code two different ones can share
   * (a 400 is both a retired model and a model outside the user's plan).
   */
  kind: GenerationErrorKind;
};

export type ModelChain = {
  /** In preference order. Never empty. */
  candidates: ModelChoice[];
  /**
   * When this request stops being worth continuing, as an epoch millisecond.
   *
   * A per-attempt timeout bounds one candidate; it does not bound a request,
   * because a CV runs several generations and each of them may walk several
   * candidates. Three slow candidates on the analysis and three more on the CV
   * is nine minutes of a person watching a spinner, every step of which looked
   * locally reasonable.
   *
   * Read by `generate` in `./pipeline.ts`, which shortens each attempt to what
   * is left and refuses to start one there is no longer room for — the same
   * bargain as the ceiling check beside it: never pay a round-trip for an
   * answer that cannot arrive in time to be used.
   */
  deadlineAt: number;
  /**
   * The HTTP request's own signal, so a user who navigates away or presses
   * Cancel stops the work rather than paying for it in the background.
   *
   * Carried here rather than passed to each step because it belongs to the
   * request, exactly as `deadlineAt` and `failed` do — and because the
   * alternative is an extra parameter on all fourteen generators, thirteen of
   * which would only be forwarding it.
   *
   * `./pipeline.ts` distinguishes this firing from its own attempt budget: one
   * means the answer is no longer wanted and the chain must stop, the other
   * means this candidate is too slow and the next one should be asked.
   */
  signal?: AbortSignal;
  /**
   * Told whenever the chain moves on, as it happens.
   *
   * `switches` below is the same information collected for the response, which
   * is the right shape for a route that answers once. A streaming route needs
   * it while the user is still waiting — an unexplained sixty seconds and a
   * sixty seconds that said "Groq no respondió, probando con Google" are the
   * same delay and a different experience.
   */
  onSwitch?: (event: SwitchEvent) => void;
  /** The candidate that ran last. Starts as the first, so callers always have one. */
  used: ModelChoice;
  /**
   * `cooldownKey`s already discarded during this request, so the generations
   * that follow in it do not each repeat the same failed call. Request-scoped
   * by design; `./cooldown.ts` is what carries the same lesson between them.
   */
  failed: Set<string>;
  /** Every switch that happened, for `meta` on the response and for the log. */
  switches: SwitchEvent[];
  /**
   * Why the last candidate was discarded. Once every candidate is in `failed`,
   * this is what the next generation in the request fails with — reported
   * without spending another call, on the same reasoning as the ceiling check
   * in `./pipeline.ts`: an answer already paid for is not worth buying twice.
   */
  lastError?: unknown;
};

/**
 * Forces `thinking: {type: "disabled"}` onto every DeepSeek request.
 *
 * `deepseek-v4-flash` reasons by default and there is no `reasoning_effort`
 * lever for it — see `PER_MODEL_REASONING_PROVIDERS` above. `thinking` is not
 * a field the AI SDK's `generateObject`/`generateText` know how to set (it is
 * not `reasoning_effort`, `reasoningEffort`, or anything in
 * `providerOptions` this SDK version forwards for an `openai-compatible`
 * model), so the only place left to set it is the request body itself, after
 * the SDK has already built it and before it reaches the network. Silently
 * skips any request `createOpenAICompatible` sends with a non-JSON body
 * (there are none today — chat completions always serialise to JSON — but
 * failing open here is a broken CV generation, not a security question).
 */
const deepseekFetch: typeof fetch = async (input, init) => {
  if (typeof init?.body === "string") {
    try {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      body.thinking = { type: "disabled" };
      return fetch(input, { ...init, body: JSON.stringify(body) });
    } catch {
      // Not JSON — forward untouched rather than guess.
    }
  }
  return fetch(input, init);
};

/**
 * Builds the provider's own client, without the JSON-fence middleware `build`
 * wraps it in. Exported because that wrapper is opaque — the structured-output
 * flag a provider is configured with lives on the raw model instance and is
 * invisible through it — and the model-chain test asserts exactly that flag.
 */
export function buildRaw(
  provider: ProviderId,
  apiKey: string,
  modelId: string,
  accountId?: string,
): Exclude<LanguageModel, string> {
  switch (provider) {
    case "google":
      return createGoogle({ apiKey, fetch: noRetryOnDailyQuota })(modelId);
    /**
     * The one provider whose account is part of the address rather than of the
     * credential — see `ACCOUNT_ID_LABEL` in `./provider-catalog.ts`. Checked
     * here rather than trusted, because without it the template literal below
     * would build `.../accounts/undefined/ai/v1` and the user would be told
     * their key was rejected by a URL they cannot see.
     *
     * The interpolation is safe for the same reason the hardcoded base URLs
     * around it are: `buildRaw` is only ever reached through `isProviderId`,
     * and the value is confined to one path segment by the `ACCOUNT_ID` shape
     * check.
     */
    case "cloudflare": {
      const account = accountId?.trim() ?? "";
      if (!ACCOUNT_ID.test(account)) {
        throw new ProviderConfigError(
          "Cloudflare necesita el Account ID además de la API key. Lo encontrás en el " +
            "panel de Cloudflare, en Workers & Pages.",
        );
      }
      return createOpenAICompatible({
        name: "cloudflare",
        baseURL: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`,
        apiKey,
      })(modelId);
    }
    case "groq":
      return createOpenAICompatible({
        name: "groq",
        baseURL: "https://api.groq.com/openai/v1",
        apiKey,
      })(modelId);
    case "openrouter":
      return createOpenAICompatible({
        name: "openrouter",
        baseURL: "https://openrouter.ai/api/v1",
        apiKey,
      })(modelId);
    case "cerebras":
      return createOpenAICompatible({
        name: "cerebras",
        baseURL: "https://api.cerebras.ai/v1",
        apiKey,
      })(modelId);
    case "nvidia":
      return createOpenAICompatible({
        name: "nvidia",
        baseURL: "https://integrate.api.nvidia.com/v1",
        apiKey,
      })(modelId);
    case "requesty":
      /**
       * The one aggregator here whose router takes a JSON Schema in
       * `response_format` and constrained-decodes on it. Without this flag the
       * request goes out as bare `json_object` mode — no schema over the wire —
       * and the model only meets the ceilings as prose inside `schemaHint`.
       * Its default (`mistral/leanstral-1-5`, the only free model advertising
       * `json_schema`) broke the CV's 8-bullet cap in 6 of 10 live runs that
       * way, and the ones `clipToLimits` could not save surfaced as "No object
       * generated: response did not match schema". With the schema forwarded,
       * the router holds the output to the ceilings at decoding time: asked
       * for 10 bullets under an 8-item cap, it returned 8. Verified live
       * against the router with this app's own Zod-emitted keywords
       * (`minItems`, `maxItems`, `minLength`, `additionalProperties`) — all
       * accepted, so `needsRelaxedJsonSchema` deliberately stays false.
       *
       * The model list in `./model-list.ts` already filters Requesty's
       * catalogue to models reporting `supports_output_json_schema`, so every
       * model this flag can reach has been advertised as taking the schema.
       */
      return createOpenAICompatible({
        name: "requesty",
        baseURL: "https://router.requesty.ai/v1",
        apiKey,
        supportsStructuredOutputs: true,
      })(modelId);
    case "bazaarlink":
      return createOpenAICompatible({
        name: "bazaarlink",
        baseURL: "https://api.bazaarlink.ai/v1",
        apiKey,
      })(modelId);
    case "airforce":
      return createOpenAICompatible({
        name: "airforce",
        baseURL: "https://api.airforce/v1",
        apiKey,
      })(modelId);
    case "llm7":
      return createOpenAICompatible({
        name: "llm7",
        baseURL: "https://api.llm7.io/v1",
        apiKey,
      })(modelId);
    /**
     * The provider the metered tiers run on. `api.together.ai` rather than the
     * older `api.together.xyz`: both answer, only the first is the one the
     * documentation names, and a base URL that is merely still working is the
     * kind of thing that stops.
     */
    case "together":
      return createOpenAICompatible({
        name: "together",
        baseURL: "https://api.together.ai/v1",
        apiKey,
      })(modelId);
    /**
     * DeepSeek's own API, OpenAI-compatible at this base URL per its own
     * quick-start docs. Not the dedicated `@ai-sdk/deepseek` package: every
     * other OpenAI-compatible host here goes through this same generic
     * wrapper, and pulling in a per-vendor SDK for one more REST API would be
     * a second way to do the same thing rather than a better one.
     */
    case "deepseek":
      return createOpenAICompatible({
        name: "deepseek",
        baseURL: "https://api.deepseek.com/v1",
        apiKey,
        fetch: deepseekFetch,
      })(modelId);

    case "mistral":
      return createMistral({ apiKey })(modelId);
    case "cohere":
      return createCohere({ apiKey })(modelId);
  }
}

/**
 * A Cloudflare account id: 32 lowercase hex characters. Matched rather than
 * merely checked for emptiness so that nothing a user pastes can leave the one
 * path segment it is interpolated into — and, more usefully day to day, so that
 * pasting the API token into the Account ID field is caught here with a
 * sentence instead of at Cloudflare with a 404.
 */
const ACCOUNT_ID = /^[0-9a-f]{32}$/i;

/**
 * Providers without native structured-output support (e.g. Groq's
 * `json_object` mode on models that don't support `structuredOutputs`) still
 * often wrap their JSON in a markdown code fence, which breaks parsing before
 * schema validation runs. Stripping any such fence here covers every call
 * made with the model — generation and the schema-repair retry alike — and is
 * a no-op for providers that never fence their output.
 */
function build(
  provider: ProviderId,
  apiKey: string,
  modelId: string,
  accountId?: string,
): LanguageModel {
  return wrapLanguageModel({
    model: buildRaw(provider, apiKey, modelId, accountId),
    middleware: extractJsonMiddleware(),
  });
}

/**
 * Where a better model is worth what it costs.
 *
 * Not "everything the employer reads" — that was the first cut, and it put the
 * large model on `email`, `interview` and `video`, which are the three longest
 * outputs here and the three that gain least from it. A cover email is six
 * sentences of ordinary prose; a prep sheet is questions and answers. Paying
 * eight to fifteen times per token for those doubled the cost of a paid
 * application and changed nothing anyone could point at.
 *
 * What is left is where the difference is legible: the CV, which is the product
 * and the one document that has to survive a recruiter's twenty seconds; the
 * form answers, which a person reads next to it; and the import, which decides
 * the quality of everything generated afterwards from the profile it produces.
 *
 * `intake` and `metrics` were never here. Asking someone their name and filing
 * the answer is not a reasoning problem.
 */
const QUALITY_ACTIONS = new Set<Action>(["cv", "answers", "import"]);

/** The tiers that have paid for the better model. */
const PAID_TIERS = new Set<Tier>(["pro", "credits"]);

/**
 * One candidate, with every per-model fact `./pipeline.ts` needs settled here
 * rather than at the call site — the whole point of a chain is that candidate
 * two is not asked in the shape that suited candidate one.
 */
function candidate(input: {
  provider: ProviderId;
  apiKey: string;
  modelId: string;
  /** Only for the providers in `ACCOUNT_ID_LABEL`; ignored by every other one. */
  accountId?: string;
  /** Appended to `describe`; the only thing that differs between BYOK and ours. */
  note?: string;
}): ModelChoice {
  const { provider, apiKey, modelId } = input;
  return {
    model: build(provider, apiKey, modelId, input.accountId),
    describe: `${PROVIDER_LABEL[provider]} · ${modelId}${input.note ? ` (${input.note})` : ""}`,
    cooldownKey: candidateKey({ provider, modelId, apiKey }),
    provider,
    modelId,
    reasoningCapable: PER_MODEL_REASONING_PROVIDERS.has(provider)
      ? supportsReasoningEffort(provider, modelId)
      : true,
    looseJsonSchema: needsRelaxedJsonSchema(provider),
    maxOutputTokens: maxOutputTokensFor(provider),
    minAttemptTimeoutMs: minAttemptTimeoutFor(provider),
    budget: {},
  };
}

const fallbackEntrySchema = z.object({
  provider: z.enum(PROVIDERS),
  apiKey: z.string().min(1),
  model: z.string().trim().min(1).optional(),
});

/**
 * The service's own standbys, for when our Gemini key is the one that runs out.
 *
 * A JSON array rather than a delimited list because model ids contain both `/`
 * and `:` (`google/gemini-2.5-flash`, and OpenRouter's `:free` suffix), which
 * leaves no separator that is safe to split on:
 *
 *   AI_FALLBACKS='[{"provider":"groq","apiKey":"gsk_…","model":"openai/gpt-oss-120b"}]'
 *
 * Repeating `provider: "google"` with a different key is how you rotate keys
 * against a daily limit; naming another provider is how you survive Google
 * being down. Both are the same list.
 *
 * A malformed entry is dropped with a log rather than thrown: this is read at
 * module load, and a typo in an optional resilience feature must not be the
 * reason the app fails to boot.
 */
function parseFallbacks(raw: string | undefined): Array<z.infer<typeof fallbackEntrySchema>> {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[provider] AI_FALLBACKS is not valid JSON; ignoring it.");
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.error("[provider] AI_FALLBACKS must be a JSON array; ignoring it.");
    return [];
  }
  return parsed.flatMap((entry, i) => {
    const result = fallbackEntrySchema.safeParse(entry);
    if (result.success) return [result.data];
    // The entry itself is never logged — it holds a key.
    console.error(`[provider] AI_FALLBACKS entry ${i} is invalid; ignoring it.`);
    return [];
  });
}

/**
 * Read once. The value cannot change without a restart, and parsing it per
 * request would re-log the same complaint about the same typo forever.
 */
let fallbackCache: ReturnType<typeof parseFallbacks> | undefined;

function serviceFallbacks() {
  fallbackCache ??= parseFallbacks(process.env.AI_FALLBACKS);
  return fallbackCache;
}

/**
 * The provider this deployment runs its own key on, for the metered tiers.
 *
 * Named rather than hardcoded because it moved: it was Google, it is Together,
 * and the next move should be a variable and a redeploy rather than an edit to
 * `candidatesFor` below. Unset means `google`, which is what every installation
 * of this app was before the variable existed.
 *
 * An unrecognised value is logged and ignored rather than thrown on, for the
 * reason `parseFallbacks` above swallows a bad entry: a typo in the environment
 * must not be able to stop the module from importing, because at that point
 * nothing serves at all — including the pages that would have told somebody
 * what went wrong.
 */
const DEFAULT_SERVICE_PROVIDER: ProviderId = "google";

let serviceProviderCache: ProviderId | undefined;

function serviceProvider(): ProviderId {
  if (serviceProviderCache) return serviceProviderCache;
  const raw = process.env.SERVICE_PROVIDER?.trim();
  if (raw && !isProviderId(raw)) {
    console.error(
      `[provider] SERVICE_PROVIDER "${raw}" is not a known provider; ` +
        `falling back to ${DEFAULT_SERVICE_PROVIDER}.`,
    );
  }
  serviceProviderCache = raw && isProviderId(raw) ? raw : DEFAULT_SERVICE_PROVIDER;
  return serviceProviderCache;
}

/**
 * The variables these replaced, and the one deploy that goes wrong quietly.
 *
 * `SERVICE_API_KEY` and `SERVICE_MODEL` used to be `GOOGLE_GENERATIVE_AI_API_KEY`
 * and `FREE_TIER_MODEL` (the latter misnamed since the server-funded trial was
 * removed — `free` has run nothing at all for a while). Nothing reads the old
 * names any more, deliberately: a dual read is a second definition of the same
 * fact, and the point of the rename was to stop having one.
 *
 * What that costs is diagnosability on exactly one path — shipping the code
 * without updating the deployment's environment. The symptom there is every
 * paid generation failing with "el servicio no tiene una API key configurada",
 * which reads as "we never configured one" rather than "we configured the
 * variable that is no longer read". This says the difference out loud, once.
 */
const RENAMED_ENV: ReadonlyArray<readonly [old: string, current: string]> = [
  ["GOOGLE_GENERATIVE_AI_API_KEY", "SERVICE_API_KEY"],
  ["FREE_TIER_MODEL", "SERVICE_MODEL"],
  ["PRO_TIER_MODEL", "SERVICE_PRO_MODEL"],
];

let renameWarned = false;

function warnAboutRenamedEnv(): void {
  if (renameWarned) return;
  renameWarned = true;
  const stale = RENAMED_ENV.filter(
    ([old, current]) => process.env[old]?.trim() && !process.env[current]?.trim(),
  );
  if (stale.length === 0) return;
  console.error(
    "[provider] These environment variables were renamed and are no longer read: " +
      stale.map(([old, current]) => `${old} → ${current}`).join(", ") +
      ". The metered tiers will not run until the new names are set.",
  );
}

function serviceApiKey(): string | undefined {
  warnAboutRenamedEnv();
  return process.env.SERVICE_API_KEY?.trim() || undefined;
}

/**
 * Whether this installation can serve a metered tier at all.
 *
 * Exported so the UI can say so *before* someone spends effort on a request
 * that cannot succeed: without this, an installation with no key of its own
 * still reports a healthy free-tier balance, and the only way to discover
 * otherwise is to write a paragraph, send it, and get a 400 back.
 *
 * `candidatesFor` below decides the same thing from the same two facts, and
 * calls this rather than repeating them — the promise the UI makes and the
 * check that enforces it must not be able to drift.
 */
export function serviceKeyConfigured(): boolean {
  return Boolean(serviceApiKey()) || serviceFallbacks().length > 0;
}

/**
 * The metered tiers run on our own key, at `SERVICE_PROVIDER`. BYOK runs on
 * the user's, at whichever provider they chose.
 *
 * Which model that is depends on both the tier and the action: the paid tiers
 * exist to buy a better document, so they get the stronger model exactly where
 * the document is written and the cheap one everywhere else.
 *
 * `SERVICE_PRO_MODEL` falls back to `SERVICE_MODEL` when unset, so an
 * installation that has not configured one keeps working — it simply has
 * nothing extra to sell yet.
 */
export async function resolveModel(input: {
  tier: Tier;
  action: Action;
  byok?: ByokEntry[];
}): Promise<ModelChain> {
  const chain = chainOf(candidatesFor(input));
  /**
   * One line per request, and the only place a production log can answer the
   * question a failing fallback raises: were the candidates that never got a
   * turn missing from what the browser sent, or did the request stop before
   * reaching them?
   *
   * `describe` is the same string the UI and the switch events use, which is
   * what makes it safe here: provider label, model id and whose key it is —
   * never the key itself (see `candidate` above and `redactKeys` below).
   */
  console.info(`[generate] ${input.action}: tier=${input.tier} · ${describeChainForLog(chain)}`);
  return chain;
}

/**
 * The chain as a single log line. Exported so a test can pin its shape without
 * standing up a request.
 *
 * The count leads because that is the number worth comparing against what the
 * browser logged on its way out (`[chain] N keys → …` in `lib/api/client.ts`):
 * two lines that agree mean the chain arrived whole, and a server line with
 * fewer candidates says something in between dropped some.
 */
export function describeChainForLog(chain: ModelChain): string {
  return (
    `${chain.candidates.length} candidato(s): ` +
    chain.candidates.map((candidate) => candidate.describe).join(" | ")
  );
}

/**
 * How long a whole request may spend on model calls.
 *
 * Sized from the honest worst case of the longest one rather than from
 * impatience: a CV is an analysis (~25s) followed by the document itself
 * (~90s), and may pay for the document twice when `cvGaps` finds something the
 * model dropped. That fits, with room for one failed candidate along the way.
 * What does not fit — and is exactly what this exists to stop — is a request
 * walking a long chain of slow candidates at every stage.
 */
const REQUEST_BUDGET_MS = 180_000;

function chainOf(candidates: ModelChoice[]): ModelChain {
  return {
    candidates,
    used: candidates[0],
    failed: new Set(),
    switches: [],
    deadlineAt: Date.now() + REQUEST_BUDGET_MS,
  };
}

function candidatesFor(input: {
  tier: Tier;
  action: Action;
  byok?: ByokEntry[];
}): ModelChoice[] {
  /**
   * A spent BYOK chain stops there; it never falls through to the metered
   * candidates below. BYOK is unlimited precisely because it costs us nothing,
   * and a silent fallback onto our own key would quietly turn every user who
   * configured one into a charge against our budget — while telling them their
   * key is working fine.
   */
  if (input.tier === "byok") {
    const entries = (input.byok ?? []).filter((entry) => entry.apiKey.trim());
    if (entries.length === 0) {
      throw new ProviderConfigError("Falta la API key.");
    }
    return entries.map((entry) =>
      candidate({
        provider: entry.provider,
        apiKey: entry.apiKey.trim(),
        modelId: entry.model?.trim() || DEFAULT_MODEL[entry.provider],
        accountId: entry.accountId,
        note: "key propia",
      }),
    );
  }

  if (input.tier === "free") {
    // There is no server-funded trial: `free` means nobody's key, full stop,
    // independent of whether a service key happens to be configured — that key
    // belongs to `pro`/`credits` alone. See `lib/quota.ts`'s top comment.
    throw new ProviderConfigError(
      "Este producto no ofrece generación gratuita con nuestra key. Configurá la tuya " +
        "—gratis, dos minutos— desde Ajustes.",
    );
  }

  const provider = serviceProvider();
  const apiKey = serviceApiKey();
  const fallbacks = serviceFallbacks();
  if (!serviceKeyConfigured()) {
    throw new ProviderConfigError(
      "El servicio no tiene una API key configurada. Podés usar tu propia key desde Ajustes.",
    );
  }

  /**
   * The standard model, and the better one on the steps an employer reads.
   * `QUALITY_ACTIONS` is deliberately three actions and not six: the large
   * model runs eight to fifteen times the price per token, so widening it
   * silently doubles what a paid application costs to serve. See
   * `tests/model-tiering.test.ts`, which is where that decision is recorded.
   */
  const standardModel = process.env.SERVICE_MODEL?.trim() || DEFAULT_MODEL[provider];
  const paid = PAID_TIERS.has(input.tier) && QUALITY_ACTIONS.has(input.action);
  const modelId = (paid && process.env.SERVICE_PRO_MODEL?.trim()) || standardModel;

  return [
    /**
     * `accountId` is read for the one provider whose account is part of the
     * base URL rather than of the credential (`ACCOUNT_ID_LABEL` in
     * `./provider-catalog.ts`). It is meaningless for the other twelve and
     * ignored by them — but without it `SERVICE_PROVIDER` would be a setting
     * that silently cannot express one of its own legal values.
     */
    ...(apiKey
      ? [
          candidate({
            provider,
            apiKey,
            modelId,
            accountId: process.env.SERVICE_ACCOUNT_ID?.trim() || undefined,
          }),
        ]
      : []),

    /**
     * The tiering above is the primary's alone. A standby exists to get the
     * request finished at all, and asking an installation to name a free and a
     * pro model for each of its fallbacks would be a lot of configuration for
     * the rare path — so each entry runs the one model it declares.
     */
    ...fallbacks.map((entry) =>
      candidate({
        provider: entry.provider,
        apiKey: entry.apiKey,
        modelId: entry.model || DEFAULT_MODEL[entry.provider],
        note: "respaldo",
      }),
    ),
  ];
}

/**
 * Provider SDKs sometimes echo the request (headers included) into error
 * messages. Everything user-facing goes through this so a key cannot leak into
 * an error toast or a log line.
 */
export function redactKeys(text: string): string {
  return text
    .replace(/\bgsk_[A-Za-z0-9_-]{16,}/g, "gsk_***")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}/g, "AIza***")
    .replace(/\bsk-bl-[A-Za-z0-9_-]{16,}/g, "sk-bl-***")
    .replace(/\bsk-air-[A-Za-z0-9_-]{16,}/g, "sk-air-***")
    .replace(/(x-goog-api-key|authorization|x-api-key)(["':\s]+)[^\s"',}]+/gi, "$1$2***");
}
