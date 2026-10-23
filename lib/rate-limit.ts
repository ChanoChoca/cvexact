import "server-only";

import { sql } from "drizzle-orm";
import { databaseConfigured, getDb, schema } from "@/lib/db";
import { clientIp, quotaSubject } from "@/lib/quota";

/**
 * A fixed-window rate limit for the routes Better Auth never sees.
 *
 * Better Auth guards `/api/auth/*` on its own; everything else in this app was
 * unguarded. That mattered most where a request is expensive but free: the PDF
 * export launches a Chromium per call with no session at all, and the BYOK path
 * through `openRequest` is anonymous, unmetered, and allowed 180 s of provider
 * time. Neither costs us inference, and both cost us the box.
 *
 * Its own table, `app_rate_limit` — not Better Auth's `rate_limit`, which used
 * to be shared here. Better Auth prunes that table on every request with a
 * cutoff of `max(window, 10, 60)` seconds, blind to `customRules`
 * (`better-auth/dist/api/rate-limiter/index.mjs`, `deleteExpiredRows`): with its
 * own window at 60 s, any bucket written here with a longer window — the email
 * budget's multi-hour ones, `export-pdf`'s 600 s — got wiped out from under it
 * within a minute of any request landing anywhere in the app. A rule is only as
 * long as the shortest-lived table it lives in.
 *
 * Not a substitute for `reserveQuota`. Quota asks whether this consumer may
 * spend another generation; this asks whether anyone may make another request
 * this minute. A metered tier passes through both.
 */

export type RateLimitRule = {
  /** Window length in seconds. */
  window: number;
  /** Requests allowed per window. */
  max: number;
};

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Dev fallback so the app runs without Postgres, alongside `memoryCounters` in
 * `lib/quota.ts`. Per-process and lost on restart.
 */
const memory = new Map<string, { count: number; lastRequest: number }>();

/**
 * Names the thing being limited *and* who is asking.
 *
 * The subject comes from `quotaSubject`, which is a user id when signed in and
 * a salted hash of the client IP otherwise — so the raw address is never
 * written here either, and a signed-in user's allowance follows them across
 * networks instead of being shared with everyone behind their NAT.
 */
export function rateLimitKey(name: string, headers: Headers, userId?: string): string {
  return `app:${name}:${quotaSubject({ userId, ip: clientIp(headers) })}`;
}

/**
 * Counts one request against `key` and says whether it is allowed.
 *
 * The whole check-and-increment is a single statement, so two simultaneous
 * requests cannot both read a stale count and both pass. The window is fixed
 * rather than sliding: `last_request` is the start of the current window and
 * only moves when a window has fully elapsed, which is what makes the reset
 * expressible without a second round trip.
 */
export async function consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const windowMs = rule.window * 1000;
  const now = Date.now();

  const { count, windowStart } = databaseConfigured
    ? await consumeInDatabase(key, windowMs, now)
    : consumeInMemory(key, windowMs, now);

  if (count <= rule.max) return { ok: true };

  // At least a second, so a client that honours `retry-after` actually waits
  // instead of hammering on a rounded-down zero.
  return {
    ok: false,
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)),
  };
}

async function consumeInDatabase(
  key: string,
  windowMs: number,
  now: number,
): Promise<{ count: number; windowStart: number }> {
  const table = schema.appRateLimit;
  const expired = sql`${now} - ${table.lastRequest} >= ${windowMs}`;

  const [row] = await getDb()
    .insert(table)
    // The key doubles as the id: it is already unique per bucket, and a
    // generated one would only be a second name for the same row.
    .values({ id: key, key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: table.key,
      set: {
        count: sql`case when ${expired} then 1 else ${table.count} + 1 end`,
        lastRequest: sql`case when ${expired} then ${now} else ${table.lastRequest} end`,
      },
    })
    .returning({ count: table.count, lastRequest: table.lastRequest });

  return { count: row?.count ?? 1, windowStart: row?.lastRequest ?? now };
}

function consumeInMemory(
  key: string,
  windowMs: number,
  now: number,
): { count: number; windowStart: number } {
  const entry = memory.get(key);
  const next =
    !entry || now - entry.lastRequest >= windowMs
      ? { count: 1, lastRequest: now }
      : { count: entry.count + 1, lastRequest: entry.lastRequest };

  memory.set(key, next);
  return { count: next.count, windowStart: next.lastRequest };
}

/** Test seam. Clears the dev fallback between cases. */
export function resetRateLimitMemory(): void {
  memory.clear();
}
