import "server-only";

import { createHash } from "node:crypto";
import { consume } from "@/lib/rate-limit";
import type { MailKind } from "@/lib/email/mailer";

/**
 * How much mail this app may send, independent of any per-route rate limit.
 *
 * The routes that trigger mail are already capped per caller in `lib/auth.ts`
 * — five sign-ups an hour, five password resets an hour, and so on, keyed on
 * IP-or-account. None of that holds against an attacker with many addresses:
 * a caller that never repeats never trips a limit keyed on the caller. What
 * does not scale with how the requests are distributed is the account this
 * all goes through — today Resend's free tier, a hard 100 messages a day
 * (https://resend.com/docs/knowledge-base/account-quotas-and-limits): past
 * that, Resend itself refuses the send, not this budget, which is exactly
 * the "half-configured" failure `lib/email/mailer.ts` says must never
 * happen. If this account ever moves to a paid Resend plan, that ceiling
 * lifts and `GLOBAL_DAILY_MAX` / `UNSOLICITED_GATE_MAX` should move with it.
 *
 * Three checks, all built on `consume()` from `lib/rate-limit.ts` — the same
 * atomic upsert the per-route limits use, just with different keys:
 *
 *  - Per recipient (`RECIPIENT_HOURLY`, `RECIPIENT_DAILY`): keyed on a salted
 *    hash of the address, so the mailbox itself never appears in a limit
 *    table. Caps one target from being used to test how much this app will
 *    mail them, regardless of how many callers or addresses are behind it.
 *  - Global (`GLOBAL_DAILY_MAX`): one shared bucket for the whole app, well
 *    under the mailbox's own daily ceiling.
 *
 * The global bucket is reserved for `account` mail — a password reset, a
 * delete confirmation, a lockout notice — because losing one of those is how
 * this kind of flood does real damage to a real person. `unsolicited` mail —
 * a verification link, sendable against any address by anyone who types it
 * into a form — passes through a *second*, narrower gate first
 * (`UNSOLICITED_GATE_MAX`) before it may spend any of the shared budget at
 * all. That gate is what bounds unsolicited mail's total draw on the shared
 * bucket to `UNSOLICITED_GATE_MAX`, no matter how many attempts are made past
 * it: `consume()` keeps counting attempts once a bucket is exhausted, so
 * without a dedicated ceiling on the *unsolicited* side, enough sign-up spam
 * would eventually push the *shared* counter past `GLOBAL_DAILY_MAX` on its
 * own and start refusing account mail too — exactly the outcome the reserve
 * exists to prevent. Two independent buckets is what keeps that growth from
 * ever crossing over.
 *
 * Known trade-off: the per-recipient cap can itself be turned against its
 * target — enough requests from enough callers exhausts *their* daily
 * allowance, and a legitimate reset for them stops arriving until the window
 * resets. That is the cost of capping abuse per recipient at all, and unlike
 * the mailbox-wide risk this exists to prevent, it is bounded to one address
 * at a time.
 *
 * `job_alert` gets the same treatment as `unsolicited`: its own gate
 * (`JOB_ALERT_GATE_MAX`) ahead of the shared bucket, sized well under it.
 * Unlike `unsolicited`, nobody can point this mail at an address they do not
 * control — it requires an account, a synced profile and its own consent —
 * but a day with a lot of alerts to send out is still not allowed to be the
 * day a password reset has to wait.
 *
 * `tracker` (recordatorios de seguimiento y avisos de ghosting,
 * `scripts/tracker-cron.mjs`) gets the same treatment again, with its own
 * `TRACKER_GATE_MAX`. Adding a fourth gate meant re-splitting
 * `GLOBAL_DAILY_MAX`'s 90: `UNSOLICITED_GATE_MAX` came down from 60 to 45 to
 * make room, a real trade-off — fewer verification/sign-up mails fit in a
 * single worst-case day — rather than raising the shared ceiling itself,
 * which is pinned to Resend's free-tier daily cap (see above). 45 + 20 + 15
 * still leaves at least 10 of the 90 clear for `account` mail even when
 * `unsolicited`, `job_alert`, and `tracker` are all maxed out the same day.
 */

const RECIPIENT_HOURLY = { window: 3600, max: 3 };
const RECIPIENT_DAILY = { window: 86400, max: 8 };
const GLOBAL_WINDOW = 86400;
const GLOBAL_DAILY_MAX = 90;
/** How much of the shared daily budget `unsolicited` mail may ever draw on. */
const UNSOLICITED_GATE_MAX = 45;
/** How much of the shared daily budget `job_alert` mail may ever draw on. */
const JOB_ALERT_GATE_MAX = 20;
/** How much of the shared daily budget `tracker` mail may ever draw on. */
const TRACKER_GATE_MAX = 15;

const GLOBAL_KEY = "mail:global:day";
const UNSOLICITED_GATE_KEY = "mail:global:day:unsolicited-gate";
const JOB_ALERT_GATE_KEY = "mail:global:day:job-alert-gate";
const TRACKER_GATE_KEY = "mail:global:day:tracker-gate";

/** Salted so the address itself is never written to the rate-limit table. */
function recipientKey(email: string): string {
  const salt = process.env.MAIL_BUDGET_SALT ?? "cvexact-dev-salt";
  const hash = createHash("sha256")
    .update(`${salt}:${email.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
  return `mail:recipient:${hash}`;
}

/**
 * Reserves one send against every budget it counts toward, narrowest first.
 *
 * Never throws — a bookkeeping failure here must not turn into a dropped
 * mail, so callers treat a thrown error the same as a full budget: don't
 * send. Returns false without logging the address; only the kind and which
 * ceiling was hit reach the log, same discipline as `sendMail` itself.
 */
export async function reserveMailBudget(kind: MailKind, to: string): Promise<boolean> {
  try {
    const key = recipientKey(to);

    const hourly = await consume(`${key}:hour`, RECIPIENT_HOURLY);
    if (!hourly.ok) {
      console.error(`[mail-budget] recipient hourly cap reached for a "${kind}" mail`);
      return false;
    }

    const daily = await consume(`${key}:day`, RECIPIENT_DAILY);
    if (!daily.ok) {
      console.error(`[mail-budget] recipient daily cap reached for a "${kind}" mail`);
      return false;
    }

    if (kind === "unsolicited") {
      const gate = await consume(UNSOLICITED_GATE_KEY, {
        window: GLOBAL_WINDOW,
        max: UNSOLICITED_GATE_MAX,
      });
      if (!gate.ok) {
        console.error("[mail-budget] unsolicited mail's share of the daily budget is spent");
        return false;
      }
    }

    if (kind === "job_alert") {
      const gate = await consume(JOB_ALERT_GATE_KEY, {
        window: GLOBAL_WINDOW,
        max: JOB_ALERT_GATE_MAX,
      });
      if (!gate.ok) {
        console.error("[mail-budget] job_alert mail's share of the daily budget is spent");
        return false;
      }
    }

    if (kind === "tracker") {
      const gate = await consume(TRACKER_GATE_KEY, { window: GLOBAL_WINDOW, max: TRACKER_GATE_MAX });
      if (!gate.ok) {
        console.error("[mail-budget] tracker mail's share of the daily budget is spent");
        return false;
      }
    }

    const global = await consume(GLOBAL_KEY, { window: GLOBAL_WINDOW, max: GLOBAL_DAILY_MAX });
    if (!global.ok) {
      console.error(`[mail-budget] global daily cap reached for a "${kind}" mail`);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[mail-budget] could not check the budget; refusing to send:", error);
    return false;
  }
}
