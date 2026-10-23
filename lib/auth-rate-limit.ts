import "server-only";

import { createHash } from "node:crypto";
import type { BetterAuthOptions } from "better-auth";
import { consume } from "@/lib/rate-limit";

/**
 * Where Better Auth's rate limiter keeps its buckets, minus the raw address.
 *
 * Left to itself (`storage: "database"`) Better Auth writes each bucket under
 * the key `<ip>|<path>` (`createRateLimitKey`,
 * `@better-auth/core/dist/utils/ip.mjs`) — the visitor's address in the clear,
 * in `rate_limit`, for anyone who touched a sign-in, sign-up or password-reset
 * endpoint. Clause 3 of `/legales/privacidad` promises that without an account
 * "no guardamos la IP: lo que se almacena es un hash con sal", and everywhere
 * else in this app that is true (`quotaSubject`, `rateLimitKey`). This closes
 * the one place it was not.
 *
 * The whole key is hashed rather than parsed. Splitting `<ip>|<path>` back
 * apart would tie this to a key format Better Auth owns, and a format change
 * would quietly start storing the raw value again. Hashing the string as a
 * whole keeps one bucket per (address, path) — the granularity it always had —
 * and fails safe: there is no input that reaches storage unhashed.
 *
 * The buckets live in `app_rate_limit`, through the same atomic `consume()` the
 * rest of the app uses, so `scripts/prune.mjs` already covers them. Better
 * Auth's own `rate_limit` table is no longer written; the prune job still
 * sweeps it, to clear whatever raw addresses it held before this existed.
 *
 * One behavioural difference, and a deliberate one: Better Auth's window slides
 * from the last allowed request, while `consume()` is fixed from the first. For
 * the rules in `lib/auth.ts` (10 sign-ins per 5 minutes, 5 mails per hour) that
 * is the same protection with a clearer reset time.
 */

/** Salted, so the stored value cannot be walked back to an address. */
function bucketId(key: string): string {
  const salt = process.env.QUOTA_IP_SALT ?? "cvexact-dev-salt";
  return createHash("sha256").update(`${salt}:${key}`).digest("hex").slice(0, 32);
}

/**
 * Better Auth 1.6 still lists `get` and `set` as required members of a storage,
 * for the non-atomic path it falls back to when a storage has no `consume`
 * (`legacyConsume` in `better-auth/dist/api/rate-limiter/index.mjs`). This one
 * has a `consume`, so neither is ever called. If a newer version does, failing
 * loudly beats quietly letting every request through. The contract drops both
 * on `next` (TODO(rate-limit-consume-required) upstream) and these two go with
 * it — `tsc` will say so when the upgrade makes them excess properties.
 */
async function unsupported(): Promise<never> {
  throw new Error("authRateLimitStorage only implements consume()");
}

export const authRateLimitStorage = {
  get: unsupported,
  set: unsupported,
  async consume(key, rule) {
    const result = await consume(`auth:${bucketId(key)}`, rule);
    return result.ok
      ? { allowed: true, retryAfter: null }
      : { allowed: false, retryAfter: result.retryAfterSeconds };
  },
} satisfies NonNullable<NonNullable<BetterAuthOptions["rateLimit"]>["customStorage"]>;
