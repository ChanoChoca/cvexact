import "server-only";

import { NextResponse } from "next/server";
import { isProviderId, ProviderConfigError, redactKeys, resolveModel } from "@/lib/ai/provider";
import type { ByokEntry, ModelChain } from "@/lib/ai/provider";
import { z } from "zod";
import { GenerationError } from "@/lib/ai/pipeline";
import type { GenerationErrorKind } from "@/lib/ai/error-kind";
import type { GenerationTelemetry } from "@/lib/ai/pipeline";
import { recordUsage } from "@/lib/billing/usage";
import { getSessionUser, hasActiveSubscription } from "@/lib/auth";
import { clientIp, creditBalance, quotaSubject, reserveQuota } from "@/lib/quota";
import { enforceRateLimit } from "@/lib/api/guards";
import { hasTransferConsent } from "@/lib/legal/consent";
import type { Action, DenialReason, Tier } from "@/lib/quota";

/**
 * Shared entry logic for the four generation endpoints: work out the tier,
 * resolve a model, reserve quota, and normalise failures.
 *
 * BYOK credentials arrive as request headers rather than in the body so they
 * never end up in a logged or persisted payload. They are read here, used to
 * build a client, and dropped.
 */

export const BYOK_HEADERS = {
  provider: "x-cvp-provider",
  key: "x-cvp-key",
  model: "x-cvp-model",
  /**
   * The second identifier Cloudflare needs — see `ACCOUNT_ID_LABEL` in
   * `lib/ai/provider-catalog.ts`. Only meaningful alongside the single-value
   * headers above; the chain carries its own per-entry copy, because a chain
   * can hold two Cloudflare rows on different accounts.
   *
   * Not a secret, and travelling as a header anyway: it is half of one
   * credential and splitting it across two transports would only make the pair
   * harder to keep together.
   */
  account: "x-cvp-account",
  /**
   * The ordered provider list, base64 of a JSON array of
   * `{ provider, apiKey, model? }`. Base64 because a header value may not
   * contain arbitrary bytes and a key is arbitrary; JSON because model ids use
   * both `/` and `:` (`google/gemini-2.5-flash`, OpenRouter's `:free`), which
   * leaves no delimiter safe to split on.
   *
   * The three single-value headers above are still read as a one-entry chain.
   * They are what a tab loaded before this shipped will keep sending, and what
   * `app/api/models/route.ts` uses — listing one provider's catalogue is not a
   * generation and has no chain to speak of.
   */
  chain: "x-cvp-chain",
} as const;

const chainHeaderSchema = z.array(
  z.object({
    provider: z.string(),
    apiKey: z.string(),
    model: z.string().optional(),
    accountId: z.string().optional(),
  }),
);

/** The BYOK entries the browser sent, in order, or none. */
export function byokChain(headers: Headers): ByokEntry[] {
  const encoded = headers.get(BYOK_HEADERS.chain)?.trim();
  if (encoded) {
    try {
      const parsed = chainHeaderSchema.parse(
        JSON.parse(Buffer.from(encoded, "base64").toString("utf8")),
      );
      return parsed.flatMap((entry) => {
        const provider = entry.provider.trim();
        const apiKey = entry.apiKey.trim();
        // A row half-filled in Ajustes is not an error worth refusing the whole
        // request over; it is a row the user has not finished yet.
        if (!isProviderId(provider) || !apiKey) return [];
        return [
          {
            provider,
            apiKey,
            model: entry.model?.trim() || undefined,
            accountId: entry.accountId?.trim() || undefined,
          },
        ];
      });
    } catch {
      // Falls through to the single-value headers below. Nothing is logged:
      // the payload holds keys.
    }
  }

  const provider = headers.get(BYOK_HEADERS.provider)?.trim();
  const apiKey = headers.get(BYOK_HEADERS.key)?.trim();
  if (!isProviderId(provider) || !apiKey) return [];
  return [
    {
      provider,
      apiKey,
      model: headers.get(BYOK_HEADERS.model)?.trim() || undefined,
      accountId: headers.get(BYOK_HEADERS.account)?.trim() || undefined,
    },
  ];
}

/**
 * The grant every route already holds, with cost accounting folded into the
 * call it already makes.
 *
 * Wired into `release` rather than added to each of the eight routes: they all
 * release exactly once on every path, which is the same guarantee the recording
 * needs, and one wrapper cannot drift out of sync with seven copies of itself.
 * Routes that thread a `GenerationTelemetry` pass it and get token counts; the
 * rest still contribute a call count.
 */
export type ReleasableGrant = {
  release: (outcome: "success" | "failure", telemetry?: GenerationTelemetry) => Promise<void>;
};

export type RequestContext = {
  tier: Tier;
  /**
   * Every model this request may use, in order, plus which one has run. A
   * single choice until a provider running out of quota mid-request had
   * nowhere to fall back to; see `ModelChain` in `@/lib/ai/provider`.
   */
  chain: ModelChain;
  grant: ReleasableGrant;
};

/**
 * Determines the tier, in order of what should be spent first.
 *
 *   byok    — a usable key of their own. Wins over everything: someone paying
 *             for their own inference is never made to spend ours, and never
 *             limited.
 *   pro     — an active subscription. Ahead of credits on purpose: a subscriber
 *             who also bought a pack must not have the pack quietly drained by
 *             usage their subscription already covers.
 *   credits — a balance left from a pack.
 *   free    — the trial.
 *
 * A signed-in user is metered against their user id rather than their IP, so
 * their allowance follows them across networks — and, for the trial, so that a
 * whole office behind one address does not share one person's.
 */
async function resolveTier(headers: Headers): Promise<{ tier: Tier; userId?: string }> {
  if (byokChain(headers).length > 0) return { tier: "byok" };

  const user = await getSessionUser(headers);
  if (!user) return { tier: "free" };

  if (hasActiveSubscription(user)) return { tier: "pro", userId: user.id };

  // One primary-key read. Cheaper than the alternative of carrying the balance
  // on the session, which would go stale the moment a pack was bought.
  const balance = await creditBalance(user.id);
  return { tier: balance > 0 ? "credits" : "free", userId: user.id };
}

/**
 * What to tell someone who has been refused, and what to offer them.
 *
 * The free path comes first in every message that has one. It is the honest
 * ordering — BYOK costs the user nothing and gives them the whole product —
 * and a paywall that leads with the paid option while a free one exists is
 * just a worse version of the truth.
 */
function denialMessage(reason: DenialReason, used: number, allowance: number): string {
  switch (reason) {
    case "no_credits":
      return (
        `Te quedaste sin créditos. Podés comprar más, o seguir gratis y sin límite con tu ` +
        `propia API key desde Ajustes.`
      );
    case "daily_limit":
      return (
        `Llegaste al tope diario (${used}/${allowance}). Se libera a la medianoche UTC. ` +
        `Si necesitás seguir ahora, podés usar tu propia API key desde Ajustes.`
      );
    case "monthly_limit":
      return (
        `Llegaste al tope del mes (${used}/${allowance}). Se libera al empezar el próximo. ` +
        `Si necesitás seguir ahora, podés usar tu propia API key desde Ajustes.`
      );
    /*
     * Inalcanzable desde `reserveQuota`, que nunca devuelve este motivo — la
     * refusal por consentimiento se arma entera en `openRequest`, con su propio
     * texto y su propio 403. Está acá para que el `switch` siga siendo
     * exhaustivo: si mañana aparece un quinto motivo, este archivo tiene que
     * dejar de compilar, y esa es exactamente la protección que se perdería
     * poniendo un `default`.
     */
    case "transfer_consent":
      return (
        `Falta tu consentimiento para enviar el perfil al proveedor del modelo, que está ` +
        `fuera del país.`
      );
    /*
     * Tampoco sale de `reserveQuota`, por la misma razón que `transfer_consent`
     * de arriba: `openRequest` corta con su propio 403 antes de llegar a
     * reservar nada. Está acá solo para que el `switch` siga siendo exhaustivo.
     */
    case "byok_required":
      return (
        `Este producto no ofrece generación gratuita con nuestra key. Configurá la tuya ` +
        `desde Ajustes.`
      );
  }
}

export async function openRequest(
  request: Request,
  action: Action,
): Promise<RequestContext | NextResponse> {
  const { tier, userId } = await resolveTier(request.headers);

  /**
   * BYOK is the one path with no ceiling of its own, by design — someone paying
   * for their own inference is never made to spend ours, and `meterByok` counts
   * without ever comparing. That settles the *model* bill, not this machine's:
   * the call still costs a connection and up to `REQUEST_BUDGET_MS` of server
   * time, and it needs no session, so nothing else stands between an anonymous
   * caller and as many of those as they care to open.
   *
   * The metered tiers are left alone. `reserveQuota` below already bounds them,
   * and a second ceiling on a request someone has paid for would only ever fire
   * on a legitimate user.
   *
   * Before `resolveModel` and `reserveQuota` on purpose: a request refused here
   * must not reserve a grant it will never release.
   */
  if (tier === "byok") {
    const limited = await enforceRateLimit("generate-byok", request.headers, {
      window: 600,
      max: 60,
    });
    if (limited) return limited;
  }

  /*
   * Sin key propia, sin suscripción activa y sin créditos: `resolveModel` de
   * todos modos lo rechazaría más abajo (ver el comentario de `tier === "free"`
   * en `candidatesFor`, en `lib/ai/provider.ts`), pero como un 400 sin `reason`
   * — un motivo que `denialOf` en `components/billing/LimitReached.tsx` no
   * puede convertir en la tarjeta de `ByokSetup`, así que sale como un toast de
   * error genérico. Sin venta habilitada este es el camino de todo usuario
   * nuevo, no un caso de borde, y por eso se corta acá con su propio motivo.
   */
  if (tier === "free") {
    return NextResponse.json(
      {
        error:
          "Este producto no ofrece generación gratuita con nuestra key. Configurá la tuya " +
          "—gratis, dos minutos— desde Ajustes.",
        reason: "byok_required" satisfies DenialReason,
      },
      { status: 403 },
    );
  }

  let chain: ModelChain;
  try {
    chain = await resolveModel({
      tier,
      action,
      byok: tier === "byok" ? byokChain(request.headers) : undefined,
    });
  } catch (error) {
    if (error instanceof ProviderConfigError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  /**
   * A user who navigates away or presses Cancel stops the generation.
   *
   * `lib/ai/pipeline.ts` distinguishes this from its own attempt budget: this
   * one means the answer is no longer wanted and the chain must stop asking
   * anyone, rather than that the current candidate is too slow.
   */
  chain.signal = request.signal;

  /*
   * El consentimiento a la transferencia internacional, antes de reservar nada.
   *
   * Los tiers pagos corren sobre nuestra key, que hoy es DeepSeek: el perfil
   * sale del país hacia un destino que no está en la lista de protección
   * adecuada de la Disp. AAIP 60-E/2016, y lo que sostiene esa transferencia es
   * el consentimiento del titular (Ley 25.326 art. 12). Pedirlo después de
   * haber mandado los datos no es pedirlo.
   *
   * `byok` queda afuera a propósito y no por olvido: ahí el usuario eligió su
   * proveedor y su país, la key es suya, y no somos nosotros quienes decidimos
   * a dónde van sus datos. `free` tampoco llega acá — `resolveModel` ya lo
   * rechazó más arriba.
   *
   * Se emite como 403 y no como 429: no es «esperá», es «falta un paso». El
   * cliente lo lee igual porque `denialOf` acepta los dos códigos.
   */
  if ((tier === "pro" || tier === "credits") && userId) {
    if (!(await hasTransferConsent(userId))) {
      return NextResponse.json(
        {
          error:
            "Antes de la primera generación necesitamos tu consentimiento para enviar tu " +
            "perfil al proveedor del modelo, que está fuera del país.",
          reason: "transfer_consent" satisfies DenialReason,
        },
        { status: 403 },
      );
    }
  }

  const subject = quotaSubject({ userId, ip: clientIp(request.headers) });
  const grant = await reserveQuota({ tier, action, subject, userId });

  if (!grant.ok) {
    return NextResponse.json(
      {
        error: denialMessage(grant.reason, grant.used, grant.allowance),
        // `reason` is what lets the client show the right screen instead of a
        // toast. `quota` is what the balance indicator reads.
        reason: grant.reason,
        quota: { used: grant.used, allowance: grant.allowance },
      },
      {
        status: 429,
        // Only sent when waiting actually helps. A `retry-after` on a spent
        // trial would tell every well-behaved client to come back and be
        // refused again.
        headers: grant.retryAfterSeconds
          ? { "retry-after": String(grant.retryAfterSeconds) }
          : undefined,
      },
    );
  }

  return {
    tier,
    chain,
    grant: {
      release: async (outcome, telemetry) => {
        await grant.release(outcome);
        // Only what was actually delivered. A refunded reservation produced no
        // tokens worth costing.
        if (outcome === "success") {
          await recordUsage({
            action,
            tier,
            // The candidate that actually produced the tokens. Attributing them
            // to the one the request opened with would credit a provider that
            // may have refused before writing a word.
            provider: chain.used.provider,
            modelId: chain.used.modelId,
            telemetry,
          });
        }
      },
    },
  };
}

/** One candidate this request actually spent a call on, and what it said. */
export type CandidateAttempt = {
  name: string;
  message: string;
  provider: string;
  modelId: string;
  status: number;
  /** The classification beside the status — see `@/lib/ai/error-kind`. */
  kind?: GenerationErrorKind;
};

/**
 * Every candidate this request touched, in order, with why each one ended.
 * The candidate that ended the loop is never in `chain.switches` — it either
 * had no next candidate to hand off to, or its error wasn't `switchable` and
 * the loop threw before recording a switch (see `generate()` in
 * `@/lib/ai/pipeline`) — so it is appended here from `chain.used` instead.
 */
function candidateAttempts(chain: ModelChain, error: GenerationError): CandidateAttempt[] {
  /**
   * One entry per candidate, not per switch.
   *
   * A CV starts its analysis and its skill inference concurrently against the
   * same chain, so a first candidate that is down is discovered by both and
   * records the switch twice. Listed raw, that told the user "Probamos tus 2
   * keys" and then named the same one twice — while the key that actually
   * still had a turn left went unmentioned. It also made `allTried` below
   * true whenever the duplicates happened to reach the count.
   */
  const attempts = new Map<string, CandidateAttempt>();
  for (const s of chain.switches) {
    if (!attempts.has(s.from)) {
      attempts.set(s.from, {
        name: s.from,
        message: s.message,
        provider: s.provider,
        modelId: s.modelId,
        status: s.status,
        kind: s.kind,
      });
    }
  }
  if (!attempts.has(chain.used.describe)) {
    attempts.set(chain.used.describe, {
      name: chain.used.describe,
      message: error.message,
      provider: chain.used.provider,
      modelId: chain.used.modelId,
      status: error.status,
      kind: error.kind,
    });
  }
  return [...attempts.values()];
}

/**
 * Whether every key/provider this request could have tried actually got a
 * turn, so the message can say so instead of leaving it to be guessed from a
 * single provider's error.
 *
 * Silent when there is only one candidate to begin with — a lone key failing
 * has nothing to summarise beyond its own message. BYOK names each of the
 * user's own keys, since that is exactly what Ajustes lets them fix; the
 * metered tiers only report a count, because their fallbacks are the
 * operator's own standbys, not something the user manages or should see
 * named.
 */
function describeFailure(
  error: GenerationError,
  attempts: CandidateAttempt[],
  ctx: { chain: ModelChain; tier: Tier },
): string {
  const total = ctx.chain.candidates.length;

  if (ctx.tier === "byok") {
    const allTried = attempts.length >= total;
    return (
      `${error.message} Probamos tus ${total} keys` +
      (allTried ? "" : ` (llegamos a ${attempts.length} de ${total})`) +
      ":\n" +
      attempts.map((a) => ` • ${a.name} — ${a.message}`).join("\n")
    );
  }

  return `${error.message} (Probamos ${attempts.length} de ${total} alternativas de nuestro lado.)`;
}

/**
 * Normalises anything thrown during generation into a client-safe message.
 *
 * Split out from `failure` below for the streaming routes, which cannot answer
 * with a status: once a byte has been written the response is already a 200, so
 * a failure after that point travels as an `error` frame. Both paths phrase it
 * the same way because it is the same failure.
 *
 * `attempts`/`untried` ride alongside the prose rather than replacing it, so a
 * client that wants to act on them (reorder the chain, keep going on its own)
 * can, without parsing the sentence, while one that only prints the message
 * loses nothing. BYOK only: the metered tiers' fallbacks are the operator's
 * own standbys, not something the user manages, so naming them here would leak
 * exactly what `describeFailure`'s count-only phrasing is written to avoid.
 */
export function failureMessage(
  error: unknown,
  ctx?: { chain: ModelChain; tier: Tier },
): { message: string; status: number; attempts?: CandidateAttempt[]; untried?: number } {
  if (error instanceof GenerationError) {
    if (!ctx || ctx.chain.candidates.length <= 1) {
      console.warn(`[generate] request failed (${error.status}): ${error.message}`);
      return { message: error.message, status: error.status };
    }
    const attempts = candidateAttempts(ctx.chain, error);
    const message = describeFailure(error, attempts, ctx);
    /**
     * The same summary the user is reading, in the server's own log. It is the
     * one line that says how many of the configured keys were actually spent
     * before the request gave up — the difference between "the keys do not
     * work" and "this request never asked them". `GenerationError` already
     * redacted its half; the attempts list is built from those same messages.
     */
    console.warn(`[generate] request failed (${error.status}): ${message}`);
    if (ctx.tier !== "byok") return { message, status: error.status };
    return {
      message,
      status: error.status,
      attempts,
      untried: ctx.chain.candidates.length - attempts.length,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    "[generate] unexpected failure:",
    error instanceof Error ? error : redactKeys(message),
  );
  return { message: "Ocurrió un error inesperado al generar. Probá de nuevo.", status: 500 };
}

/** Normalises anything thrown during generation into a client-safe response. */
export function failure(error: unknown, ctx?: { chain: ModelChain; tier: Tier }): NextResponse {
  const { message, status, attempts, untried } = failureMessage(error, ctx);
  return NextResponse.json({ error: message, attempts, untried }, { status });
}
