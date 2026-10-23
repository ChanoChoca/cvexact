import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit, requireVerifiedEmail } from "@/lib/api/guards";
import { databaseConfigured } from "@/lib/db";
import { addNote } from "@/lib/tracker/service";
import { trackerErrorResponse } from "@/lib/tracker/http";

export const runtime = "nodejs";

const RATE_LIMIT = { window: 3600, max: 120 };
const bodySchema = z.object({ body: z.string().trim().min(1).max(4000) });

export async function POST(request: Request, ctx: RouteContext<"/api/tracker/applications/[id]/notes">) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const verified = requireVerifiedEmail(user);
  if (verified) return verified;

  const limited = await enforceRateLimit("tracker-notes", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "La nota no puede estar vacía." }, { status: 400 });

  if (!databaseConfigured) {
    return NextResponse.json({ error: "Esta instalación no tiene base de datos configurada." }, { status: 503 });
  }

  const { id } = await ctx.params;
  try {
    await addNote(user.id, id, parsed.data.body);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return trackerErrorResponse(error) ?? NextResponse.json({ error: "Error inesperado." }, { status: 500 });
  }
}
