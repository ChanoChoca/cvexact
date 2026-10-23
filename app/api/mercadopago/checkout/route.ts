import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/api/guards";
import {
  createPackCheckout,
  logMercadoPagoError,
  mercadoPagoConfigured,
} from "@/lib/payments/mercadopago";
import { packCredits, publicUrl } from "@/lib/billing/pack";

export const runtime = "nodejs";

/**
 * Buys a credit pack through Mercado Pago.
 *
 * Answers `{ url }` so the client does not have to know anything about the
 * gateway beyond which button was pressed.
 *
 * `packCredits` comes from `lib/billing/pack.ts` on purpose: the pack is one
 * product, and the number of credits it grants must not depend on how it was
 * paid for.
 */
export async function POST(request: Request) {
  if (!mercadoPagoConfigured) {
    return NextResponse.json(
      { error: "Mercado Pago no está habilitado en esta instalación." },
      { status: 503 },
    );
  }

  // The session lives in a cookie on this request; a fresh Headers would
  // make every caller anonymous.
  const user = await getSessionUser(request.headers);
  if (!user) {
    return NextResponse.json({ error: "Iniciá sesión para comprar créditos." }, { status: 401 });
  }

  // Every call here is a request to Mercado Pago's own API to open a checkout
  // session — generous enough for someone retrying a page that did not load,
  // tight enough that a loop cannot spend this deployment's MP API budget on
  // sessions nobody will ever pay.
  const limited = await enforceRateLimit("mp-checkout", request.headers, { window: 300, max: 10 }, user.id);
  if (limited) return limited;

  try {
    const url = await createPackCheckout({
      userId: user.id,
      email: user.email,
      credits: packCredits(),
      returnUrl: `${publicUrl()}/cuenta`,
    });
    return NextResponse.json({ url });
  } catch (error) {
    logMercadoPagoError("[mercadopago] checkout failed:", error);
    return NextResponse.json({ error: "No pudimos abrir el pago." }, { status: 502 });
  }
}
