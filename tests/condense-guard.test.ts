import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildEvidenceIndex } from "@/lib/ai/evidence";
import { applyCondensed, classifyFitUnits, type FitAnalysis } from "@/lib/cv/fit";
import { condenseCv, condenseTargets } from "@/lib/cv/condense";
import { guardRewrite, lexiconFor, summaryStillAllowed } from "@/lib/cv/condense-guard";
import { cvDocumentSchema, type CVDocument } from "@/lib/schemas/cv";
import { devProfile } from "./fixtures";
import { fakeMeasurer } from "./helpers/cv-fit";

/**
 * What the model that shortens is allowed to get away with.
 *
 * Every case here is one of the invariants of §7, written as the failure it
 * prevents: a figure that moved, a negation that appeared, a «colaboré» that
 * turned into «lideré». The last level is not an invariant at all — it is a share,
 * and the tests say so: below the floor the line is refused, between the floor and
 * the mark it passes *marked for the person to read*.
 */

const callGenerator = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ callGenerator }));

const LONG =
  "Preparé los informes mensuales de ventas para la dirección comercial y reduje un 20 % el tiempo de cierre.";

/** One long line with a figure in it, a study, and nothing else to pick. */
function lineCv(summary = ""): CVDocument {
  return cvDocumentSchema.parse({
    language: "es",
    header: {
      fullName: "Ana Pérez",
      location: "Rosario, Argentina",
      phone: "+54 341 555 1234",
      email: "ana@example.com",
      links: [],
    },
    summary,
    sections: [
      {
        kind: "experience",
        title: "EXPERIENCIA PROFESIONAL",
        items: [
          {
            company: "Nubia Retail",
            role: "Analista de datos",
            location: "Rosario, Argentina",
            dateRange: "marzo 2021 – actualidad",
            bullets: [LONG],
          },
        ],
      },
      {
        kind: "education",
        title: "EDUCACIÓN",
        items: [
          {
            institution: "Universidad Nacional de Rosario",
            degree: "Licenciada en Administración",
            location: "Rosario, Argentina",
            date: "2020",
            honors: "",
          },
        ],
      },
    ],
    coverage: { requirements: [], omitted: [] },
  });
}

describe("guardRewrite — the invariants", () => {
  it("accepts a shorter line that keeps every fact, and says it needs no reading", () => {
    expect(
      guardRewrite({
        original: LONG,
        rewrite: "Preparé los informes de ventas de la dirección y reduje un 20 % el tiempo de cierre.",
        language: "es",
        maxChars: 90,
      }),
    ).toEqual({ ok: true, needsReview: false });
  });

  it("refuses a figure that changed, added or dropped", () => {
    for (const rewrite of [
      "Preparé los informes de ventas y reduje un 25 % el tiempo de cierre.",
      "Preparé los informes de ventas y reduje el tiempo de cierre.",
      "Preparé los informes de ventas y reduje un 20 % el tiempo de cierre en 3 semanas.",
    ]) {
      expect(guardRewrite({ original: LONG, rewrite, language: "es", maxChars: 90 })).toEqual({
        ok: false,
        reason: "figures",
      });
    }
  });

  it("refuses a negation that appeared or disappeared", () => {
    expect(
      guardRewrite({
        original: "No llevo la facturación del local, solo el control de stock.",
        rewrite: "Llevo la facturación del local y el control de stock.",
        language: "es",
        maxChars: 60,
      }),
    ).toEqual({ ok: false, reason: "negations" });

    expect(
      guardRewrite({
        original: "Llevo la facturación del local y el control de stock semanal.",
        rewrite: "No llevo la facturación y hago el control de stock.",
        language: "es",
        maxChars: 60,
      }),
    ).toEqual({ ok: false, reason: "negations" });
  });

  it("refuses a nuance of authorship that turns into a stronger claim", () => {
    const original = "Colaboré con el equipo de compras en la negociación de proveedores locales.";

    expect(
      guardRewrite({
        original,
        rewrite: "Lideré la negociación de proveedores locales.",
        language: "es",
        maxChars: 45,
      }),
    ).toEqual({ ok: false, reason: "authorship" });

    // Dropping the nuance without strengthening it is refused too: «con el equipo»
    // disappearing is the same claim made stronger, word by word.
    expect(
      guardRewrite({
        original,
        rewrite: "Negocié proveedores locales con las compras.",
        language: "es",
        maxChars: 45,
      }),
    ).toEqual({ ok: false, reason: "authorship" });

    // And the other way round: what the original already said can be said again.
    expect(
      guardRewrite({
        original: "Lideré la negociación de proveedores locales y armé los contratos.",
        rewrite: "Lideré la negociación de proveedores y los contratos.",
        language: "es",
        maxChars: 60,
      }),
    ).toEqual({ ok: true, needsReview: false });
  });

  it("refuses a technology or a name the line did not have, and refuses to lose one it had", () => {
    // New terms are caught against the profile — the same index the CV was built
    // from, which is the only thing that can say whether the person ever named it.
    expect(
      guardRewrite({
        original: "Armé los tableros de ventas del equipo comercial.",
        rewrite: "Armé los tableros de ventas en Power BI.",
        language: "es",
        maxChars: 45,
        profile: buildEvidenceIndex(devProfile),
      }),
    ).toEqual({ ok: false, reason: "terms" });

    expect(
      guardRewrite({
        original: "Armé los tableros de ventas en Power BI para el equipo comercial.",
        rewrite: "Armé los tableros de ventas para el equipo.",
        language: "es",
        maxChars: 50,
      }),
    ).toEqual({ ok: false, reason: "terms" });
  });

  it("refuses a line that is not shorter, or that breaks the ceiling it was given", () => {
    expect(
      guardRewrite({
        original: "Armé los tableros de ventas del equipo.",
        rewrite: "Armé los tableros de ventas del equipo comercial.",
        language: "es",
        maxChars: 60,
      }),
    ).toEqual({ ok: false, reason: "not-shorter" });

    expect(
      guardRewrite({
        original: "Armé los tableros de ventas del equipo comercial todos los meses.",
        rewrite: "Armé los tableros de ventas del equipo.",
        language: "es",
        maxChars: 10,
      }),
    ).toEqual({ ok: false, reason: "too-long" });
  });

  it("refuses to shorten anything in a language it has no lexicon for", () => {
    expect(lexiconFor("fr")).toBeNull();
    expect(lexiconFor("pt-BR")).toBeNull();
    expect(lexiconFor("es-AR")).toBe("es");
    expect(lexiconFor("en")).toBe("en");

    expect(
      guardRewrite({
        original: "J'ai préparé les rapports mensuels de ventes pour la direction.",
        rewrite: "J'ai préparé les rapports de ventes pour la direction.",
        language: "fr",
        maxChars: 50,
      }),
    ).toEqual({ ok: false, reason: "unsupported-language" });
  });
});

describe("guardRewrite — the share", () => {
  it("passes a line that kept its vocabulary, and marks one that changed enough of it", () => {
    const original = "Armé los tableros de ventas del equipo comercial con datos de tres marcas distintas.";

    // Every content word of the rewrite is in the original.
    expect(
      guardRewrite({
        original,
        rewrite: "Armé tableros de ventas del equipo comercial con datos de marcas.",
        language: "es",
        maxChars: 75,
      }),
    ).toEqual({ ok: true, needsReview: false });

    // Two of seven are new words: inside the band, so it passes — and is marked
    // for the person to read, because changing vocabulary is not proof of
    // anything, in either direction.
    expect(
      guardRewrite({
        original,
        rewrite: "Hice tableros de ventas del equipo comercial con cifras nuevas de marcas.",
        language: "es",
        maxChars: 78,
      }),
    ).toEqual({ ok: true, needsReview: true });
  });

  it("refuses a line that barely keeps any of what the original said", () => {
    expect(
      guardRewrite({
        original: "Preparé los informes mensuales de ventas para dirección.",
        rewrite: "Hice informes y reportes para jefes.",
        language: "es",
        maxChars: 45,
      }),
    ).toEqual({ ok: false, reason: "unfaithful" });
  });
});

describe("summaryStillAllowed", () => {
  const withSummary = (summary: string) => cvDocumentSchema.parse({ ...lineCv(), summary });

  it("says yes when the rules the summary already kept are still kept", () => {
    const before = withSummary("Analista de datos con seis años de experiencia en retail y consumo masivo.");
    const after = withSummary("Analista de datos con seis años en retail y consumo masivo.");
    expect(summaryStillAllowed(before, after, devProfile)).toBe(true);
  });

  it("says no when the rewrite turns the summary into a cover letter", () => {
    const before = withSummary("Analista de datos con seis años de experiencia en retail y consumo masivo.");
    const after = withSummary("Analista de datos. Busco un rol donde aplicar mis habilidades.");
    expect(summaryStillAllowed(before, after, devProfile)).toBe(false);
  });

  it("does not blame the rewrite for a rule the summary was already breaking", () => {
    const before = withSummary("Analista de datos. Busco un rol donde aplicar mis habilidades y crecer.");
    const after = withSummary("Analista de datos. Busco un rol donde aplicar mis habilidades.");
    expect(summaryStillAllowed(before, after, devProfile)).toBe(true);
  });
});

describe("condenseCv — what actually reaches the CV", () => {
  beforeEach(() => {
    callGenerator.mockReset();
  });

  it("applies the rewrite that keeps the figure, and leaves alone the one that moved it", async () => {
    const cv = lineCv();
    const layout = fakeMeasurer.layout(cv);
    const id = condenseTargets(cv, { layout, units: classifyFitUnits(cv), linesToGain: 1 })[0]!.id;

    for (const [rewrite, applied] of [
      ["Preparé los informes de ventas de la dirección y reduje un 20 % el tiempo de cierre.", true],
      ["Preparé los informes de ventas de la dirección y reduje un 25 % el tiempo de cierre.", false],
    ] as const) {
      callGenerator.mockResolvedValue({ rewrites: [{ id, text: rewrite }] });
      const accepted = await condenseCv(cv, { layout, language: "es", linesToGain: 1, profile: devProfile });

      expect(accepted).toHaveLength(applied ? 1 : 0);
      const next = applyCondensed(cv, accepted);
      if (applied) {
        const section = next.sections[0]!;
        expect(section.kind === "experience" && section.items[0]!.bullets[0]).toBe(rewrite);
      } else {
        // «Esa viñeta queda como estaba», character for character.
        expect(next).toBe(cv);
      }
    }
  });

  it("ignores a rewrite for an id nobody asked about", async () => {
    const cv = lineCv();
    const layout = fakeMeasurer.layout(cv);
    const id = condenseTargets(cv, { layout, units: classifyFitUnits(cv), linesToGain: 1 })[0]!.id;

    callGenerator.mockResolvedValue({
      rewrites: [
        { id: "s9.i9.b9", text: "Cualquier cosa, más corta." },
        { id, text: "Preparé los informes de dirección y reduje un 20 % el cierre." },
      ],
    });

    const accepted = await condenseCv(cv, { layout, language: "es", linesToGain: 1, profile: devProfile });

    expect(accepted.map((line) => line.id)).toEqual([id]);
  });

  it("carries on with the deterministic fit when the call fails", async () => {
    const cv = lineCv();
    const layout = fakeMeasurer.layout(cv);

    for (const failure of [new Error("sin key"), new Error("403"), new Error("se cortó")]) {
      callGenerator.mockRejectedValue(failure);
      expect(
        await condenseCv(cv, { layout, language: "es", linesToGain: 1, profile: devProfile }),
      ).toEqual([]);
    }
    expect(callGenerator).toHaveBeenCalledTimes(3);
  });

  it("does not ask at all when there is nothing worth shortening", async () => {
    const base = lineCv();
    const small = cvDocumentSchema.parse({
      ...base,
      sections: [
        {
          ...base.sections[0]!,
          items: [
            {
              company: "Nubia Retail",
              role: "Cajera",
              location: "Rosario",
              dateRange: "2021 – actualidad",
              bullets: ["Atiendo el público."],
            },
          ],
        },
        base.sections[1]!,
      ],
    });

    const accepted = await condenseCv(small, {
      layout: fakeMeasurer.layout(small),
      language: "es",
      linesToGain: 1,
      profile: devProfile,
    });

    expect(accepted).toEqual([]);
    expect(callGenerator).not.toHaveBeenCalled();
  });

  it("drops the summary when the rewrite turns it into a cover letter, and keeps the rest", async () => {
    const cv = lineCv(
      "Analista de datos con seis años de experiencia en retail y consumo masivo, con foco en tableros comerciales.",
    );
    const layout = fakeMeasurer.layout(cv);
    const bullet = condenseTargets(cv, { layout, units: classifyFitUnits(cv), linesToGain: 1 })[0]!;

    callGenerator.mockResolvedValue({
      rewrites: [
        { id: bullet.id, text: "Preparé los informes de ventas de dirección y reduje un 20 % el cierre." },
        { id: "sum", text: "Analista de datos con seis años en retail. Busco un rol donde aplicar mis habilidades." },
      ],
    });

    const accepted = await condenseCv(cv, { layout, language: "es", linesToGain: 1, profile: devProfile });

    expect(accepted.map((line) => line.id)).toEqual([bullet.id]);
  });
});

describe("condenseTargets", () => {
  it("never offers the only evidence of an excluding requirement", () => {
    const cv = lineCv();
    const analysis: FitAnalysis = {
      keywords: ["informes"],
      requirements: [{ text: "Manejo de informes", kind: "hard", excluding: true }],
      responsibilities: [],
    };
    const units = [
      {
        id: "s0.i0.b0",
        kind: "bullet" as const,
        text: LONG,
        label: LONG.slice(0, 60),
        tier: "T5" as const,
        order: 60,
        jobIndex: 0,
        bulletIndex: 0,
        docOrder: 0,
      },
    ];

    expect(condenseTargets(cv, { layout: fakeMeasurer.layout(cv), units, linesToGain: 3 })).toEqual([]);
    void analysis;
  });
});
