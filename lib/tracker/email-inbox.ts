import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { recordTrackerMailInboxConsent } from "@/lib/legal/consent";

/**
 * El alias por cuenta y su consentimiento — `email_inbox`, creada en la
 * migración 0016 y sin uso hasta esta fase. Todo lo de acá exige `userId` y
 * está ownership-scoped, como el resto de `lib/tracker/service.ts`; vive en
 * su propio archivo porque es un concepto separado (la casilla, no la
 * postulación) que además necesita leerse por `alias` en vez de por
 * `userId` desde `lib/tracker/email-ingest.ts` — un caso de acceso que no
 * encaja en el resto del servicio.
 */

export const trackerEmailConfigured = Boolean(process.env.TRACKER_EMAIL_DOMAIN);

function generateAlias(): string {
  const domain = process.env.TRACKER_EMAIL_DOMAIN;
  if (!domain) throw new Error("TRACKER_EMAIL_DOMAIN no está configurado.");
  return `u_${randomBytes(6).toString("hex")}@${domain}`;
}

export type EmailInbox = typeof schema.emailInbox.$inferSelect;

export async function getEmailInbox(userId: string): Promise<EmailInbox | null> {
  const [row] = await getDb().select().from(schema.emailInbox).where(eq(schema.emailInbox.userId, userId)).limit(1);
  return row ?? null;
}

/**
 * Da de alta la casilla si no existe, y dentro del mismo paso registra el
 * consentimiento — activar la detección por email sin haber dado el
 * consentimiento explícito no es un estado que este servicio deje existir,
 * a diferencia de crear la fila primero y consentir después.
 *
 * `recordTrackerMailInboxConsent` (`lib/legal/consent.ts`) deja, además de
 * `consentAt` acá, una constancia versionada contra `LEGAL_VERSION` en la
 * tabla `consent` — la única de las dos que sobrevive a `revokeEmailInbox`.
 * Ver el comentario de esa función para el porqué.
 */
export async function activateEmailInbox(userId: string): Promise<EmailInbox> {
  const existing = await getEmailInbox(userId);
  if (existing) {
    if (existing.consentAt) return existing;
    const [updated] = await getDb()
      .update(schema.emailInbox)
      .set({ consentAt: new Date() })
      .where(eq(schema.emailInbox.userId, userId))
      .returning();
    await recordTrackerMailInboxConsent(userId);
    return updated;
  }

  const [row] = await getDb()
    .insert(schema.emailInbox)
    .values({ id: randomUUID(), userId, alias: generateAlias(), consentAt: new Date() })
    .returning();
  await recordTrackerMailInboxConsent(userId);
  return row;
}

/**
 * Revoca: borra el alias y todo lo que derivó de correos ya procesados —
 * los eventos con `detectedFrom = 'email'` de las postulaciones del
 * usuario. El endpoint de revocación que pide el requerimiento, en forma de
 * función; `app/api/tracker/email-inbox/route.ts` es el `DELETE` que la
 * llama. Después de esto, un correo que siga llegando al alias vieja no
 * encuentra fila (`lib/tracker/email-ingest.ts` responde "no_inbox" y no
 * escribe nada) — Cloudflare del lado de afuera es responsabilidad de la
 * cuenta, no de esta función.
 *
 * Deliberadamente NO borra la fila de `consent` (`kind: "tracker_mail_inbox"`)
 * que dejó `activateEmailInbox` — ver el comentario de
 * `recordTrackerMailInboxConsent` en `lib/legal/consent.ts` para el porqué:
 * es la única constancia de que hubo base legal para procesar la
 * correspondencia de terceros que ya se procesó, y tiene que sobrevivir a
 * que la casilla se apague.
 */
export async function revokeEmailInbox(userId: string): Promise<void> {
  const db = getDb();
  const applications = await db
    .select({ id: schema.application.id })
    .from(schema.application)
    .where(eq(schema.application.userId, userId));

  if (applications.length > 0) {
    await db
      .delete(schema.applicationEvent)
      .where(
        and(
          inArray(
            schema.applicationEvent.applicationId,
            applications.map((a) => a.id),
          ),
          eq(schema.applicationEvent.detectedFrom, "email"),
        ),
      );
  }

  await db.delete(schema.emailInbox).where(eq(schema.emailInbox.userId, userId));
}
