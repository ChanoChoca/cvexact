import { describe, expect, it } from "vitest";
import { inventedFigures } from "@/lib/ai/verify";
import { roleForField, withoutFigureLine } from "@/lib/cv/invented";
import { cvDocumentSchema, type CVDocument } from "@/lib/schemas/cv";
import { devProfile } from "./fixtures";

/**
 * What can be done about a number the CV made up: take its line out, or say it is real and ask where. Both read the CV on the
 * page, and neither guesses — a line that is not a thing to take out (the whole summary, a list that would lose its section)
 * is left for the person's own hands.
 */

const SKILLS = (bullets: string[]) => ({ kind: "bullets" as const, title: "HABILIDADES", bullets });
const FILL = ["React, TypeScript y Git.", "Optimización de bundles y tiempos de carga.", "Trabajo por sprints con diseño y backend.", "Atención al público y manejo de caja.", "Control de stock y reposición de mercadería.", "Voluntariado en un comedor comunitario."];

function cv(overrides: { summary?: string; bullets?: string[]; skills?: string[]; company?: string } = {}): CVDocument {
  return cvDocumentSchema.parse({
    language: "es",
    header: { fullName: devProfile.fullName, location: "Rosario, Argentina", phone: devProfile.phone, email: devProfile.email, links: devProfile.links },
    summary: overrides.summary ?? "Desarrollador con cuatro años de experiencia.",
    sections: [
      {
        kind: "experience",
        title: "EXPERIENCIA PROFESIONAL",
        items: [
          {
            company: overrides.company ?? "Talleres Digitales SRL",
            role: "Desarrollador Frontend",
            location: "Rosario, Argentina",
            dateRange: "Marzo 2021 – Agosto 2024",
            bullets: overrides.bullets ?? ["Desarrollé la interfaz del panel de clientes.", "Reduje los costos un 40 % en el primer semestre."],
          },
        ],
      },
      {
        kind: "education",
        title: "EDUCACIÓN",
        items: [{ institution: "Universidad Nacional de Rosario", degree: "Analista en Sistemas", location: "Rosario, Argentina", date: "2020", honors: "" }],
      },
      SKILLS(overrides.skills ?? FILL),
    ],
    coverage: { requirements: [], omitted: [] },
  });
}

describe("taking out the line a figure is in", () => {
  it("removes a bullet of a job", () => {
    const text = cv();
    const [found] = inventedFigures(text, devProfile);
    const next = withoutFigureLine(text, found!.field, found!.figure)!;
    const section = next.sections[0]!;
    expect(section.kind === "experience" && section.items[0]!.bullets).toEqual(["Desarrollé la interfaz del panel de clientes."]);
    expect(inventedFigures(next, devProfile)).toEqual([]);
  });

  it("removes the sentence of the summary the figure is in, and not the whole summary", () => {
    const text = cv({ summary: "Desarrollador con cuatro años de experiencia. Atendí a más de 300 clientes en el último año. Me gusta el trabajo en equipo." });
    const [found] = inventedFigures(text, devProfile);
    expect(found!.field).toBe("summary");
    expect(withoutFigureLine(text, "summary", found!.figure)!.summary).toBe("Desarrollador con cuatro años de experiencia. Me gusta el trabajo en equipo.");
  });

  it("finds the sentence of a quantity said in words as it does one said in digits (VAL-5)", () => {
    const text = cv({ summary: "Desarrollador con cuatro años de experiencia. Armé pantallas para cientos de estudiantes. Me gusta el trabajo en equipo." });
    const [found] = inventedFigures(text, devProfile);
    expect(found!.figure).toBe("cientos");
    expect(withoutFigureLine(text, "summary", found!.figure)!.summary).toBe("Desarrollador con cuatro años de experiencia. Me gusta el trabajo en equipo.");
  });

  it("does not take out the summary when the figure is all it says", () => {
    expect(withoutFigureLine(cv({ summary: "Atendí a más de 300 clientes." }), "summary", "300")).toBeNull();
  });

  it("does not match a longer number for the sentence: «40» is not in «140»", () => {
    const text = cv({ summary: "Tuve 140 clientes. Cerré 40 proyectos." });
    expect(withoutFigureLine(text, "summary", "40")!.summary).toBe("Tuve 140 clientes.");
  });

  it("removes a line of a list while it keeps its minimum, and leaves a list that would lose its section", () => {
    const text = cv({ skills: [...FILL, "Gestión de 20 proveedores locales."] });
    const found = inventedFigures(text, devProfile).find((entry) => entry.figure === "20")!;
    const next = withoutFigureLine(text, found.field, found.figure)!;
    const section = next.sections[2]!;
    expect(section.kind === "bullets" && section.bullets).toHaveLength(FILL.length);
  });

  it("removes a labelled line of the short facts, as a pair", () => {
    const base = cv({ bullets: ["Desarrollé la interfaz del panel de clientes.", "Bajé la carga inicial de 4s a 1,2s recortando el bundle."] });
    const text = cvDocumentSchema.parse({
      ...base,
      sections: [
        ...base.sections,
        { kind: "pairs", title: "DISPONIBILIDAD", items: [{ label: "Disponibilidad", value: "40 horas semanales" }, { label: "Carnet", value: "B1" }] },
      ],
    });
    const found = inventedFigures(text, devProfile).find((entry) => entry.figure === "40")!;
    expect(found.field).toMatch(/^sections\[\d+\]\.items\[0\]$/);
    const next = withoutFigureLine(text, found.field, found.figure)!;
    const pairs = next.sections.find((section) => section.kind === "pairs");
    expect(pairs?.kind === "pairs" && pairs.items.map((item) => item.label)).toEqual(["Carnet"]);
  });

  it("removes a project whose description states a number nobody gave", () => {
    const base = cv();
    const text = cvDocumentSchema.parse({
      ...base,
      sections: [
        ...base.sections,
        { kind: "projects", title: "PROYECTOS", items: [{ ref: "P1", name: "Sistema de turnos", description: "Lo usan 300 pacientes.", url: "" }, { ref: "P2", name: "Planilla", description: "", url: "" }] },
      ],
    });
    const found = inventedFigures(text, devProfile).find((entry) => entry.figure === "300")!;
    expect(found.field).toMatch(/^sections\[\d+\]\.items\[0\]\.description$/);
    const next = withoutFigureLine(text, found.field, found.figure)!;
    const projects = next.sections.find((section) => section.kind === "projects");
    expect(projects?.kind === "projects" && projects.items.map((item) => item.name)).toEqual(["Planilla"]);
  });

  it("leaves a list that would lose its whole section for one number: that is for the person to decide", () => {
    // Two lines is the least a list may have (`SECTION_MINIMUM`): taking one out takes the section with it.
    const text = cv({ skills: ["React, TypeScript y Git.", "Gestión de 20 proveedores locales."] });
    const found = inventedFigures(text, devProfile).find((entry) => entry.figure === "20")!;
    expect(found.field).toBe("sections[2].bullets[1]");
    expect(withoutFigureLine(text, found.field, found.figure)).toBeNull();
  });

  it("is nothing for a field it cannot point to", () => {
    expect(withoutFigureLine(cv(), "sections", "40%")).toBeNull();
    expect(withoutFigureLine(cv(), "header.email", "40%")).toBeNull();
  });
});

describe("the job a figure is about", () => {
  it("is the one the line's own entry names, however the company is written", () => {
    const text = cv({ company: "Talleres Digitales" });
    const field = "sections[0].items[0].bullets[1]";
    expect(roleForField(text, devProfile, field)).toBe("e1");
  });

  it("is, for the summary, the job the CV drew most from", () => {
    expect(roleForField(cv(), devProfile, "summary")).toBe("e1");
  });
});
