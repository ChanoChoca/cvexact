import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { databaseConfigured, getDb, schema } from "@/lib/db";
import { markGhostedApplications } from "@/lib/tracker/ghosting";
import { listDueReminders, markReminderSent } from "@/lib/tracker/reminders";
import { sendMail } from "@/lib/email/mailer";
import { ghostingMail, followUpMail } from "@/lib/email/templates";
import { hasTrackerMailConsent } from "@/lib/legal/consent";
import { rejectIfViaPublicEdge } from "@/lib/api/internal-only";

export const runtime = "nodejs";

/**
 * La corrida diaria del tracker: ghosting y recordatorios, en la misma
 * request para que `scripts/tracker-cron.mjs` sea un solo `fetch`. Ambas
 * cosas procesan por deltas (índices parciales en `lib/db/schema.ts`, ver
 * `application_ghosting_candidates_idx` y `application_reminder_due_idx`),
 * nunca un recorrido completo de todas las cuentas.
 *
 * Internal-only, y lo que la hace interna es `rejectIfViaPublicEdge`, no
 * `proxy.ts`: la Transform Rule de Cloudflare le agrega `X-Origin-Auth` a todo
 * el tráfico público, así que `proxy.ts` sólo separa "pasó por Cloudflare" de
 * "llegó directo al nodo". Sin esta guarda cualquiera desde internet podía
 * disparar la corrida (comprobado el 2026-09-18: un GET público devolvía 405,
 * o sea que llegaba hasta acá). El CronJob entra por el Service del clúster
 * (`INTERNAL_APP_URL`), que no pasa por Cloudflare y no trae `cf-ray`. Ver el
 * comentario de `lib/api/internal-only.ts` — no es una segunda guardia sobre lo
 * mismo, comprueba otra cosa.
 */

export async function POST(request: Request) {
  const refused = rejectIfViaPublicEdge(request);
  if (refused) return refused;

  if (!databaseConfigured) return NextResponse.json({ ghosted: 0, reminded: 0 });

  const db = getDb();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const manageUrl = `${siteUrl}/postulaciones?view=tabla`;

  const [ghosted, dueReminders] = await Promise.all([markGhostedApplications(), listDueReminders()]);

  const userIds = [...new Set([...ghosted.map((g) => g.userId), ...dueReminders.map((r) => r.userId)])];
  const accounts = userIds.length
    ? await db
        .select({ id: schema.user.id, email: schema.user.email, emailVerified: schema.user.emailVerified })
        .from(schema.user)
        .where(inArray(schema.user.id, userIds))
    : [];
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  let ghostedMailed = 0;
  const ghostedByUser = groupBy(ghosted, (g) => g.userId);
  for (const [userId, applications] of ghostedByUser) {
    const account = accountById.get(userId);
    if (!account?.emailVerified) continue;
    // El correo de ghosting es no solicitado — lo dispara el sistema, en un
    // horario que el usuario nunca pidió — así que requiere el mismo tipo de
    // consentimiento explícito que `job_alerts` (ver `lib/legal/consent.ts`).
    // Esto gobierna sólo el CANAL DE CORREO: `markGhostedApplications()` ya
    // corrió arriba para todas las cuentas, el cambio a `sin_respuesta` y su
    // evento quedaron escritos igual, y el aviso sigue visible en el tablero
    // y en el detalle de la postulación sin este consentimiento. No lo
    // muevas antes de `markGhostedApplications()`.
    if (!(await hasTrackerMailConsent(userId))) continue;
    try {
      const delivered = await sendMail(
        ghostingMail(
          account.email,
          applications.map((a) => ({ jobTitle: a.jobTitle ?? "", company: a.company ?? "" })),
          manageUrl,
        ),
      );
      if (delivered) ghostedMailed += 1;
    } catch (error) {
      console.error("[tracker-cron] falló el aviso de ghosting para una cuenta:", error instanceof Error ? error.message : error);
    }
  }

  let remindersSent = 0;
  const remindersByUser = groupBy(dueReminders, (r) => r.userId);
  for (const [userId, reminders] of remindersByUser) {
    const account = accountById.get(userId);
    if (!account?.emailVerified) continue;
    try {
      const delivered = await sendMail(
        followUpMail(
          account.email,
          reminders.map((r) => ({ jobTitle: r.jobTitle ?? "", company: r.company ?? "", message: r.message })),
          manageUrl,
        ),
      );
      // Sólo se marcan enviados si el correo salió de verdad — un envío
      // fallido o sin presupuesto deja la fila como estaba, y la corrida de
      // mañana la vuelve a encontrar. Ver el comentario de `sendMail`.
      if (delivered) {
        await Promise.all(reminders.map((r) => markReminderSent(r.id)));
        remindersSent += reminders.length;
      }
    } catch (error) {
      console.error("[tracker-cron] falló el recordatorio para una cuenta:", error instanceof Error ? error.message : error);
    }
  }

  return NextResponse.json({
    ghosted: ghosted.length,
    ghostedMailed,
    dueReminders: dueReminders.length,
    remindersSent,
  });
}

function groupBy<T, K>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}
