import { describe, expect, it } from "vitest";
import {
  canMoveSection,
  commit,
  moveSection,
  parseFieldPath,
  removalCost,
  removeActivity,
  removeItemBullet,
  removePair,
  removeProject,
  removeSection,
  removeSectionBullet,
  setActivity,
  setItemBullet,
  setPair,
  setProject,
  setRole,
  setSummary,
} from "@/lib/cv/edit";
import { verifyCV } from "@/lib/ai/verify";
import { cvDocumentSchema, type CVDocument } from "@/lib/schemas/cv";
import { profileSchema } from "@/lib/schemas/profile";
import { devProfile } from "./fixtures";

/**
 * Editing exists because regenerating is a lottery: the same posting produced
 * one honest, thin run and one fuller run that had invented an availability, and
 * nothing chose between them. A one-line fix must not cost a model call.
 */

function cv(overrides: Partial<CVDocument> = {}): CVDocument {
  return cvDocumentSchema.parse({
    language: "es",
    header: { fullName: devProfile.fullName, location: "Rosario, Argentina" },
    summary: "Desarrollador con cuatro años de experiencia.",
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
            bullets: ["Desarrollé el panel de clientes.", "Bajé la carga de 4s a 1,2s."],
          },
        ],
      },
      {
        kind: "education",
        title: "EDUCACIÓN",
        items: [
          {
            institution: "Universidad Nacional de Rosario",
            degree: "Analista en Sistemas",
            location: "Rosario, Argentina",
            date: "2020",
            honors: "",
          },
        ],
      },
      { kind: "bullets", title: "SKILLS ADICIONALES", bullets: ["React y Git.", "Atención al público."] },
      { kind: "pairs", title: "DATOS", items: [{ label: "Disponibilidad", value: "Full time" }] },
    ],
    coverage: { requirements: [], omitted: [] },
    ...overrides,
  });
}

describe("parseFieldPath", () => {
  it("reads every shape the verifier emits", () => {
    expect(parseFieldPath("summary")).toEqual({ kind: "summary" });
    expect(parseFieldPath("sections[2]")).toEqual({ kind: "section", section: 2 });
    expect(parseFieldPath("sections[2].bullets[1]")).toEqual({
      kind: "sectionBullet",
      section: 2,
      bullet: 1,
    });
    expect(parseFieldPath("sections[3].items[0]")).toEqual({ kind: "pair", section: 3, item: 0 });
    expect(parseFieldPath("sections[0].items[0].bullets[1]")).toEqual({
      kind: "itemBullet",
      section: 0,
      item: 0,
      bullet: 1,
    });
    expect(parseFieldPath("sections[0].items[0].role")).toEqual({
      kind: "role",
      section: 0,
      item: 0,
    });
  });

  it("returns null for findings that are about the document, not a control", () => {
    for (const field of ["sections", "coverage", "header.email", "header.phone", "header.links"]) {
      expect(parseFieldPath(field)).toBeNull();
    }
  });

  it("returns null for an item field the editor does not expose", () => {
    expect(parseFieldPath("sections[0].items[0].company")).toBeNull();
    expect(parseFieldPath("sections[0].items[0].dateRange")).toBeNull();
  });
});

describe("edits", () => {
  it("leaves the original document untouched", () => {
    const original = cv();
    const before = JSON.stringify(original);
    setSummary(original, "Otro resumen.");
    removeSectionBullet(original, 2, 0);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("edits and removes a bullet inside a role", () => {
    expect(setItemBullet(cv(), 0, 0, 1, "Otra cosa.").sections[0]).toMatchObject({
      items: [{ bullets: ["Desarrollé el panel de clientes.", "Otra cosa."] }],
    });
    expect(removeItemBullet(cv(), 0, 0, 0).sections[0]).toMatchObject({
      items: [{ bullets: ["Bajé la carga de 4s a 1,2s."] }],
    });
  });

  it("puts the profile's own job title back", () => {
    expect(setRole(cv(), 0, 0, "Software Engineer").sections[0]).toMatchObject({
      items: [{ role: "Software Engineer" }],
    });
  });

  it("edits and removes a pairs row", () => {
    expect(setPair(cv(), 3, 0, { value: "Part time" }).sections[3]).toMatchObject({
      items: [{ label: "Disponibilidad", value: "Part time" }],
    });
    expect(removePair(cv(), 3, 0).sections[3]).toMatchObject({ items: [] });
  });

  it("ignores an edit aimed at the wrong kind of section", () => {
    const document = cv();
    expect(setItemBullet(document, 2, 0, 0, "x").sections[2]).toEqual(document.sections[2]);
  });

  it("ignores an index that does not exist", () => {
    const document = cv();
    expect(removeSection(document, 9)).toBe(document);
  });
});

describe("removalCost", () => {
  it("warns that removing the second bullet takes the section with it", () => {
    expect(removalCost(cv(), 2)).toEqual({ remaining: 1, minimum: 2, removesSection: true });
  });

  it("says nothing alarming while the section still clears its minimum", () => {
    const roomy = cv({
      sections: [
        ...cv().sections.slice(0, 2),
        {
          kind: "bullets",
          title: "SKILLS ADICIONALES",
          bullets: ["React y Git.", "Atención al público.", "Manejo de caja."],
        },
        cv().sections[3]!,
      ],
    });

    expect(removalCost(roomy, 2)).toEqual({ remaining: 2, minimum: 2, removesSection: false });
  });

  it("warns for the last item of an experience section too", () => {
    expect(removalCost(cv(), 0)).toEqual({ remaining: 0, minimum: 1, removesSection: true });
  });
});

describe("moveSection", () => {
  it("swaps a section with its neighbour", () => {
    expect(moveSection(cv(), 1, -1).sections.map((s) => s.kind)).toEqual([
      "education",
      "experience",
      "bullets",
      "pairs",
    ]);
  });

  it("refuses to move past the ends", () => {
    const document = cv();
    expect(moveSection(document, 0, -1)).toBe(document);
    expect(canMoveSection(document, 0, -1)).toBe(false);
  });

  /**
   * `cvDocumentSchema` puts `pairs` last on every parse, so an arrow that
   * appeared to move it would silently undo itself on the next commit.
   */
  it("never moves the pairs section, and never moves anything past it", () => {
    const document = cv();
    expect(moveSection(document, 3, -1)).toBe(document);
    expect(canMoveSection(document, 2, 1)).toBe(false);
  });
});

describe("commit", () => {
  it("accepts a normal edit", () => {
    const result = commit(setSummary(cv(), "Resumen nuevo, más corto."));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cv.summary).toBe("Resumen nuevo, más corto.");
  });

  it("rejects a bullet past the schema's cap instead of silently truncating", () => {
    const result = commit(setItemBullet(cv(), 0, 0, 0, "x".repeat(401)));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("sección");
  });

  it("drops a section the user emptied below its minimum", () => {
    const thin = removeSectionBullet(cv(), 2, 0);
    const result = commit(thin);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cv.sections.map((s) => s.kind)).toEqual([
      "experience",
      "education",
      "pairs",
    ]);
  });

  it("re-imposes the template's own rules, so the editor need not know them", () => {
    const renamed = { ...cv(), sections: cv().sections.map((s) => ({ ...s, title: "LO QUE SEA" })) };
    const result = commit(renamed as CVDocument);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cv.sections.map((s) => s.title)).toEqual([
        "EXPERIENCIA PROFESIONAL",
        "EDUCACIÓN",
        "SKILLS ADICIONALES",
        // Only the pairs heading is the user's to write.
        "LO QUE SEA",
      ]);
    }
  });

  /**
   * The commitment the generator was stopped from making must not survive
   * because a person typed it instead of a model.
   */
  it("re-imposes the profile's practical values on a hand-typed row", () => {
    const profile = profileSchema.parse({
      ...devProfile,
      practical: { ...devProfile.practical, availability: "Full time, Part time" },
    });
    const edited = setPair(cv(), 3, 0, { value: "Jueves a domingo, 19:30hs al cierre" });

    const result = commit(edited, profile);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const pairs = result.cv.sections.find((s) => s.kind === "pairs");
      expect(pairs).toMatchObject({ items: [{ value: "Full time, Part time" }] });
      // The row the user typed is no longer a commitment they never made. Other
      // findings about this fixture are none of this test's business.
      expect(verifyCV(result.cv, profile).filter((f) => f.detail.includes("Jueves"))).toEqual([]);
    }
  });

  it("leaves the row alone when no profile is supplied", () => {
    const result = commit(setPair(cv(), 3, 0, { value: "Lo que quiera" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cv.sections.find((s) => s.kind === "pairs")).toMatchObject({
        items: [{ value: "Lo que quiera" }],
      });
    }
  });
});

describe("projects", () => {
  const withProjects = () => {
    const base = cv();
    return cvDocumentSchema.parse({
      ...base,
      sections: [
        base.sections[0],
        {
          kind: "projects",
          title: "PROYECTOS",
          items: [
            { ref: "P1", name: "Sistema de turnos", description: "Agenda para una clínica.", url: "https://github.com/perfil-ejemplo/turnos" },
            { ref: "P2", name: "Planilla de gastos", description: "", url: "" },
          ],
        },
        base.sections[3],
      ],
    });
  };

  it("knows where a finding about a project's description points", () => {
    expect(parseFieldPath("sections[1].items[0].description")).toEqual({ kind: "projectDescription", section: 1, item: 0 });
  });

  it("edits the description and nothing else of the project", () => {
    expect(setProject(withProjects(), 1, 0, "Otra descripción.").sections[1]).toMatchObject({
      items: [
        { ref: "P1", name: "Sistema de turnos", description: "Otra descripción.", url: "https://github.com/perfil-ejemplo/turnos" },
        { name: "Planilla de gastos" },
      ],
    });
  });

  it("removes a project, and the section goes with the last one", () => {
    const one = removeProject(withProjects(), 1, 0);
    expect(one.sections[1]).toMatchObject({ items: [{ name: "Planilla de gastos" }] });
    expect(removalCost(one, 1)).toEqual({ remaining: 0, minimum: 1, removesSection: true });

    const result = commit(removeProject(one, 1, 0));
    expect(result.ok && result.cv.sections.map((section) => section.kind)).toEqual(["experience", "pairs"]);
  });

  it("ignores an edit aimed at a section that is not projects", () => {
    const document = withProjects();
    expect(setProject(document, 0, 0, "x").sections[0]).toEqual(document.sections[0]);
    expect(removeProject(document, 2, 0).sections[2]).toEqual(document.sections[2]);
  });

  it("holds a description to the lengths the page has room for", () => {
    const result = commit(setProject(withProjects(), 1, 0, "x".repeat(301)));
    expect(result.ok).toBe(false);
  });
});

describe("activities", () => {
  const withActivities = () => {
    const base = cv();
    return cvDocumentSchema.parse({
      ...base,
      sections: [
        base.sections[0],
        { kind: "activities", title: "ACTIVIDADES", items: [{ ref: "O1", text: "Presido el Club de Robótica." }, { ref: "O2", text: "Doy clases de apoyo." }] },
        base.sections[3],
      ],
    });
  };

  it("knows where a finding about an activity's text points", () => {
    expect(parseFieldPath("sections[1].items[0].text")).toEqual({ kind: "activityText", section: 1, item: 0 });
  });

  it("edits the text and nothing else of the activity", () => {
    expect(setActivity(withActivities(), 1, 1, "Doy clases a chicos del barrio.").sections[1]).toMatchObject({
      items: [{ ref: "O1", text: "Presido el Club de Robótica." }, { ref: "O2", text: "Doy clases a chicos del barrio." }],
    });
  });

  it("removes an activity, and the section goes with the last one", () => {
    const one = removeActivity(withActivities(), 1, 0);
    expect(one.sections[1]).toMatchObject({ items: [{ ref: "O2" }] });
    expect(removalCost(one, 1)).toEqual({ remaining: 0, minimum: 1, removesSection: true });

    const result = commit(removeActivity(one, 1, 0));
    expect(result.ok && result.cv.sections.map((section) => section.kind)).toEqual(["experience", "pairs"]);
  });

  it("ignores an edit aimed at a section that is not activities", () => {
    const document = withActivities();
    expect(setActivity(document, 0, 0, "x").sections[0]).toEqual(document.sections[0]);
    expect(removeActivity(document, 2, 0).sections[2]).toEqual(document.sections[2]);
  });
});
