import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit, requireVerifiedEmail } from "@/lib/api/guards";
import { databaseConfigured } from "@/lib/db";
import { ensureCvVersion, listCvVersions } from "@/lib/tracker/service";

export const runtime = "nodejs";

/**
 * Las versiones de CV del usuario — para el selector "¿cuál usaste?" cuando
 * "Ya me postulé" encuentra más de un CV local que podría corresponder al
 * aviso, y para la página de métricas (Fase 1). El documento nunca llega
 * acá — ver el comentario de `cvVersion` en `lib/db/schema.ts`.
 */
const RATE_LIMIT = { window: 60, max: 60 };

export async function GET(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  if (!databaseConfigured) return NextResponse.json({ versions: [] });

  const versions = await listCvVersions(user.id);
  return NextResponse.json({ versions });
}

const bodySchema = z.object({
  fingerprint: z.string().trim().min(1).max(64),
  label: z.string().trim().max(120).default(""),
});

export async function POST(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const verified = requireVerifiedEmail(user);
  if (verified) return verified;

  const limited = await enforceRateLimit("tracker-cv-versions", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos de versión inválidos." }, { status: 400 });

  if (!databaseConfigured) {
    return NextResponse.json({ error: "Esta instalación no tiene base de datos configurada." }, { status: 503 });
  }

  const version = await ensureCvVersion(user.id, parsed.data);
  return NextResponse.json({ version }, { status: 201 });
}
