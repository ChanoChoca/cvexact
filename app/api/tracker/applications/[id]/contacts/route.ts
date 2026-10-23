import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit, requireVerifiedEmail } from "@/lib/api/guards";
import { databaseConfigured } from "@/lib/db";
import { addContact } from "@/lib/tracker/service";
import { trackerErrorResponse } from "@/lib/tracker/http";

export const runtime = "nodejs";

const RATE_LIMIT = { window: 3600, max: 60 };
const bodySchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  role: z.string().trim().max(120).optional(),
  linkedinUrl: z.string().trim().max(500).optional(),
});

export async function POST(request: Request, ctx: RouteContext<"/api/tracker/applications/[id]/contacts">) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const verified = requireVerifiedEmail(user);
  if (verified) return verified;

  const limited = await enforceRateLimit("tracker-contacts", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos de contacto inválidos." }, { status: 400 });

  if (!databaseConfigured) {
    return NextResponse.json({ error: "Esta instalación no tiene base de datos configurada." }, { status: 503 });
  }

  const { id } = await ctx.params;
  try {
    const contact = await addContact(user.id, id, parsed.data);
    return NextResponse.json({ contact }, { status: 201 });
  } catch (error) {
    return trackerErrorResponse(error) ?? NextResponse.json({ error: "Error inesperado." }, { status: 500 });
  }
}
