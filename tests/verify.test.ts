import { describe, expect, it } from "vitest";
import {
  answerGaps,
  answerLimitFindings,
  answerLimitGaps,
  auditAnswers,
  cvGaps,
  cvProse,
  gapCount,
  hasGaps,
  inventedFigures,
  verifyAnswers,
  verifyCV,
  verifyJargon,
} from "@/lib/ai/verify";
import { parseFieldPath } from "@/lib/cv/edit";
import { cvDocumentSchema, type CVDocument } from "@/lib/schemas/cv";
import { profileSchema } from "@/lib/schemas/profile";
import { answersSchema } from "@/lib/schemas/outputs";
import { backendProfile, devProfile, fullstackProfile } from "./fixtures";

/**
 * The anti-fabrication check is a product requirement, not a nicety: a CV that
 * names an employer the candidate never worked for fails at the interview.
 */

/**
 * The sections a complete CV always has, so a fixture testing one thing does
 * not also trip the completeness checks. Overriding `sections` replaces these,
 * which is what the fabrication cases want: they assert on the whole findings
 * array, so anything else the CV is missing would show up there too.
 */
const filler = {
  education: {
    kind: "education" as const,
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
  skills: {
    kind: "bullets" as const,
    title: "HABILIDADES",
    // Eight, so a fixture carrying it clears the thin-CV floor on its own and
    // the experience bullets stay free to say whatever the case needs.
    bullets: [
      "React y TypeScript.",
      "Optimización de bundles y tiempos de carga.",
      "Trabajo por sprints con diseño y backend.",
      "Atención al público y manejo de caja.",
      "Control de stock y reposición de mercadería.",
      "Voluntariado en un comedor comunitario.",
      "Coordinación con diseño para cada entrega.",
      "Manejo de caja en turnos de ocho horas.",
    ],
  },
};

function cv(overrides: Partial<CVDocument> = {}): CVDocument {
  return cvDocumentSchema.parse({
    language: "es",
    header: {
      fullName: devProfile.fullName,
      location: "Rosario, Argentina",
      phone: devProfile.phone,
      email: devProfile.email,
      links: devProfile.links,
    },
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
            // The second bullet carries the profile's figures. A CV that keeps
            // this role and none of its numbers is a finding of its own now, so
            // a fixture standing for "clean CV" has to keep them.
            bullets: [
              "Desarrollé la interfaz del panel de clientes.",
              "Bajé la carga inicial de 4s a 1,2s recortando el bundle.",
            ],
          },
        ],
      },
      filler.education,
      filler.skills,
    ],
    coverage: { requirements: [], omitted: [] },
    ...overrides,
  });
}

describe("verifyCV", () => {
  it("passes a CV built only from profile facts", () => {
    expect(verifyCV(cv(), devProfile)).toEqual([]);
  });

  it("flags an employer that is not in the profile", () => {
    const fabricated = cv({
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA PROFESIONAL",
          items: [
            {
              company: "Mercado Libre",
              role: "Desarrollador Frontend",
              location: "Rosario, Argentina",
              dateRange: "Marzo 2021 – Agosto 2024",
              bullets: [],
            },
          ],
        },
        filler.education,
        filler.skills,
      ],
    });

    const findings = verifyCV(fabricated, devProfile);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("error");
    expect(findings[0]!.detail).toContain("Mercado Libre");
  });

  describe("a project given as the employer", () => {
    const withProject = { ...devProfile, projects: [{ id: "p1", name: "Tablero de ventas", description: "Panel para el equipo comercial.", url: "", tags: [] }] };
    const employer = (company: string) =>
      cv({
        sections: [
          {
            kind: "experience",
            title: "EXPERIENCIA PROFESIONAL",
            items: [{ company, role: "Desarrollador", location: "", dateRange: "Marzo 2021 – Agosto 2024", bullets: [] }],
          },
          filler.education,
          filler.skills,
        ],
      });

    it("says it is a project, not a job, instead of calling it a stranger", () => {
      const findings = verifyCV(employer("Tablero de ventas"), withProject);
      expect(findings).toEqual([
        { severity: "error", field: "sections[0].items[0].company", detail: "«Tablero de ventas» es un proyecto, no un puesto." },
      ]);
    });

    it("still calls an employer in neither list unknown", () => {
      const [finding] = verifyCV(employer("Mercado Libre"), withProject);
      expect(finding!.detail).toBe("El CV menciona «Mercado Libre», que no figura en tu perfil.");
    });

    it("leaves a real employer alone, even when a project shares part of its name", () => {
      const shared = { ...withProject, projects: [{ ...withProject.projects[0]!, name: "Talleres Digitales" }] };
      expect(verifyCV(employer("Talleres Digitales SRL"), shared)).toEqual([]);
    });
  });

  it("flags a year the profile never mentions", () => {
    const stretched = cv({
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA PROFESIONAL",
          items: [
            {
              company: "Talleres Digitales SRL",
              role: "Desarrollador Frontend",
              location: "Rosario, Argentina",
              dateRange: "Marzo 2017 – Agosto 2024", // 2017 is invented
              bullets: [],
            },
          ],
        },
        filler.education,
        filler.skills,
      ],
    });

    const findings = verifyCV(stretched, devProfile);
    expect(findings.some((f) => f.detail.includes("2017"))).toBe(true);
  });

  it("accepts a shortened or expanded company name", () => {
    // The model legitimately writes "Talleres Digitales" for
    // "Talleres Digitales SRL"; that must not be reported as fabrication.
    const shortened = cv({
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA PROFESIONAL",
          items: [
            {
              company: "Talleres Digitales",
              role: "Desarrollador Frontend",
              location: "Rosario, Argentina",
              dateRange: "Marzo 2021 – Agosto 2024",
              bullets: [],
            },
          ],
        },
        filler.education,
        filler.skills,
      ],
    });

    expect(verifyCV(shortened, devProfile)).toEqual([]);
  });

  it("flags an institution that is not in the profile", () => {
    const fabricated = cv({
      sections: [
        {
          kind: "education",
          title: "EDUCACIÓN",
          items: [
            {
              institution: "Universidad de Buenos Aires",
              degree: "Analista en Sistemas",
              location: "Rosario, Argentina",
              date: "2020",
              honors: "",
            },
          ],
        },
        filler.skills,
      ],
    });

    const findings = verifyCV(fabricated, devProfile);
    expect(findings.some((f) => f.severity === "error")).toBe(true);
  });

  it("flags a header email the model edited", () => {
    const edited = cv({
      header: {
        fullName: devProfile.fullName,
        location: "Rosario, Argentina",
        phone: devProfile.phone,
        email: "otro@example.com",
        links: [],
      },
    });

    const findings = verifyCV(edited, devProfile);
    expect(findings.some((f) => f.field === "header.email")).toBe(true);
  });
});

/**
 * Fabricated technology is the failure the org-name check never saw. It is also
 * the expensive one: an interviewer reads "Clean Architecture, DDD" off the CV
 * and opens with a question about it.
 */
describe("verifyCV — invented technology", () => {
  /** Sections every backend fixture carries, so only the summary is under test. */
  const backendFiller = [
    {
      kind: "education" as const,
      title: "EDUCACIÓN",
      items: [
        {
          institution: "Universidad Nacional del Noroeste de la Provincia de Buenos Aires",
          degree: "Analista de Sistemas",
          location: "Junín, Argentina",
          date: "2025",
          honors: "",
        },
      ],
    },
    {
      kind: "bullets" as const,
      title: "HABILIDADES",
      bullets: [
        "Go, Java y Spring Boot.",
        "PostgreSQL, Redis y Kafka.",
        "Docker, Kubernetes y AWS.",
        "APIs REST y gRPC.",
        "Procesamiento asíncrono mediante eventos.",
        "Optimización de consultas SQL e índices.",
        "Clean Code y SOLID.",
        "Pruebas unitarias y de integración.",
      ],
    },
  ];

  function backendCV(summary: string, bullets: string[] = []): CVDocument {
    return cvDocumentSchema.parse({
      language: "es",
      header: {
        fullName: backendProfile.fullName,
        location: "Junín, Argentina",
        phone: backendProfile.phone,
        email: backendProfile.email,
        links: [],
      },
      summary,
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA PROFESIONAL",
          items: [
            {
              company: "Flash Page",
              role: "Software Engineer",
              location: "Junín, Argentina",
              dateRange: "Mayo 2024 – Actualidad",
              bullets,
            },
          ],
        },
        ...backendFiller,
      ],
      coverage: { requirements: [], omitted: [] },
    });
  }

  it("passes a CV whose technology all comes from the profile", () => {
    const honest = backendCV(
      "Ingeniera de software backend con experiencia en Go, Java y Spring Boot.",
      ["Optimicé sistemas backend sobre PostgreSQL y Redis, con eventos en Kafka."],
    );
    expect(verifyCV(honest, backendProfile)).toEqual([]);
  });

  it("flags patterns copied from the posting into the summary", () => {
    const stuffed = backendCV(
      "Ingeniera de software backend con conocimientos avanzados en patrones como Clean Architecture y DDD.",
    );

    const findings = verifyCV(stuffed, backendProfile);
    expect(findings.map((f) => f.field)).toEqual(["summary", "summary"]);
    expect(findings.every((f) => f.severity === "error")).toBe(true);
    expect(findings.map((f) => f.detail).join(" ")).toContain("Clean Architecture");
  });

  it("flags invented technology in a bullet, naming where it is", () => {
    const stuffed = backendCV("Ingeniera de software backend.", [
      "Diseñé microservicios con event sourcing y CQRS sobre AWS Lambda.",
    ]);

    const findings = verifyCV(stuffed, backendProfile);
    expect(findings).not.toHaveLength(0);
    expect(findings.every((f) => f.field === "sections[0].items[0].bullets[0]")).toBe(true);
    expect(findings.map((f) => f.detail).join(" ")).toContain("CQRS");
  });

  it("does not read an uppercase section title as a wall of acronyms", () => {
    const honest = backendCV("Ingeniera de software backend.");
    expect(verifyCV(honest, backendProfile)).toEqual([]);
  });
});

describe("verifyCV — seniority", () => {
  function withSummary(summary: string): CVDocument {
    return cvDocumentSchema.parse({
      language: "es",
      header: {
        fullName: backendProfile.fullName,
        location: "Junín, Argentina",
        phone: backendProfile.phone,
        email: backendProfile.email,
        links: [],
      },
      summary,
      sections: [
        { kind: "bullets", title: "HABILIDADES", bullets: ["Go y Java.", "Spring Boot."] },
      ],
      coverage: { requirements: [], omitted: [] },
    });
  }

  it("flags more years than the dates support", () => {
    const findings = verifyCV(withSummary("Ingeniera con 8 años de experiencia."), backendProfile);
    expect(findings.some((f) => f.severity === "error" && f.field === "summary")).toBe(true);
  });

  it("warns on a vague claim of a long career", () => {
    const findings = verifyCV(
      withSummary("Ingeniera de software con amplia trayectoria en sistemas distribuidos."),
      backendProfile,
    );
    expect(findings.some((f) => f.severity === "warning" && f.field === "summary")).toBe(true);
  });

  it("accepts a claim the dates do support", () => {
    // devProfile's roles add up to five years.
    const cvForDev = cvDocumentSchema.parse({
      language: "es",
      header: {
        fullName: devProfile.fullName,
        location: "Rosario, Argentina",
        phone: "",
        email: "",
        links: [],
      },
      summary: "Desarrollador con 4 años de experiencia en React y TypeScript.",
      sections: [
        { kind: "bullets", title: "HABILIDADES", bullets: ["React y TypeScript.", "Git."] },
      ],
      coverage: { requirements: [], omitted: [] },
    });
    expect(verifyCV(cvForDev, devProfile).filter((f) => f.field === "summary")).toEqual([]);
  });

  it("stays silent when the profile has no parseable dates", () => {
    // Same experience, but with dates the parser cannot read: the seniority
    // check has nothing to compare against and must not guess.
    const undated = {
      ...backendProfile,
      experience: backendProfile.experience.map((job) => ({ ...job, start: "", current: false })),
    };
    const findings = verifyCV(withSummary("Ingeniera senior con amplia trayectoria."), undated);
    expect(findings.filter((f) => f.field === "summary")).toEqual([]);
  });
});

/**
 * Absence, which every other check misses.
 *
 * The rest of this file compares what the CV asserts against the profile, so a
 * CV that asserts almost nothing sails through all of it. One did: a summary,
 * two skill bullets, no work history, no education, no email. Schema-valid and
 * unusable.
 */
describe("verifyCV — completeness", () => {
  /** The CV that actually shipped, reduced to its structure. */
  function mutilated(overrides: Partial<CVDocument> = {}): CVDocument {
    return cvDocumentSchema.parse({
      language: "en",
      header: {
        fullName: backendProfile.fullName,
        location: "Junín, Argentina",
        phone: backendProfile.phone,
        email: "",
        links: [],
      },
      summary: "Ingeniera de software backend con experiencia en Go, Java y Spring Boot.",
      sections: [
        {
          kind: "bullets",
          title: "TECHNICAL SKILLS",
          bullets: ["Go, Java y Spring Boot.", "PostgreSQL, Redis y Kafka."],
        },
      ],
      coverage: { requirements: [], omitted: [] },
      ...overrides,
    });
  }

  it("errors when a CV carries no work history at all", () => {
    const findings = verifyCV(mutilated(), backendProfile);
    expect(
      findings.some((f) => f.severity === "error" && f.field === "sections"),
    ).toBe(true);
  });

  it("errors when the email is missing rather than wrong", () => {
    // The old check compared values and skipped an empty one, so the CV that
    // lost its email entirely passed while a *changed* email was caught.
    const findings = verifyCV(mutilated(), backendProfile);
    expect(findings.some((f) => f.severity === "error" && f.field === "header.email")).toBe(true);
  });

  it("warns about a CV too thin to fill the page", () => {
    const findings = verifyCV(mutilated(), backendProfile);
    expect(
      findings.some((f) => f.severity === "warning" && f.detail.includes("media página")),
    ).toBe(true);
  });

  describe("the thin-CV warning says whose fault the short page is", () => {
    /** Ana's one role, cut down to `tasks` tasks and nothing else: what the profile can give is that and no more. */
    const bare = (tasks: number, extra: Partial<typeof backendProfile> = {}) => ({
      ...backendProfile,
      experience: [{ ...backendProfile.experience[0]!, bullets: backendProfile.experience[0]!.bullets.slice(0, tasks), tags: [] }],
      certifications: [],
      languages: [],
      ...extra,
    });
    const thinWarning = (profile: typeof backendProfile, relevance?: "unrelated") =>
      verifyCV(mutilated(), profile, relevance && { relevance }).find((f) => f.detail.includes("media página"))?.detail;

    it("sends a profile with material to regenerate", () => {
      const detail = thinWarning(backendProfile);
      expect(detail).toContain("Volvé a generar");
      expect(detail).not.toContain("poco material");
    });

    it("tells a profile without it that the material is short, and not to regenerate", () => {
      const detail = thinWarning(bare(2));
      expect(detail).toContain("media página");
      expect(detail).toContain("Tu perfil tiene poco material para este aviso.");
      expect(detail).toContain("Sumá proyectos, ayudantías, voluntariados o actividades");
      expect(detail).not.toContain("Volvé a generar");
    });

    it("marks the short CV of a profile with little to put on it, and only that one, for the question of what else to list (UI-4)", () => {
      const kindOf = (profile: typeof backendProfile) => verifyCV(mutilated(), profile).find((f) => f.detail.includes("media página"))?.kind;
      expect(kindOf(bare(2))).toBe("thin_cv");
      expect(kindOf(backendProfile)).toBeUndefined();
    });

    it("counts certifications and languages, which print as rows of their own", () => {
      const rows = {
        certifications: [{ id: "c1", name: "Cloud Practitioner", issuer: "AWS", date: "2024" }],
        languages: [
          { id: "l1", name: "Español", level: "Nativo" },
          { id: "l2", name: "Inglés", level: "Avanzado" },
        ],
      };
      // 3 tasks + 3 rows = 6 is still short of eight; 3 tasks + the rows + 2 projects reaches it.
      expect(thinWarning(bare(3, rows))).toContain("poco material");
      const projects = [1, 2].map((n) => ({ id: `p${n}`, name: `Proyecto ${n}`, description: "Algo hecho.", url: "", tags: [] }));
      expect(thinWarning(bare(3, { ...rows, projects }))).toContain("Volvé a generar");
    });

    it("does not count a certification the person left unnamed", () => {
      const blank = { certifications: Array.from({ length: 5 }, (_, n) => ({ id: `c${n}`, name: " ", issuer: "", date: "" })) };
      expect(thinWarning(bare(3, blank))).toContain("poco material");
    });

    it("weighs the material against the lower floor outside the candidate's field", () => {
      // Three tasks and a CV of two lines: short against 8 and against 5, but the profile clears only the second.
      const profile = bare(3, { extras: ["Voluntariado en un comedor.", "Ayudante de cátedra."] });
      expect(thinWarning(profile)).toContain("poco material");
      expect(thinWarning(profile, "unrelated")).toContain("Volvé a generar");
    });
  });

  it("warns about missing links when the profile has them", () => {
    const findings = verifyCV(mutilated(), devProfile);
    expect(findings.some((f) => f.field === "header.links")).toBe(true);
  });

  it("does not demand education for a job in a different field", () => {
    // The `unrelated` strategy may lead with skills or availability instead.
    const withWork = mutilated({
      sections: [
        {
          kind: "experience",
          title: "WORK EXPERIENCE",
          items: [
            {
              company: "Flash Page",
              role: "Software Engineer",
              location: "Junín, Argentina",
              dateRange: "Mayo 2024 – Actualidad",
              bullets: ["Optimicé sistemas backend sobre PostgreSQL y Redis."],
            },
          ],
        },
      ],
    });

    const fields = verifyCV(withWork, backendProfile, { relevance: "unrelated" }).map(
      (f) => f.field,
    );
    expect(fields.filter((f) => f === "sections")).not.toContain("education");
    expect(
      verifyCV(withWork, backendProfile, { relevance: "direct" }).some((f) =>
        f.detail.includes("formación académica"),
      ),
    ).toBe(true);
  });
});
/**
 * The empty report the schema now tolerates. `coverage` is defaulted so a
 * model that omits the block no longer fails the whole document (see
 * `coverageSchema`), which means the failure has to become visible somewhere
 * else: the panel beside the preview counts the posting's requirements against
 * these entries, and with none it shows 0 de N — which reads as "you cover
 * nothing" rather than "the model did not report".
 */
describe("verifyCV — informe de cobertura vacío", () => {
  const analysis = {
    relevance: "direct" as const,
    requirements: [
      {
        text: "Experiencia mínima de 5 años en desarrollo de software",
        kind: "hard" as const,
        excluding: false,
      },
    ],
  };

  it("warns instead of letting an empty report read as zero coverage", () => {
    const warning = verifyCV(cv(), devProfile, analysis).find((f) => f.field === "coverage");

    expect(warning?.severity).toBe("warning");
    expect(warning?.detail).toContain("0 de 1");
  });

  it("stays quiet when the report carries the entries", () => {
    const reported = cv({
      coverage: {
        requirements: [
          {
            requirement: "Experiencia mínima de 5 años en desarrollo de software",
            covered: true,
            evidence: "Cuatro años de experiencia.",
            inferred: false,
          },
        ],
        omitted: [],
      },
    });

    expect(verifyCV(reported, devProfile, analysis).some((f) => f.field === "coverage")).toBe(
      false,
    );
  });
});



/**
 * Every check above asks whether the CV overreached. None asks whether it did
 * any work: a CV assembled by copying the profile's own lines passes all of
 * them and is not a tailored CV. A run for a Python role came back exactly that
 * way — profile ABOUT as the summary, bullets verbatim in the profile's order,
 * and a skills section of single words lifted from the posting.
 */
describe("verifyCV — tailoring", () => {
  const analysis = {
    relevance: "direct" as const,
    keywords: ["Python", "MySQL", "SOAP", "Docker", "Kubernetes", "PostgreSQL", "Redis"],
    requirements: [
      {
        text: "Experiencia mínima de 5 años en desarrollo de software",
        kind: "hard" as const,
        excluding: false,
      },
    ],
  };

  const backendCV = (overrides: Partial<CVDocument> = {}) =>
    cvDocumentSchema.parse({
      language: "es",
      header: {
        fullName: backendProfile.fullName,
        location: "Junín, Argentina",
        phone: backendProfile.phone,
        email: backendProfile.email,
        links: [],
      },
      summary: "Ingeniera backend orientada a servicios distribuidos sobre Kubernetes.",
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA PROFESIONAL",
          items: [
            {
              company: "Flash Page",
              role: "Software Engineer",
              location: "Junín, Argentina",
              dateRange: "Mayo 2024 – Actualidad",
              bullets: [
                "Llevé consultas SQL sobre PostgreSQL y Redis a la mitad de latencia con índices y caching.",
                "Puse en producción servicios en Docker y Kubernetes sobre AWS.",
              ],
            },
          ],
        },
        filler.education,
        filler.skills,
      ],
      coverage: { requirements: [], omitted: [] },
      ...overrides,
    });

  it("warns when the summary is the profile's own about paragraph", () => {
    const findings = verifyCV(backendCV({ summary: backendProfile.about }), backendProfile);
    expect(findings.some((f) => f.field === "summary" && f.detail.includes("sin adaptar"))).toBe(
      true,
    );
  });

  it("stays quiet on a summary written for the posting", () => {
    const findings = verifyCV(backendCV(), backendProfile);
    expect(findings.some((f) => f.detail.includes("sin adaptar"))).toBe(false);
  });

  it("warns when most bullets are the profile's, unrewritten", () => {
    const copied = backendCV({
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA PROFESIONAL",
          items: [
            {
              company: "Flash Page",
              role: "Software Engineer",
              location: "Junín, Argentina",
              dateRange: "Mayo 2024 – Actualidad",
              bullets: backendProfile.experience[0]!.bullets,
            },
          ],
        },
        filler.education,
        filler.skills,
      ],
    });

    expect(verifyCV(copied, backendProfile).some((f) => f.detail.includes("sin reescribir"))).toBe(
      true,
    );
  });

  it("does not call a genuine rewrite a copy", () => {
    expect(verifyCV(backendCV(), backendProfile).some((f) => f.detail.includes("sin reescribir"))).toBe(
      false,
    );
  });

  it("warns about a skills section that is a list of bare keywords", () => {
    const dumped = backendCV({
      sections: [
        backendCV().sections[0]!,
        filler.education,
        {
          kind: "bullets",
          title: "HABILIDADES ADICIONALES",
          bullets: ["Python", "MySQL", "SOAP", "Git", "Scrum", "APIs REST"],
        },
      ],
    });

    expect(verifyCV(dumped, backendProfile).some((f) => f.detail.includes("palabras sueltas"))).toBe(
      true,
    );
  });

  it("names the posting terms the profile supports and the CV never used", () => {
    // Everything this posting asks for and the profile carries, against a CV
    // that spent its bullets on the database half and never reached the rest.
    const wider = {
      ...analysis,
      keywords: [...analysis.keywords, "Kafka", "gRPC", "Java", "Clean Architecture"],
    };
    const narrow = backendCV({
      summary: "Ingeniera backend orientada al rendimiento de bases de datos.",
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA PROFESIONAL",
          items: [
            {
              company: "Flash Page",
              role: "Software Engineer",
              location: "Junín, Argentina",
              dateRange: "Mayo 2024 – Actualidad",
              bullets: [
                "Llevé consultas SQL sobre PostgreSQL y Redis a la mitad de latencia con índices y caching.",
              ],
            },
          ],
        },
        filler.education,
        filler.skills,
      ],
    });

    const unused = verifyCV(narrow, backendProfile, wider).find((f) =>
      f.detail.includes("no lo menciona"),
    );
    expect(unused?.detail).toContain("Docker");
    expect(unused?.detail).toContain("Kafka");
    // Never stated in the profile: absent from the CV is correct, not a miss.
    expect(unused?.detail).not.toContain("Python");
    expect(unused?.detail).not.toContain("Clean Architecture");
    // Spent, so not reported.
    expect(unused?.detail).not.toContain("PostgreSQL");
  });

  it("stays quiet when the CV already spent the vocabulary it could", () => {
    expect(
      verifyCV(backendCV(), backendProfile, analysis).some((f) =>
        f.detail.includes("no lo menciona"),
      ),
    ).toBe(false);
  });

  it("says nothing about keywords when it was given no analysis", () => {
    expect(verifyCV(backendCV(), backendProfile).some((f) => f.detail.includes("no lo menciona"))).toBe(
      false,
    );
  });

  it("reports the gap between the years asked for and the dates on the profile", () => {
    const findings = verifyCV(backendCV(), backendProfile, analysis);
    expect(findings.some((f) => f.detail.includes("El aviso pide 5 años"))).toBe(true);
  });

  it("says nothing when the dates cover what the posting asks for", () => {
    const modest = {
      ...analysis,
      requirements: [
        { text: "Al menos 1 año de experiencia", kind: "hard" as const, excluding: false },
      ],
    };
    expect(
      verifyCV(backendCV(), backendProfile, modest).some((f) => f.detail.includes("El aviso pide")),
    ).toBe(false);
  });
});

/**
 * The skills section is the one the prompt makes mandatory to fill a page, and
 * therefore the one padding lands in. Neither of these is fabrication — every
 * word is the candidate's own — so nothing else in this file can see them.
 */
describe("verifyCV — skills section", () => {
  const withSkills = (bullets: string[]) =>
    cvDocumentSchema.parse({
      language: "es",
      header: {
        fullName: backendProfile.fullName,
        location: "Junín, Argentina",
        phone: backendProfile.phone,
        email: backendProfile.email,
        links: [],
      },
      summary: "Ingeniera backend orientada a servicios distribuidos.",
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA PROFESIONAL",
          items: [
            {
              company: "Flash Page",
              role: "Software Engineer",
              location: "Junín, Argentina",
              dateRange: "Mayo 2024 – Actualidad",
              bullets: [
                "Puse en producción servicios en Docker y Kubernetes sobre AWS.",
                "Optimicé consultas sobre PostgreSQL y Redis con índices y caching.",
                "Diseñé servicios desacoplados con gRPC y Kafka.",
              ],
            },
          ],
        },
        { kind: "bullets", title: "SKILLS ADICIONALES", bullets },
      ],
      coverage: { requirements: [], omitted: [] },
    });

  const repeats = (findings: ReturnType<typeof verifyCV>) =>
    findings.some((f) => f.detail.includes("repite lo que ya dicen tus logros"));

  it("warns when the section restates the technology already in the bullets", () => {
    const cv = withSkills([
      "Contenedores y orquestación con Docker y Kubernetes.",
      "Bases de datos PostgreSQL y caching con Redis.",
      "Comunicación entre servicios con gRPC y Kafka.",
    ]);
    expect(repeats(verifyCV(cv, backendProfile))).toBe(true);
  });

  it("stays quiet when the section carries tools the bullets had no room for", () => {
    const cv = withSkills([
      "Java y Spring Boot para servicios de negocio.",
      "Clean Code y SOLID aplicados en revisiones de código.",
      "Go para herramientas internas de línea de comandos.",
    ]);
    expect(repeats(verifyCV(cv, backendProfile))).toBe(false);
  });

  it("warns on a line that opens by conceding, in either language", () => {
    const spanish = verifyCV(
      withSkills([
        "Java y Spring Boot para servicios de negocio.",
        "Conocimiento de Clean Code y SOLID.",
        "Go para herramientas internas.",
      ]),
      backendProfile,
    );
    expect(spanish.some((f) => f.detail.includes("concesión"))).toBe(true);

    const english = verifyCV(
      withSkills([
        "Java and Spring Boot for business services.",
        "Familiar with Clean Code and SOLID.",
        "Go for internal tooling.",
      ]),
      backendProfile,
    );
    expect(english.some((f) => f.detail.includes("concesión"))).toBe(true);
  });

  it("stays quiet when every line claims rather than concedes", () => {
    const cv = withSkills([
      "Java y Spring Boot para servicios de negocio.",
      "Clean Code y SOLID aplicados en revisiones de código.",
      "Go para herramientas internas.",
    ]);
    expect(verifyCV(cv, backendProfile).some((f) => f.detail.includes("concesión"))).toBe(false);
  });
});

/**
 * The failure the metrics assistant was built to fix, and could not, because
 * nothing checked it: the user is interrupted, asked for a number, types one —
 * and the next CV deletes it while keeping the bullet it came from.
 *
 * Measured over 69 real applications: 85% of the profile's figures never
 * reached the CV, and the assistant reappeared every time asking again, because
 * its trigger is "this CV has no number in it".
 */
describe("verifyCV — figures", () => {
  const role = {
    company: "Talleres Digitales SRL",
    role: "Desarrollador Frontend",
    location: "Rosario, Argentina",
    dateRange: "Marzo 2021 – Agosto 2024",
  };

  const withBullets = (bullets: string[]) =>
    cv({
      sections: [
        { kind: "experience", title: "EXPERIENCIA PROFESIONAL", items: [{ ...role, bullets }] },
        filler.education,
        filler.skills,
      ],
    });

  it("errors when a kept role arrives with none of its numbers", () => {
    const stripped = withBullets(["Optimicé la carga inicial ajustando el bundle."]);

    const finding = verifyCV(stripped, devProfile).find((f) => f.detail.includes("borró"));
    expect(finding?.severity).toBe("error");
    expect(finding?.detail).toContain("4");
    expect(finding?.detail).toContain("1.2");
  });

  it("says nothing when the numbers survived the rewrite", () => {
    const kept = withBullets(["Bajé la carga inicial de 4s a 1,2s recortando el bundle."]);

    expect(verifyCV(kept, devProfile).some((f) => f.detail.includes("borró"))).toBe(false);
  });

  // Dropping a job is an editorial decision the strategy prompts license, and
  // the documented way to show continuity of employment is a header with no
  // bullets under it. Neither can lose a number.
  it("says nothing about a role the CV reduced to a header", () => {
    const headerOnly = cv({
      sections: [
        { kind: "experience", title: "EXPERIENCIA PROFESIONAL", items: [{ ...role, bullets: [] }] },
        filler.education,
        filler.skills,
      ],
    });

    expect(verifyCV(headerOnly, devProfile).some((f) => f.detail.includes("borró"))).toBe(false);
  });

  it("warns rather than errors when it kept some and lost most", () => {
    const partial = withBullets([
      "Bajé la carga inicial a 1,2s recortando el bundle.",
      "Coordiné con diseño y backend cada sprint.",
    ]);

    const finding = verifyCV(partial, devProfile).find((f) => f.detail.includes("se quedó con"));
    expect(finding?.severity).toBe("warning");
  });

  it("says nothing when the profile states no numbers at all", () => {
    const noFigures = profileSchema.parse({
      ...devProfile,
      experience: [
        {
          ...devProfile.experience[0],
          bullets: ["Desarrollé la interfaz del panel de clientes."],
        },
      ],
    });

    expect(
      verifyCV(withBullets(["Desarrollé paneles de clientes."]), noFigures).some((f) =>
        f.detail.includes("borró"),
      ),
    ).toBe(false);
  });
});

/**
 * `cvGaps` decides what a second attempt is asked to fix, which is a narrower
 * question than what `verifyCV` reports. Only omissions go in: told which
 * figure it dropped, a model puts it back, whereas retrying over an invented
 * technology tends to produce a different invention.
 */
/**
 * True technology claims, on a job that has no use for them. Nothing else here
 * could see this: every other check asks whether a claim is supported, and these
 * all are. The CV is simply still addressed to a software reader.
 */
describe("verifyJargon", () => {
  const groundskeeping = { relevance: "unrelated" as const };

  const withBullets = (bullets: string[]) =>
    cv({
      sections: [
        cv().sections[0]!,
        filler.education,
        { kind: "bullets" as const, title: "HABILIDADES", bullets },
      ],
    });

  it("names the candidate's own stack when the job is outside their field", () => {
    const findings = verifyJargon(
      withBullets([
        "Configuré y mantuve equipos con Docker y Kubernetes.",
        "Administré bases PostgreSQL en producción.",
      ]),
      backendProfile,
      groundskeeping,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("warning");
    expect(findings[0]!.detail).toContain("Docker");
  });

  it("stays quiet inside the candidate's own field", () => {
    expect(
      verifyJargon(
        withBullets(["Desplegué con Docker y Kubernetes.", "Optimicé PostgreSQL."]),
        backendProfile,
        { relevance: "direct" },
      ),
    ).toEqual([]);
  });

  it("lets a single stray term pass, since one is a slip and not a pattern", () => {
    expect(
      verifyJargon(
        withBullets(["Atendí al público en turnos de ocho horas.", "Usé Docker alguna vez."]),
        backendProfile,
        groundskeeping,
      ),
    ).toEqual([]);
  });

  /**
   * A licence class is two capitals and a digit, so the acronym pass reads "B1"
   * as a technology — and the licence is the one thing this strategy wants on
   * the page.
   */
  it("never reports the driving licence it asked the CV to carry", () => {
    const licensed = profileSchema.parse({
      ...backendProfile,
      practical: { ...backendProfile.practical, driverLicense: "B1" },
    });

    const findings = verifyJargon(
      cv({
        sections: [
          cv().sections[0]!,
          filler.education,
          { kind: "pairs", title: "DATOS", items: [{ label: "Licencia de conducir", value: "B1" }] },
        ],
      }),
      licensed,
      groundskeeping,
    );

    expect(findings.flatMap((f) => f.detail)).not.toContain("B1");
  });

  it("says nothing about a CV that actually stripped the jargon", () => {
    expect(
      verifyJargon(
        withBullets([
          "Resolví problemas de equipos bajo presión y con plazos ajustados.",
          "Trabajé en equipo siguiendo procedimientos establecidos.",
        ]),
        backendProfile,
        groundskeeping,
      ),
    ).toEqual([]);
  });

  /**
   * A term the posting itself asks for is not jargon here: a field-technician
   * posting naming "Linux" is a case where that background is the job, not
   * overqualification for it. `serializeJargonBan` in `build-cv.ts` applies the
   * same exemption to the ban it hands the model, so the two never disagree.
   */
  it("does not report a technology the posting itself asks for", () => {
    const fieldSupport = {
      relevance: "unrelated" as const,
      title: "Técnico de soporte de campo",
      domain: "soporte técnico en sitio",
      keywords: ["Linux"],
    };

    const findings = verifyJargon(
      withBullets([
        "Configuré y mantuve equipos con Docker y Kubernetes.",
        "Administré bases PostgreSQL en producción con Linux.",
      ]),
      backendProfile,
      fieldSupport,
    );

    // Docker, Kubernetes and PostgreSQL are still unasked-for and still worth
    // the warning; only the term the posting names drops out.
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).not.toContain("Linux");
  });
});

describe("cvGaps", () => {
  const stripped = cv({
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
            bullets: ["Optimicé la carga inicial ajustando el bundle."],
          },
        ],
      },
      filler.skills,
    ],
  });

  it("names the figures to put back and the missing section", () => {
    const gaps = cvGaps(stripped, devProfile, { relevance: "direct" });

    expect(gaps.droppedFigures).toEqual(["4", "1.2"]);
    expect(gaps.missingEducation).toBe(true);
    expect(hasGaps(gaps)).toBe(true);
    expect(gapCount(gaps)).toBe(3);
  });

  it("does not ask for education back on a job in a different field", () => {
    expect(cvGaps(stripped, devProfile, { relevance: "unrelated" }).missingEducation).toBe(false);
  });

  /**
   * The two failures worth a retry that are not omissions. Both are the model
   * contradicting something it can see — the profile's own title, its own
   * coverage report — which is what separates them from a fabricated
   * technology, where a second attempt just invents something else.
   */
  it("hands the retry the real job title", () => {
    const retitled = cv({
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA PROFESIONAL",
          items: [
            {
              company: "Talleres Digitales SRL",
              role: "Soporte Técnico y Operaciones",
              location: "Rosario, Argentina",
              dateRange: "Marzo 2021 – Agosto 2024",
              bullets: ["Bajé la carga inicial de 4s a 1,2s recortando el bundle."],
            },
          ],
        },
        filler.education,
        filler.skills,
      ],
    });

    const gaps = cvGaps(retitled, devProfile, { relevance: "direct" });
    expect(gaps.retitledRoles).toEqual([
      { claimed: "Soporte Técnico y Operaciones", stated: "Desarrollador Frontend" },
    ]);
    expect(hasGaps(gaps)).toBe(true);
  });

  it("hands the retry the requirement the summary and the report disagree on", () => {
    const contradictory = cv({
      summary: "Profesional con experiencia en atención al cliente y manejo de caja.",
      coverage: {
        requirements: [
          { requirement: "Atención al cliente", covered: false, evidence: "—", inferred: false },
        ],
        omitted: [],
      },
    });

    expect(
      cvGaps(contradictory, devProfile, { relevance: "direct" }).contradictedRequirements,
    ).toEqual(["Atención al cliente"]);
  });

  it("counts every failure once, so a retry has to get strictly better to win", () => {
    const both = cv({
      summary: "Profesional con experiencia en atención al cliente y manejo de caja.",
      coverage: {
        requirements: [
          { requirement: "Atención al cliente", covered: false, evidence: "—", inferred: false },
        ],
        omitted: [],
      },
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA PROFESIONAL",
          items: [
            {
              company: "Talleres Digitales SRL",
              role: "Soporte Técnico y Operaciones",
              location: "Rosario, Argentina",
              dateRange: "Marzo 2021 – Agosto 2024",
              bullets: ["Bajé la carga inicial de 4s a 1,2s recortando el bundle."],
            },
          ],
        },
        filler.education,
        filler.skills,
      ],
    });

    expect(gapCount(cvGaps(both, devProfile, { relevance: "direct" }))).toBe(2);
  });

  /**
   * The three that were measured and reported for as long as this file has
   * existed and never cost the model a thing. A real run came back with 7 of 7
   * bullets copied, a skills section of twelve bare words, and a summary opening
   * "buscando un rol de Desarrollador HTML" — every one of them warned about,
   * none of them retried.
   */
  describe("tailoring", () => {
    /** The profile's own bullets, shipped as the CV. */
    const transcribed = cv({
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
              bullets: devProfile.experience[0]!.bullets,
            },
          ],
        },
        filler.education,
        filler.skills,
      ],
    });

    it("reports the bullets that were never rewritten, to the model when there is a retry anyway", () => {
      const gaps = cvGaps(transcribed, devProfile, { relevance: "direct" });

      expect(gaps.copiedBullets).toEqual(devProfile.experience[0]!.bullets);
    });

    it("does not spend a retry on them (VAL-8): a real rewrite counted as a copy cost a paid call", () => {
      const gaps = cvGaps(transcribed, devProfile, { relevance: "direct" });
      expect(gaps.copiedBullets).toHaveLength(3);
      expect(gapCount(gaps)).toBe(0);
      expect(hasGaps(gaps)).toBe(false);
    });

    it("still tells the person, in a warning", () => {
      const copied = verifyCV(transcribed, devProfile, { relevance: "direct" }).filter((finding) => finding.detail.includes("copiados de tu perfil"));
      expect(copied).toHaveLength(1);
      expect(copied[0]!.severity).toBe("warning");
    });

    it("leaves one faithfully-kept line alone", () => {
      const mostlyRewritten = cv({
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
                bullets: [
                  devProfile.experience[0]!.bullets[1]!,
                  "Construí el panel de clientes en React y TypeScript, de la maqueta al deploy.",
                  "Trabajé con diseño y backend en ciclos de dos semanas.",
                ],
              },
            ],
          },
          filler.education,
          filler.skills,
        ],
      });

      expect(cvGaps(mostlyRewritten, devProfile, { relevance: "direct" }).copiedBullets).toEqual([]);
    });

    it("hands the retry a skills section written as a word list", () => {
      const dumped = cv({
        sections: [
          {
            kind: "bullets",
            title: "SKILLS ADICIONALES",
            bullets: ["Java", "JavaScript", "TypeScript", "Python", "Go", "SOAP"],
          },
        ],
      });

      expect(cvGaps(dumped, devProfile, { relevance: "direct" }).keywordDumpSections).toEqual([
        "SKILLS ADICIONALES",
      ]);
    });

    it("hands the retry a summary that says what the candidate wants", () => {
      const wanting = cv({
        summary:
          "Ingeniero de software full-stack con experiencia en desarrollo web, buscando un rol de Desarrollador HTML donde pueda aplicar mis habilidades.",
      });

      expect(cvGaps(wanting, devProfile, { relevance: "direct" }).summaryRuleViolations).toHaveLength(1);
    });

    it("does not read an ordinary sentence as one", () => {
      const fine = cv({ summary: "Desarrollador con cuatro años construyendo interfaces web." });
      expect(cvGaps(fine, devProfile, { relevance: "direct" }).summaryRuleViolations).toEqual([]);
    });

    it("does not spend a retry recovering a quantity of one", () => {
      const singular = profileSchema.parse({
        ...devProfile,
        experience: [
          {
            ...devProfile.experience[0]!,
            bullets: ["Administré 1 servidor Linux en producción."],
          },
        ],
      });
      const without = cv({
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
                bullets: ["Mantuve la infraestructura Linux de producción."],
              },
            ],
          },
          filler.education,
          filler.skills,
        ],
      });

      expect(cvGaps(without, singular, { relevance: "direct" }).droppedFigures).toEqual([]);
    });
  });

  it("finds nothing to fix in a CV that kept both", () => {
    const good = cv({
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
              bullets: ["Bajé la carga inicial de 4s a 1,2s recortando el bundle."],
            },
          ],
        },
        filler.education,
        filler.skills,
      ],
    });

    expect(hasGaps(cvGaps(good, devProfile, { relevance: "direct" }))).toBe(false);
  });

  // A partial loss is an editorial decision often enough that spending a call
  // on it is wrong; the warning already tells the user.
  it("does not retry over a partial loss", () => {
    const partial = cv({
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
              bullets: ["Bajé la carga inicial a 1,2s recortando el bundle."],
            },
          ],
        },
        filler.education,
        filler.skills,
      ],
    });

    expect(cvGaps(partial, devProfile, { relevance: "direct" }).droppedFigures).toEqual([]);
  });

  /**
   * Promoted from a warning-only check to a retry: `verifyJargon` reported this
   * from the day it was written and it never cost the model anything, which is
   * how a CV for a camera-installer vacancy kept naming RBAC, Zero Trust and
   * SSR/SSG/ISR through every warned-about generation. `jargonTerms` shares
   * `jargonTermsIn` with `verifyJargon`, so the two never disagree about what
   * counts as jargon here.
   */
  describe("jargonTerms", () => {
    const groundskeeping = { relevance: "unrelated" as const };

    const withSkillBullets = (bullets: string[]) =>
      cv({
        sections: [
          cv().sections[0]!,
          filler.education,
          { kind: "bullets" as const, title: "HABILIDADES", bullets },
        ],
      });

    it("is empty when there are fewer stray terms than the retry floor", () => {
      const oneTerm = withSkillBullets(["Usé Docker alguna vez.", "Atendí al público."]);
      expect(cvGaps(oneTerm, backendProfile, groundskeeping).jargonTerms).toEqual([]);
    });

    it("names the terms once the CV still reads as a software CV", () => {
      const stillSoftware = withSkillBullets([
        "Configuré y mantuve equipos con Docker y Kubernetes.",
        "Administré bases PostgreSQL en producción.",
      ]);

      const gaps = cvGaps(stillSoftware, backendProfile, groundskeeping);
      expect(gaps.jargonTerms.length).toBeGreaterThanOrEqual(3);
      expect(gaps.jargonTerms).toContain("Docker");
      expect(hasGaps(gaps)).toBe(true);
    });

    it("never fires inside the candidate's own field", () => {
      const sameProse = withSkillBullets([
        "Configuré y mantuve equipos con Docker y Kubernetes.",
        "Administré bases PostgreSQL en producción.",
      ]);
      expect(cvGaps(sameProse, backendProfile, { relevance: "direct" }).jargonTerms).toEqual([]);
    });

    it("exempts a technology the posting itself asks for, same as verifyJargon", () => {
      const fieldSupport = {
        relevance: "unrelated" as const,
        title: "Técnico de soporte de campo",
        domain: "soporte técnico en sitio",
        keywords: ["Linux"],
      };

      const gaps = cvGaps(
        withSkillBullets([
          "Configuré y mantuve equipos con Docker y Kubernetes.",
          "Administré bases PostgreSQL en producción con Linux.",
        ]),
        backendProfile,
        fieldSupport,
      );

      expect(gaps.jargonTerms).not.toContain("Linux");
    });
  });
});

/**
 * The job title, which every other structural check here walked straight past.
 *
 * `verifyCV` validates the employer, the institution, the years, the email and
 * the phone, and never looked at `role` — the field the model rewrites hardest
 * when it is reframing for a different field. The same profile role shipped as
 * "Soporte Técnico y Mantenimiento de Infraestructura" on one posting and
 * "Soporte Técnico y Operaciones" on the next, from a profile that says
 * "Software Engineer". That is an employment history a reference call disproves.
 */
describe("verifyCV — role titles", () => {
  const retitled = (role: string) =>
    cv({
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA PROFESIONAL",
          items: [
            {
              company: "Talleres Digitales SRL",
              role,
              location: "Rosario, Argentina",
              dateRange: "Marzo 2021 – Agosto 2024",
              bullets: ["Bajé la carga inicial de 4s a 1,2s recortando el bundle."],
            },
          ],
        },
        filler.education,
        filler.skills,
      ],
    });

  it("flags a title the profile does not carry", () => {
    const findings = verifyCV(retitled("Soporte Técnico y Operaciones"), devProfile);
    const role = findings.find((f) => f.field.endsWith(".role"));

    expect(role?.severity).toBe("warning");
    expect(role?.detail).toContain("Soporte Técnico y Operaciones");
    expect(role?.detail).toContain("Desarrollador Frontend");
  });

  it("accepts the profile's own title", () => {
    expect(
      verifyCV(retitled("Desarrollador Frontend"), devProfile).filter((f) =>
        f.field.endsWith(".role"),
      ),
    ).toEqual([]);
  });

  /**
   * The output language follows the posting, so a Spanish profile legitimately
   * produces an English title. Anything sharing a word with the profile's is
   * left alone — a warning on every translated CV would be a warning nobody
   * reads.
   */
  it("leaves a translated title alone when it still shares a word", () => {
    expect(
      verifyCV(retitled("Frontend Developer"), devProfile).filter((f) =>
        f.field.endsWith(".role"),
      ),
    ).toEqual([]);
  });

  it("says nothing about a role at an employer the profile does not have", () => {
    // That is the employer check's finding, not this one's, and reporting it
    // twice would say the same thing in two voices.
    const findings = verifyCV(
      cv({
        sections: [
          {
            kind: "experience",
            title: "EXPERIENCIA PROFESIONAL",
            items: [
              {
                company: "Mercado Libre",
                role: "Cualquier Cosa",
                location: "Rosario, Argentina",
                dateRange: "Marzo 2021 – Agosto 2024",
                bullets: [],
              },
            ],
          },
          filler.education,
          filler.skills,
        ],
      }),
      devProfile,
    );

    expect(findings.filter((f) => f.field.endsWith(".role"))).toEqual([]);
  });
});

/**
 * The practical rows, which are read as commitments rather than descriptions.
 *
 * This is where the model answered with the posting instead of the profile: a
 * candidate whose profile says "Disponibilidad full time, turnos rotativos
 * incluidos" had CVs sent promising "Lunes a sábados" and "Jueves a domingo,
 * 19:30hs al cierre" — in each case the requirement, mirrored back as a fact
 * about them.
 */
describe("verifyCV — practical pairs", () => {
  const withPair = (label: string, value: string) =>
    cv({
      sections: [
        { kind: "pairs", title: "DISPONIBILIDAD", items: [{ label, value }] },
        cv().sections[0],
        filler.education,
        filler.skills,
      ],
    });

  /**
   * Where the pairs section ended up. `pairsLast` moves it to the end of the
   * document, so the field path a finding reports is not the index it was written
   * at — and hardcoding one here would only be testing the reordering.
   */
  const pairsPath = (document: CVDocument) =>
    `sections[${document.sections.findIndex((s) => s.kind === "pairs")}]`;

  it("flags an availability the profile does not state", () => {
    const findings = verifyCV(withPair("Disponibilidad", "Jueves a domingo, 19:30hs al cierre"), devProfile);
    const pair = findings.find((f) => f.detail.includes("Jueves a domingo"));

    expect(pair?.severity).toBe("error");
    expect(pair?.detail).toContain("Disponibilidad full time, turnos rotativos incluidos");
  });

  it("accepts the profile's own availability", () => {
    const document = withPair("Disponibilidad", "Disponibilidad full time, turnos rotativos incluidos");
    expect(
      verifyCV(document, devProfile).filter((f) => f.field.startsWith(pairsPath(document))),
    ).toEqual([]);
  });

  /** Elaborating on the profile's value is fine; replacing it is not. */
  it("accepts a licence row that adds detail around the stated value", () => {
    const document = withPair("Licencia de conducir", "B1 (vehículo propio)");
    expect(
      verifyCV(document, devProfile).filter((f) => f.field.startsWith(pairsPath(document))),
    ).toEqual([]);
  });

  it("flags a commitment on a field the profile leaves empty", () => {
    // `workEligibility` is "" on this fixture, so any value is invented.
    const document = withPair("Elegibilidad laboral", "Ciudadanía argentina");
    const pair = verifyCV(document, devProfile).find((f) =>
      f.field.startsWith(pairsPath(document)),
    );

    expect(pair?.severity).toBe("error");
    expect(pair?.detail).toContain("no dice nada");
  });

  it("leaves a language row alone", () => {
    // Its value is the output language's business, not the profile's wording:
    // "Avanzado" legitimately ships as "Advanced".
    const document = withPair("Inglés", "Advanced");
    expect(
      verifyCV(document, devProfile).filter((f) => f.field.startsWith(pairsPath(document))),
    ).toEqual([]);
  });
});

/**
 * The coverage report, which is the only part of the response the user reads to
 * decide whether they are a fit, and the only part nothing checked.
 *
 * Left unaudited it grades its own homework: a groundskeeping posting with three
 * requirements came back with a ten-row report, eight marked covered, the seven
 * extra rows invented out of things the CV happened to say. Real coverage was
 * one of three; the panel showed 76%.
 */
describe("verifyCV — coverage report", () => {
  const analysis = {
    relevance: "unrelated" as const,
    keywords: [],
    requirements: [
      { text: "Experiencia comprobable en corte de césped", kind: "hard" as const, excluding: true },
      {
        text: "Disponibilidad para trabajar de lunes a sábados",
        kind: "hard" as const,
        excluding: false,
      },
    ],
    responsibilities: [],
  };

  const withCoverage = (requirements: CVDocument["coverage"]["requirements"]) =>
    cv({ coverage: { requirements, omitted: [] } });

  it("flags entries the posting never asked for, and states the real ratio", () => {
    const findings = verifyCV(
      withCoverage([
        { requirement: "Experiencia comprobable en corte de césped", covered: false, evidence: "—", inferred: false },
        { requirement: "Disponibilidad para trabajar de lunes a sábados", covered: true, evidence: "—", inferred: false },
        { requirement: "Atención al detalle", covered: true, evidence: "—", inferred: false },
        { requirement: "Trabajo en equipo", covered: true, evidence: "—", inferred: false },
      ]),
      devProfile,
      analysis,
    );

    const coverage = findings.find((f) => f.field === "coverage");
    expect(coverage?.severity).toBe("warning");
    expect(coverage?.detail).toContain("2 no figuran");
    expect(coverage?.detail).toContain("cubrís 1 de 2");
  });

  it("says nothing when every entry answers the posting", () => {
    expect(
      verifyCV(
        withCoverage([
          { requirement: "Experiencia comprobable en corte de césped", covered: false, evidence: "—", inferred: false },
          { requirement: "Disponibilidad para trabajar de lunes a sábados", covered: true, evidence: "—", inferred: false },
        ]),
        devProfile,
        analysis,
      ).filter((f) => f.field === "coverage"),
    ).toEqual([]);
  });

  /**
   * A duty listed in the ad is something the reader will look for, so a report
   * covering it is being more complete rather than making something up. It does
   * not join the denominator, which is what the user is told they are a fit
   * against.
   */
  it("accepts an entry that reports on a responsibility", () => {
    expect(
      verifyCV(
        withCoverage([
          { requirement: "Mantener los espacios verdes del predio", covered: false, evidence: "—", inferred: false },
        ]),
        devProfile,
        { ...analysis, responsibilities: ["Mantener los espacios verdes del predio"] },
      ).filter((f) => f.field === "coverage"),
    ).toEqual([]);
  });

  /**
   * Both halves came back in one response for a waiting job: the coverage said
   * customer contact was not covered, and the summary opened "con experiencia en
   * atención al cliente". Whichever half is wrong, they cannot both ship.
   */
  it("flags a summary claiming what the report concedes", () => {
    const findings = verifyCV(
      cv({
        summary: "Profesional con experiencia en atención al cliente y trabajo en equipo.",
        coverage: {
          requirements: [
            { requirement: "Atención al cliente", covered: false, evidence: "—", inferred: false },
          ],
          omitted: [],
        },
      }),
      devProfile,
      analysis,
    );

    const contradiction = findings.find(
      (f) => f.field === "summary" && f.detail.includes("se contradice"),
    );
    expect(contradiction?.severity).toBe("error");
  });
});

/**
 * Figures outside the candidate's own field, where dropping them is the point.
 *
 * `STRATEGIES.unrelated` orders the jargon stripped, and on a software profile
 * every number is attached to jargon. Unguarded, `verifyFigures` fired on both
 * such CVs in the corpus and was the ONLY thing the panel said about either —
 * an error telling the user to regenerate a CV whose one correct decision it
 * had just found — while `cvGaps` spent a second paid generation arguing the
 * model back toward the numbers it had rightly dropped.
 */
describe("verifyCV — figures outside the candidate's field", () => {
  const noNumbers = cv({
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
            bullets: ["Trabajé por turnos coordinando entregas con el resto del equipo."],
          },
        ],
      },
      filler.education,
      filler.skills,
    ],
  });

  it("says nothing about the numbers it dropped", () => {
    const findings = verifyCV(noNumbers, devProfile, {
      relevance: "unrelated",
      requirements: [],
      responsibilities: [],
      keywords: [],
    });

    expect(findings.filter((f) => f.detail.includes("números"))).toEqual([]);
  });

  it("still says so on a posting in the candidate's own field", () => {
    const findings = verifyCV(noNumbers, devProfile, {
      relevance: "direct",
      requirements: [],
      responsibilities: [],
      keywords: [],
    });

    expect(findings.some((f) => f.detail.includes("números"))).toBe(true);
  });

  it("does not spend a retry on it either", () => {
    expect(
      hasGaps(cvGaps(noNumbers, devProfile, { relevance: "unrelated" })),
    ).toBe(false);
    expect(hasGaps(cvGaps(noNumbers, devProfile, { relevance: "direct" }))).toBe(true);
  });
});

/**
 * The answers are audited for the opposite failure to the CV's.
 *
 * Everything above this point checks that the model did not claim more than the
 * profile supports. These check that it did not claim less — which is the
 * failure mode of a prompt whose highest-priority text is a list of things not
 * to say, and which produced the answer in the first case below.
 */
describe("auditAnswers", () => {
  const now = new Date(2026, 7, 20); // 27 months after Mayo 2024.

  const answers = (
    ...entries: { question: string; answer: string; shortAnswer?: string }[]
  ) =>
    answersSchema.parse({
      language: "es",
      answers: entries.map((e) => ({ shortAnswer: "", ...e })),
    });

  const QUESTION = "¿Cuántos años de experiencia tenés con React.js, TypeScript y Node.js?";

  it("catches the reported answer: zero against two years of its own dates", () => {
    const audit = auditAnswers({
      profile: fullstackProfile,
      now,
      answers: answers({
        question: QUESTION,
        shortAnswer: "0",
        answer:
          "Tengo 0 años de experiencia profesional formal en el stack React.js, " +
          "TypeScript y Node.js como combinación específica. En Flash Page (desde " +
          "mayo 2024) he trabajado en arquitecturas frontend con React y TypeScript, " +
          "y en servicios backend con Node.js, pero no en el mismo proyecto de " +
          "manera simultánea.",
      }),
    });

    const errors = audit.filter((p) => p.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("answers[0].shortAnswer");
    expect(errors[0].detail).toContain("2 años");
    // The retry has to be told each technology counts on its own, which is the
    // misreading that produced the zero.
    expect(errors[0].correction).toContain("on its own");
  });

  it("flags the self-defeating qualifier and the negative opening separately", () => {
    const audit = auditAnswers({
      profile: fullstackProfile,
      now,
      answers: answers({
        question: QUESTION,
        shortAnswer: "0",
        answer: "Tengo 0 años de experiencia formal, pero no en el mismo proyecto.",
      }),
    });

    const details = audit.filter((p) => p.severity === "warning").map((p) => p.detail);
    expect(details.some((d) => d.includes("abre por lo que te falta"))).toBe(true);
    expect(details.some((d) => d.includes("reparo que nadie preguntó"))).toBe(true);
  });

  it("accepts the answer the fix is meant to produce", () => {
    const audit = auditAnswers({
      profile: fullstackProfile,
      now,
      answers: answers({
        question: QUESTION,
        shortAnswer: "2",
        answer:
          "Trabajo con las tres desde mayo de 2024 en Flash Page: React y TypeScript " +
          "en las arquitecturas frontend, y Node.js en los servicios backend.",
      }),
    });

    expect(audit).toEqual([]);
  });

  it("catches a number that is merely low, not only a zero", () => {
    const audit = auditAnswers({
      profile: fullstackProfile,
      now,
      answers: answers({
        question: QUESTION,
        shortAnswer: "1",
        answer: "Un año con React en Flash Page.",
      }),
    });

    expect(audit.filter((p) => p.severity === "error")).toHaveLength(1);
    expect(audit[0].detail).toContain("dice 1 años");
  });

  it("still catches a technology the profile never states", () => {
    const audit = auditAnswers({
      profile: fullstackProfile,
      now,
      answers: answers({
        question: "¿Usaste Kubernetes?",
        answer: "Sí, administro clústers de Kubernetes en producción.",
      }),
    });

    const errors = audit.filter((p) => p.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].detail).toContain("Kubernetes");
  });

  it("still catches a fabrication that precedes an unrelated denial in the same sentence", () => {
    // Before clauses() split on contrastive conjunctions, the trailing "pero
    // no ..." made the whole sentence read as one denial clause and skipped
    // the fabrication check entirely — hiding the Kubernetes claim.
    const audit = auditAnswers({
      profile: fullstackProfile,
      now,
      answers: answers({
        question: "¿Tenés experiencia con Kubernetes y con Redis?",
        answer: "Tengo experiencia con Kubernetes, pero no trabajé con Redis.",
      }),
    });

    const fabricated = audit.filter((p) => p.kind === "fabricated");
    expect(fabricated).toHaveLength(1);
    expect(fabricated[0].detail).toContain("Kubernetes");
  });

  it("leaves an honest no alone when there is nothing better to lead with", () => {
    // The question names a technology the profile lacks, so the answer opening
    // on the gap is the answer being correct — not a defect to warn about.
    const audit = auditAnswers({
      profile: fullstackProfile,
      now,
      answers: answers({
        question: "¿Tenés experiencia con Kubernetes?",
        shortAnswer: "No",
        answer: "No, no trabajé con Kubernetes. Sí administro despliegues sobre PostgreSQL.",
      }),
    });

    expect(audit).toEqual([]);
  });

  it("says nothing about a general question the dates cannot settle", () => {
    const undated = profileSchema.parse({
      fullName: "Sin Fechas",
      experience: [
        { id: "e1", company: "X", role: "Dev", start: "", end: "", bullets: [], tags: ["React"] },
      ],
    });

    const audit = auditAnswers({
      profile: undated,
      now,
      answers: answers({
        question: "¿Cuántos años de experiencia tenés?",
        shortAnswer: "0",
        answer: "Trabajé como desarrollador en X.",
      }),
    });

    expect(audit.filter((p) => p.severity === "error")).toEqual([]);
  });
});

describe("auditAnswers — cv-contradiction", () => {
  const now = new Date(2026, 7, 20);

  const answers = (
    ...entries: { question: string; answer: string; shortAnswer?: string }[]
  ) =>
    answersSchema.parse({
      language: "es",
      answers: entries.map((e) => ({ shortAnswer: "", ...e })),
    });

  const cvWithAngular = cv({
    sections: [
      {
        kind: "experience",
        title: "EXPERIENCIA PROFESIONAL",
        items: [
          {
            company: "Flash Page",
            role: "Desarrollador Full Stack",
            location: "Junín, Argentina",
            dateRange: "Mayo 2024 – actualidad",
            bullets: ["Diseñé arquitecturas frontend con Angular, React y TypeScript."],
          },
        ],
      },
      filler.education,
      filler.skills,
    ],
  });

  it("does not flag an affirmation that follows 'pero' inside a denial-bearing sentence", () => {
    // The real reported bug: "no version details" negates the versions, not
    // Angular/React, which the same sentence affirms right after "pero".
    const audit = auditAnswers({
      profile: fullstackProfile,
      now,
      cv: cvWithAngular,
      answers: answers({
        question: "¿Cuántos años de experiencia tenés con Angular? ¿Qué versiones trabajaste?",
        shortAnswer: "2",
        answer:
          "Tengo 2 años y 5 meses de experiencia con Angular. Las versiones específicas no " +
          "están detalladas en mi perfil, pero mi stack principal incluye Angular junto con " +
          "React y Next.js.",
      }),
    });

    expect(audit.filter((p) => p.kind === "cv-contradiction")).toEqual([]);
  });

  it("does not read 'sin embargo' as the denial word 'sin'", () => {
    const audit = auditAnswers({
      profile: fullstackProfile,
      now,
      cv: cvWithAngular,
      answers: answers({
        question: "¿Tenés experiencia con Angular?",
        answer: "Sin embargo, tengo experiencia con Angular desde 2024.",
      }),
    });

    expect(audit.filter((p) => p.kind === "cv-contradiction")).toEqual([]);
  });

  it("still flags a genuine denial of something the CV asserts", () => {
    const audit = auditAnswers({
      profile: fullstackProfile,
      now,
      cv: cvWithAngular,
      answers: answers({
        question: "¿Tenés experiencia con Angular?",
        answer: "No, no tengo experiencia con Angular.",
      }),
    });

    const found = audit.filter((p) => p.kind === "cv-contradiction");
    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain("Angular");
    expect(found[0].severity).toBe("warning");
  });

  it("still flags a denial joined by 'pero' to an unrelated affirmation", () => {
    const audit = auditAnswers({
      profile: fullstackProfile,
      now,
      cv: cvWithAngular,
      answers: answers({
        question: "¿Tenés experiencia con Angular y con Docker?",
        answer: "No tengo experiencia con Angular, pero sí con Docker.",
      }),
    });

    const found = audit.filter((p) => p.kind === "cv-contradiction");
    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain("Angular");
  });
});

describe("verifyAnswers and answerGaps", () => {
  const now = new Date(2026, 7, 20);
  const answers = answersSchema.parse({
    language: "es",
    answers: [
      {
        question: "¿Cuántos años de experiencia tenés con React y Node.js?",
        answer: "Tengo 0 años de experiencia formal con ese stack.",
        shortAnswer: "0",
        needsUserInput: false,
      },
    ],
  });

  it("reports the same defect to the panel and to the retry", () => {
    const findings = verifyAnswers({ profile: fullstackProfile, answers, now });
    const gaps = answerGaps({ profile: fullstackProfile, answers, now });

    expect(findings.some((f) => f.severity === "error")).toBe(true);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].question).toBe(answers.answers[0].question);
    expect(gaps[0].problem).toContain("27 months");
  });

  it("gives the retry nothing to do when the answers are sound", () => {
    const sound = answersSchema.parse({
      language: "es",
      answers: [
        {
          question: "¿Cuántos años de experiencia tenés con React y Node.js?",
          answer: "Dos años, desde mayo de 2024 en Flash Page.",
          shortAnswer: "2",
          needsUserInput: false,
        },
      ],
    });

    expect(answerGaps({ profile: fullstackProfile, answers: sound, now })).toEqual([]);
  });
});

describe("answerLimitGaps and answerLimitFindings", () => {
  // Questions as the user pastes them: the limit rides inside the text, and
  // both functions parse it themselves — the same parse the prompt used.
  const answers = (
    ...entries: { question: string; answer: string; shortAnswer?: string }[]
  ) =>
    answersSchema.parse({
      language: "es",
      answers: entries.map((e) => ({ shortAnswer: "", ...e })),
    });

  it("tells the retry an over-limit answer is, and by how much", () => {
    // The model echoes the cleaned question the prompt hands it; the limit is
    // parsed again from the raw question it came in as.
    const gaps = answerLimitGaps({
      answers: answers({
        question: "¿Por qué querés trabajar acá?",
        answer: "Me interesa el puesto y su equipo.",
      }),
      questions: ["¿Por qué querés trabajar acá? (máx. 10 caracteres)"],
    });

    expect(gaps).toHaveLength(1);
    expect(gaps[0].question).toBe("¿Por qué querés trabajar acá?");
    expect(gaps[0].problem).toContain("34 characters");
    expect(gaps[0].problem).toContain("at most 10");
  });

  it("gives the retry nothing to do when the answer fits", () => {
    const raw = "¿Por qué querés trabajar acá? (máx. 300 caracteres)";
    expect(
      answerLimitGaps({
        answers: answers({ question: raw, answer: "Me interesa el puesto y su equipo." }),
        questions: [raw],
      }),
    ).toEqual([]);
  });

  it("counts words where the form counts words", () => {
    const raw = "Contá tu experiencia en 2 palabras o menos.";
    const gaps = answerLimitGaps({
      answers: answers({ question: raw, answer: "Uno dos tres cuatro." }),
      questions: [raw],
    });

    expect(gaps[0].problem).toContain("4 words");
    expect(gaps[0].problem).toContain("at most 2");
  });

  it("counts the bare value when that is all there is to paste", () => {
    // A numeric question's pasted text is the shortAnswer; a limit on it is
    // rare but real (a salary band squeezed into a small box).
    const raw = "¿Cuál es tu pretensión salarial? (máx. 3 caracteres)";
    const gaps = answerLimitGaps({
      answers: answers({ question: raw, answer: "", shortAnswer: "1500" }),
      questions: [raw],
    });

    expect(gaps).toHaveLength(1);
    expect(gaps[0].problem).toContain("4 characters");
  });

  it("says nothing about questions that state no limit", () => {
    const raw = "¿Cuál es tu disponibilidad horaria?";
    expect(
      answerLimitGaps({
        answers: answers({ question: raw, answer: "Full time, con flexibilidad." }),
        questions: [raw],
      }),
    ).toEqual([]);
  });

  it("surfaces whatever is still over as a finding the panel shows", () => {
    const raw = "¿Por qué querés trabajar acá? (máx. 10 caracteres)";
    const findings = answerLimitFindings({
      answers: answers({ question: raw, answer: "Me interesa el puesto y su equipo." }),
      questions: [raw],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].field).toBe("answers[0].answer");
    expect(findings[0].detail).toContain("34 caracteres");
    expect(findings[0].detail).toContain("admite 10");
  });

  it("points the finding at the shortAnswer when that is what overflows", () => {
    const raw = "¿Cuál es tu pretensión salarial? (máx. 3 caracteres)";
    const findings = answerLimitFindings({
      answers: answers({ question: raw, answer: "", shortAnswer: "1500" }),
      questions: [raw],
    });

    expect(findings[0].field).toBe("answers[0].shortAnswer");
  });

  it("measures against the explicit limit typed next to the question, not the parsed one", () => {
    // The question states no limit of its own, but the user typed 10 in the
    // field next to it in the UI.
    const raw = "¿Por qué querés trabajar acá?";
    const gaps = answerLimitGaps({
      answers: answers({ question: raw, answer: "Me interesa el puesto y su equipo." }),
      questions: [raw],
      questionLimits: [10],
    });

    expect(gaps).toHaveLength(1);
    expect(gaps[0].problem).toContain("34 characters");
    expect(gaps[0].problem).toContain("at most 10");
  });
});

describe("verifyCV — projects", () => {
  const project = (description: string, name = "Tablero de ventas") => ({
    kind: "projects" as const,
    title: "PROYECTOS",
    items: [{ ref: "P1", name, description, url: "" }],
  });
  const withProject = (description: string) => {
    const base = cv();
    return cv({ sections: [...base.sections, project(description)] });
  };

  it("reads a project's description as prose, and only the description", () => {
    const prose = cvProse(withProject("Tablero para el equipo comercial."));
    const entry = prose.find((line) => line.kind === "projects");
    expect(entry).toEqual({ field: "sections[3].items[0].description", text: "Tablero para el equipo comercial.", kind: "projects" });
    // The name and the link are the profile's, not the model's text.
    expect(prose.map((line) => line.text)).not.toContain("Tablero de ventas");
  });

  it("looks at a description the way it looks at a bullet: an invented number is found", () => {
    const found = inventedFigures(withProject("Lo usan 300 clientes."), devProfile);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ figure: "300", field: "sections[3].items[0].description" });
  });

  it("looks at a description the way it looks at a bullet: a technology nobody stated is an error", () => {
    const findings = verifyCV(withProject("Desplegado sobre Kubernetes."), devProfile);
    expect(findings).toContainEqual(expect.objectContaining({ severity: "error", field: "sections[3].items[0].description", detail: expect.stringContaining("Kubernetes") }));
  });

  it("points a finding at the editable field: its path is one the editor can open", () => {
    const [finding] = verifyCV(withProject("Desplegado sobre Kubernetes."), devProfile);
    expect(parseFieldPath(finding!.field)).toEqual({ kind: "projectDescription", section: 3, item: 0 });
  });

  it("says nothing of a description that sticks to what the profile says", () => {
    expect(verifyCV(withProject("Interfaz del panel de clientes."), devProfile)).toEqual([]);
  });

  it("counts a project as a printed line for the thin-CV floor, with or without a description", () => {
    const seven = (extra: unknown[]) =>
      cv({ sections: [cv().sections[0]!, { ...filler.skills, bullets: filler.skills.bullets.slice(0, 5) }, ...(extra as CVDocument["sections"])] });
    const thin = (document: CVDocument) => verifyCV(document, devProfile).some((finding) => finding.detail.includes("media página"));

    expect(thin(seven([]))).toBe(true);
    expect(thin(seven([project("Tablero para el equipo comercial.")]))).toBe(false);
    expect(thin(seven([project("")]))).toBe(false);
  });
});
