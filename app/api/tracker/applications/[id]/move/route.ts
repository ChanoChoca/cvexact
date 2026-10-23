import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit, requireVerifiedEmail } from "@/lib/api/guards";
import { databaseConfigured } from "@/lib/db";
import { moveCard } from "@/lib/tracker/service";
import { trackerErrorResponse } from "@/lib/tracker/http";
import { APPLICATION_STATUSES } from "@/lib/tracker/status";

export const runtime = "nodejs";

/**
 * Lo que dispara soltar una tarjeta del kanban — separado de la edición
 * general porque necesita mandar `boardPosition` y `toStatus` juntos, en la
 * misma escritura, para que el update optimista del cliente y la persistencia
 * queden en un solo viaje. Ver `lib/tracker/board.ts` para cómo el cliente
 * calcula `boardPosition` antes de llamar acá.
 */
const RATE_LIMIT = { window: 60, max: 240 };

const bodySchema = z.object({
  toStatus: z.enum(APPLICATION_STATUSES),
  boardPosition: z.number().finite(),
  force: z.boolean().optional(),
});

export async function PATCH(request: Request, ctx: RouteContext<"/api/tracker/applications/[id]/move">) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const verified = requireVerifiedEmail(user);
  if (verified) return verified;

  const limited = await enforceRateLimit("tracker-move", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Movimiento inválido." }, { status: 400 });

  if (!databaseConfigured) {
    return NextResponse.json({ error: "Esta instalación no tiene base de datos configurada." }, { status: 503 });
  }

  const { id } = await ctx.params;
  try {
    const application = await moveCard(user.id, id, parsed.data);
    return NextResponse.json({ application });
  } catch (error) {
    return trackerErrorResponse(error) ?? NextResponse.json({ error: "Error inesperado." }, { status: 500 });
  }
}
