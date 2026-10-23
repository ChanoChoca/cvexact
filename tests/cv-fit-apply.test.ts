import { describe, expect, it } from "vitest";
import { fitApplicationCv, fitReceipt, type FitContext } from "@/lib/applications/fit";
import { cvContentHash } from "@/lib/cv/review-hash";
import { correctionsOf } from "@/lib/cv/corrections";
import { withGeneratedCV } from "@/lib/storage/applications/normalize";
import { OMITTED_LIMIT } from "@/lib/schemas/cv";
import type { Application } from "@/lib/storage/application";
import { devProfile } from "./fixtures";
import {
  LINE_PX,
  SHORTENED_BULLET,
  WRAPPED_BULLET,
  application,
  fakeHeight,
  fakeMeasurer,
  fakeStore,
  limitWithRoomFor,
  longLinePage,
  thinPage,
} from "./helpers/cv-fit";

/**
 * The flow around the engine: what is written, what is said, and what is never
 * touched. Measurer, store and fonts are injected, so none of it needs a DOM,
 * IndexedDB or a real click.
 */

/** The context of one attempt, against the store the test owns. */
function context(
  store: ReturnType<typeof fakeStore>,
  options: { limit?: number; allowExtreme?: boolean; keepUndo?: boolean } = {},
): FitContext {
  return {
    profile: devProfile,
    measurer: fakeMeasurer,
    fontsReady: async () => true,
    store: store.store,
    ...options,
  };
}

describe("fitApplicationCv", () => {
  it("says nothing at all when the CV already fits", async () => {
    const app = application();
    const store = fakeStore([app]);

    const outcome = await fitApplicationCv(app, context(store, { limit: fakeHeight(app.cv!) }));

    expect(outcome.status).toBe("unchanged");
    // Not even a session: there was no attempt to remember.
    expect(store.saves).toHaveLength(0);
  });

  it("writes the fitted CV, its receipt, its session and the copy that undoes it", async () => {
    const app = application();
    const store = fakeStore([app]);
    const limit = limitWithRoomFor(app.cv!, 3);

    const outcome = await fitApplicationCv(app, context(store, { limit }));
    expect(outcome.status).toBe("fitted");
    if (outcome.status !== "fitted") return;

    const fitted = outcome.application;
    expect(fitted.cv).not.toEqual(app.cv);
    expect(fitted.cv!.coverage.omitted[0]!.reason).toBe("Se quitó para que entre en una hoja.");
    expect(fitted.cv!.coverage.omitted.slice(0, outcome.removed.length).map((entry) => entry.item)).toEqual(
      outcome.removed.map((line) => line.label),
    );
    expect(fitted.cv!.coverage.omitted.length).toBeLessThanOrEqual(OMITTED_LIMIT);

    // The person sees what left, and can put it back.
    expect(fitted.fitUndo?.cv).toEqual(app.cv);
    expect(fitted.fitUndo?.fittedHash).toBe(cvContentHash(fitted.cv!));
    expect(outcome.undoSaved).toBe(true);
    expect(outcome.condensed).toEqual([]);

    // The session records how far the ladder went.
    expect(fitted.fitSession?.level).toBe(outcome.level);
    expect(store.records.get(app.id)).toEqual(fitted);
  });

  it("never marks the CV as hand-edited, and never writes a cvOriginal", async () => {
    const app = application();
    const store = fakeStore([app]);

    const outcome = await fitApplicationCv(app, context(store, { limit: limitWithRoomFor(app.cv!, 3) }));
    expect(outcome.status).toBe("fitted");
    if (outcome.status !== "fitted") return;

    // Nothing the fit did reads as something the *person* wrote: the corrections
    // engine compares the CV on screen with the generated one, and a line the
    // engine took out is not a claim anyone made.
    expect(
      correctionsOf({ original: app.cv!, edited: outcome.application.cv!, profile: devProfile }),
    ).toEqual([]);

    // «Editado por vos», the corrections offered to the profile and «restaurar el
    // generado» all hang off these two fields, and an automatic adjustment is
    // none of their business: the fit leaves both exactly as it found them.
    expect(outcome.application.cvEdited).not.toBe(true);
    expect(outcome.application.cvOriginal).toBeUndefined();

    // On the real path the CV was generated first, so `cvEdited` is already
    // `false` — and it stays false.
    const generated = withGeneratedCV(app, app.cv);
    const overGenerated = await fitApplicationCv(
      generated,
      context(fakeStore([generated]), { limit: limitWithRoomFor(app.cv!, 3) }),
    );
    expect(overGenerated.status === "fitted" && overGenerated.application.cvEdited).toBe(false);
    expect(overGenerated.status === "fitted" && overGenerated.application.cvOriginal).toBeUndefined();
  });

  it("recomputes the findings, keeping the one that cannot be recomputed", async () => {
    const truncation = {
      severity: "warning" as const,
      field: "sections",
      detail: "La respuesta se cortó y la última sección puede estar incompleta.",
    };
    const app = application({ findings: [truncation] });
    const store = fakeStore([app]);

    const outcome = await fitApplicationCv(app, context(store, { limit: limitWithRoomFor(app.cv!, 3) }));
    expect(outcome.status).toBe("fitted");
    if (outcome.status !== "fitted") return;

    const findings = outcome.application.findings ?? [];

    // The server's warning is about the model's answer, not about the document:
    // it is carried over once, and it is still there.
    expect(findings.filter((finding) => /se cortó/.test(finding.detail))).toHaveLength(1);
    // And every positional finding points at a line that exists in the fitted CV.
    for (const finding of findings) {
      const match = /^sections\[(\d+)\]\.items\[(\d+)\]\.bullets\[(\d+)\]$/.exec(finding.field);
      if (!match) continue;
      const section = outcome.application.cv!.sections[Number(match[1])];
      expect(section?.kind).toBe("experience");
      if (section?.kind !== "experience") continue;
      expect(section.items[Number(match[2])]?.bullets[Number(match[3])]).toBeDefined();
    }
  });

  it("turns a requirement whose only evidence went out into uncovered", async () => {
    const app = application({ cv: thinPage() });
    const store = fakeStore([app]);
    // Exactly one line over: at `extreme` the only thing that can go is the
    // licence row, the only line evidencing an excluding requirement.
    const limit = fakeHeight(app.cv!) - LINE_PX;

    const outcome = await fitApplicationCv(app, context(store, { limit, allowExtreme: true }));
    expect(outcome.status).toBe("fitted");
    if (outcome.status !== "fitted") return;

    expect(outcome.level).toBe("extreme");
    const entry = outcome.application.cv!.coverage.requirements.find(
      (row) => row.requirement === "Licencia de conducir B1",
    );
    expect(entry).toMatchObject({
      covered: false,
      evidence: "Se quitó para que entre en una hoja.",
    });
    expect(outcome.application.cv!.coverage.omitted[0]!.item).toMatch(/Licencia de conducir/);
  });

  it("asks for consent before extreme, and applies nothing while it does", async () => {
    const app = application({ cv: thinPage() });
    const store = fakeStore([app]);
    const limit = fakeHeight(app.cv!) - LINE_PX;

    const outcome = await fitApplicationCv(app, context(store, { limit }));

    expect(outcome.status).toBe("needs-consent");
    if (outcome.status !== "needs-consent") return;
    // What the dialog has to name: the only line evidencing the excluding
    // requirement, with the requirement it evidences.
    expect(outcome.preview.map((line) => line.tier)).toEqual(["T5"]);
    expect(outcome.preview[0]!.requirement).toBe("Licencia de conducir B1");
    expect(store.saves).toHaveLength(0);
  });

  it("says impossible when even extreme cannot make it fit", async () => {
    const app = application();
    const store = fakeStore([app]);

    const outcome = await fitApplicationCv(app, context(store, { limit: 1, allowExtreme: true }));

    expect(outcome.status).toBe("impossible");
    expect(store.saves).toHaveLength(0);
  });

  it("leaves the application untouched when the faces are not ready", async () => {
    const app = application();
    const store = fakeStore([app]);

    const outcome = await fitApplicationCv(app, {
      ...context(store, { limit: limitWithRoomFor(app.cv!, 3) }),
      fontsReady: async () => false,
    });

    expect(outcome).toEqual({ status: "skipped", reason: "fonts" });
    expect(store.saves).toHaveLength(0);
  });

  it("leaves the application untouched when the engine throws", async () => {
    const app = application();
    const store = fakeStore([app]);

    const outcome = await fitApplicationCv(app, {
      ...context(store, { limit: limitWithRoomFor(app.cv!, 3) }),
      measurer: {
        measure: () => {
          throw new Error("no DOM");
        },
        layout: () => ({ bullets: [] }),
      },
    });

    expect(outcome).toEqual({ status: "skipped", reason: "error" });
    expect(store.saves).toHaveLength(0);
  });

  it("saves the fit even when the copy for «Deshacer» does not fit, and says so", async () => {
    const app = application();
    const store = fakeStore([app], { refuse: true });
    const limit = limitWithRoomFor(app.cv!, 3);

    const outcome = await fitApplicationCv(app, context(store, { limit }));
    expect(outcome.status).toBe("fitted");
    if (outcome.status !== "fitted") return;

    // The first write was refused; the retry carries the same CV without the
    // second copy, so the fit is never lost to the undo.
    expect(outcome.undoSaved).toBe(false);
    expect(outcome.application.fitUndo).toBeUndefined();
    expect(store.saves.map((save) => save.fitUndo !== undefined)).toEqual([true, false]);
  });

  it("keeps no copy at all on the fallback engine", async () => {
    const app = application();
    const store = fakeStore([app]);
    const limit = limitWithRoomFor(app.cv!, 3);

    const outcome = await fitApplicationCv(app, context(store, { limit, keepUndo: false }));
    expect(outcome.status).toBe("fitted");
    if (outcome.status !== "fitted") return;

    expect(outcome.undoSaved).toBe(false);
    expect(outcome.application.fitUndo).toBeUndefined();
  });

  it("records what was shortened in «Qué se dejó afuera», with the line it used to be", async () => {
    const app = application({ cv: longLinePage() });
    const store = fakeStore([app]);
    const rewritten = [{ id: "s0.i0.b0", before: WRAPPED_BULLET, after: SHORTENED_BULLET }];

    const outcome = await fitApplicationCv(app, {
      ...context(store, { limit: fakeHeight(app.cv!) - LINE_PX }),
      condense: async () => rewritten,
    });

    expect(outcome.status).toBe("fitted");
    if (outcome.status !== "fitted") return;
    expect(outcome.condensed).toEqual(rewritten);
    // Nothing was removed: the line is still there, shorter.
    expect(outcome.removed).toEqual([]);
    expect(JSON.stringify(outcome.application.cv)).toContain(SHORTENED_BULLET);

    const omitted = outcome.application.cv!.coverage.omitted;
    expect(omitted[0]!.item).toBe(`Acortada: ${SHORTENED_BULLET}`);
    expect(omitted[0]!.reason).toBe(`Antes: «${WRAPPED_BULLET}»`);
  });
});

describe("the receipt", () => {
  it("names what left and says it stays in the profile", async () => {
    const app: Application = application();
    const store = fakeStore([app]);

    const outcome = await fitApplicationCv(app, context(store, { limit: limitWithRoomFor(app.cv!, 3) }));
    expect(outcome.status).toBe("fitted");
    if (outcome.status !== "fitted") return;

    const receipt = fitReceipt(outcome.removed, outcome.condensed);
    expect(receipt).toContain("Para que entre en una hoja, quitamos");
    expect(receipt).toContain("Siguen en tu perfil y las ves en «Qué se dejó afuera del CV»");
  });

  it("names an omitted job with its company and its dates", () => {
    const removed = [
      {
        kind: "job" as const,
        label: "Puesto: Kiosco Norte",
        text: "Kiosco Norte — Vendedora (2014 – 2016)",
        tier: "T4b" as const,
        company: "Kiosco Norte",
        dates: "2014 – 2016",
      },
    ];

    expect(fitReceipt(removed, [])).toContain("Omitimos el puesto «Kiosco Norte» (2014 – 2016)");
    expect(fitReceipt(removed, [])).toContain("ya no aparece en el CV");
  });
});

