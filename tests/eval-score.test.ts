import { describe, expect, it } from "vitest";
import { scoreCV } from "./eval/score";
import { cvDocumentSchema, type CVDocument } from "@/lib/schemas/cv";
import { jobAnalysisSchema } from "@/lib/schemas/job";
import { backendProfile } from "./fixtures";

/**
 * The harness scores every prompt change, so a metric that quietly starts
 * measuring the wrong thing is worse than no metric: it reports an improvement
 * nobody made. `hasMetric` did exactly that. The day the "pairs" section
 * shipped, every CV began carrying "Cloud Practitioner: AWS, 2024", the year
 * matched the two-or-more-digits rule, and the share of CVs "with a number"
 * jumped from 9% to 72% across 53 real postings without one achievement figure
 * being added.
 */

const analysis = jobAnalysisSchema.parse({
  title: "Backend Engineer",
  language: "es",
  domain: "backend",
  relevance: "direct",
  relevanceReason: "Same field.",
  requirements: [{ text: "Go", kind: "hard" }],
  responsibilities: ["Construir servicios."],
  keywords: ["Go"],
});

const cv = (overrides: Partial<CVDocument>) =>
  cvDocumentSchema.parse({
    language: "es",
    header: { fullName: "Ana", location: "", phone: "", email: "a@example.com", links: [] },
    summary: "Ingeniera backend.",
    sections: [
      {
        kind: "experience",
        title: "EXPERIENCIA PROFESIONAL",
        items: [
          {
            company: "Flash Page",
            role: "Software Engineer",
            location: "",
            dateRange: "Mayo 2024 – Actualidad",
            bullets: ["Construí servicios desacoplados en Go."],
          },
        ],
      },
    ],
    coverage: { requirements: [], omitted: [] },
    ...overrides,
  });

const score = (doc: CVDocument) =>
  scoreCV({ label: "t", profile: backendProfile, analysis, cv: doc });

describe("scoreCV — hasMetric", () => {
  it("does not count a dated certification as an achievement number", () => {
    const withCert = cv({
      sections: [
        ...cv({}).sections,
        {
          kind: "pairs",
          title: "CERTIFICACIONES",
          items: [{ label: "Cloud Practitioner", value: "AWS, 2024" }],
        },
      ],
    });
    expect(score(withCert).hasMetric).toBe(false);
  });

  it("counts a figure in a work-history bullet", () => {
    const withNumber = cv({
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA PROFESIONAL",
          items: [
            {
              company: "Flash Page",
              role: "Software Engineer",
              location: "",
              dateRange: "Mayo 2024 – Actualidad",
              bullets: ["Administré 40 servidores Linux en producción."],
            },
          ],
        },
      ],
    });
    expect(score(withNumber).hasMetric).toBe(true);
  });

  it("counts a percentage in a skills line", () => {
    const withPercent = cv({
      sections: [
        ...cv({}).sections,
        {
          kind: "bullets",
          title: "SKILLS ADICIONALES",
          bullets: ["Bajé 30% el tiempo de build.", "Go para herramientas internas."],
        },
      ],
    });
    expect(score(withPercent).hasMetric).toBe(true);
  });

  it("ignores the date range on a role, which every CV has", () => {
    expect(score(cv({})).hasMetric).toBe(false);
  });
});

describe("scoreCV — skills redundancy", () => {
  /** One work-history bullet naming Docker, plus whatever skills lines. */
  const withSkills = (bullets: string[]) =>
    cv({
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA PROFESIONAL",
          items: [
            {
              company: "Flash Page",
              role: "Software Engineer",
              location: "",
              dateRange: "Mayo 2024 – Actualidad",
              bullets: ["Puse servicios en producción con Docker."],
            },
          ],
        },
        { kind: "bullets", title: "SKILLS ADICIONALES", bullets },
      ],
    });

  it("counts the tech a skills line repeats from the bullets", () => {
    const s = score(withSkills(["Docker para empaquetar servicios.", "Kafka para eventos."]));
    expect(s.skillTech).toBe(2);
    expect(s.skillTechAlsoInBullets).toBe(1);
  });

  it("counts nothing when the section names no profile technology", () => {
    expect(score(withSkills(["Trabajo por sprints.", "Revisiones de código."])).skillTech).toBe(0);
  });

  it("ignores tags too short to match a word safely, such as Go", () => {
    // `supports` matches whole words, so counting "Go" would also count the
    // verb in "go to production". The filter in score.ts drops it deliberately.
    expect(score(withSkills(["Go para herramientas internas."])).skillTech).toBe(0);
  });

  it("flags a conceding opener", () => {
    expect(score(withSkills(["Familiar with Kafka.", "Java para servicios."])).hedgedSkillBullets).toBe(1);
    expect(score(withSkills(["Conocimiento de Kafka.", "Java para servicios."])).hedgedSkillBullets).toBe(1);
    expect(score(withSkills(["Kafka para eventos.", "Java para servicios."])).hedgedSkillBullets).toBe(0);
  });
});

/**
 * The claim check, which is the metric this harness was missing entirely.
 *
 * `fabricated` counts named technologies, so the two CVs in the corpus with the
 * most invented content — a groundskeeping job and a waiting job, asserting
 * weather tolerance, stock-keeping and customer contact from a profile with
 * none of it — both scored zero and the harness reported them clean.
 *
 * These pin the threshold. It has to separate a genuinely reframed bullet from
 * an invented one, and if it stops doing that the metric is reporting noise.
 */
describe("scoreCV — unsupported claims", () => {
  const withSkills = (bullets: string[]) =>
    cv({ sections: [...cv({}).sections, { kind: "bullets", title: "SKILLS", bullets }] });

  it("counts a line the profile has no words for", () => {
    // Nothing in `backendProfile` mentions the outdoors, weather, or machinery.
    const invented = withSkills([
      "Responsabilidad en la gestión de tareas físicas y al aire libre, con disposición para trabajar en diferentes condiciones climáticas.",
      "Experiencia en gestión de inventarios y registros de mercadería en depósito.",
    ]);

    expect(score(invented).unsupportedClaims).toBe(2);
  });

  it("leaves a line rebuilt out of the profile's own material alone", () => {
    const grounded = withSkills([
      "Administré infraestructura cloud con Docker, Kubernetes y servicios AWS.",
      "Optimicé sistemas backend sobre PostgreSQL y Redis, mejorando consultas SQL e índices.",
    ]);

    expect(score(grounded).unsupportedClaims).toBe(0);
  });

  /**
   * A "pairs" row is a label and a short fact, and the label's own words
   * ("Licencia de conducir") drag the share to zero on rows that are perfectly
   * well supported. `verifyPairs` checks those against the profile field they
   * come from instead.
   */
  it("does not count a pairs row", () => {
    const withPair = cv({
      sections: [
        // Enough prose alongside it for `documentLanguage` to settle, which it
        // refuses to do on a handful of words.
        ...withSkills([
          "Administré infraestructura cloud con Docker, Kubernetes y servicios AWS.",
          "Optimicé sistemas backend sobre PostgreSQL y Redis, mejorando consultas SQL e índices.",
        ]).sections,
        {
          kind: "pairs",
          title: "DATOS",
          items: [{ label: "Licencia de conducir", value: "B1" }],
        },
      ],
    });

    expect(score(withPair).unsupportedClaims).toBe(0);
  });

  /**
   * `supportShare` compares words, so a faithful English CV built from a
   * Spanish profile reads as one long fabrication. Suppressing the metric is
   * the same choice `statedYearsOfExperience` makes with dates it cannot parse,
   * and the aggregate denominates over the CVs where it applied.
   */
  it("gives up rather than misfire on a CV in the other language", () => {
    const english = cv({
      language: "en",
      summary: "Backend engineer building distributed services and scalable web applications.",
      sections: [
        {
          kind: "experience",
          title: "WORK EXPERIENCE",
          items: [
            {
              company: "Flash Page",
              role: "Software Engineer",
              location: "",
              dateRange: "May 2024 – Present",
              bullets: [
                "Designed decoupled services applying distributed architecture principles with REST and gRPC APIs.",
                "Optimised backend systems on PostgreSQL and Redis, improving SQL queries, caching and indexes.",
                "Administered cloud infrastructure with Docker, Kubernetes and AWS services throughout.",
              ],
            },
          ],
        },
      ],
    });

    expect(score(english).unsupportedClaims).toBeNull();
  });
});

/**
 * Counted with the same functions `verifyCV` reports to the user, so the metric
 * and the warning cannot drift apart — the reason `figuresAtStake` and
 * `isHedgedSkillLine` are exported too.
 */
describe("scoreCV — the checks the panel shows", () => {
  it("counts a retitled role", () => {
    const retitled = cv({
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA PROFESIONAL",
          items: [
            {
              company: "Flash Page",
              role: "Soporte Técnico y Operaciones",
              location: "",
              dateRange: "Mayo 2024 – Actualidad",
              bullets: ["Construí servicios desacoplados en Go."],
            },
          ],
        },
      ],
    });

    expect(score(retitled).roleTitlesChanged).toBe(1);
    expect(score(cv({})).roleTitlesChanged).toBe(0);
  });

  it("counts a coverage entry the posting never asked for", () => {
    const inflated = cv({
      coverage: {
        requirements: [
          { requirement: "Go", covered: true, evidence: "—", inferred: false },
          { requirement: "Atención al detalle", covered: true, evidence: "—", inferred: false },
        ],
        omitted: [],
      },
    });

    expect(score(inflated).coverageInvented).toBe(1);
    expect(score(inflated).coverageReported).toBe(2);
  });
});
