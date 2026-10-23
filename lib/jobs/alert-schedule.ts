/**
 * Whether a job alert is due to run again. Pulled out of
 * `app/api/jobs/alerts/send/route.ts` for the same reason `feed-query.ts`
 * was pulled out of the feed route: a `route.ts` in this app exports only
 * the handlers Next.js recognises, so anything worth unit-testing on its own
 * has to live in `lib/`.
 */

/** Hours since `lastSentAt` before an alert is due again. A little under the
 *  nominal period (24h/168h) so a cron that drifts by an hour or two never
 *  skips a cycle waiting for the exact mark. */
export const FREQUENCY_HOURS: Record<string, number> = { daily: 20, weekly: 156 };

export type AlertSchedule = { frequency: string; lastSentAt: Date | null };

export function isAlertDue(alert: AlertSchedule, now: Date): boolean {
  if (!alert.lastSentAt) return true;
  const hours = FREQUENCY_HOURS[alert.frequency] ?? FREQUENCY_HOURS.daily!;
  return now.getTime() - alert.lastSentAt.getTime() >= hours * 60 * 60 * 1000;
}
