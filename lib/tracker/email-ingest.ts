import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  CATEGORY_TO_EVENT_TYPE,
  CATEGORY_TO_STATUS,
  CLASSIFIER_CONFIDENCE_THRESHOLD,
  classifyEmail,
  type EmailCategory,
} from "./email-classifier";
import { matchApplicationForEmail } from "./email-match";
import { OPEN_BOARD_STATUSES } from "./status";

/**
 * El otro extremo del Worker de Cloudflare — `app/api/tracker/email/ingest/route.ts`
 * llama a esto por cada correo reenviado. Todo lo que decide (a qué
 * postulación, qué categoría, si aplica el cambio solo o lo propone) vive
 * acá, no en el Worker: eso es lo que lo mantiene testeable sin desplegar
 * nada, y lo que hace que la Fase 3 comparta el mismo mecanismo de eventos
 * que el resto del tracker (el trigger de la migración 0017/0020) en vez de
 * inventar uno paralelo.
 *
 * El cuerpo del correo llega hasta acá (`bodyText`) para que el
 * clasificador lo pueda leer, pero nunca se guarda — ni en `application`,
 * ni en `application_event.body` (esa columna es para las notas que
 * escribe el usuario, no para contenido de un correo de un tercero). Lo
 * único que persiste de un correo es lo que ya autoriza el requerimiento:
 * remitente, asunto y el resultado de clasificarlo.
 */

export type IngestOutcome =
  | { outcome: "no_inbox" }
  | { outcome: "digest" }
  | { outcome: "unclassified" }
  | { outcome: "unmatched"; reason: "no_candidates" | "ambiguous" }
  | { outcome: "logged"; applicationId: string; category: EmailCategory }
  | { outcome: "applied"; applicationId: string; category: EmailCategory }
  | { outcome: "proposed"; applicationId: string; category: EmailCategory };

const CATEGORY_LABEL: Record<EmailCategory, string> = {
  confirmacion: "confirmación de recepción",
  entrevista: "invitación a entrevista",
  evaluacion: "evaluación técnica",
  oferta: "oferta",
  rechazo: "rechazo",
};

export async function ingestEmail(input: {
  alias: string;
  from: string;
  subject: string;
  bodyText: string;
}): Promise<IngestOutcome> {
  const db = getDb();

  const [inbox] = await db
    .select()
    .from(schema.emailInbox)
    .where(eq(schema.emailInbox.alias, input.alias))
    .limit(1);
  // Sin consentimiento vigente, ni siquiera se clasifica — ver la cláusula
  // 17 de la política de privacidad y el requerimiento de la Fase 3.
  if (!inbox || !inbox.consentAt) return { outcome: "no_inbox" };

  if (!inbox.verifiedAt) {
    // La primera vez que un correo llega de verdad es la prueba de que el
    // filtro de reenvío que la persona configuró funciona — no hace falta
    // pedirle que confirme nada aparte.
    await db.update(schema.emailInbox).set({ verifiedAt: new Date() }).where(eq(schema.emailInbox.id, inbox.id));
  }

  const classification = classifyEmail(input);
  if (classification.kind === "digest") return { outcome: "digest" };
  if (classification.kind === "unclassified") return { outcome: "unclassified" };

  const candidates = await db
    .select({ id: schema.application.id, company: schema.application.company })
    .from(schema.application)
    .where(
      and(
        eq(schema.application.userId, inbox.userId),
        inArray(schema.application.status, OPEN_BOARD_STATUSES),
        eq(schema.application.archived, false),
      ),
    );

  const matches = matchApplicationForEmail(candidates, input);
  if (matches.length !== 1) {
    return { outcome: "unmatched", reason: matches.length === 0 ? "no_candidates" : "ambiguous" };
  }

  const applicationId = matches[0].id;
  const { category, confidence, matchedSender } = classification;
  const toStatus = CATEGORY_TO_STATUS[category];
  const eventType = CATEGORY_TO_EVENT_TYPE[category];

  // `confirmacion` nunca mueve el estado — es exactamente lo que la tasa de
  // respuesta ya excluye como "no es una respuesta real" (ver
  // lib/tracker/metrics.ts). Se registra igual, sin tocar `application`.
  if (!toStatus) {
    await db.insert(schema.applicationEvent).values({
      id: randomUUID(),
      applicationId,
      eventType,
      detectedFrom: "email",
      confidence,
      rawSender: input.from,
      rawSubject: input.subject,
    });
    return { outcome: "logged", applicationId, category };
  }

  // Confianza baja: se propone, no se aplica — una nota en la línea de
  // tiempo, sin cambiar `application.status`. El usuario confirma a mano
  // desde el selector de estado del detalle si corresponde.
  if (confidence < CLASSIFIER_CONFIDENCE_THRESHOLD) {
    await db.insert(schema.applicationEvent).values({
      id: randomUUID(),
      applicationId,
      eventType: "nota",
      detectedFrom: "email",
      confidence,
      rawSender: input.from,
      rawSubject: input.subject,
      body: `Un correo${matchedSender ? " de un sistema de postulaciones conocido" : ""} podría indicar: ${CATEGORY_LABEL[category]}. Confianza baja — revisá y cambiá el estado a mano si corresponde.`,
    });
    return { outcome: "proposed", applicationId, category };
  }

  // Confianza alta: aplica el cambio por la misma transacción con GUC que
  // usa el resto del tracker (moveCard, ghosting) — el trigger de las
  // migraciones 0017/0020 es quien de verdad escribe el evento, ahora con
  // confidence/raw_sender/raw_subject incluidos.
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.event_detected_from', 'email', true)`);
    await tx.execute(sql`select set_config('app.event_type', ${eventType}, true)`);
    await tx.execute(sql`select set_config('app.event_confidence', ${String(confidence)}, true)`);
    await tx.execute(sql`select set_config('app.event_raw_sender', ${input.from}, true)`);
    await tx.execute(sql`select set_config('app.event_raw_subject', ${input.subject}, true)`);
    await tx.update(schema.application).set({ status: toStatus }).where(eq(schema.application.id, applicationId));
  });

  return { outcome: "applied", applicationId, category };
}
