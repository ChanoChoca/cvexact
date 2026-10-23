import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit, requireVerifiedEmail } from "@/lib/api/guards";
import { databaseConfigured } from "@/lib/db";
import { hasTrackerMailConsent, recordTrackerMailConsent, withdrawTrackerMailConsent } from "@/lib/legal/consent";

export const runtime = "nodejs";

/**
 * Activar/consultar/retirar el consentimiento al aviso de ghosting por
 * correo — cláusula 16 de la política de privacidad. Mismo patrón que
 * `app/api/tracker/email-inbox/route.ts`: sin este endpoint no hay forma de
 * probar que el checkbox se tildó a mano.
 *
 * No manda nada por sí solo: `app/api/tracker/cron/route.ts` vuelve a
 * comprobar `hasTrackerMailConsent` en cada corrida antes de mandar el
 * aviso de ghosting. La detección de abandono en sí (`markGhostedApplications`)
 * no depende de este consentimiento — ver el comentario de
 * `withdrawTrackerMailConsent`.
 */
const RATE_LIMIT = { window: 3600, max: 20 };
const bodySchema = z.object({
  /** No opcional ni con default — el checkbox tiene que estar tildado a
   *  mano, misma regla que `email-inbox` y `job_alerts`. */
  consent: z.literal(true),
});

export async function GET(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  if (!databaseConfigured) return NextResponse.json({ active: false });

  return NextResponse.json({ active: await hasTrackerMailConsent(user.id) });
}

export async function POST(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const verified = requireVerifiedEmail(user);
  if (verified) return verified;

  const limited = await enforceRateLimit("tracker-mail-consent", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Hace falta el consentimiento explícito para activar esto." }, { status: 400 });
  }

  if (!databaseConfigured) {
    return NextResponse.json({ error: "Esta instalación no tiene base de datos configurada." }, { status: 503 });
  }

  await recordTrackerMailConsent(user.id);
  return NextResponse.json({ active: true });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const limited = await enforceRateLimit("tracker-mail-consent", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  if (databaseConfigured) await withdrawTrackerMailConsent(user.id);
  return NextResponse.json({ active: false });
}
