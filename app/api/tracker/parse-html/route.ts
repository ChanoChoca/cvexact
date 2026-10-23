import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit, requireVerifiedEmail } from "@/lib/api/guards";
import { getApiUser } from "@/lib/tracker/extension-auth";
import { extractJobPosting } from "@/lib/tracker/jsonld";
import { canonicalizeJobUrl } from "@/lib/tracker/job-url";
import { getExperienceSignal, rankTitleCandidates } from "@/lib/tracker/rank-title";

export const runtime = "nodejs";

/**
 * La otra mitad del import por URL (`app/api/tracker/import/url/route.ts`),
 * pero sin el fetch: acá el HTML ya viene adjunto, porque quien llama es la
 * extensión de navegador (Fase 4) — el HTML de la página que la persona ya
 * tiene abierta, leído por su propio navegador al apretar "Capturar este
 * aviso", nunca por un fetch nuestro. Es justamente lo que evita que
 * capturar un aviso de LinkedIn o Indeed sea "nuestro servidor scrapeando
 * LinkedIn": nunca les pedimos nada, sólo interpretamos lo que el
 * navegador de la persona ya cargó frente a ella. `extractJobPosting` es
 * la misma función que usa el import por URL — una sola implementación de
 * "cómo se lee un aviso", los dos caminos sólo difieren en de dónde sale
 * el HTML.
 */
const RATE_LIMIT = { window: 3600, max: 60 };
const bodySchema = z.object({
  html: z.string().min(1).max(3 * 1024 * 1024),
  url: z.string().trim().url().max(2000),
});

export async function POST(request: Request) {
  const user = await getApiUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const verified = requireVerifiedEmail(user);
  if (verified) return verified;

  const limited = await enforceRateLimit("tracker-parse-html", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Payload inválido." }, { status: 400 });

  const fields = extractJobPosting(parsed.data.html, parsed.data.url);

  // Sólo cuando hay entre qué elegir — un aviso normal de /jobs/ nunca trae
  // más de un candidato, así que esto no le agrega una consulta de más a ese
  // camino. La idea es del propio usuario: ordenar los puestos detectados en
  // una publicación según lo que ya tiene cargado en su perfil, sin ningún
  // modelo — sólo si alguna vez hizo "Subir" (`POST /api/sync`) hay algo con
  // qué comparar (`getExperienceSignal`); si no, el orden queda igual.
  let result = fields;
  if (fields.extractedFrom === "site-post" && (fields.jobTitleCandidates?.length ?? 0) > 1) {
    const experience = await getExperienceSignal(user.id);
    const ranked = rankTitleCandidates(fields.jobTitleCandidates!, experience);
    result = { ...fields, jobTitle: ranked[0] ?? fields.jobTitle, jobTitleCandidates: ranked };
  }

  return NextResponse.json({ ...result, jobUrl: canonicalizeJobUrl(result.domJobUrl ?? parsed.data.url) });
}
