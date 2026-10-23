import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/api/guards";
import { databaseConfigured } from "@/lib/db";
import { deleteContact } from "@/lib/tracker/service";
import { trackerErrorResponse } from "@/lib/tracker/http";

export const runtime = "nodejs";

const RATE_LIMIT = { window: 3600, max: 60 };

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/tracker/applications/[id]/contacts/[contactId]">,
) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const limited = await enforceRateLimit("tracker-contacts", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  if (!databaseConfigured) {
    return NextResponse.json({ error: "Esta instalación no tiene base de datos configurada." }, { status: 503 });
  }

  const { id, contactId } = await ctx.params;
  try {
    await deleteContact(user.id, id, contactId);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return trackerErrorResponse(error) ?? NextResponse.json({ error: "Error inesperado." }, { status: 500 });
  }
}
