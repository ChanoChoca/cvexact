import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit, requireVerifiedEmail } from "@/lib/api/guards";
import { databaseConfigured } from "@/lib/db";
import { activateEmailInbox, getEmailInbox, revokeEmailInbox, trackerEmailConfigured } from "@/lib/tracker/email-inbox";

export const runtime = "nodejs";

/**
 * Activar/consultar/revocar la detección de estados por email — la
 * pantalla de `/postulaciones` que pide `docs/tracker-email-fase3.md`.
 * Nunca clasifica nada acá: eso es `POST /api/tracker/email/ingest`, que
 * llama el Worker de Cloudflare, no el usuario.
 */
const RATE_LIMIT = { window: 3600, max: 20 };
const bodySchema = z.object({
  /** No opcional ni con default — el checkbox tiene que estar tildado a
   *  mano, misma regla que `TransferConsent.tsx` y `job_alerts`. */
  consent: z.literal(true),
});

export async function GET(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  if (!databaseConfigured) return NextResponse.json({ configured: trackerEmailConfigured, active: false, alias: null });

  const inbox = await getEmailInbox(user.id);
  return NextResponse.json({
    configured: trackerEmailConfigured,
    active: Boolean(inbox?.consentAt),
    alias: inbox?.alias ?? null,
    verified: Boolean(inbox?.verifiedAt),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const verified = requireVerifiedEmail(user);
  if (verified) return verified;

  const limited = await enforceRateLimit("tracker-email-inbox", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Hace falta el consentimiento explícito para activar esto." }, { status: 400 });
  }

  if (!trackerEmailConfigured) {
    return NextResponse.json(
      { error: "Esta instalación todavía no tiene la detección por email configurada." },
      { status: 503 },
    );
  }
  if (!databaseConfigured) {
    return NextResponse.json({ error: "Esta instalación no tiene base de datos configurada." }, { status: 503 });
  }

  const inbox = await activateEmailInbox(user.id);
  return NextResponse.json({ active: true, alias: inbox.alias, verified: Boolean(inbox.verifiedAt) });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const limited = await enforceRateLimit("tracker-email-inbox", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  if (databaseConfigured) await revokeEmailInbox(user.id);
  return NextResponse.json({ active: false });
}
