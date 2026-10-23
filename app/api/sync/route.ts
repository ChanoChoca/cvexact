import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit, requireVerifiedEmail } from "@/lib/api/guards";
import { getDb, schema } from "@/lib/db";
import { exportUsageCounterForUser } from "@/lib/quota";
import { profileSchema } from "@/lib/schemas/profile";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";
import { parseAnyProfile } from "@/lib/profile/parse";
import { toPlainProfile } from "@/lib/profile/project";
import { reconcileFromPlain } from "@/lib/profile/reconcile";
import { forSync } from "@/lib/profile/sync";

export const runtime = "nodejs";

/**
 * Sync between the browser store and the account.
 *
 * Deliberately explicit rather than automatic: the browser copy is the one the
 * user has been working in, and silently reconciling two divergent copies is
 * how people lose a profile. The UI offers "upload" and "download" as separate
 * actions and says which direction overwrites what.
 *
 * Upload is additive — the server never removes rows the snapshot does not
 * mention — so deleted applications travel as tombstones (`deletedIds`): the
 * server removes those rows and remembers them, and a later download filters
 * them out of what it hands back.
 */

/**
 * El perfil llega en una de dos formas. `profileV2` es el perfil guardado, con
 * procedencia — lo que manda una versión actual. `profile` es el plano de antes
 * de la procedencia, y sigue aceptándose para un navegador que todavía corre esa
 * versión (una pestaña que quedó abierta durante el deploy): rechazarlo le
 * haría perder la subida sin decirle por qué. Se validan abajo, no acá, porque
 * `parseAnyProfile` es lo que sabe leer las dos.
 */
const bodySchema = z
  .object({
    profileV2: z.unknown().optional(),
    profile: z.unknown().optional(),
    applications: z.array(z.record(z.string(), z.unknown())).max(500),
    deletedIds: z.array(z.string()).max(500).optional(),
  })
  .refine((body) => body.profileV2 !== undefined || body.profile !== undefined);

/**
 * Los tres topes que `.max(500)` no da. Ese número acota lo que trae *un*
 * pedido; sin lo de abajo, un pedido igual podría meter jsonb de tamaño libre,
 * repetirse hasta acumular filas sin fin, o traer ids nuevos cada vez.
 */

/** El pedido entero, medido antes de parsear. Un perfil con decenas de
 *  postulaciones son unos cientos de KB (lib/storage/local.ts); 1 MiB es
 *  holgado para uso real y mata el flood en dos líneas. */
const MAX_BODY_BYTES = 1024 * 1024;

/** Una sola postulación serializada. Un registro razonable no pasa de unos KB. */
const MAX_APPLICATION_BYTES = 64 * 1024;

/** Filas totales por cuenta: lo que `.max(500)` parece prometer, ahora real. */
const MAX_APPLICATIONS_PER_USER = 500;

const SYNC_LIMIT = "sync";
const RULE = { window: 600, max: 60 };

/**
 * Qué manda `export=account`, aparte de lo que ya traía `pull()`.
 *
 * El art. 14 de la Ley 25.326 da derecho de acceso a los datos propios, y hasta
 * acá el único camino de vuelta era este mismo endpoint sin este parámetro:
 * perfil y postulaciones, nada de la cuenta, las sesiones, las compras, los
 * consentimientos dados ni los trámites de arrepentimiento o baja hechos con
 * este correo. La cláusula 8 de la política de privacidad prometía justamente
 * eso — "te descarga todo lo que tenemos tuyo en un archivo" — así que el
 * parámetro existe para que la promesa sea cierta sin tocar lo que `pull()` ya
 * hace: sincronizar sigue siendo `GET /api/sync` a secas, y lo que se agrega
 * acá es aditivo, nunca leído por ese camino.
 *
 * `legalRequest` no tiene `userId` ni clave foránea a propósito (ver el
 * comentario de la tabla en `lib/db/schema.ts`): se busca por el email de la
 * cuenta, que es lo único que la conecta con quien la hizo.
 *
 * Lo que NO se entrega, a propósito: las credenciales —el hash de la
 * contraseña (`account.password`), los tokens de sesión y de proveedor, y el
 * hash del token de la extensión—. Sólo sirven para autenticar, no son "datos
 * tuyos" en el sentido del art. 14, y volcarlos en un archivo descargable sería
 * regalarle a quien lo robe justo lo que la cuenta protege. La cláusula 8 de la
 * política lo dice igual. Todo lo demás que la base guarda de una cuenta tiene
 * que estar acá: si se agrega una tabla con `user_id`, se agrega a esta lista,
 * o se suma la excepción a la cláusula 8.
 */
async function accountExport(userId: string, email: string) {
  const db = getDb();

  const [accountRow] = await db
    .select({
      name: schema.user.name,
      email: schema.user.email,
      image: schema.user.image,
      emailVerified: schema.user.emailVerified,
      createdAt: schema.user.createdAt,
      subscriptionStatus: schema.user.subscriptionStatus,
      subscriptionGateway: schema.user.subscriptionGateway,
      creditBalance: schema.user.creditBalance,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  const sessions = await db
    .select({
      createdAt: schema.session.createdAt,
      ipAddress: schema.session.ipAddress,
      userAgent: schema.session.userAgent,
    })
    .from(schema.session)
    .where(eq(schema.session.userId, userId));

  const creditPurchases = await db
    .select({
      gateway: schema.creditPurchase.gateway,
      credits: schema.creditPurchase.credits,
      createdAt: schema.creditPurchase.createdAt,
    })
    .from(schema.creditPurchase)
    .where(eq(schema.creditPurchase.userId, userId));

  const consents = await db
    .select({
      kind: schema.consent.kind,
      version: schema.consent.version,
      createdAt: schema.consent.createdAt,
    })
    .from(schema.consent)
    .where(eq(schema.consent.userId, userId));

  const legalRequests = await db
    .select({
      id: schema.legalRequest.id,
      kind: schema.legalRequest.kind,
      status: schema.legalRequest.status,
      createdAt: schema.legalRequest.createdAt,
      resolvedAt: schema.legalRequest.resolvedAt,
    })
    .from(schema.legalRequest)
    .where(eq(schema.legalRequest.email, email));

  // El tracker: metadato del aviso y del proceso, y su timeline — no `data`,
  // que ya viene en `applications` (`pull()`: el CV generado, las respuestas y
  // el resto). Ver la cláusula 16 de la política de privacidad y
  // `docs/tracker-plan.md`, sección 8: sin esto, el export de cuenta dejaría de
  // ser "todo lo que tenemos tuyo" en cuanto alguien activa el seguimiento.
  // Incluye el texto del aviso (`jdText`), que la cláusula 16 declara.
  const trackerApplications = await db
    .select({
      id: schema.application.id,
      jobTitle: schema.application.jobTitle,
      company: schema.application.company,
      source: schema.application.source,
      jobUrl: schema.application.jobUrl,
      jdText: schema.application.jdText,
      jdJsonld: schema.application.jdJsonld,
      location: schema.application.location,
      remote: schema.application.remote,
      salaryMin: schema.application.salaryMin,
      salaryMax: schema.application.salaryMax,
      currency: schema.application.currency,
      status: schema.application.status,
      createdAt: schema.application.createdAt,
      appliedAt: schema.application.appliedAt,
      lastActivityAt: schema.application.lastActivityAt,
      cvVersionId: schema.application.cvVersionId,
      archived: schema.application.archived,
    })
    .from(schema.application)
    .where(eq(schema.application.userId, userId));

  const trackerApplicationIds = trackerApplications.map((row) => row.id);

  const trackerEvents = trackerApplicationIds.length
    ? await db
        .select({
          applicationId: schema.applicationEvent.applicationId,
          eventType: schema.applicationEvent.eventType,
          fromStatus: schema.applicationEvent.fromStatus,
          toStatus: schema.applicationEvent.toStatus,
          detectedFrom: schema.applicationEvent.detectedFrom,
          body: schema.applicationEvent.body,
          occurredAt: schema.applicationEvent.occurredAt,
        })
        .from(schema.applicationEvent)
        .where(inArray(schema.applicationEvent.applicationId, trackerApplicationIds))
    : [];

  const trackerContacts = trackerApplicationIds.length
    ? await db
        .select({
          applicationId: schema.applicationContact.applicationId,
          name: schema.applicationContact.name,
          email: schema.applicationContact.email,
          role: schema.applicationContact.role,
          linkedinUrl: schema.applicationContact.linkedinUrl,
        })
        .from(schema.applicationContact)
        .where(inArray(schema.applicationContact.applicationId, trackerApplicationIds))
    : [];

  const cvVersions = await db
    .select({ id: schema.cvVersion.id, label: schema.cvVersion.label, createdAt: schema.cvVersion.createdAt })
    .from(schema.cvVersion)
    .where(eq(schema.cvVersion.userId, userId));

  // Fase 3: sólo la dirección y su estado — nunca hace falta el contenido de
  // ningún correo acá, porque nunca se guardó (ver cláusula 17).
  const [emailInboxRow] = await db
    .select({
      alias: schema.emailInbox.alias,
      consentAt: schema.emailInbox.consentAt,
      verifiedAt: schema.emailInbox.verifiedAt,
    })
    .from(schema.emailInbox)
    .where(eq(schema.emailInbox.userId, userId))
    .limit(1);

  // Recordatorios: `message` es texto libre que escribió la persona.
  const trackerReminders = await db
    .select({
      applicationId: schema.applicationReminder.applicationId,
      dueAt: schema.applicationReminder.dueAt,
      kind: schema.applicationReminder.kind,
      message: schema.applicationReminder.message,
      sentAt: schema.applicationReminder.sentAt,
      dismissed: schema.applicationReminder.dismissed,
      createdAt: schema.applicationReminder.createdAt,
    })
    .from(schema.applicationReminder)
    .where(eq(schema.applicationReminder.userId, userId));

  // La configuración de las alertas de empleo (cláusula 14): una fila por cuenta.
  const [jobAlertRow] = await db
    .select({
      query: schema.jobAlert.query,
      workMode: schema.jobAlert.workMode,
      minScore: schema.jobAlert.minScore,
      frequency: schema.jobAlert.frequency,
      lastSentAt: schema.jobAlert.lastSentAt,
      updatedAt: schema.jobAlert.updatedAt,
    })
    .from(schema.jobAlert)
    .where(eq(schema.jobAlert.userId, userId))
    .limit(1);

  // Que la extensión está conectada y desde cuándo. Nunca `tokenHash`: es una
  // credencial (ver el comentario de cabecera).
  const [extensionTokenRow] = await db
    .select({
      createdAt: schema.extensionToken.createdAt,
      lastUsedAt: schema.extensionToken.lastUsedAt,
    })
    .from(schema.extensionToken)
    .where(eq(schema.extensionToken.userId, userId))
    .limit(1);

  return {
    account: accountRow ?? null,
    sessions,
    creditPurchases,
    consents,
    legalRequests,
    trackerApplications,
    trackerEvents,
    trackerContacts,
    trackerReminders,
    cvVersions,
    emailInbox: emailInboxRow ?? null,
    jobAlert: jobAlertRow ?? null,
    extensionToken: extensionTokenRow ?? null,
    usageCounters: await exportUsageCounterForUser(userId),
  };
}

export async function GET(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const unverified = requireVerifiedEmail(user);
  if (unverified) return unverified;

  const db = getDb();
  const query = new URL(request.url).searchParams;

  const [profileRow] = await db
    .select({ data: schema.profile.data })
    .from(schema.profile)
    .where(eq(schema.profile.userId, user.id))
    .limit(1);

  // `?only=profile`: only the profile, for the screens that ask whether the account has one worth bringing here. They
  // ask each time someone signed in opens the entry or their profile, and the whole history — up to 500 applications
  // and the tombstones — is not what they are asking about.
  if (query.get("only") === "profile") {
    return NextResponse.json({ profileV2: profileRow ? parseAnyProfile(profileRow.data) : null });
  }

  const applications = await db
    .select({ data: schema.application.data })
    .from(schema.application)
    .where(eq(schema.application.userId, user.id));

  // La fila puede estar en el formato de antes de la procedencia; se lee y se
  // entrega en el actual. `null` si no hay fila, o si no se puede leer: quien
  // baja no pisa su perfil con nada.
  const storedProfile = profileRow ? parseAnyProfile(profileRow.data) : null;

  const tombstones = await db
    .select({ applicationId: schema.applicationTombstone.applicationId })
    .from(schema.applicationTombstone)
    .where(eq(schema.applicationTombstone.userId, user.id));

  const wantsAccountExport = query.get("export") === "account";

  return NextResponse.json({
    profileV2: storedProfile,
    // El mismo perfil en el formato plano, para un navegador que todavía corre
    // la versión anterior a la procedencia. Se puede quitar cuando ya no quede
    // ninguno: una pestaña abierta durante el deploy es lo único que lo lee.
    profile: storedProfile ? toPlainProfile(storedProfile) : null,
    applications: applications.map((row) => row.data),
    deletedIds: tombstones.map((row) => row.applicationId),
    ...(wantsAccountExport ? await accountExport(user.id, user.email) : {}),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const unverified = requireVerifiedEmail(user);
  if (unverified) return unverified;

  // Authenticated, so this is not the anonymous free-for-all the other limits
  // guard against — it is a ceiling on how fast one account can grow the table.
  const limited = await enforceRateLimit(SYNC_LIMIT, request.headers, RULE, user.id);
  if (limited) return limited;

  // El tope de bytes va ANTES de parsear: JSON.parse sobre un cuerpo enorme ya
  // le gastó al proceso la memoria y el CPU del flood; leer el texto y medirlo
  // no.
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "El contenido a subir es demasiado grande.", reason: "payload_too_large" },
      { status: 413 },
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const db = getDb();
  const now = new Date();

  let profile = parsed.data.profileV2 !== undefined ? parseAnyProfile(parsed.data.profileV2) : null;
  if (parsed.data.profileV2 === undefined) {
    // Un perfil plano: se aplica como edición sobre el que ya está en la cuenta,
    // así lo que no cambió conserva su procedencia en vez de volver a empezar.
    const plain = profileSchema.safeParse(parsed.data.profile);
    if (plain.success) {
      const [existing] = await db
        .select({ data: schema.profile.data })
        .from(schema.profile)
        .where(eq(schema.profile.userId, user.id))
        .limit(1);
      const base = (existing ? parseAnyProfile(existing.data) : null) ?? emptyStoredProfile();
      profile = reconcileFromPlain(base, plain.data, { origin: "manual" });
    }
  }
  if (!profile) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  // El historial de ediciones, lo archivado y los nombres de archivo son del
  // navegador; borrar algo del perfil tiene que ser borrarlo, también acá.
  profile = forSync(profile);

  /**
   * El tope de filas acumuladas. `.max(500)` acota el pedido, no la tabla: cada
   * request puede traer ids que nunca subieron y seguir creciendo para
   * siempre. Contar antes de insertar deja el techo en 500 filas por cuenta,
   * que era lo que el esquema del cliente siempre insinuó.
   */
  const [counted] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.application)
    .where(eq(schema.application.userId, user.id));
  let remainingSlots = Math.max(0, MAX_APPLICATIONS_PER_USER - Number(counted?.total ?? 0));

  await db
    .insert(schema.profile)
    .values({ userId: user.id, data: profile, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.profile.userId,
      set: { data: profile, updatedAt: now },
    });

  const uploadedIds: string[] = [];
  let skippedOversize = 0;
  let skippedFull = 0;
  for (const application of parsed.data.applications) {
    const id = application.id;
    if (typeof id !== "string") continue;

    // Saltar, no abortar: una postulación inflada no le devuelve al usuario el
    // trabajo de las otras 499. El número viaja en la respuesta para que la UI
    // lo diga en vez de fingir un éxito total.
    if (Buffer.byteLength(JSON.stringify(application), "utf8") > MAX_APPLICATION_BYTES) {
      skippedOversize += 1;
      continue;
    }
    if (remainingSlots <= 0) {
      skippedFull += 1;
      continue;
    }

    uploadedIds.push(id);
    remainingSlots -= 1;

    await db
      .insert(schema.application)
      .values({
        id,
        userId: user.id,
        label: typeof application.label === "string" ? application.label : "",
        data: application,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.application.id,
        set: {
          label: typeof application.label === "string" ? application.label : "",
          data: application,
          updatedAt: now,
        },
        /**
         * Without this predicate the update reaches any row that happens to
         * share the id, whoever owns it — an uploaded application could
         * overwrite a stranger's. Ids are `crypto.randomUUID()`, so hitting one
         * blindly is not a practical attack, but every other write in this file
         * is already scoped to the owner and unguessability is not access
         * control. A conflicting row belonging to someone else is left alone.
         */
        setWhere: eq(schema.application.userId, user.id),
      });
  }

  // An uploaded id wins over any tombstone: a restore or re-push of the same
  // application means the user wants it back, so its deletion is retired.
  if (uploadedIds.length > 0) {
    await db
      .delete(schema.applicationTombstone)
      .where(
        and(
          eq(schema.applicationTombstone.userId, user.id),
          inArray(schema.applicationTombstone.applicationId, uploadedIds),
        ),
      );
  }

  const deletedIds = parsed.data.deletedIds ?? [];
  if (deletedIds.length > 0) {
    await db
      .delete(schema.application)
      .where(
        and(
          eq(schema.application.userId, user.id),
          inArray(schema.application.id, deletedIds),
        ),
      );

    await db
      .insert(schema.applicationTombstone)
      .values(
        deletedIds.map((applicationId) => ({
          userId: user.id,
          applicationId,
          deletedAt: now,
        })),
      )
      .onConflictDoNothing({
        target: [schema.applicationTombstone.userId, schema.applicationTombstone.applicationId],
      });
  }

  return NextResponse.json({
    ok: true,
    applications: uploadedIds.length,
    skippedOversize,
    skippedFull,
  });
}
