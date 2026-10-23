import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit, requireVerifiedEmail } from "@/lib/api/guards";
import { databaseConfigured } from "@/lib/db";
import { createApplication, listApplications } from "@/lib/tracker/service";
import { parseApplicationsQuery } from "@/lib/tracker/query";
import { findDuplicates } from "@/lib/tracker/duplicates";
import { getApiUser } from "@/lib/tracker/extension-auth";
import { APPLICATION_STATUSES } from "@/lib/tracker/status";
import { canonicalizeJobUrl } from "@/lib/tracker/job-url";

export const runtime = "nodejs";

const RATE_LIMIT = { window: 60, max: 60 };
const CREATE_RATE_LIMIT = { window: 3600, max: 200 };

/**
 * GET lista las postulaciones del usuario (kanban y tabla comparten esta
 * misma query — `lib/tracker/query.ts` traduce los filtros de la URL).
 * POST crea una — el camino que usan "Guardar"/"Ya me postulé" en
 * `/empleos` y el alta manual desde `/postulaciones`.
 */

export async function GET(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const limited = await enforceRateLimit("tracker-applications", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  if (!databaseConfigured) return NextResponse.json({ applications: [] });

  const filter = parseApplicationsQuery(new URL(request.url));
  const applications = await listApplications(user.id, filter);
  return NextResponse.json({ applications });
}

const createSchema = z.object({
  id: z.string().uuid().optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
  jobTitle: z.string().trim().max(200).optional(),
  company: z.string().trim().max(200).optional(),
  source: z.string().trim().max(60).optional(),
  jobPostingId: z.string().trim().max(200).optional(),
  jobUrl: z.string().trim().max(2000).optional(),
  jdText: z.string().trim().max(20_000).optional(),
  location: z.string().trim().max(200).optional(),
  remote: z.boolean().optional(),
  salaryMin: z.number().int().min(0).max(10_000_000).optional(),
  salaryMax: z.number().int().min(0).max(10_000_000).optional(),
  currency: z.string().trim().max(10).optional(),
  label: z.string().trim().max(200).optional(),
  /** ISO — presente cuando "Ya me postulé" ya marca la fecha real. */
  appliedAt: z.string().datetime().optional(),
});

export async function POST(request: Request) {
  // getApiUser, no getSessionUser: es una de las dos routes que además
  // acepta el token de la extensión de navegador (Fase 4) — ver
  // lib/tracker/extension-auth.ts.
  const user = await getApiUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const verified = requireVerifiedEmail(user);
  if (verified) return verified;

  const limited = await enforceRateLimit("tracker-applications-create", request.headers, CREATE_RATE_LIMIT, user.id);
  if (limited) return limited;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos de la postulación inválidos." }, { status: 400 });
  }

  if (!databaseConfigured) {
    return NextResponse.json(
      { error: "Esta instalación no tiene base de datos configurada." },
      { status: 503 },
    );
  }

  const { appliedAt, jobUrl, ...rest } = parsed.data;
  const application = await createApplication(user.id, {
    ...rest,
    jobUrl: jobUrl ? canonicalizeJobUrl(jobUrl) : undefined,
    appliedAt: appliedAt ? new Date(appliedAt) : undefined,
  });

  // Nunca bloquea — sólo avisa. `excludeId` para que la fila recién creada
  // no se marque a sí misma como su propio duplicado.
  const duplicates =
    application.company || application.jobTitle
      ? await findDuplicates(
          user.id,
          { company: application.company ?? "", jobTitle: application.jobTitle ?? "" },
          application.id,
        )
      : [];

  return NextResponse.json({ application, duplicates }, { status: 201 });
}
