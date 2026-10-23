import "server-only";

import { MercadoPagoConfig, Payment, PreApproval, Preference } from "mercadopago";

/**
 * Mercado Pago, for the users this product is actually for.
 *
 * The only payment gateway this app talks to: a `configured` flag each route
 * checks before acting, a cached client, and the operations a pack and a
 * subscription need.
 *
 * Both products live here: the pack, a one-off `Preference`, and the
 * subscription, which Mercado Pago models as a *preapproval* with a lifecycle
 * of its own — authorised, paused, cancelled — and no billing portal, so the
 * cancellation is an API call we make rather than a page we link to.
 */

export const mercadoPagoConfigured = Boolean(
  process.env.MP_ACCESS_TOKEN && process.env.MP_PACK_PRICE_ARS,
);

/** The subscription is configured separately: an install can sell only packs. */
export const mercadoPagoSubscriptionConfigured = Boolean(
  process.env.MP_ACCESS_TOKEN && process.env.MP_SUB_PRICE_ARS,
);

/** Whether incoming notifications can be verified. Without it, none are trusted. */
export const mercadoPagoWebhookConfigured = Boolean(process.env.MP_WEBHOOK_SECRET);

/**
 * Logs an SDK error, including whatever detail Mercado Pago's response body
 * carried beyond `.message` (the SDK's error classes expose `.status` and
 * `.causes`, an array of the specific reasons — e.g. why a 401 was a 401).
 */
export function logMercadoPagoError(context: string, error: unknown): void {
  if (!(error instanceof Error)) {
    console.error(context, String(error));
    return;
  }
  const status = (error as { status?: unknown }).status;
  if (status === undefined) {
    // Not an SDK error (e.g. our own "MP_ACCESS_TOKEN is not set" guard) — no extra detail to add.
    console.error(context, error.message);
    return;
  }
  const code = (error as { error?: unknown }).error;
  const causes = (error as { causes?: unknown }).causes;
  console.error(context, error.message, {
    status,
    error: code || undefined,
    causes: Array.isArray(causes) && causes.length > 0 ? causes : undefined,
  });
}

let cached: MercadoPagoConfig | null = null;

/** Throws when Mercado Pago is not configured — check the flag first. */
function client(): MercadoPagoConfig {
  if (!process.env.MP_ACCESS_TOKEN) {
    throw new Error("MP_ACCESS_TOKEN is not set. Guard with `mercadoPagoConfigured` first.");
  }
  cached ??= new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
  return cached;
}

/**
 * The pack price in pesos.
 *
 * An environment variable rather than a constant because a fixed price in ARS
 * loses value on its own: inflation erodes it, and a number compiled into the
 * bundle needs a deploy to fix. This needs revisiting a few times a year — see
 * the note in the README.
 */
export function packPriceArs(): number {
  const configured = Number(process.env.MP_PACK_PRICE_ARS);
  if (!Number.isFinite(configured) || configured <= 0) {
    throw new Error("MP_PACK_PRICE_ARS must be a positive number.");
  }
  return configured;
}

/**
 * Starts a Checkout Pro payment and returns where to send the user.
 *
 * `external_reference` carries the user id: the webhook arrives with no session
 * of its own, and this is how it learns whose balance to credit.
 */
export async function createPackCheckout(input: {
  userId: string;
  email: string;
  credits: number;
  returnUrl: string;
}): Promise<string> {
  const preference = await new Preference(client()).create({
    body: {
      items: [
        {
          id: "pack-creditos",
          title: `cvexact — ${input.credits} créditos`,
          quantity: 1,
          unit_price: packPriceArs(),
          currency_id: "ARS",
        },
      ],
      payer: { email: input.email },
      external_reference: input.userId,
      back_urls: {
        success: `${input.returnUrl}?creditos=ok`,
        pending: `${input.returnUrl}?creditos=pendiente`,
        failure: input.returnUrl,
      },
      auto_return: "approved",
    },
  });

  const url = preference.init_point;
  if (!url) throw new Error("Mercado Pago returned a preference with no init_point.");
  return url;
}


export type MercadoPagoPayment = {
  status: string;
  externalReference: string | null;
  /**
   * Lo que el pago realmente cobró, en pesos. `lib/fiscal/invoice.ts` factura
   * este número — no `packPriceArs()` — porque el comprobante tiene que decir
   * lo que se cobró de verdad, no el precio vigente al momento del webhook. Un
   * ajuste de precio entre la compra y la entrega de la notificación no puede
   * hacer que la factura diga un monto distinto del que la tarjeta vio.
   */
  transactionAmount: number;
};

/**
 * Asks Mercado Pago what actually happened to a payment.
 *
 * The webhook never trusts what it is handed: a notification carries an id and
 * nothing else worth believing, so the status is fetched rather than read off
 * the request. A body that says "approved" is not evidence that anyone paid.
 */
export async function getPayment(id: string): Promise<MercadoPagoPayment> {
  const payment = await new Payment(client()).get({ id });
  return {
    status: payment.status ?? "unknown",
    externalReference: payment.external_reference ?? null,
    transactionAmount: payment.transaction_amount ?? 0,
  };
}

// --- Subscription (preapproval) ----------------------------------------------

/** The monthly price in pesos. Same caveat as the pack: it needs revisiting. */
export function subscriptionPriceArs(): number {
  const configured = Number(process.env.MP_SUB_PRICE_ARS);
  if (!Number.isFinite(configured) || configured <= 0) {
    throw new Error("MP_SUB_PRICE_ARS must be a positive number.");
  }
  return configured;
}

/**
 * Starts a monthly subscription and returns where to send the user to authorise
 * it. `external_reference` carries the user id, exactly as the pack does.
 */
export async function createSubscription(input: {
  userId: string;
  email: string;
  backUrl: string;
}): Promise<string> {
  const preapproval = await new PreApproval(client()).create({
    body: {
      reason: "cvexact — suscripción mensual",
      external_reference: input.userId,
      payer_email: input.email,
      back_url: input.backUrl,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: subscriptionPriceArs(),
        currency_id: "ARS",
      },
      status: "pending",
    },
  });

  const url = preapproval.init_point;
  if (!url) throw new Error("Mercado Pago returned a preapproval with no init_point.");
  return url;
}

export type MercadoPagoSubscription = {
  id: string;
  status: string;
  externalReference: string | null;
  /** When the next charge is due; what the access period is measured against. */
  nextPaymentDate: string | null;
};

/** Asks Mercado Pago for the real state of a subscription. */
export async function getSubscription(id: string): Promise<MercadoPagoSubscription> {
  const preapproval = await new PreApproval(client()).get({ id });
  return {
    id: preapproval.id ?? id,
    status: preapproval.status ?? "unknown",
    externalReference: preapproval.external_reference ?? null,
    nextPaymentDate: preapproval.next_payment_date ?? null,
  };
}

/**
 * Cancels a subscription.
 *
 * Mercado Pago has no billing portal, so this is the only way out for the user
 * — which makes it a control the product has to provide rather than link to.
 */
export async function cancelSubscription(id: string): Promise<void> {
  await new PreApproval(client()).update({ id, body: { status: "cancelled" } });
}
