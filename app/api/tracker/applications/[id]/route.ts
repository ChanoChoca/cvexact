import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit, requireVerifiedEmail } from "@/lib/api/guards";
import { databaseConfigured } from "@/lib/db";
import {
  changeStatus,
  deleteApplication,
  getApplicationDetail,
  linkCvVersion,
  updateApplicationFields,
} from "@/lib/tracker/service";
import { trackerErrorResponse } from "@/lib/tracker/http";
import { APPLICATION_STATUSES } from "@/lib/tracker/status";

export const runtime = "nodejs";

const RATE_LIMIT = { window: 60, max: 120 };

export async function GET(request: Request, ctx: RouteContext<"/api/tracker/applications/[id]">) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  if (!databaseConfigured) {
    return NextResponse.json({ error: "Esta instalación no tiene base de datos configurada." }, { status: 503 });
  }

  const { id } = await ctx.params;
  try {
    const detail = await getApplicationDetail(user.id, id);
    return NextResponse.json(detail);
  } catch (error) {
    return trackerErrorResponse(error) ?? NextResponse.json({ error: "Error inesperado." }, { status: 500 });
  }
}

const patchSchema = z.object({
  jobTitle: z.string().trim().max(200).optional(),
  company: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  remote: z.boolean().optional(),
  salaryMin: z.number().int().min(0).max(10_000_000).nullable().optional(),
  salaryMax: z.number().int().min(0).max(10_000_000).nullable().optional(),
  currency: z.string().trim().max(10).optional(),
  jobUrl: z.string().trim().max(2000).optional(),
  label: z.string().trim().max(200).optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
  force: z.boolean().optional(),
  cvVersionId: z.string().nullable().optional(),
});

export async function PATCH(request: Request, ctx: RouteContext<"/api/tracker/applications/[id]">) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const verified = requireVerifiedEmail(user);
  if (verified) return verified;

  const limited = await enforceRateLimit("tracker-applications-write", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  if (!databaseConfigured) {
    return NextResponse.json({ error: "Esta instalación no tiene base de datos configurada." }, { status: 503 });
  }

  const { id } = await ctx.params;
  const { status, force, cvVersionId, ...fields } = parsed.data;

  try {
    if (status) await changeStatus(user.id, id, status, { force });
    if (cvVersionId !== undefined) await linkCvVersion(user.id, id, cvVersionId);
    if (Object.keys(fields).length > 0) await updateApplicationFields(user.id, id, fields);

    const detail = await getApplicationDetail(user.id, id);
    return NextResponse.json(detail);
  } catch (error) {
    return trackerErrorResponse(error) ?? NextResponse.json({ error: "Error inesperado." }, { status: 500 });
  }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/tracker/applications/[id]">) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const limited = await enforceRateLimit("tracker-applications-write", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  if (!databaseConfigured) {
    return NextResponse.json({ error: "Esta instalación no tiene base de datos configurada." }, { status: 503 });
  }

  const { id } = await ctx.params;
  try {
    await deleteApplication(user.id, id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return trackerErrorResponse(error) ?? NextResponse.json({ error: "Error inesperado." }, { status: 500 });
  }
}
