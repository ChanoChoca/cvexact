import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit, requireVerifiedEmail } from "@/lib/api/guards";
import { fetchJobPostingHtml, UnsafeUrlError } from "@/lib/tracker/safe-fetch";
import { extractJobPosting } from "@/lib/tracker/jsonld";
import { canonicalizeJobUrl } from "@/lib/tracker/job-url";

export const runtime = "nodejs";

/**
 * Parsea un aviso a partir de una URL que el propio usuario pegó — no
 * crea nada. El cliente muestra el resultado en un formulario prellenado
 * (falta lo que el JSON-LD no traía, o si no había JSON-LD, casi todo) y
 * confirma con el `POST /api/tracker/applications` de siempre, que además
 * corre la detección de duplicados.
 *
 * Límite bajo a propósito: es un fetch saliente que además resuelve DNS por
 * cada intento (`lib/tracker/safe-fetch.ts`), más caro que cualquier otra
 * ruta del tracker.
 */
const RATE_LIMIT = { window: 3600, max: 20 };
const bodySchema = z.object({ url: z.string().trim().url().max(2000) });

export async function POST(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const verified = requireVerifiedEmail(user);
  if (verified) return verified;

  const limited = await enforceRateLimit("tracker-import-url", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pegá una URL válida." }, { status: 400 });

  try {
    const html = await fetchJobPostingHtml(parsed.data.url);
    const fields = extractJobPosting(html, parsed.data.url);
    return NextResponse.json({ ...fields, jobUrl: canonicalizeJobUrl(fields.domJobUrl ?? parsed.data.url) });
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "No pudimos leer esa URL.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
