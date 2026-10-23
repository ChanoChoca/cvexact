import { NextResponse } from "next/server";
import { InvalidWebhookSignatureError, WebhookSignatureValidator } from "mercadopago";
import { eq } from "drizzle-orm";
import {
  getPayment,
  getSubscription,
  mercadoPagoConfigured,
  mercadoPagoWebhookConfigured,
} from "@/lib/payments/mercadopago";
import { packCredits } from "@/lib/billing/pack";
import { grantCredits, revokeCredits } from "@/lib/quota";
import { getDb, schema } from "@/lib/db";
import { ensureInvoice } from "@/lib/fiscal/invoice";

export const runtime = "nodejs";
// The signature covers this exact request, so nothing may be cached or reused.
export const dynamic = "force-dynamic";

/**
 * Credits a pack paid through Mercado Pago.
 *
 * Three disciplines, all here for the same reason — this endpoint hands out
 * money's worth of credits:
 *
 *  1. Signature first. An unverified payload never reaches the database — this
 *     endpoint hands out credits, so anything that reaches the crediting call
 *     without proof is a way to mint them for free.
 *  2. The status is asked for, not believed. The notification carries an id;
 *     what happened to that payment comes from the API.
 *  3. 500 on a transient failure so Mercado Pago retries, and `grantCredits`
 *     idempotent so the retry is harmless.
 */

/** Replay window. Wide enough for a retry, narrow enough to bound a replay. */
const TOLERANCE_SECONDS = 600;

export async function POST(request: Request) {
  if (!mercadoPagoConfigured) {
    return NextResponse.json({ error: "Mercado Pago no está configurado." }, { status: 503 });
  }

  // Refusing outright rather than skipping the check: an endpoint that credits
  // accounts must never run unauthenticated because a secret went missing.
  if (!mercadoPagoWebhookConfigured) {
    console.error("[mercadopago] MP_WEBHOOK_SECRET is not set; refusing notifications");
    return NextResponse.json({ error: "Webhook no configurado." }, { status: 503 });
  }

  const url = new URL(request.url);
  // Mercado Pago sends the id on the query string; some notification types also
  // repeat it in the body, and the signature is computed over the query one.
  const dataId = url.searchParams.get("data.id") ?? url.searchParams.get("id");

  try {
    // The SDK builds the manifest, compares in constant time, and checks the
    // timestamp. Hand-rolling this is how a webhook ends up accepting anything.
    WebhookSignatureValidator.validate({
      xSignature: request.headers.get("x-signature"),
      xRequestId: request.headers.get("x-request-id"),
      dataId,
      secret: process.env.MP_WEBHOOK_SECRET!,
      toleranceSeconds: TOLERANCE_SECONDS,
    });
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError) {
      console.error(
        `[mercadopago] signature rejected (${error.reason}) request-id=${error.requestId ?? "?"}`,
      );
      return NextResponse.json({ error: "Firma inválida." }, { status: 400 });
    }
    throw error;
  }

  // Branching happens *after* the signature check, never before: a subscription
  // notification is exactly as forgeable as a payment one, and deciding what
  // kind of thing an unverified request is would be doing work on an attacker's
  // say-so.
  const type = url.searchParams.get("type") ?? url.searchParams.get("topic");
  if (!dataId) return NextResponse.json({ received: true });

  try {
    switch (type) {
      case "payment":
        await creditPack(dataId);
        break;

      // The subscription itself changed: authorised, paused, cancelled.
      case "subscription_preapproval":
      // A monthly charge went through; refreshing moves the access period
      // forward, since it is measured against the next payment date.
      case "subscription_authorized_payment":
        await syncSubscription(dataId);
        break;

      default:
        // Mercado Pago sends far more types than this app has opinions about.
        // 200 so it stops retrying something ignored on purpose.
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error(
      `[mercadopago] failed to handle ${type} ${dataId}:`,
      error instanceof Error ? error.message : String(error),
    );
    // A 500 makes Mercado Pago retry, which is what we want for a transient
    // failure — the crediting itself is idempotent.
    return NextResponse.json({ error: "Error al procesar el aviso." }, { status: 500 });
  }
}

/**
 * Statuses that mean the money went back. Both reverse the same way — the
 * difference between a refund and a chargeback is who initiated it, not what
 * the ledger has to do about it.
 */
const REVERSED_STATUSES = new Set(["refunded", "charged_back"]);

/**
 * Credits a paid pack, or reverses one whose payment was refunded or charged
 * back. Idempotent through `grantCredits`/`revokeCredits` either way.
 */
async function creditPack(paymentId: string): Promise<void> {
  const payment = await getPayment(paymentId);

  if (REVERSED_STATUSES.has(payment.status)) {
    const reversed = await revokeCredits({ gateway: "mercadopago", externalId: paymentId });
    if (!reversed) {
      console.log(
        `[mercadopago] payment ${paymentId} (${payment.status}) was never credited, or already reversed; ignoring`,
      );
    }
    return;
  }

  // Anything else is pending or rejected. A pending payment that is later
  // approved arrives again as its own notification.
  if (payment.status !== "approved") return;

  const userId = payment.externalReference;
  if (!userId) {
    // Nothing to credit and nothing a retry would fix. Returning normally keeps
    // Mercado Pago from retrying forever against a payment that will never
    // carry a user.
    console.error(`[mercadopago] approved payment ${paymentId} carries no external_reference`);
    return;
  }

  const credited = await grantCredits({
    userId,
    credits: packCredits(),
    gateway: "mercadopago",
    externalId: paymentId,
  });

  if (!credited) {
    console.log(`[mercadopago] payment ${paymentId} was already credited; ignoring retry`);
  }

  /**
   * Facturar es una obligación aparte de acreditar, así que se llama en
   * todas las entregas de este webhook, acreditó de nuevo o no — un proceso
   * que se cayó entre `grantCredits` y esto en un intento anterior deja los
   * créditos puestos y la factura pendiente, y el reintento de Mercado Pago
   * es la única oportunidad de terminarla. `ensureInvoice` nunca tira ni
   * hace fallar este webhook: ver su propio comentario.
   */
  await ensureInvoice({
    userId,
    gateway: "mercadopago",
    externalId: paymentId,
    importe: payment.transactionAmount,
  });
}

/**
 * Mirrors a preapproval's state onto the user row, so the tier check stays one
 * read. The status is stored as Mercado Pago words it — `authorized` is the
 * active status in `lib/auth.ts`.
 */
/**
 * PENDIENTE: esto no factura los cargos de la suscripción.
 *
 * `lib/fiscal/invoice.ts` factura el pack porque `type: "payment"` trae un id
 * de `Payment` de verdad, que `getPayment` ya sabe leer. Un cargo mensual de
 * suscripción llega como `subscription_authorized_payment` con el id de un
 * recurso distinto (un "authorized payment" bajo el `PreApproval`, no un
 * `Payment` común), que este código nunca pidió ni parseó — así que cada
 * cobro de una suscripción activa queda hoy sin comprobante. Es una brecha
 * real: la obligación de facturar por venta no distingue pago único de
 * recurrente. Antes de dar la Fase 2 por completa hay que sumar acá el
 * mismo `ensureInvoice`, con el monto y la fecha de ese cargo específico.
 */
async function syncSubscription(preapprovalId: string): Promise<void> {
  const subscription = await getSubscription(preapprovalId);

  const userId = subscription.externalReference;
  if (!userId) {
    console.error(`[mercadopago] preapproval ${subscription.id} carries no external_reference`);
    return;
  }

  await getDb()
    .update(schema.user)
    .set({
      subscriptionStatus: subscription.status,
      subscriptionCurrentPeriodEnd: subscription.nextPaymentDate
        ? new Date(subscription.nextPaymentDate)
        : null,
      subscriptionGateway: "mercadopago",
      subscriptionExternalId: subscription.id,
    })
    .where(eq(schema.user.id, userId));
}
