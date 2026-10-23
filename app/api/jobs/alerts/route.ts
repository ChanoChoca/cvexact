import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit, requireVerifiedEmail } from "@/lib/api/guards";
import { databaseConfigured, getDb, schema } from "@/lib/db";
import { hasJobAlertsConsent, recordJobAlertsConsent } from "@/lib/legal/consent";
import { deactivateJobAlert } from "@/lib/jobs/alerts";

export const runtime = "nodejs";

/**
 * The user's own job-alert configuration — one row, like `profile`. GET reads
 * it back for `/empleos`'s settings card; POST creates or replaces it and
 * records the cláusula 14 consent in the same request, the same pairing
 * `TransferConsent.tsx` does for the international-transfer one; DELETE turns
 * the alert off and withdraws that consent together, so an "off" alert never
 * leaves a live permission behind it with nothing exercising it.
 *
 * Every path requires a session — this is a permission over one person's own
 * data and inbox, not something a stranger can configure by guessing a user
 * id, the same reasoning `../consentimiento/route.ts` documents for the
 * transfer consent.
 */

const bodySchema = z.object({
  query: z.string().trim().max(200).default(""),
  workMode: z.enum(["", "onsite", "hybrid", "remote"]).default(""),
  minScore: z.number().int().min(0).max(100).default(60),
  frequency: z.enum(["daily", "weekly"]).default("daily"),
  /** Not optional and not defaulted: the checkbox has to be explicitly
   *  checked, the same "starts empty" rule `TransferConsent.tsx` follows. */
  consent: z.literal(true),
});

const RATE_LIMIT = { window: 3600, max: 20 };

async function hasSyncedProfile(userId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ userId: schema.profile.userId })
    .from(schema.profile)
    .where(eq(schema.profile.userId, userId))
    .limit(1);
  return rows.length > 0;
}

export async function GET(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) {
    return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });
  }

  if (!databaseConfigured) {
    return NextResponse.json({ active: false, consent: false, config: null });
  }

  const [row] = await getDb()
    .select()
    .from(schema.jobAlert)
    .where(eq(schema.jobAlert.userId, user.id))
    .limit(1);

  return NextResponse.json({
    active: Boolean(row),
    consent: await hasJobAlertsConsent(user.id),
    config: row ?? null,
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) {
    return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });
  }

  const verified = requireVerifiedEmail(user);
  if (verified) return verified;

  const limited = await enforceRateLimit("jobs-alerts", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Configuración de alerta inválida." }, { status: 400 });
  }

  if (!databaseConfigured) {
    return NextResponse.json(
      { error: "Esta instalación no tiene base de datos configurada." },
      { status: 503 },
    );
  }

  // Sin perfil sincronizado no hay contra qué puntuar un aviso fuera de una
  // sesión de navegador — ver el comentario de `jobAlert` en lib/db/schema.ts.
  if (!(await hasSyncedProfile(user.id))) {
    return NextResponse.json(
      {
        error: "Sincronizá tu perfil primero, desde Ajustes, para poder activar las alertas.",
        reason: "profile_not_synced",
      },
      { status: 409 },
    );
  }

  const { query, workMode, minScore, frequency } = parsed.data;

  await recordJobAlertsConsent(user.id);
  await getDb()
    .insert(schema.jobAlert)
    .values({ userId: user.id, query, workMode, minScore, frequency })
    .onConflictDoUpdate({
      target: schema.jobAlert.userId,
      set: { query, workMode, minScore, frequency, updatedAt: new Date() },
    });

  return NextResponse.json({ active: true });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) {
    return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });
  }

  const limited = await enforceRateLimit("jobs-alerts", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  await deactivateJobAlert(user.id);

  return NextResponse.json({ active: false });
}
