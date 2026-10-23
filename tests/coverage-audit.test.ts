import { describe, expect, it } from "vitest";
import { coverageAudit, summaryContradictions } from "@/lib/ai/verify";
import { cvDocumentSchema, type Coverage, type CVDocument } from "@/lib/schemas/cv";
import { requirementSchema, type Requirement } from "@/lib/schemas/job";
import { devProfile } from "./fixtures";

/**
 * The coverage report is the only thing the user reads to decide whether they are
 * a fit, and until this existed it graded its own homework. Two measured cases,
 * both from `public/cvexact-2026-08-17.json`:
 *
 *   a groundskeeping ad with 3 requirements → 10 rows, 8 covered, shown as 76%
 *   a waiting job with 2 requirements       → 8 rows, 6 covered, shown as 6/8
 *
 * The waiting job's real answer was 1 of 2, and the requirement it missed was the
 * excluding one.
 */

const req = (text: string, overrides: Partial<Requirement> = {}): Requirement =>
  requirementSchema.parse({ text, kind: "hard", ...overrides });

const row = (requirement: string, covered: boolean) => ({
  requirement,
  covered,
  evidence: "—",
  inferred: false,
});

function cv(requirements: Coverage["requirements"], summary = "Profesional responsable."): CVDocument {
  return cvDocumentSchema.parse({
    language: "es",
    header: { fullName: devProfile.fullName, location: "Rosario, Argentina" },
    summary,
    sections: [{ kind: "pairs", title: "DISPONIBILIDAD", items: [{ label: "Inglés", value: "Avanzado" }] }],
    coverage: { requirements, omitted: [] },
  });
}

describe("coverageAudit", () => {
  const posting = {
    requirements: [
      req("Experiencia previa en el puesto (excluyente)", { excluding: true }),
      req("Disponibilidad de jueves a domingo de 19:30hs al cierre"),
    ],
    responsibilities: [],
  };

  it("denominates in what the posting asks, not in what the report listed", () => {
    // The eight rows the real run came back with, six of them marked covered.
    const audit = coverageAudit(
      cv([
        row("Experiencia previa en el puesto de mozo/a", false),
        row("Disponibilidad de jueves a domingo de 19:30hs al cierre", true),
        row("Trabajo bajo presión en entornos dinámicos", true),
        row("Atención al cliente o servicio directo", false),
        row("Trabajo en equipo y coordinación de turnos", true),
        row("Seguimiento de procedimientos estandarizados", true),
        row("Precisión en tareas repetitivas", true),
        row("Flexibilidad horaria y disponibilidad para turnos rotativos", true),
      ]),
      posting,
    );

    expect(audit.total).toBe(2);
    expect(audit.genuinelyCovered).toBe(1);
    expect(audit.extra).toHaveLength(6);
  });

  it("keeps the posting's own wording and order as the spine", () => {
    const audit = coverageAudit(
      cv([row("Disponibilidad de jueves a domingo de 19:30hs al cierre", true)]),
      posting,
    );

    expect(audit.rows.map((r) => r.requirement)).toEqual([
      "Experiencia previa en el puesto (excluyente)",
      "Disponibilidad de jueves a domingo de 19:30hs al cierre",
    ]);
  });

  it("reads a requirement the report never mentioned as uncovered", () => {
    // Silence is not evidence. This row used to vanish from the panel entirely,
    // which read to the user as coverage.
    const audit = coverageAudit(cv([]), posting);

    expect(audit.rows.every((r) => r.entry === null)).toBe(true);
    expect(audit.genuinelyCovered).toBe(0);
    expect(audit.total).toBe(2);
  });

  it("carries the excluding flag through, so the panel can mark it", () => {
    const audit = coverageAudit(cv([]), posting);
    expect(audit.rows.map((r) => r.excluding)).toEqual([true, false]);
  });

  it("counts a responsibility as something the posting asked for", () => {
    const audit = coverageAudit(cv([row("Mantener los espacios verdes del predio", false)]), {
      requirements: [req("Experiencia en jardinería")],
      responsibilities: ["Mantener los espacios verdes del predio"],
    });

    expect(audit.extra).toEqual([]);
  });

  it("returns an empty audit for a posting with no requirements", () => {
    const audit = coverageAudit(cv([row("Algo", true)]), {
      requirements: [],
      responsibilities: [],
    });

    expect(audit).toMatchObject({ total: 0, genuinelyCovered: 0 });
    expect(audit.rows).toEqual([]);
  });
});

describe("summaryContradictions", () => {
  it("catches the summary claiming what the report concedes", () => {
    // Both halves of this came back in one response for a waiting job.
    expect(
      summaryContradictions(
        cv(
          [row("Atención al cliente o servicio directo", false)],
          "Profesional responsable y orientado al servicio, con experiencia en atención al cliente y trabajo en equipo.",
        ),
      ),
    ).toEqual(["Atención al cliente o servicio directo"]);
  });

  it("stays quiet when the report says the requirement is covered", () => {
    expect(
      summaryContradictions(
        cv(
          [row("Atención al cliente o servicio directo", true)],
          "Profesional con experiencia en atención al cliente y servicio directo.",
        ),
      ),
    ).toEqual([]);
  });

  it("stays quiet when the summary does not claim it", () => {
    expect(
      summaryContradictions(
        cv([row("Atención al cliente o servicio directo", false)], "Analista de sistemas recibido."),
      ),
    ).toEqual([]);
  });
});

/**
 * From the HTML-developer run: 5 checkable requirements and 7 personality
 * traits, of which the candidate met 3 checkable ones. The panel showed 3/12 —
 * a shortfall no CV could have closed, on an application worth sending.
 */
describe("coverageAudit — hard vs soft denominator", () => {
  const posting = {
    requirements: [
      req("Manejo intermedio de Git"),
      req("HTML5 Semántico", { excluding: true }),
      req("CSS3 y Responsive Design", { excluding: true }),
      req("Pensamiento visual y didáctico", { kind: "soft", excluding: true }),
      req("Atención al detalle", { kind: "soft", excluding: true }),
      req("Trabajo colaborativo", { kind: "soft" }),
    ],
    responsibilities: [],
    keywords: [],
  };

  const audit = coverageAudit(
    cv([
      row("Manejo intermedio de Git", true),
      row("HTML5 Semántico", false),
      row("CSS3 y Responsive Design", false),
      row("Pensamiento visual y didáctico", false),
      row("Atención al detalle", false),
      row("Trabajo colaborativo", true),
    ]),
    posting,
  );

  it("scores only what a CV can evidence", () => {
    expect(audit.hardCovered).toBe(1);
    expect(audit.hardTotal).toBe(3);
  });

  it("leaves the whole-posting numbers alone for tests/eval/score.ts", () => {
    expect(audit.genuinelyCovered).toBe(2);
    expect(audit.total).toBe(6);
  });

  it("still lists the traits as rows so the user sees them", () => {
    expect(audit.rows).toHaveLength(6);
    expect(audit.rows.filter((r) => r.kind === "soft")).toHaveLength(3);
  });
});
