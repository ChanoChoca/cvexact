import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit, requireVerifiedEmail } from "@/lib/api/guards";
import { databaseConfigured } from "@/lib/db";
import { addNote, createApplication } from "@/lib/tracker/service";
import { findDuplicates } from "@/lib/tracker/duplicates";
import { APPLICATION_STATUSES } from "@/lib/tracker/status";

export const runtime = "nodejs";

/**
 * El cliente ya parseó el CSV y aplicó el mapeo de columnas
 * (`lib/tracker/csv.ts`, isomorfo) y mostró el preview — acá sólo llega lo
 * ya mapeado, una fila por postulación. Esta route es la única que escribe:
 * vuelve a validar con Zod (nunca confiar en lo que mandó el cliente) y crea
 * cada fila, sin bloquear por duplicados — sólo los reporta, igual que
 * `POST /api/tracker/applications`.
 */
const RATE_LIMIT = { window: 3600, max: 10 };
const MAX_ROWS = 500;

const rowSchema = z
  .object({
    jobTitle: z.string().trim().max(200).optional(),
    company: z.string().trim().max(200).optional(),
    location: z.string().trim().max(200).optional(),
    remote: z.boolean().optional(),
    source: z.string().trim().max(60).optional(),
    jobUrl: z.string().trim().max(2000).optional(),
    status: z.enum(APPLICATION_STATUSES).optional(),
    salaryMin: z.number().int().min(0).max(10_000_000).optional(),
    salaryMax: z.number().int().min(0).max(10_000_000).optional(),
    currency: z.string().trim().max(10).optional(),
    appliedAt: z.string().datetime().optional(),
    notes: z.string().trim().max(4000).optional(),
  })
  .refine((v) => v.jobTitle || v.company, { message: "Falta el puesto y la empresa." });

const bodySchema = z.object({ rows: z.array(rowSchema).min(1).max(MAX_ROWS) });

export async function POST(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const verified = requireVerifiedEmail(user);
  if (verified) return verified;

  const limited = await enforceRateLimit("tracker-import-csv", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "El archivo no tiene el formato esperado." }, { status: 400 });
  }

  if (!databaseConfigured) {
    return NextResponse.json({ error: "Esta instalación no tiene base de datos configurada." }, { status: 503 });
  }

  let created = 0;
  const duplicates: { row: number; jobTitle?: string; company?: string }[] = [];
  const rejected: { row: number; reason: string }[] = [];

  for (const [index, row] of parsed.data.rows.entries()) {
    try {
      if (row.company || row.jobTitle) {
        const matches = await findDuplicates(user.id, {
          company: row.company ?? "",
          jobTitle: row.jobTitle ?? "",
        });
        if (matches.length > 0) duplicates.push({ row: index + 1, jobTitle: row.jobTitle, company: row.company });
      }

      const { notes, appliedAt, ...fields } = row;
      const application = await createApplication(user.id, {
        ...fields,
        source: fields.source ?? "csv",
        appliedAt: appliedAt ? new Date(appliedAt) : undefined,
      });
      if (notes) await addNote(user.id, application.id, notes);
      created += 1;
    } catch {
      rejected.push({ row: index + 1, reason: "No se pudo crear esta fila." });
    }
  }

  return NextResponse.json({ created, duplicates, rejected });
}
