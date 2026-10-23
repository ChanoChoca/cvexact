import { describe, expect, it } from "vitest";
import { approximateFigures, figureMentions, saidApproximately, scaleMentions, statedFigures } from "@/lib/ai/evidence";
import { cvGaps, droppedApproximations, gapCount, inventedFigures, selfAssessedTraits, verifyCV } from "@/lib/ai/verify";
import { cvDocumentSchema, type CVDocument } from "@/lib/schemas/cv";
import type { JobAnalysis } from "@/lib/schemas/job";
import { devProfile } from "./fixtures";

/**
 * The profile is the only place a figure may come from. Every other check here asks whether the CV claimed too much; a CV
 * that writes «reduje los costos un 40 %» when nobody typed 40 passes all of them — and is the line a recruiter asks
 * about. These are the cases where a number is the CV's own, and the ones where saying so would tell a person their CV
 * lies when it does not.
 */

const EDUCATION = {
  kind: "education" as const,
  title: "EDUCACIÓN",
  items: [{ institution: "Universidad Nacional de Rosario", degree: "Analista en Sistemas", location: "Rosario, Argentina", date: "2020", honors: "" }],
};

const SKILLS = {
  kind: "bullets" as const,
  title: "HABILIDADES",
  bullets: [
    "React, TypeScript y Git.",
    "Optimización de bundles y tiempos de carga.",
    "Trabajo por sprints con diseño y backend.",
    "Atención al público y manejo de caja.",
    "Control de stock y reposición de mercadería.",
    "Voluntariado en un comedor comunitario.",
    "Coordinación con diseño para cada entrega.",
    "Manejo de caja en turnos de ocho horas.",
  ],
};

/** A CV whose second line is `bullet`, and whose summary is `summary`. */
function cv(bullet: string, summary = "Desarrollador con cuatro años de experiencia."): CVDocument {
  return cvDocumentSchema.parse({
    language: "es",
    header: { fullName: devProfile.fullName, location: "Rosario, Argentina", phone: devProfile.phone, email: devProfile.email, links: devProfile.links },
    summary,
    sections: [
      {
        kind: "experience",
        title: "EXPERIENCIA PROFESIONAL",
        items: [
          {
            company: "Talleres Digitales SRL",
            role: "Desarrollador Frontend",
            location: "Rosario, Argentina",
            dateRange: "Marzo 2021 – Agosto 2024",
            bullets: ["Desarrollé la interfaz del panel de clientes.", bullet],
          },
        ],
      },
      EDUCATION,
      SKILLS,
    ],
    coverage: { requirements: [], omitted: [] },
  });
}

const BULLET = "sections[0].items[0].bullets[1]";
const KEPT = "Bajé la carga inicial de 4s a 1,2s recortando el bundle.";
const invented = (bullet: string, summary?: string, analysis?: Partial<JobAnalysis>) => inventedFigures(cv(bullet, summary), devProfile, analysis);

describe("a number the CV made up", () => {
  it("is one the profile never states, said where it is and in the CV's own way of writing it", () => {
    expect(invented("Reduje los costos operativos un 40 % en el primer semestre.")).toEqual([
      { raw: "40 %", figure: "40%", field: BULLET, line: "Reduje los costos operativos un 40 % en el primer semestre." },
    ]);
  });

  it("is found in the summary as well, and in the lines of a list", () => {
    const text = cv(KEPT, "Desarrollador que atendió a más de 300 clientes.");
    expect(inventedFigures(text, devProfile).map((found) => [found.field, found.figure])).toEqual([["summary", "300"]]);
  });

  it("is not one the profile states — as it was typed, or as the CV writes it", () => {
    expect(invented(KEPT)).toEqual([]);
    // «1,2s» in the profile, «1.2» as a decimal in the CV: the same figure.
    expect(invented("Bajé la carga a 1.2s optimizando el bundle.")).toEqual([]);
  });

  it("is not a year: the dates are the profile's", () => {
    expect(invented("Desde 2022 lideré la migración del panel de clientes.")).toEqual([]);
  });

  it("is not a length of time: the dates say it, and the claim of seniority has a check of its own", () => {
    expect(invented("Sostuve el panel de clientes durante 3 años y 8 meses.")).toEqual([]);
    expect(invented("Más de 5+ years de experiencia con React.")).toEqual([]);
  });

  it("is not the number one: a singular is not a quantity", () => {
    expect(invented("Administré 1 servidor de pruebas para el equipo.")).toEqual([]);
  });

  it("is not a date, which says several numbers and none of them is a quantity", () => {
    expect(invented("Entregué el panel el 12/03/2023 y lo mantuve desde 03/2023.")).toEqual([]);
  });

  it("is not a figure the posting itself states", () => {
    const analysis = { requirements: [{ text: "Experiencia con Java 17 y equipos de hasta 15 personas", kind: "hard" as const, excluding: false }] };
    expect(invented("Coordiné un equipo de 15 personas sobre Java 17.")).toHaveLength(2);
    expect(invented("Coordiné un equipo de 15 personas sobre Java 17.", undefined, analysis)).toEqual([]);
  });

  it("is not a number the profile writes in words", () => {
    // «dos diseñadores» in the profile.
    expect(invented("Coordiné con 2 diseñadores cada sprint.")).toEqual([]);
    expect(invented("Coordiné con 3 diseñadores cada sprint.")).toHaveLength(1);
  });

  it("is not the same number in shorthand, or with a percent sign the profile did not use", () => {
    const profile = { ...devProfile, about: "Atendí 10 mil usuarios y reduje los tiempos en 35 por ciento." };
    const read = (bullet: string) => inventedFigures(cv(bullet), profile);
    expect(read("Atendí 10.000 usuarios.")).toEqual([]);
    expect(read("Atendí 10k usuarios.")).toEqual([]);
    expect(read("Reduje los tiempos un 35%.")).toEqual([]);
    expect(read("Reduje los tiempos un 36%.")).toHaveLength(1);
  });

  it("is not the profile's own phone number, if a line repeats it", () => {
    expect(invented("Disponible al +54 341 555 0100 en horario comercial.")).toEqual([]);
  });

  it("is not a letter-and-digit name — a technology, a licence, a language level", () => {
    expect(invented("Trabajé con S3, EC2 y OAuth2, con nivel B2 de inglés y licencia B1.")).toEqual([]);
  });

  it("is told once for each figure in each line, and again in another line", () => {
    const text = cv("Cerré 25 proyectos: 25 en tiempo y forma.", "Entregué 25 proyectos.");
    expect(inventedFigures(text, devProfile).map((found) => [found.field, found.figure])).toEqual([
      ["summary", "25"],
      [BULLET, "25"],
    ]);
  });
});

describe("what the check says", () => {
  const BAD = "Reduje los costos operativos un 40 % en el primer semestre.";

  it("is an error for each figure, with the figure as the CV wrote it and what to do", () => {
    const findings = verifyCV(cv(BAD), devProfile).filter((finding) => finding.kind === "invented_figure");
    expect(findings).toEqual([
      {
        severity: "error",
        field: BULLET,
        kind: "invented_figure",
        detail: "El CV dice «40 %», una cifra que no figura en tu perfil. Si es real, cargala; si no, sacala.",
      },
    ]);
  });

  it("is nothing for a CV whose numbers are all the profile's", () => {
    expect(verifyCV(cv(KEPT), devProfile).filter((finding) => finding.kind === "invented_figure")).toEqual([]);
  });

  it("is a gap the retry is told about, once for each figure, and that counts against an attempt", () => {
    const gaps = cvGaps(cv("Reduje costos un 40 % y cerré 25 proyectos; el 40 % fue en el primer semestre."), devProfile);
    expect(gaps.inventedFigures).toEqual(["40%", "25"]);
    expect(gapCount(gaps)).toBeGreaterThanOrEqual(2);
    const clean = cvGaps(cv(KEPT), devProfile);
    expect(clean.inventedFigures).toEqual([]);
    expect(gapCount(clean)).toBeLessThan(gapCount(gaps));
  });
});

describe("the figures a profile states", () => {
  it("are its digits, its number words and its counts of thousands, each way a CV writes them", () => {
    const stated = statedFigures(["Equipo de cinco personas, 10 mil usuarios, 1,5 millones de pesos, 35 por ciento de ahorro", "Atendí 2.500 clientes"]);
    for (const figure of ["5", "10000", "10", "1500000", "1.5", "35%", "35", "2500"]) expect(stated.has(figure)).toBe(true);
    expect(stated.has("36")).toBe(false);
    expect(stated.has("7")).toBe(false);
  });

  it("say a million the short way, too: «1.500.000» is «1.5M»", () => {
    const stated = statedFigures(["Facturé 1.500.000 pesos por año"]);
    expect(stated.has("1500000")).toBe(true);
    expect(stated.has("1.5")).toBe(true);
    expect(stated.has("15")).toBe(false);
  });

  it("do not make «un» or «una» a figure", () => {
    expect([...statedFigures(["Un equipo y una oficina"])]).toEqual([]);
  });

  it("are read from a text with where each one stands", () => {
    const mentions = figureMentions("Reduje costos un 40 % en 2020 (24/7).");
    expect(mentions.map((mention) => mention.figure)).toEqual(["40%", "2020", "24", "7"]);
    expect(mentions[0]).toMatchObject({ raw: "40 %", index: 17 });
  });
});

describe("a quantity said in words (VAL-5)", () => {
  it("is read where it stands, and not when a number counts it", () => {
    expect(scaleMentions("Usan cientos de estudiantes y miles de docentes").map((mention) => mention.figure)).toEqual(["cientos", "miles"]);
    expect(scaleMentions("Usan 10 millones de personas, dos mil escuelas y 3 millones más")).toEqual([]);
    expect(scaleMentions("Hundreds of schools, thousands of teachers, dozens of tools, millions of rows").map((mention) => mention.figure)).toEqual(["hundreds", "thousands", "dozens", "millions"]);
  });

  it("is licensed by a text that says it, with or without a count in front", () => {
    const stated = statedFigures(["Usamos miles de eventos por hora", "Facturé 10 millones"]);
    expect(stated.has("miles")).toBe(true);
    expect(stated.has("millones")).toBe(true);
    expect(stated.has("cientos")).toBe(false);
  });

  it("is an invented figure when nobody said it, once each, and carries the word as the CV wrote it", () => {
    const found = inventedFigures(cv("Armé pantallas que usan Cientos de estudiantes y cientos de docentes."), devProfile);
    expect(found.map(({ raw, figure }) => [raw, figure])).toEqual([["Cientos", "cientos"]]);
  });

  it("counts for the retry like any other invented figure", () => {
    const gaps = cvGaps(cv("Armé pantallas para cientos de estudiantes."), devProfile);
    expect(gaps.inventedFigures).toEqual(["cientos"]);
  });

  it("is a warning, with no retry, for «múltiples» and «numerosos», unless the profile says it", () => {
    const found = verifyCV(cv("Armé múltiples pantallas para numerosos clientes."), devProfile).filter((finding) => finding.detail.includes("cantidad"));
    expect(found.map((finding) => finding.severity)).toEqual(["warning", "warning"]);
    const said = { ...devProfile, about: "Trabajé en múltiples proyectos para numerosos clientes." };
    expect(verifyCV(cv("Armé múltiples pantallas para numerosos clientes."), said).filter((finding) => finding.detail.includes("cantidad"))).toEqual([]);
  });
});

describe("an estimate stated as a fact (VAL-4)", () => {
  it("is read from the profile only where every mention carries the word", () => {
    const estimated = approximateFigures(["Redujo el abandono — aprox. 12 %", "Atendí 40 clientes", "Fueron aprox. 40 al mes", "Bajó ~5 % el costo"]);
    expect([...estimated].sort()).toEqual(["12", "12%", "5", "5%"]);
  });

  it("is said before the number, after it, or a few words ahead of it when the CV is the one read", () => {
    const at = (text: string) => figureMentions(text).find((mention) => mention.figure.startsWith("12"))!;
    for (const text of ["aprox. 12 %", "~12 %", "alrededor de un 12 %", "12 % aprox.", "aproximadamente 12 %", "approx. 12%", "around 12%"]) {
      expect(saidApproximately(text, at(text))).toBe(true);
    }
    expect(saidApproximately("Redujo el abandono un 12 %", at("Redujo el abandono un 12 %"))).toBe(false);
    const loose = "aproximadamente un tercio de los pedidos, un 12 %";
    expect(saidApproximately(loose, at(loose))).toBe(false);
    const near = "aproximadamente un 12 %";
    expect(saidApproximately(near, at(near), true)).toBe(true);
  });

  const withEstimate = { ...devProfile, experience: [{ ...devProfile.experience[0]!, bullets: [...devProfile.experience[0]!.bullets, "Bajó el abandono del checkout — aprox. 12 %"] }] };

  it("is flagged where the CV states the figure flat, once each, and not where it keeps the word", () => {
    expect(droppedApproximations(cv("Bajé el abandono del checkout un 12 %."), withEstimate).map(({ raw, figure }) => [raw, figure])).toEqual([["12 %", "12%"]]);
    expect(droppedApproximations(cv("Bajé el abandono del checkout aprox. un 12 %."), withEstimate)).toEqual([]);
    expect(droppedApproximations(cv("Bajé el abandono del checkout ~12 %."), withEstimate)).toEqual([]);
  });

  it("is not a figure the profile gives exactly, a year, or a length of time", () => {
    const exact = { ...withEstimate, about: "Fue un 12 % exacto, medido." };
    expect(droppedApproximations(cv("Bajé el abandono del checkout un 12 %."), exact)).toEqual([]);
    expect(droppedApproximations(cv("Trabajé 12 años en el sector."), withEstimate)).toEqual([]);
  });

  it("is an error that costs a retry", () => {
    const flat = cv("Bajé el abandono del checkout un 12 %.");
    expect(verifyCV(flat, withEstimate).filter((finding) => finding.severity === "error").map((finding) => finding.detail)).toContain("El CV dice «12 %» sin «aprox.»: en tu perfil es una estimación. Agregale «aprox.» o sacala.");
    expect(gapCount(cvGaps(flat, withEstimate))).toBeGreaterThan(gapCount(cvGaps(cv("Bajé el abandono del checkout aprox. un 12 %."), withEstimate)));
  });
});

describe("what a candidate says of themselves (VAL-6)", () => {
  const summaryOf = (summary: string) => ({ ...cv("Armé el panel de clientes."), summary });

  it("is read in the summary and in a list of skills, once each, in both languages", () => {
    expect(selfAssessedTraits(summaryOf("Desarrollador proactivo y apasionado, orientado a resultados."))).toEqual(["proactivo/a", "orientado/a a resultados", "apasionado/a"]);
    expect(selfAssessedTraits(summaryOf("Passionate team player, detail-oriented and results-driven. Great synergy."))).toEqual(["sinergia", "team player", "detail-oriented", "results-driven", "passionate"]);
  });

  it("is not read in a job's line, where it may be a thing that was done, or in a word that means something else", () => {
    expect(selfAssessedTraits(summaryOf("Desarrollador de sitios web dinámicos."))).toEqual([]);
    expect(selfAssessedTraits(cv("Sostuve el trabajo en equipo con diseño en ciclos de dos semanas."))).toEqual([]);
  });
});
