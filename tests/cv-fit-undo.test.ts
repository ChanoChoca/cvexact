import { describe, expect, it } from "vitest";
import { fitApplicationCv, undoFit, type FitContext } from "@/lib/applications/fit";
import {
  normalizeStoredApplication,
  sameJson,
  withEditedCV,
  withFittedCV,
  withGeneratedCV,
  withRestoredCV,
  withoutFitTrace,
} from "@/lib/storage/applications/normalize";
import { devProfile } from "./fixtures";
import { application, fakeMeasurer, fakeStore, limitWithRoomFor } from "./helpers/cv-fit";

/**
 * «Deshacer el ajuste»: one copy per application, in the same record, gone the
 * moment the CV changes by something that is not the fit.
 */

function context(store: ReturnType<typeof fakeStore>): FitContext {
  return {
    profile: devProfile,
    measurer: fakeMeasurer,
    fontsReady: async () => true,
    store: store.store,
  };
}

async function fittedOnce() {
  const app = application();
  const store = fakeStore([app]);
  const outcome = await fitApplicationCv(app, { ...context(store), limit: limitWithRoomFor(app.cv!, 3) });
  if (outcome.status !== "fitted") throw new Error(`expected a fit, got ${outcome.status}`);
  return { app, store, fitted: outcome.application };
}

describe("undoFit", () => {
  it("puts back the CV and the findings, byte for byte", async () => {
    const { app, store, fitted } = await fittedOnce();

    const undone = await undoFit(fitted, store.store);

    expect(undone).not.toBeNull();
    expect(sameJson(undone!.cv, app.cv)).toBe(true);
    expect(sameJson(undone!.findings, app.findings)).toBe(true);
    expect(undone!.fitUndo).toBeUndefined();
  });

  it("patches only the CV, so anything changed meanwhile survives", async () => {
    const { app, store } = await fittedOnce();

    // The person kept working after the fit — a reload included: this is the
    // record as storage has it, not the object the fit returned.
    const reloaded = store.records.get(app.id)!;
    await store.store.save({ ...reloaded, status: "postulado", notes: "Me contestaron el martes." });

    const undone = await undoFit(store.records.get(app.id)!, store.store);

    expect(sameJson(undone!.cv, app.cv)).toBe(true);
    expect(undone!.status).toBe("postulado");
    expect(undone!.notes).toBe("Me contestaron el martes.");
  });

  it("refuses a copy that does not name the CV on the page", async () => {
    const { store, fitted } = await fittedOnce();
    const edited = withEditedCV(fitted, { ...fitted.cv!, summary: "Otro resumen escrito a mano." });
    // `withEditedCV` drops the copy, which is the first thing that happens; the
    // second is this guard, for a record that reached memory without passing
    // through it.
    const stale = { ...fitted, cv: edited.cv };

    expect(await undoFit(stale, store.store)).toBeNull();
  });
});

describe("what the copy survives, and what it does not", () => {
  it("is dropped by a hand edit and by a regeneration", async () => {
    const { app, fitted } = await fittedOnce();
    expect(fitted.fitUndo).toBeDefined();

    const edited = withEditedCV(fitted, { ...fitted.cv!, summary: "Otro resumen." });
    expect(edited.fitUndo).toBeUndefined();
    // A hand edit captures what the person was looking at — the fitted CV — as
    // the version «restaurar el generado» goes back to. The model's own version
    // is out of reach once someone edits on top of the fit by hand; that is the
    // price of «Deshacer» only being offered while nothing was edited.
    expect(sameJson(edited.cvOriginal, fitted.cv)).toBe(true);
    expect(edited.cvEdited).toBe(true);

    expect(withGeneratedCV(fitted, app.cv).fitUndo).toBeUndefined();
    expect(withRestoredCV({ ...fitted, cvOriginal: app.cv })?.fitUndo).toBeUndefined();
  });

  it("is discarded on the way in when it no longer names the CV", async () => {
    const { fitted } = await fittedOnce();

    // Same application, different CV: the copy is worthless and goes.
    const moved = normalizeStoredApplication({ ...fitted, cv: { ...fitted.cv!, summary: "Cambiado." } });
    expect(moved.fitUndo).toBeUndefined();

    // Untouched, it stays exactly as it was.
    const kept = normalizeStoredApplication(fitted);
    expect(sameJson(kept.fitUndo, fitted.fitUndo)).toBe(true);
  });

  it("never travels to a backup or to the account", async () => {
    const { fitted } = await fittedOnce();

    const out = withoutFitTrace(fitted);
    expect(out.fitUndo).toBeUndefined();
    expect(out.fitSession).toBeUndefined();
    // Everything else is untouched: what travels is the application, all of it.
    expect(out.cv).toEqual(fitted.cv);
    expect(out.findings).toEqual(fitted.findings);
  });

  it("writes the CV, the findings, the session and the copy in one record", () => {
    const app = application();
    const next = withFittedCV(app, {
      cv: { ...app.cv!, summary: "Ajustado." },
      findings: [{ severity: "warning", field: "summary", detail: "Un aviso." }],
      fitSession: { level: "relaxed", aiUsed: false, pdfChecks: 1, failedHashes: ["h"] },
      fitUndo: { cv: app.cv!, findings: app.findings ?? [], fittedHash: "h", at: "2026-10-01T10:00:00.000Z" },
    });

    expect(next.cv!.summary).toBe("Ajustado.");
    expect(next.findings).toHaveLength(1);
    expect(next.fitSession?.level).toBe("relaxed");
    expect(next.fitUndo?.cv).toEqual(app.cv);
    // And nothing else moved.
    expect(next.cvEdited).toBe(app.cvEdited);
    expect(next.cvOriginal).toBe(app.cvOriginal);
    expect(next.jobText).toBe(app.jobText);
  });
});
