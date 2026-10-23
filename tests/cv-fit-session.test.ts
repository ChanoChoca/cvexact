import { describe, expect, it, vi } from "vitest";
import {
  PDF_CHECK_LIMIT,
  countSpilledPdf,
  fitApplicationCv,
  pdfAlreadyFailed,
  readFitSession,
  undoFit,
  type FitContext,
} from "@/lib/applications/fit";
import { applyCondensed } from "@/lib/cv/fit";
import { cvContentHash } from "@/lib/cv/review-hash";
import { applicationSchema } from "@/lib/storage/application";
import { withEditedCV, withGeneratedCV } from "@/lib/storage/applications/normalize";
import { devProfile } from "./fixtures";
import {
  LINE_PX,
  WRAPPED_BULLET,
  SHORTENED_BULLET,
  application,
  fakeHeight,
  fakeMeasurer,
  fakeStore,
  limitWithRoomFor,
  longLinePage,
  thinPage,
} from "./helpers/cv-fit";

/**
 * The session: what a reload must not hand back, and what the ladder is allowed
 * to remember. Everything here goes through the same `store` the screen uses, so
 * "a reload" is just reading the record again.
 */

function context(store: ReturnType<typeof fakeStore>, limit: number): FitContext {
  return {
    profile: devProfile,
    measurer: fakeMeasurer,
    fontsReady: async () => true,
    store: store.store,
    limit,
  };
}

describe("the fit session", () => {
  it("stores how far the ladder went, and a reload does not walk it back", async () => {
    const app = application({ cv: thinPage() });
    const store = fakeStore([app]);
    const limit = fakeHeight(app.cv!) - 20;

    // The first attempt stops at `relaxed` (the highest a fit reaches alone) and
    // asks for consent for `extreme`.
    const first = await fitApplicationCv(app, context(store, limit));
    expect(first.status).toBe("needs-consent");

    // A reload: the record as storage has it. Nothing was fitted, so there is no
    // session to remember and the same question comes back — no attempt was
    // spent, because none was made.
    const reloaded = store.records.get(app.id)!;
    expect(readFitSession(reloaded).level).toBe("normal");

    // With the person's yes the fit happens, and the level is recorded.
    const accepted = await fitApplicationCv(reloaded, {
      ...context(store, limit),
      allowExtreme: true,
    });
    expect(accepted.status).toBe("fitted");
    if (accepted.status !== "fitted") return;
    expect(accepted.level).toBe("extreme");

    const afterReload = store.records.get(app.id)!;
    expect(readFitSession(afterReload).level).toBe("extreme");

    // A later attempt starts where the session left it, never below.
    const again = await fitApplicationCv(afterReload, context(store, fakeHeight(afterReload.cv!) + 1_000));
    expect(again.status).toBe("unchanged");
    expect(readFitSession(store.records.get(app.id)!).level).toBe("extreme");
  });

  it("counts a spilled PDF, remembers the CV and tightens the limit", async () => {
    const app = application();
    const store = fakeStore([app]);
    const hash = cvContentHash(app.cv!);

    const { retry } = await countSpilledPdf(app, store.store, app.cv!, { overflowPx: 40, limit: 1_100 });
    const stored = store.records.get(app.id)!;

    expect(readFitSession(stored).pdfChecks).toBe(1);
    expect(readFitSession(stored).failedHashes).toEqual([hash]);
    expect(pdfAlreadyFailed(stored, app.cv!)).toBe(true);
    // The next round fits against what the printer really measured, and it is
    // the next level that runs it.
    expect(retry).toEqual({ kind: "tighten", allowExtreme: false, limit: 1_100 - 40 - 6 });
  });

  it("asks for consent when the next level is extreme, and stops after three checks", async () => {
    const app = application();
    const store = fakeStore([
      { ...app, fitSession: { level: "relaxed", aiUsed: false, pdfChecks: 0, failedHashes: [] } },
    ]);

    const first = await countSpilledPdf(app, store.store, app.cv!);
    expect(first.retry.kind).toBe("consent");

    await countSpilledPdf(app, store.store, app.cv!);
    const third = await countSpilledPdf(app, store.store, app.cv!);

    expect(readFitSession(store.records.get(app.id)!).pdfChecks).toBe(PDF_CHECK_LIMIT);
    expect(third.retry).toEqual({ kind: "spent" });
  });

  it("keeps the counters and the hashes when the fit is undone", async () => {
    const seeded = application({
      fitSession: { level: "normal", aiUsed: true, pdfChecks: 2, failedHashes: ["otro-hash"] },
    });
    const store = fakeStore([seeded]);

    const outcome = await fitApplicationCv(seeded, context(store, limitWithRoomFor(seeded.cv!, 3)));
    expect(outcome.status).toBe("fitted");
    if (outcome.status !== "fitted") return;
    expect(readFitSession(outcome.application)).toMatchObject({ aiUsed: true, pdfChecks: 2 });

    const undone = await undoFit(outcome.application, store.store);
    expect(undone).not.toBeNull();
    // The level goes back to `normal`; the attempts already spent are not
    // refunded — a reload must not be a way to get extra tries.
    expect(readFitSession(undone!)).toEqual({
      level: "normal",
      aiUsed: true,
      pdfChecks: 2,
      failedHashes: ["otro-hash"],
    });
  });

  it("is cleared by regenerating and by a hand edit", () => {
    const fitted = application({
      cvEdited: false,
      fitSession: { level: "relaxed", aiUsed: true, pdfChecks: 1, failedHashes: ["h"] },
      fitUndo: { cv: application().cv!, findings: [], fittedHash: "h", at: "2026-10-01T10:00:00.000Z" },
    });

    for (const next of [withGeneratedCV(fitted, application().cv), withEditedCV(fitted, application().cv!)]) {
      expect(next.fitSession).toBeUndefined();
      expect(next.fitUndo).toBeUndefined();
    }
  });

  it("discards a corrupt session or undo instead of quarantining the application", () => {
    const app = application();

    for (const bad of [
      { level: "imposible", aiUsed: false, pdfChecks: 0, failedHashes: [] },
      { level: "normal", aiUsed: false, pdfChecks: 9, failedHashes: [] },
      { level: "normal" },
      "nope",
    ]) {
      const parsed = applicationSchema.safeParse({ ...app, fitSession: bad });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.fitSession).toBeUndefined();
      // What matters: the application itself survives.
      expect(parsed.success && parsed.data.cv).toEqual(app.cv);
    }

    for (const bad of [{ cv: { nope: true } }, { fittedHash: 3 }, "nope"]) {
      const parsed = applicationSchema.safeParse({ ...app, fitUndo: bad });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.fitUndo).toBeUndefined();
    }
  });
});

describe("Etapa 2 y la sesión", () => {
  /**
   * A synthesised shortening: the guard is exercised in `condense-guard.test.ts`,
   * and what is under test here is the accounting — how often the model is asked,
   * when, and what a failure costs.
   */
  const shorten = (calls: number[]) =>
    vi.fn(async () => {
      calls.push(calls.length + 1);
      return [{ id: "s0.i0.b0", before: WRAPPED_BULLET, after: SHORTENED_BULLET }];
    });

  it("asks the model at most once, reload included", async () => {
    const app = application({ cv: longLinePage() });
    const store = fakeStore([app]);
    const calls: number[] = [];
    const condense = shorten(calls);
    // The fixture's premise, said out loud: the rewrite gives back exactly one line.
    const shortened = applyCondensed(app.cv!, [
      { id: "s0.i0.b0", before: WRAPPED_BULLET, after: SHORTENED_BULLET },
    ]);
    expect(fakeHeight(app.cv!) - fakeHeight(shortened)).toBe(LINE_PX);
    const limit = fakeHeight(app.cv!) - LINE_PX;

    const first = await fitApplicationCv(app, { ...context(store, limit), condense });
    expect(first.status).toBe("fitted");
    if (first.status !== "fitted") return;
    expect(first.condensed).toHaveLength(1);
    expect(first.removed).toEqual([]);
    expect(condense).toHaveBeenCalledTimes(1);

    // The person reloads — the record as storage has it — and tries again on a
    // page that still does not fit.
    const reloaded = store.records.get(app.id)!;
    expect(readFitSession(reloaded).aiUsed).toBe(true);
    await fitApplicationCv(reloaded, { ...context(store, 1), condense });

    expect(condense).toHaveBeenCalledTimes(1);
  });

  it("writes the attempt before spending it, and does not call when it cannot write", async () => {
    const app = application({ cv: longLinePage() });
    const base = fakeStore([app]);
    const events: string[] = [];
    const store = {
      get: (id: string) => base.store.get(id),
      save: async (next: typeof app) => {
        events.push(next.fitSession?.aiUsed === true ? "write-ahead" : "write");
        return base.store.save(next);
      },
    };
    const calls: number[] = [];
    const condense = vi.fn(async () => {
      events.push("condense");
      calls.push(1);
      return [{ id: "s0.i0.b0", before: WRAPPED_BULLET, after: SHORTENED_BULLET }];
    });

    await fitApplicationCv(
      app,
      { ...context(base, fakeHeight(app.cv!) - LINE_PX), store, condense },
    );

    expect(events[0]).toBe("write-ahead");
    expect(events.indexOf("condense")).toBeGreaterThan(0);

    // And with a browser that cannot store anything, the model is not asked: an
    // attempt a reload would hand back is worse than no attempt.
    const refusing = fakeStore([app], { refuse: true });
    await fitApplicationCv(app, {
      ...context(refusing, limitWithRoomFor(app.cv!, 2)),
      condense,
    });
    expect(condense).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failure of the provider, and fits without it", async () => {
    const app = application({ cv: longLinePage() });
    const store = fakeStore([app]);
    const condense = vi.fn(async () => {
      throw new Error("403: byok_required");
    });

    // One line over: without the AI, the ladder has to take a line out itself.
    const outcome = await fitApplicationCv(app, {
      ...context(store, fakeHeight(app.cv!) - LINE_PX),
      condense,
    });

    expect(condense).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("fitted");
    if (outcome.status !== "fitted") return;
    expect(outcome.condensed).toEqual([]);
    expect(outcome.removed.length).toBeGreaterThan(0);
  });
});
