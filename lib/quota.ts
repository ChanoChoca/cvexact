import "server-only";

import { createHash } from "node:crypto";
import { eq, like, or, sql } from "drizzle-orm";
import { databaseConfigured, getDb, schema } from "@/lib/db";

/**
 * Metering for the hybrid key model.
 *
 *   byok    — the user's own key: nothing of ours is spent, so nothing is
 *             limited. Counted anyway, to know how many people this path
 *             actually serves; see `meterByok`.
 *   pro     — active subscription: our key, our better model, a daily ceiling
 *             that exists to bound abuse rather than to shape the product.
 *   credits — a pack bought outright: our key, our better model, spent from a
 *             persistent balance rather than a counter that resets.
 *   free    — nobody's key. `resolveModel` refuses these before this module is
 *             ever asked to meter anything; the tier exists only so the refusal
 *             can say "bring your own key" instead of a generic error.
 *
 * There is no server-funded trial. The plan for someone who cannot or will not
 * pay is BYOK, which is free, unlimited, and the whole product — a trial of our
 * own would have been two ways to give away the same thing. Nobody is ever
 * locked out of the product; they are pointed at the path that costs us nothing.
 *
 * Costs differ per action because the generators differ in size. Interview prep
 * is the longest output, so it costs more.
 */

export type Tier = "byok" | "pro" | "credits" | "free";

/**
 * The tiers metered here. `byok` is unlimited and never reaches this module;
 * `free` never reaches it either — `resolveModel` refuses it first.
 */
export type MeteredTier = Exclude<Tier, "byok" | "free">;

export type Action =
  | "cv"
  | "answers"
  | "email"
  | "interview"
  | "video"
  | "metrics"
  | "intake"
  | "import"
  /**
   * Shortening lines of a CV that was already generated, so the page fits
   * (to-do «ajuste a una hoja», Etapa 2). Only ever runs with the person's own
   * key — the route refuses anyone else with `byok_required` — over lines that
   * are already written, and it asks for a few hundred output tokens: it costs
   * nothing and is charged to nobody. It lives here anyway because every route
   * that calls a model goes through `openRequest`, and an action that is not in
   * this list is a route that cannot compile.
   */
  | "condense";

export const ACTION_COST: Record<Action, number> = {
  cv: 1,
  answers: 1,
  email: 1,
  interview: 2,
  // A couple of minutes of speech: shorter than the prep sheet, and the user
  // will re-run it once or twice to get the length right.
  video: 1,
  // Questions about one role's bullets — the smallest output here, and
  // the one whose answers improve every later generation. Pricing it like the
  // rest would make the free tier choose between numbers and a CV.
  metrics: 1,
  // One turn of the profile interview.
  intake: 1,
  // Reading a whole CV into a profile. Priced like the prep sheet because it is
  // shaped like it: one big output, asked for once, off the back of a document
  // rather than a sentence.
  import: 2,
  /**
   * Zero, and on purpose: it edits lines that are already written, it is only
   * ever offered with the person's own key (so nothing of ours is spent
   * anyway), and charging for the step that fixes a page the model overshot
   * would be charging for our own arithmetic. Kept as a row rather than left
   * out so `reserveQuota` stays total over `Action`.
   */
  condense: 0,
};

/**
 * How a tier's allowance is replenished: `day` resets at UTC midnight, `none`
 * is credits' balance rather than a counter, and `lifetime` is a budget that
 * never resets — the same `usage_counter` table holds it via the literal
 * string `"lifetime"` where the date would otherwise go.
 */
export type Period = "day" | "month" | "lifetime" | "none";

/**
 * What one complete application costs, in credits.
 *
 * An application is not a concept this side of the wire has: the server meters
 * actions, and an application id supplied by the client is a number the client
 * could pick. Exported so a balance can be quoted in applications instead of
 * raw credits — see `app/precios/page.tsx` and `/api/billing/status` — and a
 * page that recomputed this itself would be one edit away from advertising a
 * different number than the server enforces.
 */
export const APPLICATION_COST =
  ACTION_COST.cv +
  ACTION_COST.answers +
  ACTION_COST.email +
  ACTION_COST.interview +
  ACTION_COST.video;

/**
 * A same-day anti-burst guard on the paid tiers' main budget (cv, answers,
 * email, interview, video) — not the number that bounds what a subscription
 * costs in a month, which is `PAID_MONTHLY_CAP`.
 *
 * Sized against real use rather than against paranoia: a genuinely intensive
 * subscriber runs about three complete applications a day (18 credits). 40
 * is more than double that, so nobody doing this by hand notices it — its job
 * is to stop a script running unattended for a few hours from spending a
 * whole month's allowance before anyone looks at the account, which is a
 * different failure than "used the product a lot" and deserves a same-day
 * reset rather than a month-long lockout.
 *
 * This used to be the only cap (400, sized as "far above any real use" with
 * nothing bounding the month behind it) — see `PAID_MONTHLY_CAP` for why that
 * stopped being enough once a real, metered price was measured against it.
 */
export const PAID_DAILY_CAP = 40;

/**
 * What a subscription actually pays for in a month.
 *
 * `SERVICE_PRO_MODEL`'s real price is what this is sized against, not a
 * guess. As of 2026-08-29 it is pinned to the same model as `SERVICE_MODEL` —
 * `deepseek-v4-flash` runs everything, `deepseek-v4-pro` runs nothing — so the
 * cost below is flash's own published rate, not pro's. It used to be priced
 * against pro (exactly 3x flash on every axis this deployment measured
 * against a live key on 2026-08-28): 300 credits — 50 complete applications —
 * cost roughly US$1.75 off-peak to US$3.85 at DeepSeek's peak-hour price on
 * pro. On flash that same worst case is a third of it, roughly US$0.58 to
 * US$1.28, against a subscription that nets about US$5.55/month after
 * Mercado Pago's cut. A wide margin even before re-measuring, and before
 * whatever this jurisdiction's tax on cross-border card charges to a foreign
 * provider adds on the cost side — not modelled here, and not the same
 * question as what `/precios` charges the subscriber in ARS.
 *
 * Without a monthly ceiling, the only thing standing between a subscriber and
 * the daily anti-burst cap running every day of the month is nobody having
 * tried it — `PAID_DAILY_CAP` alone would let one account cost several times
 * what the subscription earns. Re-check this against `generation_usage` once
 * a real month of it exists rather than trusting the estimate indefinitely —
 * see the same caveat on `packCredits` in `lib/billing/pack.ts`. As of
 * 2026-08-29 that table still cannot answer the question: see the comment on
 * `recordUsage` in `lib/billing/usage.ts` for why most of what it logs today
 * is `calls: 1` with zero tokens.
 */
export const PAID_MONTHLY_CAP = 300;

/**
 * The profile-assist budget's own monthly ceiling — see `SEPARATE_BUDGET`.
 * `import` is one of its three actions and runs on the pro model like the
 * main budget above, so it is sized the same way: 60 credits is 30 imports a
 * month, generous for something a person does once or twice per profile
 * rather than per application.
 */
export const INTAKE_MONTHLY_CAP = 60;

/**
 * Actions metered against their own budget instead of the shared one.
 *
 * Everything here is help with *filling in the profile*, and none of it is
 * required to fill one in — the ficha's fields write straight to storage and
 * cost nothing. What these share is that spending them on the profile must
 * never come out of the budget for the documents an employer reads: a user who
 * pastes their CV in and asks the assistant to tidy two sections has not used
 * the product yet, and finding they can no longer generate anything would be
 * the worst possible reading of what they just did.
 *
 * They are also genuinely cheaper than a generation — a few hundred output
 * tokens against a whole CV. Counted against a distinct subject so the two never
 * touch: profile help cannot exhaust the CV budget and generating cannot
 * exhaust profile help.
 */
const SEPARATE_BUDGET: Partial<Record<Action, { suffix: string }>> = {
  // One section handed a paragraph instead of filled in by hand.
  intake: { suffix: ":intake" },
  // Numbers, from the button on a role. One call per role, and the same budget
  // as the rest of the profile help because that is what it is — the user is
  // still on `/perfil`, still improving what a later generation will read.
  metrics: { suffix: ":intake" },
  // Importing a CV *is* building the profile — it is the shortcut past the
  // typing, not a separate product. Metering it against the shared allowance
  // would mean a `pro` subscriber spends a third of their daily cap getting
  // their own CV into the app, before generating anything with it.
  import: { suffix: ":intake" },
};

/**
 * The counter row, ceiling and period an action is metered against.
 *
 * The row and the ceiling always come from here together, so a refund can never
 * land on a different counter than the reservation did.
 */
/** One counter row and the ceiling it is compared against. */
type Budget = { subject: string; allowance: number; period: Period };

/**
 * Every counter one reservation must clear, for an action against a metered
 * tier.
 *
 * A profile-assist action (`SEPARATE_BUDGET`) checks one: its own monthly
 * row, on its own suffix so it can never touch the main budget. Everything
 * else checks two, against the *same* subject — the monthly ceiling that
 * bounds what a subscriber can cost in a month, and the daily anti-burst
 * guard that bounds how fast they can get there. Both have to clear for the
 * reservation to stand; `reserveQuota` increments every entry this returns
 * and refunds all of them together the moment one is exceeded, so a request
 * that fails the monthly check never leaves a phantom charge sitting in the
 * daily one.
 */
function budgetsFor(action: Action, tier: MeteredTier, subject: string): Budget[] {
  const separate = SEPARATE_BUDGET[action];

  // Credits come out of a balance, not a counter: there is no row and no
  // ceiling to compare against, only whether the balance covers the cost.
  // Unreachable from `reserveQuota` and `quotaStatus` today — both handle
  // `credits` before calling this — kept so the function stays total over
  // `MeteredTier` rather than silently assuming a caller always checks first.
  if (tier === "credits") {
    return [{ subject, allowance: 0, period: "none" }];
  }

  // tier is "pro" — the only metered tier left. `free` never reaches here:
  // `resolveModel` refuses it before this module is asked to meter anything.
  if (separate) {
    return [
      { subject: `${subject}${separate.suffix}`, allowance: INTAKE_MONTHLY_CAP, period: "month" },
    ];
  }

  return [
    { subject, allowance: PAID_MONTHLY_CAP, period: "month" },
    { subject, allowance: PAID_DAILY_CAP, period: "day" },
  ];
}

/**
 * The value that goes in the `day` column.
 *
 * A UTC date, a `YYYY-MM` for the monthly budget, or a sentinel for one that
 * never resets. All three are just strings to the primary key, which is what
 * lets one table and one atomic increment serve every period alike.
 */
function periodKey(period: Period): string {
  if (period === "lifetime") return "lifetime";
  const iso = new Date().toISOString();
  return period === "month" ? iso.slice(0, 7) : iso.slice(0, 10);
}

/**
 * Identifies a free-tier consumer. For anonymous users this is a salted hash of
 * the client IP — the raw address is never stored, and without the salt the
 * hash is not reversible to an address.
 */
export function quotaSubject(opts: { userId?: string; ip?: string }): string {
  if (opts.userId) return `user:${opts.userId}`;
  const salt = process.env.QUOTA_IP_SALT ?? "cvexact-dev-salt";
  const hash = createHash("sha256")
    .update(`${salt}:${opts.ip ?? "unknown"}`)
    .digest("hex")
    .slice(0, 32);
  return `ip:${hash}`;
}

/**
 * Re-exported so the quota keys on the very same address the auth rate limiter
 * does. See `lib/client-ip.ts` for which header each deployment believes.
 */
export { clientIp } from "@/lib/client-ip";

// --- Store --------------------------------------------------------------------

/**
 * Dev fallback so the app runs without Postgres. Per-process and lost on
 * restart, which is fine for development and never used in production, where
 * DATABASE_URL is always set.
 */
const memoryCounters = new Map<string, number>();

async function increment(subject: string, day: string, cost: number): Promise<number> {
  if (!databaseConfigured) {
    const key = `${subject}|${day}`;
    const next = (memoryCounters.get(key) ?? 0) + cost;
    memoryCounters.set(key, next);
    return next;
  }

  // Atomic under concurrency: the conflict target is the primary key, and the
  // update reads the existing row's value inside the same statement.
  const [row] = await getDb()
    .insert(schema.usageCounter)
    .values({ subject, day, used: cost })
    .onConflictDoUpdate({
      target: [schema.usageCounter.subject, schema.usageCounter.day],
      set: {
        used: sql`${schema.usageCounter.used} + ${cost}`,
        updatedAt: new Date(),
      },
    })
    .returning({ used: schema.usageCounter.used });

  return row?.used ?? cost;
}

async function peek(subject: string, day: string): Promise<number> {
  if (!databaseConfigured) return memoryCounters.get(`${subject}|${day}`) ?? 0;

  const rows = await getDb()
    .select({ used: schema.usageCounter.used })
    .from(schema.usageCounter)
    .where(
      sql`${schema.usageCounter.subject} = ${subject} and ${schema.usageCounter.day} = ${day}`,
    )
    .limit(1);

  return rows[0]?.used ?? 0;
}

async function refund(subject: string, day: string, cost: number): Promise<void> {
  if (!databaseConfigured) {
    const key = `${subject}|${day}`;
    memoryCounters.set(key, Math.max(0, (memoryCounters.get(key) ?? 0) - cost));
    return;
  }
  await getDb()
    .update(schema.usageCounter)
    .set({ used: sql`greatest(0, ${schema.usageCounter.used} - ${cost})` })
    .where(sql`${schema.usageCounter.subject} = ${subject} and ${schema.usageCounter.day} = ${day}`);
}

/**
 * Which `usage_counter` rows belong to a signed-in user. One definition for
 * `purgeUsageCounterForUser` and `exportUsageCounterForUser`, so what an account
 * download lists and what a deletion erases can never drift apart.
 *
 * Four shapes: plain, a separate-budget suffix (e.g. intake, see `budgetsFor`),
 * and both of those again under the `byok:` prefix (see `meterByok`).
 */
function userSubjectCondition(userId: string) {
  const plain = `user:${userId}`;
  const byok = `byok:${plain}`;
  return or(
    eq(schema.usageCounter.subject, plain),
    like(schema.usageCounter.subject, `${plain}:%`),
    eq(schema.usageCounter.subject, byok),
    like(schema.usageCounter.subject, `${byok}:%`),
  );
}

/**
 * Erases every `usage_counter` row a deleted account left behind. `subject` is
 * free text (`"user:<id>"`, see `quotaSubject`), not a foreign key, so the
 * `ON DELETE CASCADE` that clears every other table when a user is deleted
 * (see lib/auth.ts) never reaches this one — left alone, the id would sit
 * until `scripts/prune.mjs` ages it out at 90 days.
 *
 * Covers all four shapes a signed-in subject can take: plain, a
 * separate-budget suffix (e.g. intake, see `budgetsFor`), and both of those
 * again under the `byok:` prefix (see `meterByok`).
 */
export async function purgeUsageCounterForUser(userId: string): Promise<void> {
  const plain = `user:${userId}`;
  const byok = `byok:${plain}`;

  if (!databaseConfigured) {
    for (const key of memoryCounters.keys()) {
      const subject = key.slice(0, key.lastIndexOf("|"));
      if (
        subject === plain ||
        subject.startsWith(`${plain}:`) ||
        subject === byok ||
        subject.startsWith(`${byok}:`)
      ) {
        memoryCounters.delete(key);
      }
    }
    return;
  }

  await getDb().delete(schema.usageCounter).where(userSubjectCondition(userId));
}

/**
 * The counters `purgeUsageCounterForUser` would erase, for the account
 * download (`GET /api/sync?export=account`). Database only: the dev fallback in
 * `memoryCounters` has no account to export.
 */
export async function exportUsageCounterForUser(
  userId: string,
): Promise<Array<{ subject: string; day: string; used: number }>> {
  return getDb()
    .select({
      subject: schema.usageCounter.subject,
      day: schema.usageCounter.day,
      used: schema.usageCounter.used,
    })
    .from(schema.usageCounter)
    .where(userSubjectCondition(userId));
}

// --- Credit balance -----------------------------------------------------------

/** Dev fallback, alongside `memoryCounters`. Never used where DATABASE_URL is set. */
const memoryCredits = new Map<string, number>();
/**
 * The dev fallback's stand-in for the `credit_purchase` table.
 *
 * Kept even though this path never runs in production: exactly-once crediting
 * is the invariant the whole table exists for, and an in-memory path that
 * quietly credits twice would make it untestable without Postgres. Keyed by
 * the same composite the table uses — a bare id would report a payment as
 * already credited because another gateway once used the same number. Carries
 * `userId` and `credits` too, not just presence, so `revokeCredits` has
 * something to reverse without Postgres either.
 */
const memoryPurchases = new Map<string, { userId: string; credits: number }>();

/** Which gateway took the money. */
export type Gateway = "mercadopago";

/**
 * Cuánto duran los créditos de una compra nueva.
 *
 * La cláusula 8 de los términos prometía que los créditos "no se vencen" y que
 * "esa promesa nos sobrevive": una promesa perpetua sin ninguna reserva
 * contable detrás. Esto la acota, y sólo hacia adelante — `grantCredits` es el
 * único lugar que la usa, así que sólo alcanza a compras que todavía no
 * pasaron por ahí. Nada reescribe `expiresAt` en las filas ya existentes.
 *
 * 24 meses y no menos: es más que cualquier ciclo de búsqueda laboral real, y
 * es lo que separa "vencen" de "vencen tan pronto que es lo mismo que no
 * venderlos". `scripts/prune.mjs` es quien de verdad hace cumplir esto, contra
 * `expiresAt`; esta constante sólo decide cuánto sumarle a `createdAt` al
 * otorgar.
 */
export const CREDIT_EXPIRY_MONTHS = 24;

/**
 * `CREDIT_EXPIRY_MONTHS` después de `from`, en UTC.
 *
 * Función propia y no la cuenta inline en `grantCredits` para que el cómputo
 * de fecha se pueda probar sin una base de datos: `Date#setUTCMonth` con un
 * mes que no existe en el mes de destino (31 de enero + 1 mes) lo empuja al
 * primer día del mes siguiente en vez de tirar un error, que es el borde que
 * vale la pena fijar con un test y no descubrir en producción.
 */
export function creditExpiryDate(from: Date = new Date()): Date {
  const expiresAt = new Date(from);
  expiresAt.setUTCMonth(expiresAt.getUTCMonth() + CREDIT_EXPIRY_MONTHS);
  return expiresAt;
}

export async function creditBalance(userId: string): Promise<number> {
  if (!databaseConfigured) return memoryCredits.get(userId) ?? 0;

  const rows = await getDb()
    .select({ balance: schema.user.creditBalance })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  return rows[0]?.balance ?? 0;
}

/**
 * Takes `cost` from the balance, or reports that it did not.
 *
 * The guard is inside the UPDATE rather than in a read followed by a write:
 * two concurrent generations against a balance of one must not both see one
 * and both spend it. Zero rows back means the balance did not cover the cost —
 * the same statement decides and applies.
 */
async function spendCredits(userId: string, cost: number): Promise<boolean> {
  if (!databaseConfigured) {
    const balance = memoryCredits.get(userId) ?? 0;
    if (balance < cost) return false;
    memoryCredits.set(userId, balance - cost);
    return true;
  }

  const rows = await getDb()
    .update(schema.user)
    .set({ creditBalance: sql`${schema.user.creditBalance} - ${cost}` })
    .where(sql`${schema.user.id} = ${userId} and ${schema.user.creditBalance} >= ${cost}`)
    .returning({ balance: schema.user.creditBalance });

  return rows.length > 0;
}

async function refundCredits(userId: string, cost: number): Promise<void> {
  if (!databaseConfigured) {
    memoryCredits.set(userId, (memoryCredits.get(userId) ?? 0) + cost);
    return;
  }
  await getDb()
    .update(schema.user)
    .set({ creditBalance: sql`${schema.user.creditBalance} + ${cost}` })
    .where(eq(schema.user.id, userId));
}

/**
 * Adds credits and records the purchase that bought them, in one transaction.
 *
 * Returns false when this payment has already been credited. Every gateway
 * retries its webhook until it gets a 2xx, so without the primary key refusing
 * the second insert, a retry pays the pack twice. The caller can treat `false`
 * as success: the credits are there, they were just put there earlier.
 */
export async function grantCredits(input: {
  userId: string;
  credits: number;
  gateway: Gateway;
  /** The gateway's own id for the payment. Unique only within that gateway. */
  externalId: string;
}): Promise<boolean> {
  const key = `${input.gateway}|${input.externalId}`;

  if (!databaseConfigured) {
    if (memoryPurchases.has(key)) return false;
    memoryPurchases.set(key, { userId: input.userId, credits: input.credits });
    memoryCredits.set(input.userId, (memoryCredits.get(input.userId) ?? 0) + input.credits);
    return true;
  }

  const expiresAt = creditExpiryDate();

  return getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.creditPurchase)
      .values({
        gateway: input.gateway,
        externalId: input.externalId,
        userId: input.userId,
        credits: input.credits,
        expiresAt,
      })
      .onConflictDoNothing()
      .returning({ id: schema.creditPurchase.externalId });

    if (inserted.length === 0) return false;

    await tx
      .update(schema.user)
      .set({ creditBalance: sql`${schema.user.creditBalance} + ${input.credits}` })
      .where(eq(schema.user.id, input.userId));

    return true;
  });
}

/**
 * Reverses a credited pack when its payment is refunded or charged back.
 *
 * Idempotent through the same `credit_purchase` row `grantCredits` inserted:
 * deleting it here is what a second refund notification finds already gone,
 * the same way a retried grant finds the row already there. Returns false in
 * that case, which the caller treats as success — the reversal already
 * happened, it just happened on an earlier delivery of the same webhook.
 *
 * The balance is allowed to go negative. A floor here would mean the
 * gateway's money moved back but the ledger refused to follow, and the wrong
 * side of that mistake is the one that keeps a refunded pack still spendable.
 * A negative balance blocks new spending exactly as a zero one does —
 * `spendCredits` compares with `>=`, not `> 0`.
 */
export async function revokeCredits(input: {
  gateway: Gateway;
  /** The gateway's own id for the payment being reversed. */
  externalId: string;
}): Promise<boolean> {
  const key = `${input.gateway}|${input.externalId}`;

  if (!databaseConfigured) {
    const purchase = memoryPurchases.get(key);
    if (!purchase) return false;
    memoryPurchases.delete(key);
    memoryCredits.set(
      purchase.userId,
      (memoryCredits.get(purchase.userId) ?? 0) - purchase.credits,
    );
    return true;
  }

  return getDb().transaction(async (tx) => {
    const deleted = await tx
      .delete(schema.creditPurchase)
      .where(
        sql`${schema.creditPurchase.gateway} = ${input.gateway} and ${schema.creditPurchase.externalId} = ${input.externalId}`,
      )
      .returning({ credits: schema.creditPurchase.credits, userId: schema.creditPurchase.userId });

    if (deleted.length === 0) return false;

    await tx
      .update(schema.user)
      .set({ creditBalance: sql`${schema.user.creditBalance} - ${deleted[0].credits}` })
      .where(eq(schema.user.id, deleted[0].userId));

    return true;
  });
}

// --- Public API ---------------------------------------------------------------

/**
 * Re-exportado, no redefinido: la definición vive en `lib/api/denial.ts` para
 * que el navegador pueda leerla sin arrastrar este módulo `server-only`. Se
 * re-exporta desde acá porque es de acá que el resto del servidor ya lo
 * importaba, exactamente como `lib/ai/provider.ts` hace con
 * `lib/ai/provider-catalog.ts`.
 */
import type { DenialReason } from "@/lib/api/denial";
export type { DenialReason };

export type QuotaGrant =
  | { ok: true; tier: Tier; release: (outcome: "success" | "failure") => Promise<void> }
  | {
      ok: false;
      tier: Tier;
      used: number;
      allowance: number;
      reason: DenialReason;
      /** Absent when waiting cannot help, which is every case but the daily cap. */
      retryAfterSeconds?: number;
    };

/**
 * Reserves quota *before* the model call, so two concurrent requests cannot both
 * pass a check against the same remaining credit. The returned `release` refunds
 * the reservation when the generation fails — the user should not pay for an
 * error they did not get output from.
 */
export async function reserveQuota(input: {
  tier: Tier;
  action: Action;
  /** The metering subject: a user id when signed in, a salted IP hash otherwise. */
  subject: string;
  /** Required to spend credits; a balance belongs to an account, not to an IP. */
  userId?: string;
}): Promise<QuotaGrant> {
  const { tier, action, subject, userId } = input;
  const cost = ACTION_COST[action];

  if (tier === "byok") {
    await meterByok(subject, cost);
    return { ok: true, tier, release: async () => {} };
  }

  if (tier === "free") {
    // Should never happen: `resolveModel` refuses a `free` request before
    // `openRequest` ever calls this. A caller that skipped that check would
    // otherwise silently meter a tier that has no counter of its own.
    throw new Error(
      'reserveQuota called with tier "free"; resolveModel should have refused it first.',
    );
  }

  if (tier === "credits") {
    // Should not happen: `resolveTier` only reports `credits` for a signed-in
    // user. Refusing beats silently letting an anonymous request through on a
    // tier that has no counter behind it.
    if (!userId) {
      return { ok: false, tier, used: 0, allowance: 0, reason: "no_credits" };
    }

    if (!(await spendCredits(userId, cost))) {
      return {
        ok: false,
        tier,
        used: 0,
        allowance: await creditBalance(userId),
        reason: "no_credits",
      };
    }

    return {
      ok: true,
      tier,
      release: async (outcome) => {
        if (outcome === "failure") await refundCredits(userId, cost);
      },
    };
  }

  const budgets = budgetsFor(action, tier, subject);
  const keys = budgets.map((b) => periodKey(b.period));
  const used = await Promise.all(budgets.map((b, i) => increment(b.subject, keys[i], cost)));

  const exceededAt = budgets.findIndex((b, i) => used[i] > b.allowance);

  if (exceededAt !== -1) {
    // Every counter this reservation touched, not just the one that tipped
    // over — see the note on `budgetsFor`.
    await Promise.all(budgets.map((b, i) => refund(b.subject, keys[i], cost)));
    const failed = budgets[exceededAt];
    return {
      ok: false,
      tier,
      used: used[exceededAt] - cost,
      allowance: failed.allowance,
      reason: failed.period === "month" ? "monthly_limit" : "daily_limit",
      retryAfterSeconds:
        failed.period === "month" ? secondsUntilNextUtcMonth() : secondsUntilUtcMidnight(),
    };
  }

  return {
    ok: true,
    tier,
    release: async (outcome) => {
      if (outcome === "failure") {
        await Promise.all(budgets.map((b, i) => refund(b.subject, keys[i], cost)));
      }
    },
  };
}

/**
 * Counts a BYOK generation without limiting it.
 *
 * Increments and never compares — there is no ceiling here and there is not
 * meant to be one. It exists because BYOK is the answer this product gives to
 * everyone who cannot pay, and how many people that actually serves is
 * otherwise unknowable.
 *
 * Failures are swallowed on purpose: a counter that cannot be written is not a
 * reason to refuse someone a generation we are not paying for.
 */
async function meterByok(subject: string, cost: number): Promise<void> {
  try {
    await increment(`byok:${subject}`, periodKey("day"), cost);
  } catch (error) {
    console.error(
      "[quota] byok metering failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * What is left, for the UI. `action` picks the budget: the chat needs to show
 * how many turns remain, which is a different number from how many CVs remain.
 */
export async function quotaStatus(input: {
  tier: Tier;
  subject: string;
  action?: Action;
  userId?: string;
}): Promise<{ tier: Tier; used: number; allowance: number | null }> {
  const { tier, subject, action = "cv", userId } = input;

  // No ceiling to report: the user is paying for their own inference.
  if (tier === "byok") return { tier, used: 0, allowance: null };

  // No trial to report either: nothing was ever reserved, so there is nothing
  // to peek at. A spent zero-allowance rather than null so `BalanceIndicator`
  // and `aiAvailability` both read it as "nothing here" with no special case.
  if (tier === "free") return { tier, used: 0, allowance: 0 };

  if (tier === "credits") {
    const balance = userId ? await creditBalance(userId) : 0;
    // Reported as a balance, so the UI can say "te quedan N" without having to
    // know that the other tiers count upwards and this one counts down.
    return { tier, used: 0, allowance: balance };
  }

  // The monthly row always comes first — see `budgetsFor` — which is also
  // the number worth showing: "how many are left this billing cycle" is what
  // a subscriber wants to know, not the anti-burst guard behind it.
  const [{ subject: row, allowance, period }] = budgetsFor(action, tier, subject);
  return { tier, used: await peek(row, periodKey(period)), allowance };
}

function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}

function secondsUntilNextUtcMonth(): number {
  const now = new Date();
  const nextMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.max(1, Math.ceil((nextMonth - now.getTime()) / 1000));
}
