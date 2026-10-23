import { beforeEach, describe, expect, it } from "vitest";
import { clearHealth, degradedKeys, healthOf, latencyOf, recordOutcome } from "@/lib/ai/health";

/**
 * What `candidateOrder` in `lib/ai/pipeline.ts` reads to decide that a
 * candidate should stop being asked first.
 *
 * The judgement is deliberately hard to trigger. A chain's order is the user's
 * own preference — they put their best model first, which is a statement about
 * quality that latency knows nothing about — so nothing here promotes anyone
 * past it. It only demotes, and only on evidence.
 */

const ok = (ms: number) => ({ ok: true, ms });
const bad = (ms: number) => ({ ok: false, ms });

beforeEach(clearHealth);

describe("registro de salud", () => {
  it("promedia la latencia dándole más peso a lo reciente", () => {
    recordOutcome("a", ok(1000));
    expect(healthOf("a")?.ewmaMs).toBe(1000);

    recordOutcome("a", ok(2000));
    // 1000 + 0.3 * (2000 - 1000)
    expect(healthOf("a")?.ewmaMs).toBeCloseTo(1300);
  });

  it("cuenta éxitos y fallos por separado", () => {
    recordOutcome("a", ok(10));
    recordOutcome("a", bad(10));
    recordOutcome("a", ok(10));
    expect(healthOf("a")).toMatchObject({ ok: 2, failed: 1 });
  });

  /**
   * A candidate demoted at lunchtime must not still be demoted at midnight
   * over a provider incident that ended hours ago.
   */
  it("deja de creerle a un registro viejo", () => {
    const morning = Date.now() - 60 * 60_000;
    recordOutcome("a", ok(10), morning);
    expect(healthOf("a", morning + 1000)).toBeDefined();
    expect(healthOf("a")).toBeUndefined();
  });

  it("no acumula una entrada por cada key vista", () => {
    for (let i = 0; i < 600; i++) recordOutcome(`k${i}`, ok(10));
    // Cleared wholesale rather than evicted one by one: every entry is
    // disposable, so the cheapest bound is the right one.
    expect(healthOf("k0")).toBeUndefined();
    expect(healthOf("k599")).toBeDefined();
  });
});

/**
 * What `lastResortBudgetMs` in `lib/ai/pipeline.ts` reads to size the attempt
 * budget of the last candidate standing.
 *
 * The judgement mirrors the demotion one — same `MIN_SAMPLES` bar, same
 * staleness window — but measures successes only: a history of failing slowly
 * must not buy a longer leash, while a history of answering slowly must.
 */
describe("latencia observada", () => {
  it("mide lo que tardan los intentos exitosos, con suficientes muestras", () => {
    recordOutcome("a", ok(50_000));
    recordOutcome("a", ok(50_000));
    recordOutcome("a", ok(50_000));
    expect(latencyOf("a")).toBeCloseTo(50_000);
  });

  it("no mide a un candidato con menos éxitos que muestras exige", () => {
    recordOutcome("a", ok(50_000));
    recordOutcome("a", ok(50_000));
    // The same bar `degradedKeys` applies: one lucky call is not evidence.
    expect(latencyOf("a")).toBeUndefined();
  });

  it("no mide a un candidato que sólo falla, aunque falle lento", () => {
    for (let i = 0; i < 5; i++) recordOutcome("a", bad(90_000));
    // Failing slowly has not demonstrated a latency worth budgeting for; the
    // caller gives this one its floor rather than its average.
    expect(latencyOf("a")).toBeUndefined();
  });

  it("mezcla éxitos con fallos, pero mide sólo los éxitos", () => {
    recordOutcome("a", bad(1_000));
    recordOutcome("a", ok(50_000));
    recordOutcome("a", bad(1_000));
    recordOutcome("a", ok(50_000));
    recordOutcome("a", ok(50_000));
    // The failures dragged `ewmaMs` down — which is right for the ranking —
    // but the success-only mean did not move.
    expect(latencyOf("a")).toBeCloseTo(50_000);
    expect(healthOf("a")!.ewmaMs).toBeLessThan(50_000);
  });

  it("deja de creerle a un éxito viejo", () => {
    const morning = Date.now() - 60 * 60_000;
    for (let i = 0; i < 3; i++) recordOutcome("a", ok(50_000), morning);
    expect(latencyOf("a")).toBeUndefined();
  });
});

describe("a quién degradar", () => {
  it("no degrada a nadie sin con quién comparar", () => {
    for (let i = 0; i < 5; i++) recordOutcome("solo", bad(90_000));
    // A chain of one has nothing to be slower *than*, and demoting the only
    // candidate would achieve nothing but a worse message.
    expect(degradedKeys(["solo"])).toEqual(new Set());
  });

  it("no degrada a un candidato sin suficientes muestras", () => {
    recordOutcome("nuevo", bad(10));
    recordOutcome("nuevo", bad(10));
    for (let i = 0; i < 5; i++) recordOutcome("viejo", ok(10));

    // Two failures is not yet evidence: a candidate the user put first has to
    // be given the chance to earn its place.
    expect(degradedKeys(["nuevo", "viejo"])).toEqual(new Set());
  });

  it("degrada al que falla la mayoría de las veces", () => {
    for (let i = 0; i < 4; i++) recordOutcome("malo", bad(10));
    for (let i = 0; i < 4; i++) recordOutcome("bueno", ok(10));

    expect(degradedKeys(["malo", "bueno"])).toEqual(new Set(["malo"]));
  });

  /**
   * The case the whole feature exists for. A provider that accepts every call
   * and takes a minute over it never refuses anything, so no cooldown and no
   * error status ever sees it — it just makes every request slow.
   */
  it("degrada al que anda bien pero tarda muchísimo más", () => {
    for (let i = 0; i < 4; i++) recordOutcome("lento", ok(60_000));
    for (let i = 0; i < 4; i++) recordOutcome("rapido", ok(5_000));

    expect(degradedKeys(["lento", "rapido"])).toEqual(new Set(["lento"]));
  });

  it("tolera una diferencia de latencia razonable", () => {
    for (let i = 0; i < 4; i++) recordOutcome("a", ok(10_000));
    for (let i = 0; i < 4; i++) recordOutcome("b", ok(18_000));

    // Twice as slow is not "broken". The user's order decides between two
    // candidates that both work.
    expect(degradedKeys(["a", "b"])).toEqual(new Set());
  });

  it("no degrada a todos, porque no quedaría a dónde promover", () => {
    for (let i = 0; i < 4; i++) recordOutcome("a", bad(10));
    for (let i = 0; i < 4; i++) recordOutcome("b", bad(10));

    expect(degradedKeys(["a", "b"])).toEqual(new Set());
  });

  /**
   * Ninety seconds spent failing is ninety seconds of the request either way,
   * so the latency bar is set from every attempt, not just the successful ones.
   */
  it("no deja que un candidato roto fije el estándar de velocidad", () => {
    for (let i = 0; i < 4; i++) recordOutcome("roto", bad(1));
    for (let i = 0; i < 4; i++) recordOutcome("normal", ok(10_000));
    for (let i = 0; i < 4; i++) recordOutcome("otro", ok(12_000));

    // "roto" is demoted for failing; it must not also drag the other two down
    // with a 1ms reference they could never meet.
    expect(degradedKeys(["roto", "normal", "otro"])).toEqual(new Set(["roto"]));
  });
});
