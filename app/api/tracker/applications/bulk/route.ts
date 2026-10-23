import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit, requireVerifiedEmail } from "@/lib/api/guards";
import { databaseConfigured } from "@/lib/db";
import { archiveApplications, bulkChangeStatus } from "@/lib/tracker/service";
import { APPLICATION_STATUSES } from "@/lib/tracker/status";

export const runtime = "nodejs";

/** Acciones en lote de la vista tabla: archivar/desarchivar y cambiar
 *  estado a varias postulaciones seleccionadas de una. */
const RATE_LIMIT = { window: 3600, max: 60 };

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("archive"), ids: z.array(z.string()).min(1).max(200), archived: z.boolean() }),
  z.object({
    action: z.literal("status"),
    ids: z.array(z.string()).min(1).max(200),
    status: z.enum(APPLICATION_STATUSES),
    force: z.boolean().optional(),
  }),
]);

export async function PATCH(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const verified = requireVerifiedEmail(user);
  if (verified) return verified;

  const limited = await enforceRateLimit("tracker-bulk", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Acción en lote inválida." }, { status: 400 });

  if (!databaseConfigured) {
    return NextResponse.json({ error: "Esta instalación no tiene base de datos configurada." }, { status: 503 });
  }

  if (parsed.data.action === "archive") {
    await archiveApplications(user.id, parsed.data.ids, parsed.data.archived);
    return NextResponse.json({ ok: true });
  }

  const result = await bulkChangeStatus(user.id, parsed.data.ids, parsed.data.status, {
    force: parsed.data.force,
  });
  return NextResponse.json(result);
}
