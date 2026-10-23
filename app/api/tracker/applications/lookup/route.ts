import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/api/guards";
import { databaseConfigured } from "@/lib/db";
import { getApplicationByUrl } from "@/lib/tracker/service";
import { getApiUser } from "@/lib/tracker/extension-auth";
import { canonicalizeJobUrl } from "@/lib/tracker/job-url";

export const runtime = "nodejs";

/**
 * "¿El aviso de esta URL ya está en mi seguimiento?" — la extensión de
 * navegador (Fase 4) la llama al abrir el popup, para el badge de estado.
 * `getApiUser`, no `getSessionUser`: es una de las dos routes que la
 * extensión usa con su token propio (la otra es la creación en
 * `applications/route.ts`).
 */
const RATE_LIMIT = { window: 60, max: 120 };

export async function GET(request: Request) {
  const user = await getApiUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const limited = await enforceRateLimit("tracker-applications-lookup", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  const url = new URL(request.url).searchParams.get("url")?.trim();
  if (!url) return NextResponse.json({ error: "Falta la URL." }, { status: 400 });

  if (!databaseConfigured) return NextResponse.json({ application: null });

  const application = await getApplicationByUrl(user.id, canonicalizeJobUrl(url));
  return NextResponse.json({ application });
}
