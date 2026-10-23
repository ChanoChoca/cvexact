import { applicationSchema, type Application } from "@/lib/storage/application";
import { cvDocumentSchema, type CVDocument } from "@/lib/schemas/cv";
import { jobAnalysisSchema } from "@/lib/schemas/job";
import type { FitAnalysis } from "@/lib/cv/fit";
import type { FitStore } from "@/lib/applications/fit";
import type { SaveOutcome } from "@/lib/storage/applications/store";

/**
 * The page the fitting tests work on, measured by hand.
 *
 * `measure` is injected precisely so these can be arithmetic: ⌈characters/105⌉
 * lines per bullet (§8), every line the same height, the page the sum of them.
 * What the browser measures differs in every digit and agrees in every decision
 * — which is the part under test.
 */

export const LINE_PX = 20;
const CHARS_PER_LINE = 105;

export const wrap = (text: string) => Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));

export function fakeLines(cv: CVDocument): number {
  let lines = cv.summary ? wrap(cv.summary) : 0;
  for (const section of cv.sections) {
    lines += 1; // the heading
    if (section.kind === "bullets") {
      lines += section.bullets.reduce((total, bullet) => total + wrap(bullet), 0);
      continue;
    }
    if (section.kind === "pairs" || section.kind === "projects" || section.kind === "activities") {
      lines += section.items.length;
      continue;
    }
    if (section.kind === "experience") {
      for (const item of section.items) {
        lines += 2 + (item.note ? 1 : 0) + item.bullets.reduce((total, bullet) => total + wrap(bullet), 0);
      }
      continue;
    }
    for (const item of section.items) {
      lines += 2 + (item.honors ? 1 : 0);
    }
  }
  return lines;
}

export const fakeHeight = (cv: CVDocument) => fakeLines(cv) * LINE_PX;

/** A limit that leaves exactly `lines` of the CV having to go. */
export const limitWithRoomFor = (cv: CVDocument, lines: number) => (fakeLines(cv) - lines) * LINE_PX;

/** The measurer the engine and the flow both take: measure by lines, no layout needed. */
export const fakeMeasurer = {
  measure: (cv: CVDocument) => fakeHeight(cv),
  /**
   * One full line per bullet. The fake has nothing to say about how a line wraps
   * — that is what the DOM measurement is there for — so every tail is full and
   * only the longest lines look worth rewriting. The order is the document's own,
   * which is what the real measurer's `<li>` walk produces.
   */
  layout: (cv: CVDocument) => ({
    bullets: cv.sections.flatMap((section) => {
      if (section.kind === "bullets") {
        return section.bullets.map(() => ({ lines: 1, tailRatio: 1 }));
      }
      if (section.kind !== "experience") return [];
      return section.items.flatMap((item) => item.bullets.map(() => ({ lines: 1, tailRatio: 1 })));
    }),
  }),
};

/* --- The CV the tests fit --------------------------------------------------- */

export const SQL_BULLET = "Consultas SQL y tableros para el equipo comercial.";
export const REPEATED = "Preparo los informes mensuales de ventas para dirección.";
export const REPEATED_OLDER = "Preparo los informes mensuales de ventas para la dirección.";
export const FIGURE_40 = "Reduje los costos un 40 % en el semestre.";
export const FIGURE_25 = "Reduje los costos un 25 % en el semestre.";
export const FIGURE_SKILL = "Gestión de 20 proveedores locales.";
export const PLAIN_SKILL = "Trabajo en equipo y comunicación.";
export const EXPECTED_ATTENDANCE = "Atiendo consultas del equipo comercial todos los días.";

export function page(
  overrides: { summary?: string; firstBullets?: string[]; olderBullets?: string[]; skills?: string[] } = {},
): CVDocument {
  return cvDocumentSchema.parse({
    language: "es",
    header: {
      fullName: "Ana Pérez",
      location: "Rosario, Argentina",
      phone: "+54 341 555 1234",
      email: "ana@example.com",
      links: [],
    },
    summary:
      overrides.summary ??
      "Analista de datos con seis años de experiencia en retail. Trabajé con equipos comerciales. Me interesa seguir creciendo.",
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
            bullets: overrides.firstBullets ?? [SQL_BULLET, REPEATED, EXPECTED_ATTENDANCE],
          },
          {
            company: "Grupo Lumen",
            role: "Asistente administrativa",
            location: "Rosario, Argentina",
            dateRange: "septiembre 2018 – febrero 2021",
            bullets: overrides.olderBullets ?? [REPEATED_OLDER, "Control de stock y reposición de mercadería."],
          },
          {
            company: "Almacén Sur",
            role: "Cajera",
            location: "Rosario, Argentina",
            dateRange: "2016 – 2018",
            bullets: ["Atención al público y manejo de caja."],
          },
          {
            company: "Kiosco Norte",
            role: "Vendedora",
            location: "Rosario, Argentina",
            dateRange: "2014 – 2016",
            bullets: ["Reposición de mercadería y control de vencimientos."],
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
            honors: "Promedio 8,5",
          },
          {
            institution: "Escuela Técnica",
            degree: "Técnica en Administración",
            location: "Rosario, Argentina",
            date: "2013",
            honors: "",
          },
        ],
      },
      {
        kind: "bullets",
        title: "SKILLS ADICIONALES",
        bullets: overrides.skills ?? ["SQL, Power BI y Excel avanzado.", FIGURE_SKILL, PLAIN_SKILL],
      },
      {
        kind: "pairs",
        title: "IDIOMAS Y LICENCIAS",
        items: [
          { label: "Inglés", value: "B2" },
          { label: "Licencia de conducir", value: "B1 vigente" },
        ],
      },
    ],
    coverage: {
      requirements: [
        { requirement: "Manejo de SQL", covered: true, evidence: SQL_BULLET, inferred: false },
        {
          requirement: "Licencia de conducir B1",
          covered: true,
          evidence: "Licencia de conducir: B1 vigente",
          inferred: false,
        },
      ],
      omitted: [],
    },
  });
}

export const ANALYSIS: FitAnalysis = {
  keywords: ["SQL", "Power BI", "atención al público", "stock", "informes"],
  requirements: [
    { text: "Manejo de SQL", kind: "hard", excluding: false },
    { text: "Licencia de conducir B1", kind: "hard", excluding: true },
  ],
  responsibilities: [],
};

/**
 * The posting as the application stores it: `JobAnalysis`, which is a `FitAnalysis` structurally.
 */
export const POSTING = jobAnalysisSchema.parse({
  title: "Analista de datos",
  company: "Nubia Retail",
  language: "es",
  domain: "data",
  relevance: "direct",
  relevanceReason: "Pide SQL y tableros, que es lo que la persona hace.",
  requirements: [
    { text: "Manejo de SQL", kind: "hard", excluding: false },
    { text: "Licencia de conducir B1", kind: "hard", excluding: true },
  ],
  responsibilities: ["Armar los tableros del equipo comercial."],
  keywords: ANALYSIS.keywords,
});

export function application(overrides: Partial<Application> = {}): Application {
  return applicationSchema.parse({
    id: "app-1",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    jobText: "Aviso de puesto: analista de datos con SQL, tableros y licencia de conducir B1.",
    label: "Analista de datos · Nubia Retail",
    analysis: POSTING,
    cv: page(),
    findings: [],
    ...overrides,
  });
}

/**
 * A page with one long line and one short one: the long one wraps into two lines
 * in the fake measurement (105 characters each), so a rewrite of it that fits in
 * one line is a line gained — which is what Etapa 2 is for.
 */
export const WRAPPED_BULLET =
  "Preparé los informes mensuales de ventas para la dirección comercial del equipo durante todo el año, con reportes semanales.";
export const SHORTENED_BULLET = "Preparé los informes de ventas de dirección durante el año pasado.";

export function longLinePage(): CVDocument {
  return cvDocumentSchema.parse({
    language: "es",
    header: {
      fullName: "Ana Pérez",
      location: "Rosario, Argentina",
      phone: "+54 341 555 1234",
      email: "ana@example.com",
      links: [],
    },
    summary: "",
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
            bullets: [WRAPPED_BULLET, "Atiendo consultas del equipo comercial."],
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

/**
 * The smallest page that still states the excluding requirement: one job with
 * one line (which the floors keep), one study, and the licence as the only row
 * of `pairs`.
 *
 * Everything on it but the licence is protected — the 1st line of the 1st job,
 * the most recent study, and a one-line job's only line — so at `extreme` the
 * only thing that can go is the `T5` row. That is what makes the «evidence went
 * out» path reachable in a test at all.
 */
export function thinPage(): CVDocument {
  return cvDocumentSchema.parse({
    language: "es",
    header: {
      fullName: "Ana Pérez",
      location: "Rosario, Argentina",
      phone: "+54 341 555 1234",
      email: "ana@example.com",
      links: [],
    },
    summary: "",
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
            bullets: [SQL_BULLET],
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
      {
        kind: "pairs",
        title: "LICENCIAS",
        items: [{ label: "Licencia de conducir", value: "B1 vigente" }],
      },
    ],
    coverage: {
      requirements: [
        { requirement: "Manejo de SQL", covered: true, evidence: SQL_BULLET, inferred: false },
        {
          requirement: "Licencia de conducir B1",
          covered: true,
          evidence: "Licencia de conducir: B1 vigente",
          inferred: false,
        },
      ],
      omitted: [],
    },
  });
}

/* --- A store that behaves like the real one --------------------------------- */

export type FakeStore = {
  store: FitStore;
  records: Map<string, Application>;
  saves: Application[];
  refusals: () => number;
  setRefuse(value: boolean): void;
};

/**
 * The application store, in a `Map`: synchronous reads from memory and writes
 * that can be refused — the contract `lib/storage/applications/store` has, so
 * the whole flow runs without IndexedDB.
 */
export function fakeStore(initial: Application[] = [], options: { refuse?: boolean } = {}): FakeStore {
  const records = new Map(initial.map((app) => [app.id, app]));
  const saves: Application[] = [];
  let refuse = options.refuse ?? false;
  let refused = 0;

  return {
    records,
    saves,
    refusals: () => refused,
    setRefuse(value: boolean) {
      refuse = value;
    },
    store: {
      get: (id: string) => records.get(id),
      save: async (app: Application): Promise<SaveOutcome> => {
        saves.push(app);
        if (refuse) {
          refused += 1;
          return { ok: false, kind: "quota" };
        }
        records.set(app.id, app);
        return { ok: true };
      },
    },
  };
}
