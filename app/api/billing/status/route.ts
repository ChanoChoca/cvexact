import { NextResponse } from "next/server";
import { byokChain } from "@/lib/api/context";
import { serviceKeyConfigured } from "@/lib/ai/provider";
import { getSessionUser, hasActiveSubscription } from "@/lib/auth";
import {
  APPLICATION_COST,
  clientIp,
  creditBalance,
  CREDIT_EXPIRY_MONTHS,
  PAID_DAILY_CAP,
  PAID_MONTHLY_CAP,
  quotaSubject,
  quotaStatus,
} from "@/lib/quota";
import { packCredits } from "@/lib/billing/pack";
import {
  mercadoPagoConfigured,
  mercadoPagoSubscriptionConfigured,
  packPriceArs,
  subscriptionPriceArs,
} from "@/lib/payments/mercadopago";
import type { Action, Tier } from "@/lib/quota";

export const runtime = "nodejs";
// Reads a per-user counter, so a cached response would show someone else's.
export const dynamic = "force-dynamic";

/**
 * What is left, before it runs out.
 *
 * The server has always sent the remaining quota on a refusal and nothing read
 * it, so the only way to discover a limit was to hit it. This is the same
 * numbers, available before that happens.
 *
 * Deliberately outside `openRequest`: asking how much is left must not spend
 * any of it, for the same reason listing a provider's models does not.
 */
const ACTIONS = new Set<Action>([
  "cv",
  "answers",
  "email",
  "interview",
  "video",
  "metrics",
  "intake",
  "import",
]);

/**
 * Lo esencial de lo que se está por comprar, para poder mostrarlo ANTES del
 * checkout.
 *
 * El art. 4 de la Ley 24.240 y el art. 1100 del CCyC piden que el consumidor
 * tenga la información esencial antes de obligarse, y hasta acá el único lugar
 * donde vivía el precio era `/precios` y el checkout de Mercado Pago: se podía
 * llegar al botón de comprar desde Ajustes sin haber visto nunca cuánto sale ni
 * que la suscripción se renueva sola.
 *
 * Una sola función y no dos bloques inline porque esta ruta ya tenía a
 * `packApplications` calculado por duplicado en sus dos ramas, que es el
 * principio de que las dos digan cosas distintas.
 *
 * Los precios se leen dentro de un `try`: `packPriceArs()` lanza cuando la
 * variable no está, y una instalación sin precio configurado tiene que informar
 * "no hay precio" y no romper la única ruta que dice cuánto queda.
 */
function purchaseTerms() {
  const price = (read: () => number): number | null => {
    try {
      return read();
    } catch {
      return null;
    }
  };

  return {
    pack: mercadoPagoConfigured
      ? {
          priceArs: price(packPriceArs),
          credits: packCredits(),
          applications: Math.floor(packCredits() / APPLICATION_COST),
          // Sólo compras nuevas — ver `CREDIT_EXPIRY_MONTHS` en `lib/quota.ts`.
          expiryMonths: CREDIT_EXPIRY_MONTHS,
        }
      : null,
    subscription: mercadoPagoSubscriptionConfigured
      ? {
          priceArs: price(subscriptionPriceArs),
          monthlyApplications: Math.floor(PAID_MONTHLY_CAP / APPLICATION_COST),
          dailyApplications: Math.floor(PAID_DAILY_CAP / APPLICATION_COST),
        }
      : null,
  };
}

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("action");
  const action = (ACTIONS.has(requested as Action) ? requested : "cv") as Action;

  // Resolved unconditionally, BYOK or not: a subscriber who also pasted a key
  // of their own into Ajustes still has a real subscription to cancel and a
  // real credit balance sitting unused, and Ajustes needs both to draw the
  // "cancelar suscripción" button and the balance. This route used to skip
  // the session lookup entirely on any BYOK chain and report `signedIn:
  // false`, which hid that button from exactly the accounts that combined
  // the two — leaving `/baja` as the only way out for someone the UI told was
  // signed out.
  const user = await getSessionUser(request.headers);
  const credits = user ? await creditBalance(user.id) : 0;
  const subscription = {
    gateway: (user?.subscriptionGateway as "mercadopago" | null) ?? null,
    active: user ? hasActiveSubscription(user) : false,
    canSubscribe: { mercadopago: mercadoPagoSubscriptionConfigured },
  };

  // Detected through the same helper `resolveTier` uses, not by re-reading the
  // headers here. Only the quota-facing fields (`tier`, `used`, `allowance`)
  // answer to the BYOK chain — a key of one's own is unlimited by definition
  // and `resolveTier`'s precedence runs generations through it regardless of
  // any subscription — but `signedIn`, `credits` and `subscription` above
  // describe the account, not the chain, and must stay real either way.
  if (byokChain(request.headers).length > 0) {
    return NextResponse.json({
      tier: "byok" satisfies Tier,
      used: 0,
      allowance: null,
      credits,
      gateways: [...(mercadoPagoConfigured ? (["mercadopago"] as const) : [])],
      serviceConfigured: serviceKeyConfigured(),
      packApplications: mercadoPagoConfigured
        ? Math.floor(packCredits() / APPLICATION_COST)
        : null,
      signedIn: Boolean(user),
      subscription,
      terms: purchaseTerms(),
    });
  }

  const tier: Tier = user
    ? hasActiveSubscription(user)
      ? "pro"
      : credits > 0
        ? "credits"
        : "free"
    : "free";

  const status = await quotaStatus({
    tier,
    subject: quotaSubject({ userId: user?.id, ip: clientIp(request.headers) }),
    action,
    userId: user?.id,
  });

  return NextResponse.json({
    ...status,
    credits,
    /**
     * Whether we have a key to serve this tier with at all.
     *
     * Without it the balance above is a promise this installation may not be
     * able to keep: with no key of our own, every one of these allowances is
     * real as a counter and worthless as a capability, and the UI would tell
     * someone they have fifteen uses left of something that answers 400.
     */
    serviceConfigured: serviceKeyConfigured(),
    /**
     * Which gateways can actually take money right now.
     *
     * A list rather than a boolean: the UI draws a button per entry, so an
     * installation missing a gateway's keys cannot offer a button that 503s.
     */
    gateways: [...(mercadoPagoConfigured ? (["mercadopago"] as const) : [])],
    /**
     * The pack in the unit a person thinks in.
     *
     * Divided here rather than in the browser because `APPLICATION_COST` lives
     * in `lib/quota.ts`, which is server-only — and because a client that did
     * its own arithmetic would be free to disagree with what the server meters.
     */
    packApplications: mercadoPagoConfigured
      ? Math.floor(packCredits() / APPLICATION_COST)
      : null,
    signedIn: Boolean(user),
    /**
     * Which subscription controls to draw. Mercado Pago has no billing portal,
     * so its subscribers need a cancel button this app operates — and someone
     * with no subscription needs neither. Computed once, above, and shared
     * with the BYOK branch: the subscription is a property of the account, not
     * of which chain served the last generation.
     */
    subscription,
    terms: purchaseTerms(),
  });
}
