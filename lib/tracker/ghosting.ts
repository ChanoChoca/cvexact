import "server-only";

import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { GHOSTING_DAYS } from "./constants";

/**
 * La única consulta de todo el tracker que cruza cuentas — todo lo demás en
 * `lib/tracker/service.ts` exige un `userId` y está ownership-scoped; esto
 * corre una vez al día desde el cron (`app/api/tracker/cron/route.ts`,
 * protegido por `x-origin-auth` en `proxy.ts`), nunca desde una request de
 * un usuario. Vive en su propio módulo en vez de en `service.ts` para no
 * romper esa regla en un solo archivo: nada acá recibe ni necesita un
 * `userId`.
 */

export { GHOSTING_DAYS };

const GHOSTED_FROM_STATUSES = ["postulado", "en_revision"] as const;

export type GhostedApplication = {
  id: string;
  userId: string;
  jobTitle: string | null;
  company: string | null;
};

/**
 * Marca como `sin_respuesta` toda postulación activa (`postulado` o
 * `en_revision`, no archivada) cuya `last_activity_at` sea anterior al
 * corte de `GHOSTING_DAYS`, y devuelve las que se marcaron — agrupadas por
 * `userId` es responsabilidad del llamador, para armar el correo de cada
 * cuenta (`ghostingMail`).
 *
 * Una sola `UPDATE ... WHERE id IN (...)`, no un `UPDATE` por fila: el
 * trigger de `application_status_event` (migración 0017) es un trigger de
 * fila, así que igual deja un evento por cada una — la eficiencia que se
 * gana acá es en redondajes a la base, no en cuántos eventos se escriben.
 */
export async function markGhostedApplications(now: Date = new Date()): Promise<GhostedApplication[]> {
  const cutoff = new Date(now.getTime() - GHOSTING_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await getDb()
    .select({
      id: schema.application.id,
      userId: schema.application.userId,
      jobTitle: schema.application.jobTitle,
      company: schema.application.company,
    })
    .from(schema.application)
    .where(
      and(
        inArray(schema.application.status, GHOSTED_FROM_STATUSES),
        lt(schema.application.lastActivityAt, cutoff),
        eq(schema.application.archived, false),
      ),
    );

  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id);
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.event_detected_from', 'sistema', true)`);
    await tx.execute(sql`select set_config('app.event_type', 'ghosting_detectado', true)`);
    await tx.update(schema.application).set({ status: "sin_respuesta" }).where(inArray(schema.application.id, ids));
  });

  return candidates;
}
