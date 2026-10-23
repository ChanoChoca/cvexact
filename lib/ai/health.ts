import "server-only";

/**
 * How each provider/model/key combination has actually been behaving, so the
 * chain can stop leading with one that is demonstrably worse than its own
 * standby.
 *
 * `./cooldown.ts` remembers the candidates that *refused* work. This remembers
 * the ones that accept it and then take ninety seconds, which is the failure a
 * cooldown can never see: a slow provider never answers 429, so before the
 * attempt budget in `./pipeline.ts` existed it simply held the request open,
 * and afterwards it holds it open for the whole budget before falling back.
 * Either way, asking it first was the mistake.
 *
 * In memory, per process, bounded — the same shape and the same argument as the
 * cooldown store: this is an optimisation, and the cost of losing all of it on a
 * restart is that the next few requests are ordered from the user's preference
 * alone, which is where they started.
 */

type Health = {
  /** Exponentially weighted mean round-trip of the attempts that finished. */
  ewmaMs: number;
  /**
   * The same mean over the attempts that *succeeded*, kept apart because the
   * two answer different questions. `ewmaMs` feeds the relative ranking in
   * `degradedKeys`, where a slow failure is as much spent time as a slow
   * success; the success-only number sizes a budget in `lastResortBudgetMs`
   * (`./pipeline.ts`), where a history of failing slowly must not buy a
   * longer leash. `undefined` until the first success, which is how the
   * caller tells "no evidence yet" from a measured value.
   */
  okEwmaMs?: number;
  ok: number;
  failed: number;
  /** Last time this candidate was heard from, for the staleness check below. */
  at: number;
};

/**
 * Weight on the newest sample.
 *
 * High enough that a provider recovering from a bad afternoon is believed again
 * within a handful of requests, low enough that one unlucky call does not
 * relegate a candidate that has been serving fine all day.
 */
const EWMA_ALPHA = 0.3;

/**
 * How many outcomes a candidate needs before its record is allowed to demote
 * it. Under this it counts as unknown, which is treated as healthy: a candidate
 * the user put first has to be given the chance to earn its place, and one bad
 * first call is not evidence.
 */
const MIN_SAMPLES = 3;

/** Below this share of successes a candidate is demoted behind its standbys. */
const MIN_SUCCESS_RATE = 0.6;

/**
 * How much slower than the chain's best a candidate may be before being
 * demoted. Deliberately generous: the point is to catch the free endpoint that
 * takes 60s against a sibling that takes 8s, not to rank two healthy providers
 * against each other — the user's order already does that, and it encodes a
 * judgement about quality that latency knows nothing about.
 */
const SLOW_MULTIPLE = 2.5;

/**
 * After this long with no outcome, a record stops being evidence.
 *
 * A candidate demoted at lunchtime must not still be demoted at midnight over
 * a provider incident that ended hours ago. Entries are left in place and
 * ignored rather than swept, since the map is bounded anyway.
 */
const STALE_MS = 30 * 60_000;

/** Bounded exactly as the cooldown map is, and for the same reason. */
const MAX_ENTRIES = 500;

const records = new Map<string, Health>();

/**
 * Records one finished attempt against a candidate.
 *
 * `key` is the `cooldownKey` from `./cooldown.ts` — a digest of the credential,
 * never the credential — because this map outlives the request that held it.
 */
export function recordOutcome(
  key: string,
  outcome: { ok: boolean; ms: number },
  now = Date.now(),
): void {
  const previous = records.get(key);
  if (!previous && records.size >= MAX_ENTRIES) records.clear();

  records.set(key, {
    ewmaMs: previous
      ? previous.ewmaMs + EWMA_ALPHA * (outcome.ms - previous.ewmaMs)
      : outcome.ms,
    // Same weight as `ewmaMs`, fed by successes alone — see the field's
    // comment above for why the two are kept apart.
    okEwmaMs: outcome.ok
      ? previous?.okEwmaMs !== undefined
        ? previous.okEwmaMs + EWMA_ALPHA * (outcome.ms - previous.okEwmaMs)
        : outcome.ms
      : previous?.okEwmaMs,
    ok: (previous?.ok ?? 0) + (outcome.ok ? 1 : 0),
    failed: (previous?.failed ?? 0) + (outcome.ok ? 0 : 1),
    at: now,
  });
}

export function healthOf(key: string, now = Date.now()): Health | undefined {
  const record = records.get(key);
  if (!record) return undefined;
  return now - record.at > STALE_MS ? undefined : record;
}

/**
 * A candidate's observed round-trip over its *successful* attempts, when there
 * have been enough of them to be believed.
 *
 * `MIN_SAMPLES` is the same bar `degradedKeys` applies, and for the same
 * reason: one lucky call is not evidence. `undefined` is a meaningful answer,
 * not an absence of one — it is how the caller tells "unknown" from measured,
 * and it is what a history of *failures* returns too, since a candidate whose
 * attempts end in timeouts has not demonstrated a latency worth budgeting
 * for; the caller gives that one its floor rather than its average.
 *
 * Staleness rides on `healthOf`, so a success from this morning is not
 * evidence tonight — the same 30-minute window the demotion logic uses.
 */
export function latencyOf(key: string, now = Date.now()): number | undefined {
  const record = healthOf(key, now);
  if (!record || record.ok < MIN_SAMPLES) return undefined;
  return record.okEwmaMs;
}

/**
 * Which of these candidates have earned a demotion, judged against each other.
 *
 * Relative rather than absolute on purpose. There is no wall-clock number that
 * means "too slow" across a catalogue this wide — a CV from a thinking model
 * legitimately takes far longer than a job analysis from Cerebras — so the only
 * honest comparison is with the alternatives this same user configured. A chain
 * of one therefore never demotes anything: there is nothing to be slower *than*,
 * and demoting the only candidate would achieve nothing but a worse message.
 */
export function degradedKeys(keys: string[], now = Date.now()): Set<string> {
  const degraded = new Set<string>();
  if (keys.length < 2) return degraded;

  const seen = keys.map((key) => ({ key, health: healthOf(key, now) }));

  const unreliable = (h: Health) =>
    h.ok + h.failed >= MIN_SAMPLES && h.ok / (h.ok + h.failed) < MIN_SUCCESS_RATE;

  for (const { key, health } of seen) {
    if (health && unreliable(health)) degraded.add(key);
  }

  /**
   * Never demote everyone: an all-degraded chain has no healthy tier left to
   * promote anything into, so the partition would be pure churn. Applied at
   * every exit rather than only the last one — the reference below has an early
   * return of its own, and the first version of this let that one past the
   * guard and demoted a whole chain.
   */
  const settle = (result: Set<string>) =>
    result.size === keys.length ? new Set<string>() : result;

  /**
   * The bar is the fastest candidate that is not already demoted for failing —
   * measured over its successful and failed attempts alike, since a candidate
   * that takes 90 seconds to fail has still spent 90 seconds of the request.
   * Taken from a candidate with enough samples to be believed, so a single fast
   * call cannot set an impossible standard for everyone else.
   */
  const reference = Math.min(
    ...seen
      .filter(
        ({ key, health }) =>
          health && !degraded.has(key) && health.ok + health.failed >= MIN_SAMPLES,
      )
      .map(({ health }) => health!.ewmaMs),
  );
  if (!Number.isFinite(reference) || reference <= 0) return settle(degraded);

  for (const { key, health } of seen) {
    if (!health || degraded.has(key)) continue;
    if (health.ok + health.failed < MIN_SAMPLES) continue;
    if (health.ewmaMs > reference * SLOW_MULTIPLE) degraded.add(key);
  }

  return settle(degraded);
}

/** For tests, which must not inherit health records from each other. */
export function clearHealth(): void {
  records.clear();
}
