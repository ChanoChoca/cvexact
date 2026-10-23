import "server-only";

import { eq, sql } from "drizzle-orm";
import { databaseConfigured, getDb, schema } from "@/lib/db";
import { mailConfigured, sendMail } from "@/lib/email/mailer";
import { lockoutMail } from "@/lib/email/templates";

/**
 * Per-account lockout for repeated failed sign-ins.
 *
 * Better Auth's rate limiter keys on the client address, which answers "is this
 * address asking too often". An attacker with a list of addresses — a botnet, a
 * proxy pool, a phone toggling airplane mode — never trips it while still
 * spending thousands of guesses on one account. This answers the other
 * question, "is this account under attack", and does not care where the guesses
 * come from.
 *
 * Both are needed. Neither replaces the other, and neither is a substitute for
 * the user having a password worth guarding.
 */

/** Failures tolerated before the first lock. Five is a fat-fingered password, not an attack. */
const THRESHOLD = 5;
/** Nobody is kept out longer than this, however many times they failed. */
const MAX_LOCK_MINUTES = 30;

/**
 * How long the account stays locked after `failures` failed attempts.
 *
 * Doubling, so a human who mistyped twice more waits a minute and an automated
 * run is priced out within a handful of rounds; capped, because past half an
 * hour the lockout stops protecting the account and starts being the attack —
 * anyone who knows an email could keep its owner out indefinitely.
 */
export function lockMinutes(failures: number): number {
  if (failures < THRESHOLD) return 0;
  return Math.min(2 ** (failures - THRESHOLD), MAX_LOCK_MINUTES);
}

/** Lowercased, so `A@b.com` and `a@b.com` cannot be attacked as two budgets. */
function normalize(email: string): string {
  return email.trim().toLowerCase();
}

type Attempt = { failures: number; lockedUntil: number | null; notified: boolean };

/** Dev fallback so sign-in works without Postgres, alongside the ones in `lib/quota.ts`. */
const memory = new Map<string, Attempt>();

async function read(email: string): Promise<Attempt | null> {
  if (!databaseConfigured) return memory.get(email) ?? null;

  const [row] = await getDb()
    .select({
      failures: schema.loginAttempt.failures,
      lockedUntil: schema.loginAttempt.lockedUntil,
      notifiedAt: schema.loginAttempt.notifiedAt,
    })
    .from(schema.loginAttempt)
    .where(eq(schema.loginAttempt.email, email))
    .limit(1);

  if (!row) return null;
  return {
    failures: row.failures,
    lockedUntil: row.lockedUntil ? row.lockedUntil.getTime() : null,
    notified: row.notifiedAt !== null,
  };
}

/**
 * Whether this account is currently locked, and for how much longer.
 *
 * Callers must phrase the refusal so it reads the same for an account that does
 * not exist. A message that only ever appears for real accounts turns the
 * lockout into an account-enumeration oracle, which would make this feature a
 * net loss.
 */
export async function checkLockout(
  rawEmail: string,
): Promise<{ locked: false } | { locked: true; retryAfterSeconds: number }> {
  const attempt = await read(normalize(rawEmail));
  if (!attempt?.lockedUntil) return { locked: false };

  const remaining = attempt.lockedUntil - Date.now();
  if (remaining <= 0) return { locked: false };

  return { locked: true, retryAfterSeconds: Math.ceil(remaining / 1000) };
}

/**
 * Counts one failed sign-in, locking the account once past the threshold.
 *
 * Never throws: this runs in an `after` hook on a request that has already been
 * answered, and a bookkeeping failure must not turn a plain "wrong password"
 * into a 500.
 */
export async function recordFailure(rawEmail: string): Promise<void> {
  const email = normalize(rawEmail);

  try {
    const attempt = await bump(email);
    const minutes = lockMinutes(attempt.failures);

    // Told once per run of failures, not once per attempt: an attacker should
    // not be able to turn this into a mail flood aimed at the account's owner.
    if (minutes > 0 && !attempt.notified) {
      await markNotified(email);
      await notifyOwner(email, minutes);
    }
  } catch (error) {
    console.error("[lockout] could not record a failed sign-in:", error);
  }
}

async function bump(email: string): Promise<Attempt> {
  const now = Date.now();

  if (!databaseConfigured) {
    const previous = memory.get(email);
    // A lock that has already elapsed starts the count over, so an account is
    // not locked for half an hour on the strength of last week's typos.
    const stale = previous?.lockedUntil !== null && (previous?.lockedUntil ?? 0) <= now;
    const failures = (previous && !stale ? previous.failures : 0) + 1;
    const minutes = lockMinutes(failures);
    const next: Attempt = {
      failures,
      lockedUntil: minutes > 0 ? now + minutes * 60_000 : null,
      notified: previous && !stale ? previous.notified : false,
    };
    memory.set(email, next);
    return next;
  }

  const table = schema.loginAttempt;
  // One statement, so concurrent guesses cannot both read the same count and
  // both write it back as one more.
  const expired = sql`${table.lockedUntil} is not null and ${table.lockedUntil} <= now()`;
  const failures = sql`case when ${expired} then 1 else ${table.failures} + 1 end`;

  const [row] = await getDb()
    .insert(table)
    .values({ email, failures: 1, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: table.email,
      set: {
        failures,
        // Recomputed from the new count in the same statement: `greatest` is the
        // cap, and the doubling below it mirrors `lockMinutes`.
        lockedUntil: sql`case when ${failures} >= ${THRESHOLD} then now() + (least(power(2, ${failures} - ${THRESHOLD}), ${MAX_LOCK_MINUTES}) * interval '1 minute') else null end`,
        notifiedAt: sql`case when ${expired} then null else ${table.notifiedAt} end`,
        updatedAt: new Date(),
      },
    })
    .returning({
      failures: table.failures,
      lockedUntil: table.lockedUntil,
      notifiedAt: table.notifiedAt,
    });

  return {
    failures: row?.failures ?? 1,
    lockedUntil: row?.lockedUntil ? row.lockedUntil.getTime() : null,
    notified: (row?.notifiedAt ?? null) !== null,
  };
}

async function markNotified(email: string): Promise<void> {
  if (!databaseConfigured) {
    const entry = memory.get(email);
    if (entry) memory.set(email, { ...entry, notified: true });
    return;
  }
  await getDb()
    .update(schema.loginAttempt)
    .set({ notifiedAt: new Date() })
    .where(eq(schema.loginAttempt.email, email));
}

/**
 * Tells the account's owner, if there is one.
 *
 * Gated on the account actually existing — not to keep a secret from the
 * attacker, who learns nothing either way, but because mailing every address
 * someone types into the login form would make this endpoint a way to send
 * unsolicited mail to strangers.
 */
async function notifyOwner(email: string, minutes: number): Promise<void> {
  if (!mailConfigured || !databaseConfigured) return;

  const [owner] = await getDb()
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(sql`lower(${schema.user.email}) = ${email}`)
    .limit(1);

  if (!owner) return;
  await sendMail(lockoutMail(owner.email, minutes));
}

/** Clears the count after a successful sign-in. */
export async function clearFailures(rawEmail: string): Promise<void> {
  const email = normalize(rawEmail);
  try {
    if (!databaseConfigured) {
      memory.delete(email);
      return;
    }
    await getDb().delete(schema.loginAttempt).where(eq(schema.loginAttempt.email, email));
  } catch (error) {
    console.error("[lockout] could not clear failed sign-ins:", error);
  }
}

/** Test seam. Clears the dev fallback between cases. */
export function resetLockoutMemory(): void {
  memory.clear();
}
