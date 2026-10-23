import "server-only";

import { and, eq, isNull, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * El lado cron de los recordatorios — cruza cuentas, igual que
 * `lib/tracker/ghosting.ts` y por la misma razón: todo lo que sí exige
 * `userId` vive en `service.ts` (`createReminder`, `dismissReminder`).
 */

export type DueReminder = {
  id: string;
  userId: string;
  applicationId: string;
  kind: string;
  message: string | null;
  jobTitle: string | null;
  company: string | null;
};

/** Recordatorios vencidos, sin enviar y sin descartar — el mismo filtro
 *  que respalda el índice parcial `application_reminder_due_idx`. */
export async function listDueReminders(now: Date = new Date()): Promise<DueReminder[]> {
  return getDb()
    .select({
      id: schema.applicationReminder.id,
      userId: schema.applicationReminder.userId,
      applicationId: schema.applicationReminder.applicationId,
      kind: schema.applicationReminder.kind,
      message: schema.applicationReminder.message,
      jobTitle: schema.application.jobTitle,
      company: schema.application.company,
    })
    .from(schema.applicationReminder)
    .innerJoin(schema.application, eq(schema.application.id, schema.applicationReminder.applicationId))
    .where(
      and(
        lt(schema.applicationReminder.dueAt, now),
        isNull(schema.applicationReminder.sentAt),
        eq(schema.applicationReminder.dismissed, false),
      ),
    );
}

/**
 * Sólo se llama después de que `sendMail` devolvió `true` — ver el
 * comentario en `lib/email/mailer.ts`. Si el envío falla o el presupuesto
 * está agotado, esta fila se queda sin `sentAt` y la próxima corrida del
 * cron la vuelve a encontrar: reintenta mañana en vez de perderse.
 */
export async function markReminderSent(id: string, sentAt: Date = new Date()): Promise<void> {
  await getDb().update(schema.applicationReminder).set({ sentAt }).where(eq(schema.applicationReminder.id, id));
}
