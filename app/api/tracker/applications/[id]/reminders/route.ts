import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit, requireVerifiedEmail } from "@/lib/api/guards";
import { databaseConfigured } from "@/lib/db";
import { createReminder } from "@/lib/tracker/service";
import { trackerErrorResponse } from "@/lib/tracker/http";

export const runtime = "nodejs";

const RATE_LIMIT = { window: 3600, max: 60 };
const bodySchema = z.object({
  dueAt: z.string().datetime(),
  kind: z.enum(["follow_up", "entrevista", "custom"]).default("custom"),
  message: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request, ctx: RouteContext<"/api/tracker/applications/[id]/reminders">) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const verified = requireVerifiedEmail(user);
  if (verified) return verified;

  const limited = await enforceRateLimit("tracker-reminders", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Recordatorio inválido." }, { status: 400 });

  if (!databaseConfigured) {
    return NextResponse.json({ error: "Esta instalación no tiene base de datos configurada." }, { status: 503 });
  }

  const { id } = await ctx.params;
  try {
    const reminder = await createReminder(user.id, id, {
      dueAt: new Date(parsed.data.dueAt),
      kind: parsed.data.kind,
      message: parsed.data.message,
    });
    return NextResponse.json({ reminder }, { status: 201 });
  } catch (error) {
    return trackerErrorResponse(error) ?? NextResponse.json({ error: "Error inesperado." }, { status: 500 });
  }
}
