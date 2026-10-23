import { NextResponse } from "next/server";
import { and, eq, gt, ilike, type SQL } from "drizzle-orm";
import { databaseConfigured, getDb, schema } from "@/lib/db";
import { hasJobAlertsConsent } from "@/lib/legal/consent";
import { parseAnyProfile } from "@/lib/profile/parse";
import { toPlainProfile } from "@/lib/profile/project";
import { scoreJobPosting } from "@/lib/jobs/score";
import { isAlertDue } from "@/lib/jobs/alert-schedule";
import { signJobAlertUnsubscribeToken } from "@/lib/jobs/alert-token";
import { sendMail } from "@/lib/email/mailer";
import { jobAlertMail } from "@/lib/email/templates";
import { rejectIfViaPublicEdge } from "@/lib/api/internal-only";

export const runtime = "nodejs";

/**
 * Scores every active job alert against `job_posting` and mails whoever has
 * new matches. Not user-triggered — `scripts/send-job-alerts.mjs` calls this
 * once a day from a CronJob (ver los CronJobs de tu despliegue).
 *
 * Internal-only, and what makes it so is `rejectIfViaPublicEdge`, not
 * `proxy.ts`. The Cloudflare Transform Rule stamps `X-Origin-Auth` on all
 * public traffic, so `proxy.ts` only tells "came through Cloudflare" apart from
 * "came straight to the node" — a visitor passes it. Before this guard anyone
 * on the internet could trigger the run (verified 2026-09-18: a public `GET`
 * answered 405, i.e. it reached this route). The CronJob comes in by the
 * cluster Service (`INTERNAL_APP_URL`), which never touches Cloudflare and so
 * carries no `cf-ray`. Not a duplicate of the perimeter check: it verifies the
 * other half — see `lib/api/internal-only.ts`.
 *
 * Why this has to be a route and not another standalone `scripts/*.mjs` like
 * `ingest-jobs.mjs`/`ingest-jooble.mjs`: those only fetch, normalise and
 * write raw SQL. This needs `lib/jobs/score.ts` (which needs the profile
 * schema and `lib/ai/evidence.ts`) and `lib/email/mailer.ts` — real
 * TypeScript app code that only exists compiled inside the `runner` image,
 * not the bare-`pg` `migrator` one the ingestion scripts run in.
 *
 * Runs every alert sequentially and never lets one throw the rest away — the
 * same "one bad source doesn't sink the run" shape `ingest-jobs.mjs` uses
 * for its four sources.
 */

/** How many of the best matches go in one mail — long enough to be worth
 *  opening, short enough that nobody scrolls past the point of reading it. */
const MAX_JOBS_PER_MAIL = 10;

/** How many recent postings a single alert scores against. `job_posting` is
 *  the whole feed, not one page of it — bounding this is what keeps one
 *  alert from re-scoring thousands of rows every run. */
const CANDIDATE_LIMIT = 300;

export async function POST(request: Request) {
  const refused = rejectIfViaPublicEdge(request);
  if (refused) return refused;

  if (!databaseConfigured) return NextResponse.json({ sent: 0, total: 0 });

  const db = getDb();
  const now = new Date();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const alerts = await db.select().from(schema.jobAlert);
  const due = alerts.filter((alert) => isAlertDue(alert, now));

  let sent = 0;
  for (const alert of due) {
    try {
      // Comprobado en cada corrida, no sólo al crear la alerta — ver el
      // comentario de `withdrawJobAlertsConsent` en lib/legal/consent.ts.
      if (!(await hasJobAlertsConsent(alert.userId))) continue;

      const [account] = await db
        .select({ email: schema.user.email, emailVerified: schema.user.emailVerified })
        .from(schema.user)
        .where(eq(schema.user.id, alert.userId))
        .limit(1);
      if (!account || !account.emailVerified) continue;

      const [profileRow] = await db
        .select({ data: schema.profile.data })
        .from(schema.profile)
        .where(eq(schema.profile.userId, alert.userId))
        .limit(1);
      if (!profileRow) continue;

      // La fila puede estar en cualquiera de los dos formatos (ver `parseAnyProfile`).
      const stored = parseAnyProfile(profileRow.data);
      if (!stored) continue;
      const profile = toPlainProfile(stored);

      const conditions: SQL[] = [];
      if (alert.workMode) conditions.push(eq(schema.jobPosting.workMode, alert.workMode));
      if (alert.query) conditions.push(ilike(schema.jobPosting.title, `%${alert.query}%`));
      // Sólo avisos publicados desde el último envío — sin esto, el mismo
      // aviso de mejor puntaje volvería a mandarse todos los días mientras
      // siga en el feed. La primera vez (`lastSentAt` null) no filtra por
      // fecha: es "mostrame lo que hay ahora", no "lo que apareció desde
      // nunca". Un aviso sin `publishedAt` legible queda afuera de los envíos
      // repetidos a propósito — sin fecha no hay forma de saber si ya se
      // mandó, y mandarlo de nuevo cada corrida es peor que no mandarlo: es
      // el mismo criterio de `lib/ai/evidence.ts` de preferir el silencio a
      // una señal que no se puede sostener.
      if (alert.lastSentAt) {
        conditions.push(gt(schema.jobPosting.publishedAt, alert.lastSentAt));
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const candidates = await db
        .select()
        .from(schema.jobPosting)
        .where(where)
        .limit(CANDIDATE_LIMIT);

      const scored = candidates
        .map((job) => ({ job, match: scoreJobPosting(profile, job, now) }))
        .filter(({ match }) => match.score >= alert.minScore)
        .sort((a, b) => b.match.score - a.match.score);

      // Same posting through more than one source (`getonbrd` and `jooble`
      // both carrying the same role) scores twice and would otherwise take
      // two of the ten slots in one mail — dedupe by the same key
      // `/api/jobs/feed` collapses the browsable feed by (see
      // `dedupPartitionKeySql` in `lib/jobs/feed-query.ts`), keeping the
      // higher-scoring row since `scored` is already sorted best-first.
      // `CANDIDATE_LIMIT` is generous enough that losing a few rows to this
      // still leaves room for `MAX_JOBS_PER_MAIL` distinct roles.
      const seenGroups = new Set<string>();
      const matches = scored
        .filter(({ job }) => {
          const key = job.dedupGroupId || job.id;
          if (seenGroups.has(key)) return false;
          seenGroups.add(key);
          return true;
        })
        .slice(0, MAX_JOBS_PER_MAIL);

      if (matches.length === 0) {
        // Nada para mandar no es lo mismo que "no corrió": igual cuenta como
        // atendida, o cada corrida futura le seguiría re-evaluando el mismo
        // rango de avisos sin lastSentAt nunca avanzando.
        await db
          .update(schema.jobAlert)
          .set({ lastSentAt: now })
          .where(eq(schema.jobAlert.userId, alert.userId));
        continue;
      }

      await sendMail(
        jobAlertMail(
          account.email,
          matches.map(({ job, match }) => ({
            title: job.title,
            company: job.company,
            score: match.score,
            url: job.url,
          })),
          `${siteUrl}/api/jobs/alerts/unsubscribe?u=${encodeURIComponent(alert.userId)}&t=${signJobAlertUnsubscribeToken(alert.userId)}`,
        ),
      );

      await db
        .update(schema.jobAlert)
        .set({ lastSentAt: now })
        .where(eq(schema.jobAlert.userId, alert.userId));
      sent += 1;
    } catch (error) {
      console.error(
        "[jobs-alerts] failed for one alert:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return NextResponse.json({ sent, due: due.length, total: alerts.length });
}
