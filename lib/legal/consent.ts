import "server-only";

import { and, eq } from "drizzle-orm";
import { databaseConfigured, getDb, schema } from "@/lib/db";
import { LEGAL_VERSION } from "./operator";

/**
 * Si el usuario aceptó la versión vigente de la transferencia internacional.
 *
 * Compara contra `LEGAL_VERSION` y no contra «tiene alguna fila»: cuando el
 * texto que describe la transferencia cambia de manera sustantiva, el
 * consentimiento anterior fue prestado sobre otra información y dejó de servir.
 * Eso es exactamente lo que promete la cláusula 13 de la política de privacidad,
 * y esta comparación es lo que hace que la promesa se cumpla sola en vez de
 * depender de que alguien se acuerde de correr un `DELETE`.
 *
 * Sin base configurada devuelve `true`. Es el caso de desarrollo, donde no hay
 * dónde guardar nada: bloquear ahí convertiría un entorno sin Postgres en un
 * entorno donde no se puede generar, y en producción `DATABASE_URL` siempre
 * está. El control real de todos modos no es este booleano sino que exista la
 * fila, y sin base no hay filas de nada.
 */
export async function hasTransferConsent(userId: string): Promise<boolean> {
  if (!databaseConfigured) return true;

  const rows = await getDb()
    .select({ version: schema.consent.version })
    .from(schema.consent)
    .where(
      and(
        eq(schema.consent.userId, userId),
        eq(schema.consent.kind, "transfer"),
        eq(schema.consent.version, LEGAL_VERSION),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/**
 * Deja constancia de que aceptó, para la versión vigente.
 *
 * `onConflictDoNothing` porque aceptar dos veces la misma versión es lo que pasa
 * cuando alguien toca el botón dos veces o vuelve atrás en el navegador, y la
 * fecha que importa es la de la primera vez.
 */
export async function recordTransferConsent(userId: string): Promise<void> {
  if (!databaseConfigured) return;

  await getDb()
    .insert(schema.consent)
    .values({ userId, kind: "transfer", version: LEGAL_VERSION })
    .onConflictDoNothing();
}

/**
 * Deja constancia de que aceptó los términos y la política de privacidad
 * vigentes, para la versión actual de `LEGAL_VERSION`.
 *
 * `AccountPanel.tsx` avisa "al crear una cuenta —con correo o con Google—
 * aceptás los términos y condiciones", pero hasta ahora ese aviso no dejaba
 * ningún rastro: un "aceptó" que nadie guardó no se puede acreditar, que es
 * el mismo problema que esta tabla ya resuelve para la transferencia
 * internacional (ver el comentario de `recordTransferConsent`). Se llama
 * desde `databaseHooks.user.create.after` en `lib/auth.ts`, que corre para
 * las dos formas de alta por igual: Better Auth invoca ese hook a nivel de
 * adaptador de base, no de endpoint, así que no hace falta duplicarlo entre
 * el flujo de correo y el de Google.
 *
 * `onConflictDoNothing` por la misma razón que `recordTransferConsent`: no
 * hay forma de crear dos cuentas con el mismo `userId`, pero sí de que este
 * hook se dispare más de una vez si Better Auth reintenta la operación.
 */
export async function recordTermsConsent(userId: string): Promise<void> {
  if (!databaseConfigured) return;

  await getDb()
    .insert(schema.consent)
    .values({ userId, kind: "terms", version: LEGAL_VERSION })
    .onConflictDoNothing();
}

/**
 * Retira el consentimiento a la transferencia internacional.
 *
 * Borra todas las filas `kind: "transfer"` del titular, no sólo la de
 * `LEGAL_VERSION`: la cláusula 5 de la política de privacidad dice "podés
 * retirarlo cuando quieras", sin distinguir versiones, y dejar una fila vieja
 * sin borrar no cambia el efecto —`hasTransferConsent` sólo mira la versión
 * vigente— pero sí deja un registro ambiguo sobre qué se retiró. La próxima
 * generación en un tier pago vuelve a pedir el consentimiento desde cero,
 * igual que si nunca se hubiera dado.
 *
 * `scripts/prune.mjs` no poda esta tabla porque una fila de consentimiento es
 * la prueba de que se dio (Ley 25.326 art. 12); el borrado a pedido del
 * titular es, junto con el borrado de cuenta, la única baja legítima.
 */
export async function withdrawTransferConsent(userId: string): Promise<void> {
  if (!databaseConfigured) return;

  await getDb()
    .delete(schema.consent)
    .where(and(eq(schema.consent.userId, userId), eq(schema.consent.kind, "transfer")));
}

/**
 * Si el usuario aceptó la versión vigente de las alertas de empleo por
 * correo — cláusula 14 de la política de privacidad. Mismo criterio que
 * `hasTransferConsent`: compara contra `LEGAL_VERSION`, no contra "tiene
 * alguna fila", así que un cambio sustantivo en la cláusula 14 vuelve a
 * pedir el consentimiento en vez de heredarlo en silencio.
 *
 * Sin base configurada devuelve `true` por la misma razón que
 * `hasTransferConsent`: es el caso de desarrollo sin dónde guardar nada, y
 * en producción `DATABASE_URL` siempre está — además, sin base tampoco existe
 * `job_alert` para que este consentimiento habilite algo.
 */
export async function hasJobAlertsConsent(userId: string): Promise<boolean> {
  if (!databaseConfigured) return true;

  const rows = await getDb()
    .select({ version: schema.consent.version })
    .from(schema.consent)
    .where(
      and(
        eq(schema.consent.userId, userId),
        eq(schema.consent.kind, "job_alerts"),
        eq(schema.consent.version, LEGAL_VERSION),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/** Deja constancia de que aceptó, para la versión vigente. Ver `recordTransferConsent`. */
export async function recordJobAlertsConsent(userId: string): Promise<void> {
  if (!databaseConfigured) return;

  await getDb()
    .insert(schema.consent)
    .values({ userId, kind: "job_alerts", version: LEGAL_VERSION })
    .onConflictDoNothing();
}

/**
 * Retira el consentimiento a las alertas de empleo. Borra todas las
 * versiones, no sólo la vigente — mismo motivo que `withdrawTransferConsent`.
 *
 * No borra por sí sola la fila de `job_alert`: quien apaga la alerta desde
 * `/empleos` hace las dos cosas en la misma request (ver
 * `app/api/jobs/alerts/route.ts`). Da igual si quedara una fila sin el
 * consentimiento que la sostiene — `app/api/jobs/alerts/send/route.ts`
 * vuelve a comprobar este consentimiento en cada corrida del cron, no sólo
 * al crear la alerta, así que una fila huérfana simplemente no manda nada.
 */
export async function withdrawJobAlertsConsent(userId: string): Promise<void> {
  if (!databaseConfigured) return;

  await getDb()
    .delete(schema.consent)
    .where(and(eq(schema.consent.userId, userId), eq(schema.consent.kind, "job_alerts")));
}

/**
 * Si el usuario aceptó recibir por correo el aviso de ghosting del tracker
 * — cláusula 16 de la política de privacidad. Mismo criterio que
 * `hasJobAlertsConsent`: compara contra `LEGAL_VERSION`, no contra "tiene
 * alguna fila".
 *
 * Cubre sólo el aviso de ghosting, no los recordatorios de seguimiento: un
 * recordatorio lo crea el usuario a mano eligiendo fecha y mensaje por
 * postulación, y esa elección ya es la solicitud del correo — gatearlo
 * también dejaría recordatorios vencidos sin marcar como enviados para
 * siempre en `listDueReminders` si el consentimiento nunca llega, haciendo
 * crecer esa cola sin techo. Ver `docs/tracker-plan.md`, sección 8.
 *
 * Sin base configurada devuelve `true` por la misma razón que
 * `hasJobAlertsConsent`: sin base tampoco existe el cron que lo consuma.
 */
export async function hasTrackerMailConsent(userId: string): Promise<boolean> {
  if (!databaseConfigured) return true;

  const rows = await getDb()
    .select({ version: schema.consent.version })
    .from(schema.consent)
    .where(
      and(
        eq(schema.consent.userId, userId),
        eq(schema.consent.kind, "tracker_mail"),
        eq(schema.consent.version, LEGAL_VERSION),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/** Deja constancia de que aceptó, para la versión vigente. Ver `recordJobAlertsConsent`. */
export async function recordTrackerMailConsent(userId: string): Promise<void> {
  if (!databaseConfigured) return;

  await getDb()
    .insert(schema.consent)
    .values({ userId, kind: "tracker_mail", version: LEGAL_VERSION })
    .onConflictDoNothing();
}

/**
 * Retira el consentimiento al aviso de ghosting por correo. Borra todas las
 * versiones, no sólo la vigente — mismo motivo que `withdrawJobAlertsConsent`.
 *
 * No toca la detección de abandono en sí: `markGhostedApplications` sigue
 * marcando `sin_respuesta` igual sin este consentimiento, y el aviso queda
 * disponible en el tablero y en el detalle de la postulación. Lo único que
 * este consentimiento gobierna es si además se manda un correo —
 * `app/api/tracker/cron/route.ts` vuelve a comprobarlo en cada corrida, no
 * sólo al activarlo.
 */
export async function withdrawTrackerMailConsent(userId: string): Promise<void> {
  if (!databaseConfigured) return;

  await getDb()
    .delete(schema.consent)
    .where(and(eq(schema.consent.userId, userId), eq(schema.consent.kind, "tracker_mail")));
}

/**
 * Deja constancia de que aceptó el reenvío de correspondencia de terceros —
 * cláusula 17 de la política de privacidad (detección de estados por email).
 * Distinto del resto de este archivo en una cosa: no tiene un
 * `withdraw...` que lo acompañe, a propósito, y ninguna otra función de este
 * archivo lo borra.
 *
 * Los otros cuatro consentimientos de acá gobiernan algo que ESTA
 * instalación hace hacia adelante (mandar un correo, transferir el perfil):
 * retirarlos significa "dejá de hacerlo", y borrar la fila no cambia lo que
 * ya se hizo mientras estuvo vigente. Éste es distinto — es la base legal
 * (art. 5, Ley 25.326) para haber procesado correspondencia de un TERCERO
 * (el remitente y el asunto de los correos de un reclutador, guardados en
 * `applicationEvent` vía `lib/tracker/email-ingest.ts`) durante la ventana en
 * que estuvo activo. Si esta fila se borrara junto con la casilla, no
 * quedaría cómo probar que esos correos ya procesados tenían una base legal
 * válida en su momento — que es exactamente lo que existe para poder
 * mostrar. `revokeEmailInbox` (`lib/tracker/email-inbox.ts`) borra el alias y
 * `emailInbox.consentAt` —la casilla deja de estar activa— pero nunca esta
 * tabla.
 *
 * Se llama desde `activateEmailInbox`, en el mismo paso que pone
 * `emailInbox.consentAt`: antes, ese timestamp suelto —sin versión, y dentro
 * de la misma fila que la revocación borra— era la única constancia que
 * existía.
 */
export async function recordTrackerMailInboxConsent(userId: string): Promise<void> {
  if (!databaseConfigured) return;

  await getDb()
    .insert(schema.consent)
    .values({ userId, kind: "tracker_mail_inbox", version: LEGAL_VERSION })
    .onConflictDoNothing();
}
