import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit, requireVerifiedEmail } from "@/lib/api/guards";
import { databaseConfigured } from "@/lib/db";
import { generateExtensionToken, hasExtensionToken, revokeExtensionToken } from "@/lib/tracker/extension-auth";

export const runtime = "nodejs";

/**
 * Generar/consultar/revocar el token de la extensión de navegador (Fase
 * 4). Siempre por sesión web — nunca por el propio token, que sería dejar
 * que un token robado se renueve a sí mismo indefinidamente.
 */
const RATE_LIMIT = { window: 3600, max: 10 };

export async function GET(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  if (!databaseConfigured) return NextResponse.json({ active: false });
  return NextResponse.json({ active: await hasExtensionToken(user.id) });
}

export async function POST(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const verified = requireVerifiedEmail(user);
  if (verified) return verified;

  const limited = await enforceRateLimit("tracker-extension-token", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  if (!databaseConfigured) {
    return NextResponse.json({ error: "Esta instalación no tiene base de datos configurada." }, { status: 503 });
  }

  const token = await generateExtensionToken(user.id);
  return NextResponse.json({ token });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  if (databaseConfigured) await revokeExtensionToken(user.id);
  return NextResponse.json({ active: false });
}
