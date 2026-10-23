"use client";

import type { ModelOption, ProviderId } from "@/lib/ai/provider-catalog";
import type { GenerationErrorKind } from "@/lib/ai/error-kind";
import type { DenialReason } from "@/lib/api/denial";
import {
  loadSettings,
  orderedChain,
  recordProviderNotes,
  resolvedModel,
} from "@/lib/storage/local";
import { IDEMPOTENCY_HEADER } from "@/lib/generation/idempotency";

/**
 * Browser-side caller for the endpoints that need the user's own key.
 *
 * The BYOK key travels as a request header rather than in the JSON body: it
 * keeps the key out of anything that might be logged or persisted as a payload,
 * and it means the server can decide the tier before parsing the body.
 */

/**
 * Why the server refused, when it refused over quota.
 *
 * Carried separately from the message because the two cases lead to
 * different screens, and matching on a Spanish sentence to decide which is how
 * a copy edit breaks a paywall.
 */
export type { DenialReason } from "@/lib/api/denial";

/** The BYOK-only twin of the message — see `CandidateAttempt` in `@/lib/api/context`. */
export type ClientCandidateAttempt = {
  name: string;
  message: string;
  provider: string;
  modelId: string;
  status: number;
  /** The classification beside the status — see `@/lib/ai/error-kind`. */
  kind?: GenerationErrorKind;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly quota?: { used: number; allowance: number },
    readonly reason?: DenialReason,
    /** Candidates this request actually spent a call on, in order. BYOK only. */
    readonly attempts?: ClientCandidateAttempt[],
    /** How many of the user's configured keys the server never got to. */
    readonly untried?: number,
  ) {
    super(message);
  }
}

/**
 * Whether the server gave up with keys still unspent — the one case worth
 * continuing on the caller's own initiative instead of making the user click
 * again. `recordProviderNotes` has already sunk every candidate this request
 * touched to the end of the chain by the time a caller sees this, so a second
 * call reaches keys the first one never tried.
 */
export function hasUntriedKeys(error: unknown): boolean {
  return error instanceof ApiError && (error.untried ?? 0) > 0;
}

/**
 * The headers every generation request carries, including the user's provider
 * chain when they have configured one.
 *
 * Shared with `./stream-client.ts`, which sends the same thing to the same
 * endpoints: two copies of this drifted apart the moment the chain replaced the
 * single provider, and the streaming path would have gone on sending one.
 */
export function requestHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  // A row the user has started but not finished is not a provider yet.
  const filled = loadSettings().entries.filter((entry) => entry.provider && entry.apiKey.trim());
  if (filled.length === 0) return headers;
  // A row a transient failure noted (rate limit, overload) is sunk to the
  // end rather than dropped; a row a durable failure noted (rejected key,
  // empty balance) is dropped outright — see `orderedChain`.
  const chain = orderedChain(filled);

  /**
   * The browser's half of the chain log — see `describeChainForLog` in
   * `@/lib/ai/provider`. The two lines are meant to be read together: equal
   * counts mean the chain reached the server whole, and a server line with
   * fewer candidates says something in between dropped some. `provider/model`
   * only; the keys travel in the header beside this, which is where they
   * belong.
   */
  console.info(
    `[chain] ${chain.length} keys → ` +
      chain.map((entry) => `${entry.provider}/${resolvedModel(entry)}`).join(", "),
  );

  const payload = JSON.stringify(
    chain.map((entry) => ({
      provider: entry.provider,
      apiKey: entry.apiKey.trim(),
      model: entry.model.trim() || undefined,
      accountId: entry.accountId?.trim() || undefined,
    })),
  );
  // Base64 of JSON: a header value cannot carry arbitrary bytes and an API key
  // is arbitrary. Encoded to UTF-8 bytes first, because `btoa` takes latin1.
  headers["x-cvp-chain"] = btoa(String.fromCharCode(...new TextEncoder().encode(payload)));
  return headers;
}

export async function callGenerator<T>(
  endpoint: string,
  body: unknown,
  signal?: AbortSignal,
  /** See `streamGenerator`'s option of the same name. */
  options: { idempotencyKey?: string } = {},
): Promise<T> {
  const headers = requestHeaders();
  if (options.idempotencyKey) headers[IDEMPOTENCY_HEADER] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("No pudimos conectar con el servidor. Revisá tu conexión.", 0);
  }

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    quota?: { used: number; allowance: number };
    reason?: DenialReason;
    attempts?: ClientCandidateAttempt[];
    untried?: number;
  };

  if (!response.ok) {
    // Recorded before the throw so every caller learns from a failure, not
    // just the one that happens to render a retry button.
    if (payload.attempts) recordProviderNotes(payload.attempts);
    throw new ApiError(
      payload.error ?? "Ocurrió un error al generar.",
      response.status,
      payload.quota,
      payload.reason,
      payload.attempts,
      payload.untried,
    );
  }

  return payload as T;
}

/**
 * The models the given key actually serves, for the model field in Ajustes.
 *
 * Provider and key are arguments rather than read from `loadSettings()` like
 * `callGenerator` does: the settings page asks this while the user is still
 * typing into those very fields, and reading the stored copy would answer for
 * whatever was saved a keystroke ago.
 */
export async function fetchModels(
  provider: ProviderId,
  apiKey: string,
  /** Only read for the providers in `ACCOUNT_ID_LABEL`; see `needsAccountId`. */
  accountId?: string,
): Promise<ModelOption[]> {
  let response: Response;
  try {
    response = await fetch("/api/models", {
      headers: {
        "x-cvp-provider": provider,
        "x-cvp-key": apiKey,
        ...(accountId ? { "x-cvp-account": accountId } : {}),
      },
    });
  } catch {
    throw new ApiError("No pudimos conectar con el servidor. Revisá tu conexión.", 0);
  }

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    models?: ModelOption[];
  };

  if (!response.ok) {
    throw new ApiError(payload.error ?? "No pudimos consultar los modelos.", response.status);
  }

  return payload.models ?? [];
}
