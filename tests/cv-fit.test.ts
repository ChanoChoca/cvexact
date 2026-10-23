import { describe, expect, it } from "vitest";
import { classifyFitUnits, fitToPage, type FitAnalysis, type FitUnit, type RemovedLine } from "@/lib/cv/fit";
import { fitReceipt } from "@/lib/applications/fit";
import { cvDocumentSchema } from "@/lib/schemas/cv";

/**
 * The engine, with the page measured by hand.
 *
 * `measure` is injected precisely so this can be arithmetic: ⌈characters/105⌉
 * lines per bullet (§8), every line the same height, and the page the sum of
 * them. What the browser measures is different in every digit and identical in
 * every decision — which is the part under test here.
 */

import {
  ANALYSIS,
  LINE_PX,
  SQL_BULLET,
  REPEATED,
  REPEATED_OLDER,
  FIGURE_25,
  FIGURE_40,
  fakeHeight,
  fakeLines,
  limitWithRoomFor,
  page as cv,
} from "./helpers/cv-fit";


const unitOf = (units: FitUnit[], id: string): FitUnit => {
  const found = units.find((unit) => unit.id === id);
  if (!found) throw new Error(`no unit ${id}`);
  return found;
};

describe("fitToPage — floors and the receipt (§3.3, §6.5)", () => {
  it("stops at the floors: the current job, its first line, one study", () => {
    const original = cv();
    const impossible = fitToPage(original, {
      analysis: ANALYSIS,
      measure: fakeHeight,
      limit: 1,
      level: "extreme",
    });

    expect(impossible.fits).toBe(false);

    const experience = impossible.cv.sections.find((section) => section.kind === "experience");
    expect(experience?.kind === "experience" && experience.items).toHaveLength(2);
    if (experience?.kind === "experience") {
      // The job the person still holds is never omitted, and its first line is
      // never touched — whatever the page demands.
      expect(experience.items[0]!.company).toBe("Nubia Retail");
      expect(experience.items[0]!.bullets[0]).toBe(SQL_BULLET);
    }

    const education = impossible.cv.sections.find((section) => section.kind === "education");
    expect(education?.kind === "education" && education.items).toHaveLength(1);
    if (education?.kind === "education") {
      expect(education.items[0]!.institution).toBe("Universidad Nacional de Rosario");
      expect(education.items[0]!.degree).toBe("Licenciada en Administración");
      expect(education.items[0]!.date).toBe("2020");
    }

    // The two oldest jobs go whole, and the receipt names them with their dates.
    const omitted = impossible.removed.filter((line) => line.kind === "job");
    expect(omitted.map((line) => line.company)).toEqual(["Kiosco Norte", "Almacén Sur"]);
    expect(omitted.every((line) => Boolean(line.dates))).toBe(true);
  });

  it("drops a skills section that would be left with one line, and reports both", () => {
    // Two lines, the minimum: taking one takes the section.
    const twoSkills = cv({ skills: ["Trabajo en equipo y comunicación.", "Puntualidad y compromiso."] });
    const result = fitToPage(twoSkills, { analysis: ANALYSIS, measure: fakeHeight, limit: 1, level: "normal" });

    expect(result.cv.sections.some((section) => section.kind === "bullets")).toBe(false);
    expect(result.removed.filter((line) => line.kind === "skill")).toHaveLength(2);
  });

  it("omits a whole job only from header-only, and only the ones the level allows", () => {
    const original = cv();
    // A page nothing fits on: every level goes as far as its own rules allow.
    const limit = 1;

    // At `normal` only the oldest job — the 4th — may be omitted, and only once
    // it has no lines left; the job the person still holds never goes.
    const normal = fitToPage(original, { analysis: ANALYSIS, measure: fakeHeight, limit, level: "normal" });
    expect(normal.removed.filter((line) => line.kind === "job").map((line) => line.company)).toEqual([
      "Kiosco Norte",
    ]);
    expect(JSON.stringify(normal.cv)).not.toContain("Kiosco Norte");
    expect(JSON.stringify(normal.cv)).toContain("Nubia Retail");

    // At `relaxed` the third goes as well, and never the two most recent ones.
    const relaxed = fitToPage(original, { analysis: ANALYSIS, measure: fakeHeight, limit, level: "relaxed" });
    expect(relaxed.removed.filter((line) => line.kind === "job").map((line) => line.company)).toEqual([
      "Kiosco Norte",
      "Almacén Sur",
    ]);
  });

  it("gives back what the page no longer needs", () => {
    const original = cv();
    const limit = limitWithRoomFor(original, 3);
    const result = fitToPage(original, { analysis: ANALYSIS, measure: fakeHeight, limit });

    expect(result.fits).toBe(true);
    // The give-back undoes the overshoot: nothing beyond what the page demanded.
    expect(result.removed.length).toBeLessThanOrEqual(3);
    expect(cvDocumentSchema.safeParse(result.cv).success).toBe(true);
  });

  it("is deterministic and idempotent", () => {
    const original = cv();
    const limit = limitWithRoomFor(original, 3);
    const options = { analysis: ANALYSIS, measure: fakeHeight, limit };

    const first = fitToPage(original, options);
    const second = fitToPage(original, options);
    expect(second.cv).toEqual(first.cv);
    expect(second.removed).toEqual(first.removed);

    const again = fitToPage(first.cv, options);
    expect(again.cv).toBe(first.cv);
    expect(again.removed).toEqual([]);
  });

  it("reports the requirements whose only evidence went out", () => {
    const original = cv();
    const result = fitToPage(original, { analysis: ANALYSIS, measure: fakeHeight, limit: 1, level: "extreme" });

    // The pair was the only line evidencing the excluding requirement.
    expect(result.lostRequirements).toContain("Licencia de conducir B1");
    // The line evidencing the covered one is still on the page: it is the first
    // line of the current job, which nothing removes.
    expect(result.lostRequirements).not.toContain("Manejo de SQL");
  });
});

describe("fitToPage — the loop (§3.2, §6.4)", () => {
  it("leaves a CV that already fits exactly as it was", () => {
    const original = cv();
    const result = fitToPage(original, {
      analysis: ANALYSIS,
      measure: fakeHeight,
      limit: fakeHeight(original),
    });

    expect(result.fits).toBe(true);
    expect(result.removed).toEqual([]);
    expect(result.cv).toBe(original);
  });

  it("takes the least valuable line, never a quantified one", () => {
    const original = cv();
    const result = fitToPage(original, {
      analysis: ANALYSIS,
      measure: fakeHeight,
      limit: limitWithRoomFor(original, 1),
    });

    expect(result.fits).toBe(true);
    expect(result.removed).toHaveLength(1);
    // The redundant line is what goes: the page keeps the figure that has
    // nothing to do with the posting *and* the one that evidences it.
    expect(result.removed[0]!.tier).toBe("T0");
    const page = JSON.stringify(result.cv);
    expect(page).toContain("20 proveedores");
    expect(page).toContain("Consultas SQL");
  });

  it("holds T4b for extreme, and T5 for last of all", () => {
    const original = cv();
    const limit = (fakeLines(original) - 25) * LINE_PX;

    /**
     * What is forbidden at `normal` and `relaxed` is *choosing* a T4b or T5
     * **line**: a quantified achievement whose figure has nothing to do with the
     * posting, the only evidence of a requirement, and so on. Two things can
     * still wear those tiers in the receipt without having been chosen: a line
     * that leaves as collateral when a `bullets` section falls under its minimum
     * goes whole, and a whole job, whose tier is a placeholder for «structural»
     * (§3.2 lets `normal` omit one from the 4th on).
     */
    const dangerous = (line: RemovedLine) =>
      line.tier === "T5" ||
      (line.tier === "T4b" &&
        (line.kind === "bullet" || line.kind === "skill" || line.kind === "pair"));

    const normal = fitToPage(original, { analysis: ANALYSIS, measure: fakeHeight, limit, level: "normal" });
    expect(normal.removed.some(dangerous)).toBe(false);

    const relaxed = fitToPage(original, { analysis: ANALYSIS, measure: fakeHeight, limit, level: "relaxed" });
    expect(relaxed.removed.some(dangerous)).toBe(false);

    const extreme = fitToPage(original, { analysis: ANALYSIS, measure: fakeHeight, limit, level: "extreme" });
    const lastStrict = extreme.removed.map((line) => line.tier).lastIndexOf("T5");
    expect(lastStrict === -1 || lastStrict === extreme.removed.length - 1).toBe(true);
  });

  it("keeps the summary at relaxed, and takes it from the back at extreme", () => {
    const first = "Analista de datos con seis años de experiencia en retail y consumo masivo, con foco en tableros.";
    const second = "Trabajé con equipos comerciales de tres marcas distintas y armé los reportes mensuales de ventas.";
    const third = "Me interesa seguir creciendo en un equipo que mida lo que hace y lo cuente con claridad y datos.";
    const original = cv({ summary: `${first} ${second} ${third}` });
    const limit = (fakeLines(original) - 2) * LINE_PX;

    const relaxed = fitToPage(original, { analysis: ANALYSIS, measure: fakeHeight, limit, level: "relaxed" });
    expect(relaxed.cv.summary).toBe(original.summary);

    const extreme = fitToPage(original, { analysis: ANALYSIS, measure: fakeHeight, limit, level: "extreme" });
    // The first sentence never goes on its own; what goes is the last one.
    expect(extreme.cv.summary.startsWith(first)).toBe(true);
    expect(extreme.cv.summary).not.toContain("contar con claridad");
  });
});

describe("fitToPage — classification (§3.1)", () => {
  const units = classifyFitUnits(cv(), ANALYSIS);

  it("gives every unit exactly one category, and the structural ones theirs", () => {
    for (const unit of units) expect(unit.tier).toMatch(/^T[0-5][ab]?$/);

    // The line evidencing the excluding requirement: last of all.
    expect(unitOf(units, "s3.i1").tier).toBe("T5");
    // The line evidencing a covered requirement: quantified relevance.
    expect(unitOf(units, "s0.i0.b0").tier).toBe("T4b");
    // A figure nothing in the posting asks about.
    expect(unitOf(units, "s2.b1").tier).toBe("T4a");
    // Two and one keyword states.
    expect(unitOf(units, "s2.b0").tier).toBe("T3");
    expect(unitOf(units, "s2.b2").tier).toBe("T1");
  });

  it("resolves redundancy first, and keeps the more probative of the pair", () => {
    // The same line in two jobs: the newer one stays, the older is the duplicate.
    expect(unitOf(units, "s0.i0.b1").tier).not.toBe("T0");
    expect(unitOf(units, "s0.i1.b0").tier).toBe("T0");
  });

  it("keeps the duplicate that evidences a requirement, even if it is the older one", () => {
    const documented = cvDocumentSchema.parse({
      ...cv(),
      coverage: {
        requirements: [
          { requirement: "Manejo de SQL", covered: true, evidence: SQL_BULLET, inferred: false },
          // The evidence names the *older* copy word for word, so that is the
          // one evidencing the requirement.
          { requirement: "Informes mensuales", covered: true, evidence: REPEATED_OLDER, inferred: false },
        ],
        omitted: [],
      },
    });
    const analysis: FitAnalysis = {
      ...ANALYSIS,
      requirements: [
        { text: "Manejo de SQL", kind: "hard", excluding: false },
        { text: "Informes mensuales", kind: "hard", excluding: false },
      ],
    };

    const classified = classifyFitUnits(documented, analysis);
    // The evidence never falls to T0, and being the more probative member of its
    // group it is the one the group keeps: the newer copy is what goes.
    expect(unitOf(classified, "s0.i1.b0").tier).toBe("T4b");
    expect(unitOf(classified, "s0.i0.b1").tier).toBe("T0");
  });

  it("does not call two different figures a duplicate", () => {
    const classified = classifyFitUnits(
      cv({ firstBullets: [FIGURE_40, REPEATED], olderBullets: [FIGURE_25] }),
      ANALYSIS,
    );
    // Each states a figure of its own, so neither is the other's duplicate —
    // and both are T4a: a figure the posting does not ask about.
    expect(unitOf(classified, "s0.i0.b0").tier).toBe("T4a");
    expect(unitOf(classified, "s0.i1.b0").tier).toBe("T4a");
  });
});


describe("fitToPage — projects", () => {
  // One current job at its floor and one study leave the projects as the only thing the page can give.
  const withProjects = () =>
    cvDocumentSchema.parse({
      language: "es",
      header: { fullName: "Ana Pérez", location: "Rosario, Argentina", phone: "", email: "", links: [] },
      summary: "Analista de datos.",
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA PROFESIONAL",
          items: [{ company: "Nubia Retail", role: "Analista", location: "Rosario", dateRange: "marzo 2021 – actualidad", bullets: [SQL_BULLET] }],
        },
        {
          kind: "education",
          title: "EDUCACIÓN",
          items: [{ institution: "UNR", degree: "Licenciada", location: "Rosario", date: "2020", honors: "" }],
        },
        {
          kind: "projects",
          title: "PROYECTOS",
          items: [
            { ref: "P1", name: "Tablero de ventas", description: "Tablero en Power BI para el equipo.", url: "https://github.com/perfil-ejemplo/tablero" },
            { ref: "P2", name: "Planilla de gastos", description: "Planilla del hogar.", url: "" },
          ],
        },
      ],
      coverage: { requirements: [], omitted: [] },
    });

  it("classifies a project as one unit, a line of the ladder like a bullet", () => {
    const units = classifyFitUnits(withProjects(), ANALYSIS);
    const matching = unitOf(units, "s2.i0");
    const plain = unitOf(units, "s2.i1");
    expect(matching).toMatchObject({ kind: "project", label: "Proyecto: Tablero de ventas" });
    expect(plain).toMatchObject({ kind: "project", label: "Proyecto: Planilla de gastos", tier: "T1" });
    // The one that states a keyword of the posting outlasts the one that states none.
    expect(matching.order).toBeGreaterThan(plain.order);
  });

  it("takes a whole project out — name, description and link — and the receipt names it", () => {
    const original = withProjects();
    const result = fitToPage(original, { analysis: ANALYSIS, measure: fakeHeight, limit: limitWithRoomFor(original, 1) });

    expect(result.fits).toBe(true);
    expect(result.removed.map((line) => [line.kind, line.label])).toEqual([["project", "Proyecto: Planilla de gastos"]]);
    const section = result.cv.sections.find((candidate) => candidate.kind === "projects");
    expect(section?.kind === "projects" && section.items.map((item) => item.name)).toEqual(["Tablero de ventas"]);
    expect(JSON.stringify(result.cv)).not.toContain("Planilla");
    expect(fitReceipt(result.removed, [])).toContain("«Proyecto: Planilla de gastos»");
    expect(result.cv.coverage.omitted).toEqual([]);
  });

  it("takes the section out with its last project", () => {
    const original = withProjects();
    const result = fitToPage(original, { analysis: ANALYSIS, measure: fakeHeight, limit: limitWithRoomFor(original, 2) });

    expect(result.fits).toBe(true);
    expect(result.removed.map((line) => line.kind)).toEqual(["project", "project"]);
    expect(result.cv.sections.map((section) => section.kind)).toEqual(["experience", "education"]);
  });

  it("gives a project back when the page has room for it again", () => {
    const original = withProjects();
    // Room for exactly the first project: the engine must not stop at the first removal it made.
    const result = fitToPage(original, { analysis: ANALYSIS, measure: fakeHeight, limit: limitWithRoomFor(original, 1) });
    expect(result.cv.sections.find((section) => section.kind === "projects")).toBeDefined();
    expect(fitToPage(result.cv, { analysis: ANALYSIS, measure: fakeHeight, limit: limitWithRoomFor(original, 1) }).removed).toEqual([]);
  });
});

describe("fitToPage — a job's note", () => {
  const withNote = () =>
    cvDocumentSchema.parse({
      language: "es",
      header: { fullName: "Ana Pérez", location: "Rosario, Argentina", phone: "", email: "", links: [] },
      summary: "Analista de datos.",
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA PROFESIONAL",
          items: [
            { company: "Nubia Retail", role: "Analista", location: "Rosario", dateRange: "marzo 2021 – actualidad", bullets: [SQL_BULLET, REPEATED] },
            { company: "Tiendix", role: "Dev", location: "", dateRange: "abril 2020 – junio 2020", bullets: [FIGURE_SKILL_LINE], note: "Cierre del área de desarrollo" },
          ],
        },
        { kind: "education", title: "EDUCACIÓN", items: [{ institution: "UNR", degree: "Licenciada", location: "Rosario", date: "2020", honors: "" }] },
      ],
      coverage: { requirements: [], omitted: [] },
    });
  const FIGURE_SKILL_LINE = "Armé el catálogo de la tienda.";

  it("is a line of its job, the first of that job to go", () => {
    const units = classifyFitUnits(withNote(), ANALYSIS);
    expect(unitOf(units, "s0.i1.n")).toMatchObject({ kind: "note", label: "Cierre del área de desarrollo", tier: "T1", jobIndex: 1, bulletIndex: 1 });
    expect(units.some((unit) => unit.id === "s0.i0.n")).toBe(false);
  });

  it("is taken out when the page has no room, the job stays, and the receipt names it", () => {
    const original = withNote();
    const result = fitToPage(original, { analysis: ANALYSIS, measure: fakeHeight, limit: limitWithRoomFor(original, 1) });

    expect(result.fits).toBe(true);
    expect(result.removed.map((line) => [line.kind, line.label])).toEqual([["note", "Cierre del área de desarrollo"]]);
    const experience = result.cv.sections.find((section) => section.kind === "experience");
    expect(experience?.kind === "experience" && experience.items.map((item) => [item.company, item.note, item.bullets.length])).toEqual([
      ["Nubia Retail", undefined, 2],
      ["Tiendix", "", 1],
    ]);
  });
});

describe("fitToPage — activities", () => {
  const withActivities = () =>
    cvDocumentSchema.parse({
      language: "es",
      header: { fullName: "Ana Pérez", location: "Rosario, Argentina", phone: "", email: "", links: [] },
      summary: "Analista de datos.",
      sections: [
        { kind: "experience", title: "EXPERIENCIA PROFESIONAL", items: [{ company: "Nubia Retail", role: "Analista", location: "Rosario", dateRange: "marzo 2021 – actualidad", bullets: [SQL_BULLET] }] },
        { kind: "education", title: "EDUCACIÓN", items: [{ institution: "UNR", degree: "Licenciada", location: "Rosario", date: "2020", honors: "" }] },
        { kind: "activities", title: "ACTIVIDADES", items: [{ ref: "O1", text: "Presido el Club de Robótica de la facultad." }, { ref: "O2", text: "Doy clases de apoyo a chicos del barrio." }] },
      ],
      coverage: { requirements: [], omitted: [] },
    });

  it("classifies an activity as one unit, a line of the ladder like a project", () => {
    const units = classifyFitUnits(withActivities(), ANALYSIS);
    expect(unitOf(units, "s2.i0")).toMatchObject({ kind: "activity", label: "Actividad: Presido el Club de Robótica de la facultad.", tier: "T1" });
    expect(unitOf(units, "s2.i1")).toMatchObject({ kind: "activity", tier: "T1" });
  });

  it("takes an activity out when the page has no room for it, and the receipt names it", () => {
    const original = withActivities();
    const result = fitToPage(original, { analysis: ANALYSIS, measure: fakeHeight, limit: limitWithRoomFor(original, 1) });

    expect(result.fits).toBe(true);
    expect(result.removed.map((line) => line.kind)).toEqual(["activity"]);
    const section = result.cv.sections.find((candidate) => candidate.kind === "activities");
    expect(section?.kind === "activities" && section.items).toHaveLength(1);
  });

  it("takes the section out with its last activity", () => {
    const original = withActivities();
    const result = fitToPage(original, { analysis: ANALYSIS, measure: fakeHeight, limit: limitWithRoomFor(original, 2) });

    expect(result.fits).toBe(true);
    expect(result.removed.map((line) => line.kind)).toEqual(["activity", "activity"]);
    expect(result.cv.sections.map((section) => section.kind)).toEqual(["experience", "education"]);
  });
});
