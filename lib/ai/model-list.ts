import "server-only";

import { redactKeys } from "./provider";
import {
  ProviderConfigError,
  PROVIDER_LABEL,
  type ModelOption,
  type ProviderId,
} from "./provider-catalog";

/**
 * What each provider's key actually serves, for the model field in Ajustes.
 *
 * This exists because a pinned default can be retired without warning:
 * `DEFAULT_MODEL.groq` was `llama-3.3-70b-versatile` until Groq stopped
 * serving it, and the only way for a user to find out what to put in its
 * place was to leave the app and read a dashboard. See the note on
 * `DEFAULT_MODEL` in `./provider-catalog.ts`.
 *
 * The switch below deliberately mirrors `buildRaw` in `./provider.ts`: a new
 * provider needs a client *and* a way to enumerate itself, and keeping the
 * two shaped alike is what makes the missing half obvious.
 *
 * Nothing here is cached. The list is asked for when the user asks for it,
 * which is a handful of times per key, and a stale cache is exactly the
 * failure this feature exists to undo.
 */

/**
 * Models below this are not chat models in any useful sense — Groq's
 * `llama-prompt-guard-2-*` classifiers report 512, against the 131072 of
 * everything worth generating a CV with. A floor rather than a name list, so
 * it keeps working on models that don't exist yet.
 */
const MIN_CONTEXT = 8192;

/** Provider APIs are not part of a page render; none of them get to hang one. */
const TIMEOUT_MS = 10_000;

/** How a provider says the key is bad when it does not say it with a 401. */
const REJECTED_KEY = /API[_ ]KEY[_ ]INVALID|API key not valid|invalid api key|unauthorized/i;

export async function listModels(
  provider: ProviderId,
  apiKey: string,
  /** Only used by the providers in `ACCOUNT_ID_LABEL`; ignored by the rest. */
  accountId?: string,
): Promise<ModelOption[]> {
  const models = await read(provider, apiKey, accountId);
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

function read(
  provider: ProviderId,
  apiKey: string,
  accountId: string | undefined,
): Promise<ModelOption[]> {
  switch (provider) {
    case "groq":
      return groq(apiKey);
    case "cloudflare":
      return cloudflare(apiKey, accountId);
    case "llm7":
      return llm7(apiKey);
    case "openrouter":
      return openrouter(apiKey);
    case "cerebras":
      return cerebras(apiKey);
    case "nvidia":
      return nvidia(apiKey);
    case "requesty":
      return requesty(apiKey);
    case "bazaarlink":
      return bazaarlink(apiKey);
    case "airforce":
      return airforce(apiKey);
    case "mistral":
      return mistral(apiKey);
    case "cohere":
      return cohere(apiKey);
    case "google":
      return google(apiKey);
    case "together":
      return together(apiKey);
    case "deepseek":
      return deepseek(apiKey);
  }
}

// --- Per-provider readers -----------------------------------------------------

/**
 * Groq annotates each model richly enough that the unusable ones can be
 * filtered on what they are rather than what they are called: the Whisper
 * models take audio, the Orpheus ones emit speech, and the prompt guards have
 * a 512-token window. All three would otherwise be offered as choices for
 * writing a CV.
 */
async function groq(apiKey: string): Promise<ModelOption[]> {
  const body = await get("groq", "https://api.groq.com/openai/v1/models", bearer(apiKey));

  return rows(body, "data")
    .filter((m) => m.active !== false)
    .filter((m) => modality(m.input_modalities, "text") && modality(m.output_modalities, "text"))
    .filter((m) => typeof m.context_window !== "number" || m.context_window >= MIN_CONTEXT)
    .map((m) => ({ id: text(m.id), label: optionalText(m.name) }))
    .filter((m) => m.id !== "");
}

/**
 * OpenRouter lists every model it can route to — over 400 — and takes the key
 * only to personalise pricing, not to gate the catalogue. The whole list is
 * returned rather than trimmed: the point of the provider is breadth, and the
 * settings field is a datalist the user can filter by typing.
 */
function openrouter(apiKey: string): Promise<ModelOption[]> {
  return aggregator("openrouter", "https://openrouter.ai/api/v1/models", apiKey);
}

/**
 * BazaarLink answers this endpoint in OpenRouter's shape field for field —
 * `architecture.output_modalities`, `context_length`, `pricing.prompt`, all
 * of it — so it reads with the same function rather than a copy of it. Its
 * free routes are `qwen/qwen3.7-flash:free` and `auto:free`; everything else
 * in the list needs a deposit, and both are returned because a user who has
 * put a dollar in should see what it bought.
 */
function bazaarlink(apiKey: string): Promise<ModelOption[]> {
  return aggregator("bazaarlink", "https://api.bazaarlink.ai/v1/models", apiKey);
}

/**
 * The one provider here that does not wrap its list.
 *
 * Together answers `GET /v1/models` with a **bare JSON array** rather than the
 * `{data: […]}` every other OpenAI-compatible endpoint in this file returns, so
 * `rows(body, "data")` reads it as empty — an empty catalogue, not an error,
 * which is the shape of bug that survives a code review and gets found by a
 * user staring at a blank model list.
 *
 * `type` is the filter that matters: the catalogue mixes chat models with
 * embeddings, rerankers, moderation and image models, and none of the latter
 * can be held to a schema. `display_name` is the provider's own name for the
 * model, which is what `label` is for.
 *
 * This exists even though Together is not offered in the BYOK form — see
 * `SERVICE_ONLY_PROVIDERS`. A provider that this deployment runs its own key on
 * is the one whose catalogue somebody most needs to enumerate, because
 * `SERVICE_MODEL` is a pin and pins get retired out from under you.
 */
async function together(apiKey: string): Promise<ModelOption[]> {
  const body = await get("together", "https://api.together.ai/v1/models", bearer(apiKey));

  return (Array.isArray(body) ? body.map(record) : rows(body, "data"))
    .filter((m) => text(m.type) === "" || text(m.type) === "chat")
    .filter((m) => typeof m.context_length !== "number" || m.context_length >= MIN_CONTEXT)
    .map((m) => ({ id: text(m.id), label: optionalText(m.display_name) }))
    .filter((m) => m.id !== "");
}

/**
 * DeepSeek's catalogue is three models and carries no context length, pricing
 * or capability field to filter on — just `id`, `object` and `owned_by` — so
 * this is the plain OpenAI shape with nothing to trim. Exists for the same
 * reason `together` does: `SERVICE_MODEL` and `SERVICE_PRO_MODEL` are pins on
 * a provider this deployment pays for directly, and DeepSeek has retired
 * aliases before (`deepseek-chat` and `deepseek-reasoner`, both gone after
 * 2026-07-24) without much notice.
 */
async function deepseek(apiKey: string): Promise<ModelOption[]> {
  const body = await get("deepseek", "https://api.deepseek.com/v1/models", bearer(apiKey));

  return rows(body, "data")
    .map((m) => ({ id: text(m.id), label: undefined }))
    .filter((m) => m.id !== "");
}

/** The OpenRouter response shape, which BazaarLink also serves. */

function aggregator(
  provider: ProviderId,
  url: string,
  apiKey: string,
): Promise<ModelOption[]> {
  return get(provider, url, bearer(apiKey)).then((body) =>
    rows(body, "data")
      .filter((m) => modality(record(m.architecture).output_modalities, "text"))
      .map((m) => ({ id: text(m.id), label: optionalText(m.name) }))
      .filter((m) => m.id !== ""),
  );
}

/**
 * Requesty annotates its catalogue better than anything else here, and both
 * things worth knowing come off those annotations rather than off a list kept
 * by hand:
 *
 * `supports_output_json_schema` decides what is shown at all. Every action in
 * `./pipeline.ts` runs through `generateObject`, so a model that cannot be
 * held to a schema is a generation that will fail — 138 of the 676 are like
 * that, and offering them is offering a failure.
 *
 * `data_used_for_training` decides what is said *about* it. Nine models train
 * on what they are sent, and what this app sends is somebody's name, contact
 * details and entire employment history. No other provider reports this, so
 * the one that does should not have it thrown away.
 *
 * As it stands the warning never renders, and that is worth writing down
 * rather than discovering later: all nine of those models are also missing
 * `json_schema`, so the filter above has already dropped every one of them.
 * The annotation stays anyway, because that overlap is a coincidence of
 * today's catalogue and not a property of it — the day Requesty lists a model
 * that both holds a schema and trains on the prompt should not be the day
 * somebody's employment history goes into a training set unannounced.
 *
 * The warning is appended to the id rather than replacing it: the datalist in
 * Ajustes renders `label ?? id`, so a bare warning would hide the very model
 * name the user is there to read.
 *
 * Like NVIDIA's, this endpoint answers without authentication: a listing that
 * succeeds says nothing about whether the key is good.
 */
async function requesty(apiKey: string): Promise<ModelOption[]> {
  const body = await get("requesty", "https://router.requesty.ai/v1/models", bearer(apiKey));

  return rows(body, "data")
    .filter((m) => m.supports_output_json_schema === true)
    .map((m) => {
      const id = text(m.id);
      return {
        id,
        label: m.data_used_for_training === true ? `${id} — entrena con tus datos` : undefined,
      };
    })
    .filter((m) => m.id !== "");
}

/**
 * Cerebras returns the plain OpenAI `/models` shape and nothing else — no
 * modality flags, no context window, not even a display name — so there is
 * nothing to filter on and nothing to label with. That is not a gap: its
 * catalogue is a handful of text models, all of them usable for a CV.
 */
async function cerebras(apiKey: string): Promise<ModelOption[]> {
  const body = await get("cerebras", "https://api.cerebras.ai/v1/models", bearer(apiKey));

  return rows(body, "data")
    .map((m) => ({ id: text(m.id) }))
    .filter((m) => m.id !== "");
}

/**
 * The one thing NVIDIA's catalogue has that a name cannot be read off of:
 * roughly a dozen embedding and retrieval models sitting among the hundred
 * chat ones. Groq's equivalents get excluded by what they *are* — modality
 * flags and a context window — but NVIDIA returns only `id`, `object`,
 * `owned_by` and `created`, so a name match is the only signal there is.
 * Kept deliberately narrow: the vision-instruct and riva-translate models
 * are chat models and stay, and anything this pattern doesn't know about is
 * shown rather than hidden.
 */
const NOT_A_CHAT_MODEL = /embed|nvclip|nemoretriever-parse/i;

/**
 * NVIDIA's catalogue is over a hundred models from every vendor. Returned
 * whole apart from the above, for the reason OpenRouter's is: breadth is the
 * point of the provider, and the settings field is a datalist the user
 * filters by typing.
 *
 * Note that this endpoint answers without authentication, so unlike every
 * other provider here a successful listing says nothing about whether the
 * key is any good — `ByokSetup` uses `fetchModels` as a key check, and that
 * check would pass for NVIDIA on a garbage key. It is Google-only today, so
 * nothing depends on this yet; anything that widens it needs to know.
 */
async function nvidia(apiKey: string): Promise<ModelOption[]> {
  const body = await get(
    "nvidia",
    "https://integrate.api.nvidia.com/v1/models",
    bearer(apiKey),
  );

  return rows(body, "data")
    .map((m) => ({ id: text(m.id) }))
    .filter((m) => m.id !== "" && !NOT_A_CHAT_MODEL.test(m.id));
}

/**
 * Cloudflare is the only provider here whose catalogue does not come from the
 * endpoint its models are generated through. Its OpenAI-compatible surface
 * implements `/chat/completions` and `/embeddings` and nothing else — a GET to
 * `/v1/models` on it answers `405 GET not supported for requested URI` — so
 * the listing has to come off the native REST API beside it, in Cloudflare's
 * own envelope rather than OpenAI's.
 *
 * Two shape differences follow from that, and both are easy to get wrong by
 * pattern-matching the readers above: the array is under `result` rather than
 * `data`, and the id the chat endpoint wants is `name` (`@cf/meta/...`) — `id`
 * is a UUID no request ever takes.
 *
 * Nothing is filtered here, for Cohere's reason rather than Cerebras': the
 * `task` query below excludes the embedding, image and speech models
 * server-side, so what comes back is already the text-generation catalogue.
 *
 * Unlike NVIDIA's and Requesty's, this endpoint refuses without credentials,
 * so a listing that succeeds does prove the key and the account id go
 * together — which is the closest thing this form has to a validate button for
 * the one provider that can be half-configured.
 */
async function cloudflare(apiKey: string, accountId: string | undefined): Promise<ModelOption[]> {
  const account = accountId?.trim() ?? "";
  if (!account) {
    throw new ProviderConfigError(
      "Cloudflare necesita el Account ID además de la API key. Lo encontrás en el " +
        "panel de Cloudflare, en Workers & Pages.",
    );
  }

  const url = new URL(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/models/search`,
  );
  url.searchParams.set("task", "Text Generation");
  url.searchParams.set("per_page", "100");

  const body = await get("cloudflare", url.toString(), bearer(apiKey));

  return rows(body, "result")
    .map((m) => ({ id: text(m.name) }))
    .filter((m) => m.id !== "");
}

/**
 * LLM7 annotates better than anything else here, and two of its flags decide
 * what the datalist may honestly offer:
 *
 * `usage_based_only` separates the models the free token actually reaches from
 * the ones behind a balance. Thirty-eight of its forty-four are the latter —
 * Claude, GPT, Grok, Gemini — and offering them to somebody who came for a free
 * key is offering a 402 with extra steps.
 *
 * `json_mode` is the filter Groq, Requesty and api.airforce each apply under a
 * different name: every action in `./pipeline.ts` runs through
 * `generateObject`, so a model that cannot be held to a schema is not a choice,
 * it is a generation that will fail.
 *
 * Like NVIDIA's and Requesty's — and unlike Cloudflare's above — this endpoint
 * answers a made-up bearer token with a 200, so a successful listing says
 * nothing whatever about whether the key is good.
 */
async function llm7(apiKey: string): Promise<ModelOption[]> {
  const body = await get("llm7", "https://api.llm7.io/v1/models", bearer(apiKey));

  return rows(body, "data")
    .filter((m) => m.usage_based_only !== true)
    .filter((m) => m.json_mode === true)
    .map((m) => ({ id: text(m.id) }))
    .filter((m) => m.id !== "");
}

/**
 * One of the best-annotated catalogues here, and the only one that answers all
 * three questions worth asking, so all three get asked:
 *
 * `supports_chat` and `response_format` are the same filters applied to Groq
 * and Requesty — a model that takes audio, or that cannot be held to a schema,
 * is not a choice for writing a CV, it is a generation that will fail.
 *
 * `status` is the one no other provider offers. Thirty-eight of api.airforce's
 * models report `major_outage` at the time of writing, and the list is there
 * precisely so the user stops guessing which id still works.
 *
 * The `tier` annotation goes in the label rather than the filter: a paid model
 * is a real choice for somebody who has topped up, just not the one most
 * people arrive for. Appended to the id, never replacing it — the datalist in
 * Ajustes renders `label ?? id`.
 */
async function airforce(apiKey: string): Promise<ModelOption[]> {
  const body = await get("airforce", "https://api.airforce/v1/models", bearer(apiKey));

  return rows(body, "data")
    .filter((m) => m.supports_chat === true)
    .filter((m) => text(m.status) === "operational")
    .filter((m) => list(m.supported_parameters).includes("response_format"))
    .map((m) => {
      const id = text(m.id);
      return { id, label: text(m.tier) === "paid" ? `${id} — consume créditos` : undefined };
    })
    .filter((m) => m.id !== "");
}

/** Mistral's catalogue includes embedding and OCR models; `capabilities` sorts them out. */
async function mistral(apiKey: string): Promise<ModelOption[]> {
  const body = await get("mistral", "https://api.mistral.ai/v1/models", bearer(apiKey));

  return rows(body, "data")
    .filter((m) => record(m.capabilities).completion_chat !== false)
    .map((m) => ({ id: text(m.id), label: optionalText(m.name ?? m.description) }))
    .filter((m) => m.id !== "");
}

/**
 * Cohere filters server-side via `endpoint=chat`, which is the only reason
 * embed and rerank do not need excluding here. `page_size` is at its maximum
 * so the response is not paginated; Cohere's catalogue is nowhere near it.
 */
async function cohere(apiKey: string): Promise<ModelOption[]> {
  const body = await get(
    "cohere",
    "https://api.cohere.com/v1/models?endpoint=chat&page_size=1000",
    bearer(apiKey),
  );

  return rows(body, "models")
    .map((m) => ({ id: text(m.name) }))
    .filter((m) => m.id !== "");
}

/**
 * Google's key goes in the query string because that is the only place its
 * models endpoint takes one. Everything else — embeddings, Imagen, the TTS
 * and video models — is excluded by asking for `generateContent` support
 * rather than by name.
 */
async function google(apiKey: string): Promise<ModelOption[]> {
  const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("pageSize", "1000");

  const body = await get("google", url.toString(), {});

  return rows(body, "models")
    .filter((m) => list(m.supportedGenerationMethods).includes("generateContent"))
    // Reported as "models/gemini-3.5-flash"; the SDK wants the bare id.
    .map((m) => ({
      id: text(m.name).replace(/^models\//, ""),
      label: optionalText(m.displayName),
    }))
    .filter((m) => m.id !== "");
}

// --- Transport ----------------------------------------------------------------

function bearer(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}` };
}

/**
 * One GET, with every failure turned into a `ProviderConfigError` — this is a
 * BYOK configuration screen, and every way it can fail is something the user
 * changes rather than something the service retries.
 */
async function get(
  provider: ProviderId,
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const name = PROVIDER_LABEL[provider];

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { ...headers, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new ProviderConfigError(`No pudimos contactar a ${name}. Probá de nuevo.`);
  }

  const body = await response.text();

  // Google answers a bad key with a 400 and a message, not the 401 the other
  // four use, so the status alone would send it down the generic branch and
  // show the user Google's English JSON instead of the one thing worth saying.
  // The error is still tagged `401` regardless of Google's own wire status:
  // that is the classification, not the transport detail.
  if (response.status === 401 || response.status === 403 || REJECTED_KEY.test(body)) {
    throw new ProviderConfigError(`${name} rechazó la API key. Revisala en Ajustes.`, 401);
  }
  if (!response.ok) {
    // The provider's own words, redacted and clipped: they are more useful
    // than a generic sentence, and `redactKeys` is what makes echoing them
    // safe — Google's errors quote the request, key and all. The raw status
    // travels too, so a probe from Ajustes gets the same 402/429/… label a
    // real generation would.
    throw new ProviderConfigError(
      `${name} respondió ${response.status}: ${redactKeys(body).slice(0, 200)}`,
      response.status,
    );
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ProviderConfigError(`${name} devolvió una respuesta que no pudimos leer.`);
  }
}

// --- Reading untyped JSON -----------------------------------------------------

type Row = Record<string, unknown>;

function record(value: unknown): Row {
  return typeof value === "object" && value !== null ? (value as Row) : {};
}

/** The array of models under `key`, whatever else the body turned out to be. */
function rows(body: unknown, key: string): Row[] {
  const value = record(body)[key];
  return Array.isArray(value) ? value.map(record) : [];
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** True when the provider says nothing, so an unannotated model is never hidden. */
function modality(value: unknown, wanted: string): boolean {
  const modalities = list(value);
  return modalities.length === 0 || modalities.includes(wanted);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown): string | undefined {
  return text(value) || undefined;
}
