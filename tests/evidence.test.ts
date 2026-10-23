import { describe, expect, it } from "vitest";
import {
  buildEvidenceIndex,
  collectFigures,
  experienceFacts,
  extractFigures,
  findUnsupportedTerms,
  isHardTerm,
  matchKeywords,
  mergedMonths,
  roleSpans,
  statedHardTerms,
  statedYearsOfExperience,
  supports,
  technologyTenure,
} from "@/lib/ai/evidence";
import { profileSchema } from "@/lib/schemas/profile";
import { backendProfile, devProfile, fullstackProfile } from "./fixtures";

/**
 * These cases are drawn from a real failure: asked for a Go backend role that
 * listed Clean Architecture, DDD, event sourcing and CQRS, the model wrote all
 * four into a CV whose profile mentions none of them, while dropping Kafka and
 * gRPC — which the profile does state, and which were the posting's best
 * matches.
 */

const index = buildEvidenceIndex(backendProfile);

describe("supports", () => {
  it("finds a term stated as a tag", () => {
    expect(supports(index, "Kafka")).toBe(true);
    expect(supports(index, "gRPC")).toBe(true);
  });

  it("finds a term stated only in a bullet", () => {
    expect(supports(index, "caching")).toBe(true);
  });

  it("finds a term stated only in a certification", () => {
    expect(supports(index, "Cloud Practitioner")).toBe(true);
  });

  it("ignores casing, accents and punctuation", () => {
    expect(supports(index, "postgresql")).toBe(true);
    expect(supports(index, "asincrono")).toBe(true);
  });

  it("rejects a term the profile never states", () => {
    expect(supports(index, "Clean Architecture")).toBe(false);
    expect(supports(index, "CQRS")).toBe(false);
    expect(supports(index, "Rust")).toBe(false);
  });

  it("does not match a phrase spanning two unrelated profile entries", () => {
    // "…Kafka, gRPC…" and "…Docker…" are separate tags; the join must not
    // let a phrase straddle them.
    expect(supports(index, "gRPC Docker")).toBe(false);
  });

  it("does not match a substring of a longer word", () => {
    expect(supports(index, "Go")).toBe(true);
    expect(supports(index, "Gom")).toBe(false);
  });

  /**
   * Drawn from a second real failure: a profile stating "HTML" and "CSS
   * (Tailwind)" was told, by a posting for an HTML developer, that neither
   * HTML5 nor CSS3 was mentioned in it — and offered a chip to add the skill it
   * already had.
   */
  describe("version suffixes", () => {
    const frontend = buildEvidenceIndex(
      profileSchema.parse({
        fullName: "Test",
        skills: ["HTML", "CSS (Tailwind)", "JavaScript", "Vue", "Python"],
      }),
    );

    it("answers a versioned term with the unversioned one", () => {
      expect(supports(frontend, "HTML5")).toBe(true);
      expect(supports(frontend, "CSS3")).toBe(true);
      expect(supports(frontend, "ES6+")).toBe(true);
      expect(supports(frontend, "Vue 3")).toBe(true);
      expect(supports(frontend, "Python 3")).toBe(true);
    });

    it("answers JS and JavaScript for each other", () => {
      expect(supports(frontend, "JS")).toBe(true);
      expect(supports(buildEvidenceIndex(profileSchema.parse({ fullName: "T", skills: ["JS"] })), "JavaScript")).toBe(
        true,
      );
    });

    it("still rejects a technology the profile never states", () => {
      expect(supports(frontend, "Angular")).toBe(false);
      expect(supports(frontend, "Sass")).toBe(false);
      // The version table is not a licence to strip digits: S3 is not "S".
      expect(supports(frontend, "S3")).toBe(false);
      expect(supports(frontend, "OAuth2")).toBe(false);
    });

    it("answers Vue.js and VueJS for Vue and the other way round, the version group and all", () => {
      const vueJs = buildEvidenceIndex(profileSchema.parse({ fullName: "T", skills: ["Vue.js"] }));
      for (const term of ["Vue", "VueJS", "Vue 3", "Vue3"]) expect(supports(vueJs, term)).toBe(true);
      expect(supports(frontend, "Vue.js")).toBe(true);
      expect(supports(frontend, "VueJS")).toBe(true);
    });

    it("does not let accessibility answer for WCAG", () => {
      const a11y = buildEvidenceIndex(
        profileSchema.parse({ fullName: "T", skills: ["Accesibilidad web"] }),
      );
      expect(supports(a11y, "a11y")).toBe(true);
      expect(supports(a11y, "accessibility")).toBe(true);
      // A specific standard, not a synonym for the practice.
      expect(supports(a11y, "WCAG")).toBe(false);
    });
  });
});

describe("isHardTerm", () => {
  it("accepts named technologies and patterns", () => {
    expect(isHardTerm("Clean Architecture")).toBe(true);
    expect(isHardTerm("Kubernetes")).toBe(true);
  });

  it("accepts bare acronyms", () => {
    expect(isHardTerm("CQRS")).toBe(true);
    expect(isHardTerm("DDD")).toBe(true);
    expect(isHardTerm("CI/CD")).toBe(true);
  });

  it("rejects descriptive phrasing the model must stay free to use", () => {
    expect(isHardTerm("Backend development")).toBe(false);
    expect(isHardTerm("diseño de APIs")).toBe(false);
    expect(isHardTerm("trabajo en equipo")).toBe(false);
  });
});

/**
 * The complement of `findUnsupportedTerms`, and the reason both share one walk:
 * outside the candidate's field the true technology claims are the problem. A CV
 * written for a groundskeeping vacancy came back naming Linux servers, DNS,
 * SSL/TLS and TeamViewer — all of them the candidate's, all of them reading as
 * overqualification to the person hiring.
 */
describe("statedHardTerms", () => {
  it("names the technology the profile does back", () => {
    const bullet =
      "Administré infraestructura cloud con Docker y Kubernetes, sobre PostgreSQL y Redis.";

    const found = statedHardTerms(bullet, index);
    for (const term of ["Docker", "Kubernetes", "PostgreSQL", "Redis"]) {
      expect(found).toContain(term);
    }
  });

  it("catches the acronyms too, which is where the field jargon hides", () => {
    // "AWS" and "gRPC" are the candidate's, and on a groundskeeping vacancy they
    // are still the wrong thing to put on the page.
    const found = statedHardTerms("Expuse APIs gRPC desplegadas en AWS.", index);
    expect(found).toContain("AWS");
    expect(found).toContain("gRPC");
  });

  it("is the exact complement of findUnsupportedTerms", () => {
    const bullet =
      "Desplegué microservicios con Docker y Kubernetes en AWS aplicando Clean Architecture.";

    expect(statedHardTerms(bullet, index)).toEqual(
      expect.arrayContaining(["Docker", "Kubernetes", "AWS"]),
    );
    // A term cannot be both, and the fabricated one belongs to the other list.
    expect(statedHardTerms(bullet, index)).not.toContain("Clean Architecture");
    expect(findUnsupportedTerms(bullet, index)).toContain("Clean Architecture");
  });

  it("finds nothing in a line that names no technology", () => {
    expect(statedHardTerms("Atendí al público y manejé la caja.", index)).toEqual([]);
  });
});

// M6–M8 of the audit: the person wrote the short name and the CV, following the posting, the long one.
describe("abbreviations", () => {
  const stating = (...skills: string[]) => buildEvidenceIndex(profileSchema.parse({ fullName: "T", skills }));

  it.each([
    ["Node", "Node.js"],
    ["Node", "NodeJS"],
    ["Postgres", "PostgreSQL"],
    ["K8s", "Kubernetes"],
    ["ReactJS", "React"],
    ["React.js", "React"],
    ["Express", "Express.js"],
    ["ExpressJS", "Express"],
    ["VueJS", "Vue.js"],
  ])("a profile that says %s answers for %s", (said, asked) => {
    expect(supports(stating(said), asked)).toBe(true);
  });

  it.each([
    ["Node.js", "Node"],
    ["PostgreSQL", "Postgres"],
    ["Kubernetes", "K8s"],
    ["React", "ReactJS"],
    ["Express.js", "Express"],
  ])("a profile that says %s answers for %s", (said, asked) => {
    expect(supports(stating(said), asked)).toBe(true);
  });

  it("flags the long name no more than the short one when the profile has neither", () => {
    const none = stating("Docker");
    for (const term of ["Node.js", "PostgreSQL", "Kubernetes", "React", "Express.js"]) expect(supports(none, term)).toBe(false);
  });

  it("does not read React as React Native", () => {
    expect(supports(stating("ReactJS"), "React Native")).toBe(false);
  });

  // «RN» is also a nurse, «TS» a transport stub and «Go» a word: they are asked of the person (`abbreviated_skill`), not read as the long name.
  it.each([
    ["RN", "React Native"],
    ["TS", "TypeScript"],
    ["Go", "Golang"],
  ])("a profile that says %s does not answer for %s", (said, asked) => {
    expect(supports(stating(said), asked)).toBe(false);
  });

  it("leaves a CV that writes the long name alone when the profile wrote the short one", () => {
    const cv = "Servicios en Node.js sobre PostgreSQL, desplegados en Kubernetes con una interfaz en React y un servidor con Express.js.";
    expect(findUnsupportedTerms(cv, stating("Node", "Postgres", "K8s", "ReactJS", "Express"))).toEqual([]);
  });
});

describe("findUnsupportedTerms", () => {
  it("flags the patterns the model copied from the posting", () => {
    const summary =
      "Ingeniero de Software especializado en backend con conocimientos avanzados en Go, " +
      "Java, Spring Boot, AWS y patrones de arquitectura como Clean Architecture y DDD.";

    const found = findUnsupportedTerms(summary, index);
    expect(found).toContain("Clean Architecture");
    expect(found).toContain("DDD");
  });

  it("flags event sourcing, CQRS, microservicios and serverless", () => {
    const bullet =
      "Diseñé microservicios con event sourcing y CQRS, desplegados como funciones serverless.";

    const found = findUnsupportedTerms(bullet, index);
    for (const term of ["Event Sourcing", "CQRS", "Microservicios", "Serverless"]) {
      expect(found).toContain(term);
    }
  });

  it("leaves everything the profile actually states alone", () => {
    const bullet =
      "Optimicé sistemas backend sobre PostgreSQL y Redis, con eventos en Kafka y APIs REST/gRPC, " +
      "desplegados con Docker y Kubernetes en AWS.";

    expect(findUnsupportedTerms(bullet, index)).toEqual([]);
  });

  it("does not report a fragment of a pattern it already named", () => {
    const found = findUnsupportedTerms("Apliqué Domain Driven Design en el diseño.", index);
    expect(found).toEqual(["Domain Driven Design"]);
  });

  it("does not flag an ordinary word that shares a glossary entry's spelling", () => {
    // "Go" is a language; "go to market" is not a claim about one. The profile
    // states Go anyway, so use a profile that does not.
    const bare = buildEvidenceIndex(profileSchema.parse({ fullName: "Sin Tags" }));
    expect(findUnsupportedTerms("Trabajé en estrategias go to market.", bare)).toEqual([]);
    expect(findUnsupportedTerms("Escribí servicios en Go.", bare)).toEqual(["Go"]);
  });

  // The tools a run put on CVs whose profile never said them ("Control de versiones con Git y gestión de
  // paquetes con npm/yarn"): the glossary did not know them, so neither the prompt nor `verifyCV` said a word.
  describe("everyday tooling", () => {
    const TOOLS = [
      "Git", "GitHub", "npm", "yarn", "pnpm", "Postman", "Bash", "Webpack", "Vite", "ESLint", "Redux", "Expo",
      "Firebase", "Swagger", "Excel", "Fastlane", "Express",
    ];
    const without = buildEvidenceIndex(profileSchema.parse({ fullName: "Sin Tags" }));

    it.each(TOOLS)("flags %s in a profile that does not have it", (tool) => {
      expect(findUnsupportedTerms(`Trabajé todos los días con ${tool} en el equipo.`, without)).toEqual([tool]);
    });

    it.each(TOOLS)("does not flag %s in a profile that does", (tool) => {
      const has = buildEvidenceIndex(profileSchema.parse({ fullName: "Con Tag", skills: [tool] }));
      expect(findUnsupportedTerms(`Trabajé todos los días con ${tool} en el equipo.`, has)).toEqual([]);
    });

    it("does not flag the ordinary words Express, Excel and Expo", () => {
      expect(findUnsupportedTerms("Quiero excel en lo que hago, con un envío express a la expo.", without)).toEqual([]);
    });

    it("names GitHub, not Git, when the text says GitHub", () => {
      expect(findUnsupportedTerms("Repositorios en GitHub.", without)).toEqual(["GitHub"]);
    });
  });

  // The `unrelated` strategy is told to put the licence on the CV, and the
  // acronym check reads a bare "B1" as a technology claim. Left out of the
  // index, a CV stating the user's real licence came back as a fabrication.
  it("does not flag a driving licence the profile states", () => {
    const licensed = buildEvidenceIndex(devProfile);
    expect(supports(licensed, "B1")).toBe(true);
    expect(findUnsupportedTerms("Licencia de conducir B1.", licensed)).toEqual([]);
  });

  it("does not treat company abbreviations as technology claims", () => {
    expect(findUnsupportedTerms("Trabajé en Talleres Digitales SRL.", index)).toEqual([]);
  });

  it("returns nothing for empty text", () => {
    expect(findUnsupportedTerms("   ", index)).toEqual([]);
  });
});

describe("matchKeywords", () => {
  it("splits the posting's keywords three ways", () => {
    const partition = matchKeywords(index, [
      "Go",
      "Kafka",
      "Clean Architecture",
      "CQRS",
      "event sourcing",
      "Backend development",
      "trabajo en equipo",
    ]);

    expect(partition.supported).toEqual(["Go", "Kafka"]);
    expect(partition.fabricable).toEqual(["Clean Architecture", "CQRS", "event sourcing"]);
    expect(partition.neutral).toEqual(["Backend development", "trabajo en equipo"]);
  });

  it("never forbids a descriptive phrase, so the model keeps its vocabulary", () => {
    const partition = matchKeywords(index, ["API design", "Query tuning"]);
    expect(partition.fabricable).toEqual([]);
    expect(partition.neutral).toHaveLength(2);
  });

  it("ignores blank entries", () => {
    expect(matchKeywords(index, ["", "  "])).toEqual({
      supported: [],
      fabricable: [],
      neutral: [],
    });
  });
});

describe("statedYearsOfExperience", () => {
  const now = new Date(2026, 7, 11); // 2026-08-11

  it("counts a current role up to today", () => {
    // Mayo 2024 – Agosto 2026 is 27 months.
    expect(statedYearsOfExperience(backendProfile, now)).toBe(2);
  });

  it("sums closed roles", () => {
    // Enero 2019 – Febrero 2021 plus Marzo 2021 – Agosto 2024: 25 + 41 months.
    expect(statedYearsOfExperience(devProfile, now)).toBe(5);
  });

  it("returns 0 when no date can be parsed, so the check stays silent", () => {
    const undated = profileSchema.parse({
      fullName: "Sin Fechas",
      experience: [{ id: "e1", company: "X", role: "Y", start: "", end: "", bullets: [], tags: [] }],
    });
    expect(statedYearsOfExperience(undated, now)).toBe(0);
  });
});

/**
 * Figures are the one thing on a CV that a rewrite cannot recreate: the
 * candidate typed each one, the honesty rules forbid producing another, and
 * across 69 real applications 85% of them never reached the page.
 */
describe("extractFigures", () => {
  it("finds a plain count and a percentage", () => {
    expect(extractFigures("Optimicé 500 consultas y reduje 35% el tiempo.")).toEqual([
      "500",
      "35%",
    ]);
  });

  it("normalises a grouping separator so the same figure compares equal", () => {
    expect(extractFigures("hasta 1.000 usuarios")).toEqual(["1000"]);
    expect(extractFigures("hasta 1,000 usuarios")).toEqual(["1000"]);
    expect(extractFigures("hasta 1000 usuarios")).toEqual(["1000"]);
  });

  it("keeps a decimal, which is a different claim from the integer", () => {
    expect(extractFigures("de 4s a 1,2s")).toEqual(["4", "1.2"]);
  });

  it("does not read trailing punctuation as part of the number", () => {
    expect(extractFigures("Reduje 400, que es mucho.")).toEqual(["400"]);
  });

  it("finds nothing in prose without numbers", () => {
    expect(extractFigures("Colaboré con equipos de desarrollo.")).toEqual([]);
  });

  // A digit glued to a word is part of a name. Without this the profile's
  // OAuth2 reported "2" as a figure every CV that wrote "OAuth" had lost.
  it("ignores a digit that belongs to a technology name", () => {
    expect(extractFigures("Implementé JWT, OAuth2 y RBAC.")).toEqual([]);
    expect(extractFigures("Desplegué en S3 y EC2 con Log4j.")).toEqual([]);
  });

  it("still reads a quantity whose unit is glued to it", () => {
    expect(extractFigures("Bajé la respuesta a 400ms.")).toEqual(["400"]);
  });
});

describe("collectFigures", () => {
  it("dedupes across texts, keeping first-seen order", () => {
    expect(collectFigures(["reduje 400 ms", "otros 400 ms y 35%"])).toEqual(["400", "35%"]);
  });
});

/**
 * The arithmetic the answer generator used to do in its head.
 *
 * `now` is fixed at 2026-08-20 throughout, which is 27 months after the Mayo
 * 2024 start every fixture below shares — the same span that produced the
 * "0 años" answer this machinery exists to make impossible.
 */
describe("technologyTenure", () => {
  const now = new Date(2026, 7, 20);

  it("counts each technology on its own, not their intersection", () => {
    const tenures = technologyTenure(fullstackProfile, ["React", "TypeScript", "Node.js"], now);

    expect(tenures.map((t) => t.term)).toEqual(["React", "TypeScript", "Node.js"]);
    for (const tenure of tenures) {
      expect(tenure.months).toBe(27);
      expect(tenure.dated).toBe(true);
    }
  });

  it("names where each one was used", () => {
    const [react] = technologyTenure(fullstackProfile, ["React"], now);
    expect(react.roles).toEqual([
      {
        role: "Desarrollador Full Stack",
        company: "Flash Page",
        period: "Mayo 2024 – present",
      },
    ]);
  });

  it("matches a technology stated only in a bullet", () => {
    // The tags carry "Node.js"; the bullet is where "arquitecturas frontend"
    // lives, and a posting asking about it must still find the role.
    const [found] = technologyTenure(fullstackProfile, ["PostgreSQL"], now);
    expect(found.months).toBe(27);
  });

  it("omits a technology the profile never states", () => {
    expect(technologyTenure(fullstackProfile, ["Kubernetes"], now)).toEqual([]);
  });

  it("dedupes terms, keeping the first spelling", () => {
    const tenures = technologyTenure(fullstackProfile, ["React", "react", "REACT"], now);
    expect(tenures.map((t) => t.term)).toEqual(["React"]);
  });

  it("reports experience with unreadable dates as undated rather than as zero", () => {
    const undated = profileSchema.parse({
      fullName: "Sin Fechas",
      experience: [
        { id: "e1", company: "X", role: "Dev", start: "", end: "", bullets: [], tags: ["React"] },
      ],
    });

    const [react] = technologyTenure(undated, ["React"], now);
    expect(react.dated).toBe(false);
    expect(react.roles).toHaveLength(1);
  });

  it("marks a bullet/tag match as linked", () => {
    const [react] = technologyTenure(fullstackProfile, ["React"], now);
    expect(react.linked).toBe(true);
  });

  it("credits a technology stated only in the profile's skills list, not in any bullet or tag", () => {
    const withAngular = { ...fullstackProfile, skills: [...fullstackProfile.skills, "Angular"] };
    const [angular] = technologyTenure(withAngular, ["Angular"], now);

    expect(angular.linked).toBe(false);
    expect(angular.months).toBe(27);
    expect(angular.dated).toBe(true);
    expect(angular.roles).toEqual([
      { role: "Desarrollador Full Stack", company: "Flash Page", period: "Mayo 2024 – present" },
    ]);
  });

  it("excludes a role with no technical signal from a skills-only credit", () => {
    // devProfile's second role (Atención al público, empty tags, no technical
    // bullets) must not inherit a skill declared only in the flat skills list.
    const withAngular = { ...devProfile, skills: [...devProfile.skills, "Angular"] };
    const [angular] = technologyTenure(withAngular, ["Angular"], now);

    expect(angular.linked).toBe(false);
    expect(angular.months).toBe(41);
    expect(angular.roles).toEqual([
      { role: "Desarrollador Frontend", company: "Talleres Digitales SRL", period: "Marzo 2021 – Agosto 2024" },
    ]);
  });

  it("does not credit a skills-only term when there is no career to credit it against", () => {
    const noExperience = profileSchema.parse({ fullName: "Sin Experiencia", skills: ["Angular"] });
    expect(technologyTenure(noExperience, ["Angular"], now)).toEqual([]);
  });

  it("does not invent a tenure entry for a skills-list phrase that is not a named technology", () => {
    const withPhrase = { ...fullstackProfile, skills: [...fullstackProfile.skills, "Trabajo en equipo"] };
    expect(technologyTenure(withPhrase, ["Trabajo en equipo"], now)).toEqual([]);
  });
});

describe("mergedMonths", () => {
  const now = new Date(2026, 7, 20);

  it("counts overlapping roles once", () => {
    // A day job and a concurrent contract over the same year are twelve months
    // of experience, not twenty-four.
    const concurrent = profileSchema.parse({
      fullName: "Dos Trabajos",
      experience: [
        { id: "e1", company: "A", role: "Dev", start: "Enero 2024", end: "Enero 2025", bullets: [], tags: [] },
        { id: "e2", company: "B", role: "Freelance", start: "Marzo 2024", end: "Enero 2025", bullets: [], tags: [] },
      ],
    });

    expect(mergedMonths(roleSpans(concurrent, now))).toBe(12);
    expect(statedYearsOfExperience(concurrent, now)).toBe(1);
  });

  it("keeps consecutive roles separate", () => {
    // devProfile's two roles do not overlap: 25 + 41 months.
    expect(mergedMonths(roleSpans(devProfile, now))).toBe(66);
  });
});

describe("experienceFacts", () => {
  const now = new Date(2026, 7, 20);

  it("takes its terms from the question, not only from the posting", () => {
    const facts = experienceFacts({
      profile: fullstackProfile,
      questions: ["¿Cuántos años de experiencia tenés con React.js, TypeScript y Node.js?"],
      keywords: [],
      now,
    });

    // "React.js" comes back as the glossary's canonical "React" — the term is
    // echoed as the evidence index knows it, not as the question spelled it.
    expect(facts.tenures.map((t) => t.term.toLowerCase()).sort()).toEqual([
      "node.js",
      "react",
      "typescript",
    ]);
    expect(facts.totalMonths).toBe(27);
    expect(facts.dated).toBe(true);
  });

  it("lists a named technology the profile lacks, without inventing a gap out of prose", () => {
    const facts = experienceFacts({
      profile: fullstackProfile,
      questions: ["¿Trabajaste con Kubernetes?"],
      keywords: ["trabajo en equipo", "Kubernetes"],
      now,
    });

    expect(facts.absent).toEqual(["Kubernetes"]);
  });

  it("reports undated experience as undated so no number can be shown", () => {
    const undated = profileSchema.parse({
      fullName: "Sin Fechas",
      experience: [
        { id: "e1", company: "X", role: "Dev", start: "", end: "", bullets: [], tags: ["React"] },
      ],
    });

    const facts = experienceFacts({ profile: undated, questions: ["¿Años con React?"], now });
    expect(facts.dated).toBe(false);
    expect(facts.totalMonths).toBe(0);
  });

  it("does not list a skills-only technology as absent, and still gives it a tenure", () => {
    const withAngular = { ...fullstackProfile, skills: [...fullstackProfile.skills, "Angular"] };
    const facts = experienceFacts({
      profile: withAngular,
      questions: ["¿Cuántos años de experiencia tenés con Angular?"],
      now,
    });

    expect(facts.absent).not.toContain("Angular");
    expect(facts.tenures.find((t) => t.term === "Angular")).toMatchObject({
      months: 27,
      linked: false,
    });
  });
});
