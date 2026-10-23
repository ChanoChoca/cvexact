import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit, requireVerifiedEmail } from "@/lib/api/guards";
import { getDb, schema } from "@/lib/db";
import { publicUrl } from "@/lib/billing/pack";
import {
  cancelSubscription,
  createSubscription,
  logMercadoPagoError,
  mercadoPagoSubscriptionConfigured,
} from "@/lib/payments/mercadopago";

export const runtime = "nodejs";

/**
 * Subscribing and unsubscribing through Mercado Pago.
 *
 * Mercado Pago has no billing portal, so cancelling is something this app has
 * to do on the user's behalf. That makes DELETE below the only exit, and the
 * reason it must be careful about whose subscription it is cancelling.
 */

export async function POST(request: Request) {
  if (!mercadoPagoSubscriptionConfigured) {
    return NextResponse.json(
      { error: "La suscripción por Mercado Pago no está habilitada." },
      { status: 503 },
    );
  }

  const user = await getSessionUser(request.headers);
  if (!user) {
    return NextResponse.json({ error: "Iniciá sesión para suscribirte." }, { status: 401 });
  }

  // A recurring charge against an address nobody has proved they can read is a
  // dispute waiting to happen: the receipts, the renewal notices and the
  // cancellation confirmation all go somewhere unverified. DELETE below is
  // deliberately *not* gated — whatever else is true, cancelling must stay easy.
  const unverified = requireVerifiedEmail(user);
  if (unverified) return unverified;

  // Same reasoning as the pack checkout's guard: this calls Mercado Pago's
  // own API to open a preapproval, and nothing else here bounds how often
  // that can happen.
  const limited = await enforceRateLimit("mp-subscription", request.headers, { window: 300, max: 10 }, user.id);
  if (limited) return limited;

  try {
    const url = await createSubscription({
      userId: user.id,
      email: user.email,
      backUrl: `${publicUrl()}/cuenta?suscripcion=ok`,
    });
    return NextResponse.json({ url });
  } catch (error) {
    logMercadoPagoError("[mercadopago] subscription create failed:", error);
    return NextResponse.json({ error: "No pudimos abrir la suscripción." }, { status: 502 });
  }
}

/**
 * Cancels the signed-in user's subscription.
 *
 * The id comes from *their own row*, never from the request. A caller supplying
 * the id to cancel would be able to cancel a stranger's subscription by
 * guessing one, and there is nothing about a preapproval id that makes it
 * secret. The session decides whose subscription this is; the body has no say.
 */
export async function DELETE(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) {
    return NextResponse.json({ error: "Iniciá sesión." }, { status: 401 });
  }

  const db = getDb();
  const [row] = await db
    .select({
      gateway: schema.user.subscriptionGateway,
      externalId: schema.user.subscriptionExternalId,
    })
    .from(schema.user)
    .where(eq(schema.user.id, user.id))
    .limit(1);

  if (row?.gateway !== "mercadopago" || !row.externalId) {
    return NextResponse.json(
      { error: "No tenés una suscripción de Mercado Pago activa." },
      { status: 400 },
    );
  }

  try {
    await cancelSubscription(row.externalId);
  } catch (error) {
    logMercadoPagoError("[mercadopago] subscription cancel failed:", error);
    return NextResponse.json({ error: "No pudimos cancelar la suscripción." }, { status: 502 });
  }

  // Written here as well as by the webhook: the user is looking at the screen
  // now, and a cancellation that appears to have done nothing until a
  // notification arrives reads as a failure and gets clicked again.
  await db
    .update(schema.user)
    .set({ subscriptionStatus: "cancelled" })
    .where(eq(schema.user.id, user.id));

  return NextResponse.json({ cancelled: true });
}
