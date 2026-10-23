import { describe, expect, it } from "vitest";
import { buildCVPrompt, BUILD_CV_SYSTEM, CV_REPAIR_FLOOR, STRATEGIES } from "@/lib/ai/prompts/build-cv";
import { profileMaterial, unusedSkills } from "@/lib/ai/prompts/shared";
import type { CVGaps } from "@/lib/ai/verify";
import { jobAnalysisSchema, type JobAnalysis } from "@/lib/schemas/job";
import { profileSchema } from "@/lib/schemas/profile";
import { backendProfile, buriedFrontendProfile, devProfile } from "./fixtures";

/**
 * The prompt is the product's most consequential file and the one with no
 * runtime type to protect it. These pin the parts that a wrong edit would
 * silently undo: the allow/deny split of the posting's vocabulary, and the fact
 * that the candidate's own tools survive whether or not the posting names them.
 */

const uala: JobAnalysis = jobAnalysisSchema.parse({
  title: "Software Engineer Backend",
  company: "Ualá",
  language: "es",
  domain: "software engineering (backend, fintech)",
  relevance: "direct",
  relevanceReason: "Backend engineer applying to a backend role.",
  requirements: [
    { text: "Experiencia sólida en desarrollo backend utilizando Go.", kind: "hard" },
    {
      text: "Conocimientos avanzados de patrones de arquitectura (Clean Architecture, DDD).",
      kind: "hard",
    },
    { text: "Conocimientos avanzados de event sourcing y CQRS.", kind: "hard" },
  ],
  responsibilities: ["Diseñar soluciones backend cloud-native sobre AWS."],
  keywords: ["Go", "AWS", "Clean Architecture", "DDD", "CQRS", "event sourcing", "backend"],
});

function prompt(analysis: JobAnalysis = uala, profile = backendProfile) {
  return buildCVPrompt({ profile, analysis, inferredSkills: [], outputLanguage: "es" });
}

/**
 * `backendProfile` with enough to fill a page from one role: nine different tasks. The budget now reads how much the
 * profile has, and the fixture's own three tasks and twelve tools are a thin profile — the push to fill the sheet
 * is for this one.
 */
const richOneRole = profileSchema.parse({
  ...backendProfile,
  experience: [
    {
      ...backendProfile.experience[0],
      bullets: Array.from({ length: 9 }, (_, i) => `Resolví el problema número ${i + 1} del servicio de pagos.`),
    },
  ],
});

describe("buildCVPrompt — posting vocabulary", () => {
  it("offers the keywords the profile supports", () => {
    const text = prompt();
    const allowed = text.slice(text.indexOf("IN THE PROFILE —"), text.indexOf("NOT IN THE PROFILE"));
    expect(allowed).toContain("Go");
    expect(allowed).toContain("AWS");
  });

  it("forbids by name the ones it does not", () => {
    const text = prompt();
    const forbidden = text.slice(text.indexOf("NOT IN THE PROFILE"), text.indexOf("=== END VOCABULARY"));
    for (const term of ["Clean Architecture", "DDD", "CQRS", "event sourcing"]) {
      expect(forbidden).toContain(term);
    }
    expect(forbidden).not.toContain("Go,");
  });

  it("never forbids ordinary phrasing, which the model needs to write at all", () => {
    const text = prompt();
    const forbidden = text.slice(text.indexOf("NOT IN THE PROFILE"), text.indexOf("=== END VOCABULARY"));
    expect(forbidden).not.toContain("backend");
  });

  it("drops the block when the analysis extracted no keywords", () => {
    const bare = jobAnalysisSchema.parse({ ...uala, keywords: [] });
    expect(prompt(bare)).not.toContain("POSTING VOCABULARY");
  });
});

describe("buildCVPrompt — profile tools", () => {
  it("marks and floats the tools this posting names", () => {
    const tools = prompt()
      .split("\n")
      .find((line) => line.trim().startsWith("tools:"))!;
    expect(tools).toContain("Go*");
    expect(tools.indexOf("Go*")).toBeLessThan(tools.indexOf("Java"));
  });

  it("keeps the tools it does not name, which are the ones that get dropped", () => {
    // The Ualá posting asks for asynchronous systems and never says "Kafka".
    // Filtering the list to literal matches is what loses the candidate's best
    // evidence for the requirement.
    const tools = prompt()
      .split("\n")
      .find((line) => line.trim().startsWith("tools:"))!;
    expect(tools).toContain("Kafka");
    expect(tools).toContain("gRPC");
    expect(tools).not.toContain("Kafka*");
  });
});

describe("buildCVPrompt — overlap block", () => {
  it("surfaces a credential the posting asks for", () => {
    expect(prompt()).toContain("Cloud Practitioner — AWS, 2024");
  });

  it("names what must not be written, requirement by requirement", () => {
    expect(prompt()).toContain("do not write: Clean Architecture, DDD");
  });
});

describe("buildCVPrompt — length budget", () => {
  it("tells a one-role candidate with the material to carry the page", () => {
    const text = prompt(uala, richOneRole);
    expect(text).toContain("12–16");
    expect(text).toContain("The single role carries the page");
  });

  it("falls back to the conservative budget for a long history", () => {
    const many = profileSchema.parse({
      ...backendProfile,
      experience: Array.from({ length: 5 }, (_, i) => ({
        ...backendProfile.experience[0]!,
        id: `e${i}`,
      })),
    });
    const text = prompt(uala, many);
    expect(text).toContain("10–16");
    expect(text).not.toContain("The single role carries the page");
  });
});

/**
 * A "pairs" section went unused across all 53 CVs in the corpus while the
 * prompt merely invited one, and the candidate's AWS certification and English
 * level — both named outright by postings — never appeared. These pin the
 * instruction that replaced the invitation.
 */
describe("buildCVPrompt — required pairs", () => {
  it("demands a pairs section for the credentials the posting asks for", () => {
    const text = prompt();
    expect(text).toContain("=== REQUIRED PAIRS SECTION ===");
    expect(text).toContain('label: "Cloud Practitioner", value: "AWS, 2024"');
  });

  it("matches a language across the posting's own language", () => {
    // The profile says "Inglés"; an English posting says "English". Nothing
    // matched, so the requirement stated most often was the one always missed.
    const english = jobAnalysisSchema.parse({
      ...uala,
      language: "en",
      requirements: [{ text: "Excellent communication skills in English.", kind: "hard" }],
      keywords: ["English", "backend"],
    });

    expect(prompt(english)).toContain('label: "Inglés", value: "Avanzado"');
  });

  it("stays out of the way when the posting asks for no credential", () => {
    const nothing = jobAnalysisSchema.parse({
      ...uala,
      requirements: [{ text: "Experiencia sólida en desarrollo backend utilizando Go.", kind: "hard" }],
      responsibilities: [],
      keywords: ["Go", "backend"],
    });

    expect(prompt(nothing)).not.toContain("REQUIRED PAIRS SECTION");
  });

  /**
   * The practical rows, which is where the model answered with the posting
   * instead of the profile on 4 of 5 measured runs. The value is stated here
   * verbatim so there is nothing left for it to compose.
   */
  const waiter = jobAnalysisSchema.parse({
    ...uala,
    title: "MOZO/A",
    domain: "gastronomía",
    relevance: "unrelated",
    requirements: [
      { text: "Disponibilidad de jueves a domingo de 19:30hs al cierre", kind: "hard" },
    ],
    responsibilities: [],
    keywords: ["mozo", "disponibilidad horaria"],
  });

  it("states the candidate's own availability, verbatim", () => {
    const text = prompt(waiter, devProfile);
    expect(text).toContain('value EXACTLY "Disponibilidad full time, turnos rotativos incluidos"');
    // The posting's hours must never arrive as an instruction about the candidate.
    expect(text).not.toContain('value EXACTLY "Jueves a domingo');
  });

  it("leaves the row's label to the output language rather than imposing it", () => {
    const text = prompt(waiter, devProfile);
    expect(text).toContain("Write the label in the output\n  language");
    expect(text).not.toContain('label: "Disponibilidad"');
  });

  it("says nothing about a fact the profile does not state", () => {
    const relocation = jobAnalysisSchema.parse({
      ...waiter,
      requirements: [{ text: "Disponibilidad para reubicarse a Córdoba", kind: "hard" }],
      keywords: ["reubicación"],
    });

    // `devProfile` leaves `willingToRelocate` unticked, so there is nothing to
    // require and the row must not be demanded at all.
    expect(prompt(relocation, devProfile)).not.toContain("willingToRelocate");
  });
});

/**
 * The deterministic half of "STRIP THE JARGON", which as an instruction alone
 * lost: a CV for a groundskeeping vacancy came back naming Linux servers,
 * firewalls, DNS, SSL/TLS and TeamViewer. Every term is genuinely the
 * candidate's, so no honesty rule could ever have caught it.
 */
describe("buildCVPrompt — jargon ban outside the field", () => {
  const groundskeeping = jobAnalysisSchema.parse({
    ...uala,
    title: "Operario de mantenimiento de espacios verdes",
    domain: "mantenimiento",
    relevance: "unrelated",
    requirements: [{ text: "Experiencia en corte de césped", kind: "hard" }],
    responsibilities: [],
    keywords: ["jardinería", "mantenimiento"],
  });

  it("lists the candidate's own technology as forbidden", () => {
    const text = prompt(groundskeeping);
    expect(text).toContain("IN THE PROFILE AND STILL NOT ALLOWED");
    for (const term of ["Docker", "Kubernetes", "PostgreSQL"]) {
      expect(text).toContain(`- ${term}`);
    }
  });

  it("never fires inside the candidate's own field", () => {
    expect(prompt(uala)).not.toContain("IN THE PROFILE AND STILL NOT ALLOWED");
  });

  it("never fires on an adjacent posting either", () => {
    const adjacent = jobAnalysisSchema.parse({ ...groundskeeping, relevance: "adjacent" });
    expect(prompt(adjacent)).not.toContain("IN THE PROFILE AND STILL NOT ALLOWED");
  });

  it("tells the model where the pairs section goes", () => {
    expect(prompt(groundskeeping)).toContain('The "pairs" section is the exception: it goes LAST');
  });

  /**
   * The prompt used to fabricate the temptation it then banned: `unrelated`
   * printed the headline ("Software Engineer"), the ABOUT paragraph and every
   * role's `tools:` line and STATED SKILLS block, and only afterwards told the
   * model not to use any of it. A CV for a camera-installer vacancy came back
   * naming RBAC, Zero Trust and SSR/SSG/ISR, none of it invented and all of it
   * addressed to a software reader — because the material was still sitting in
   * the prompt a few thousand tokens earlier.
   */
  it("drops the candidate's technology inventory from the profile block outside the field", () => {
    const text = prompt(groundskeeping, devProfile);
    expect(text).not.toContain("HEADLINE:");
    expect(text).not.toContain("ABOUT (the candidate's own words)");
    expect(text).not.toContain("tools:");
    expect(text).not.toContain("STATED SKILLS");
  });

  it("keeps the technology inventory inside the candidate's own field", () => {
    const text = prompt(uala, devProfile);
    expect(text).toContain("HEADLINE:");
    expect(text).toContain("STATED SKILLS");
  });

  /**
   * A term the posting itself asks for is not jargon, even here: a field
   * technician posting naming "Linux" is a case where that background is the
   * job, not overqualification for it. `verifyJargon` and `cvGaps` in
   * `verify.ts` apply the same exemption, so the ban, the warning and the
   * retry all agree on what counts.
   */
  it("exempts a technology the posting itself asks for", () => {
    const linuxProfile = profileSchema.parse({
      ...backendProfile,
      experience: [
        { ...backendProfile.experience[0], tags: [...backendProfile.experience[0].tags, "Linux"] },
      ],
    });
    const fieldSupport = jobAnalysisSchema.parse({
      ...groundskeeping,
      title: "Técnico de soporte de campo",
      domain: "soporte técnico en sitio",
      requirements: [{ text: "Conocimientos de Linux para mantenimiento de equipos", kind: "hard" }],
      keywords: ["Linux"],
    });

    const text = prompt(fieldSupport, linuxProfile);
    const ban = text.slice(
      text.indexOf("IN THE PROFILE AND STILL NOT ALLOWED"),
      text.indexOf("=== END VOCABULARY ==="),
    );
    expect(ban).not.toContain("- Linux");
    // Still true of the candidate and still not asked for by this posting.
    expect(ban).toContain("- Kubernetes");
  });
});

/**
 * Outside the candidate's field, the practical facts (availability, licence,
 * vehicle, work eligibility) are required whether or not the short posting
 * happens to ask about them — see `practicalAsks`. A candidate with a car is a
 * better lead for a field job than one without, and a four-line posting is too
 * short to ever match `PRACTICAL_FACTS[].asks`.
 */
describe("buildCVPrompt — required pairs outside the field", () => {
  it("requires the vehicle row even when the posting never asks for one", () => {
    const shortPosting = jobAnalysisSchema.parse({
      title: "Técnico instalador de cámaras de seguridad",
      language: "es",
      domain: "seguridad electrónica",
      relevance: "unrelated",
      relevanceReason: "—",
      requirements: [],
    });
    const withVehicle = profileSchema.parse({
      ...devProfile,
      practical: { ...devProfile.practical, ownVehicle: true },
    });

    const text = buildCVPrompt({
      profile: withVehicle,
      analysis: shortPosting,
      inferredSkills: [],
      outputLanguage: "es",
    });

    expect(text).toContain("=== REQUIRED PAIRS SECTION ===");
    expect(text).toContain("- ownVehicle: the fact is TRUE of this candidate");
  });
});

describe("buildCVPrompt — length budget, stated as a count", () => {
  it("asks for a count instead of naming the number to avoid", () => {
    // "Do not stop at five" put the number in the prompt, and 36 of 53 CVs came
    // back with exactly five bullets on the one role.
    const text = prompt(uala, richOneRole);
    expect(text).not.toContain("Do not stop at five");
    expect(text).toContain("count the bullets you have written");
  });

  it("tells the model how much material the profile still holds", () => {
    // richOneRole's single role: 9 bullets, 12 tags.
    expect(prompt(uala, richOneRole)).toContain("has 9 bullets and 12 listed tools");
  });
});

/**
 * The profile's bullets arrive in the order the candidate typed them, which is
 * the order the model reads and — left alone — the order it ships. A run for a
 * Python role opened its CV on e-commerce landing pages because that was the
 * first thing in the profile. Counting the overlap here is the same move
 * `serializeVocabulary` makes for keywords: take the judgement off the model.
 */
describe("buildCVPrompt — bullet ordering", () => {
  /** The real posting, reduced: a maquetación role naming no tool this profile states. */
  const maquetacion = jobAnalysisSchema.parse({
    ...uala,
    title: "Desarrollador HTML",
    company: "",
    domain: "maquetación y diseño de interfaces web",
    relevance: "adjacent",
    // "Git" is in the real posting and in this profile — the single incidental
    // hit that decides the top of the list. See the block below it.
    keywords: ["Figma", "WCAG", "Adobe XD", "HTML5", "CSS3", "Git"],
    requirements: [
      { text: "Maquetación de pantallas de ayuda e información de uso.", kind: "hard" },
      { text: "Integrar estas vistas dentro del ecosistema de la aplicación web.", kind: "hard" },
      { text: "Asegurar que las pantallas se lean en móviles, tablets y ordenadores.", kind: "hard" },
    ],
    responsibilities: [
      "Diseñar y estructurar centros de ayuda, guías de inicio y manuales interactivos.",
      "Aplicar estilos visuales a las páginas web de la aplicación.",
    ],
  });

  function bulletLines(text: string): string[] {
    return text
      .slice(text.indexOf("WORK EXPERIENCE"), text.indexOf("EDUCATION:"))
      .split("\n")
      .filter((line) => /^\s+b\d+ /.test(line));
  }

  it("puts the bullet that answers most of the posting first", () => {
    // In the profile, the infrastructure bullet is third of three.
    const infra = jobAnalysisSchema.parse({
      ...uala,
      keywords: ["Docker", "Kubernetes", "AWS", "PostgreSQL"],
    });
    const lines = bulletLines(prompt(infra));

    expect(lines[0]).toContain("Docker, Kubernetes y servicios AWS");
    expect(lines[0]).toContain("[3 matches]");
  });

  it("sinks the bullets that answer nothing this posting asked for", () => {
    const lines = bulletLines(prompt());

    expect(lines[lines.length - 1]).toContain("[0 matches]");
  });

  it("annotates every bullet with what it is ordered by", () => {
    const lines = bulletLines(prompt());

    expect(lines).toHaveLength(backendProfile.experience[0]!.bullets.length);
    for (const line of lines) expect(line).toMatch(/\[\d+ match(es)?\]/);
  });

  it("says one match in the singular", () => {
    expect(bulletLines(prompt()).join("\n")).toContain("[1 match]");
  });

  /**
   * A posting outside the candidate's field, sharing none of their vocabulary:
   * every bullet scores zero and nothing rescues the ranking.
   */
  const nothingInCommon = jobAnalysisSchema.parse({
    ...uala,
    title: "Cajero",
    domain: "retail",
    relevance: "unrelated",
    keywords: ["atención al cliente", "caja"],
    requirements: [],
    responsibilities: [],
  });

  it("keeps the candidate's own order between bullets that score the same", () => {
    // The profile's order is all the information left and must survive.
    const lines = bulletLines(prompt(nothingInCommon)).map((l) => l.replace(/^\s+b\d+ /, ""));

    expect(lines).toEqual(backendProfile.experience[0]!.bullets);
  });

  /**
   * The annotation is worth its line only when it distinguishes something. A
   * wall of "[0 matches]" — which is what a posting outside the candidate's
   * field produces for every bullet they have — tells the model its only
   * material is worthless, at the point where that is the last thing it needs
   * to hear and the point where it starts inventing better-looking material.
   */
  it("drops the match annotation when it separates nothing", () => {
    const text = prompt(nothingInCommon);
    // Scoped to the profile block: `STRATEGIES.direct` quotes the marker in
    // prose ("Bullets marked [0 matches] answer nothing…"), which is not what
    // this is about.
    const block = text.slice(text.indexOf("WORK EXPERIENCE"), text.indexOf("EDUCATION:"));

    expect(block).not.toContain("[0 matches]");
    expect(block).not.toContain("ordered by how much of THIS posting");
    expect(block).toContain("WORK EXPERIENCE:");
  });

  /**
   * The limit of counting keywords, written down because it is real and the
   * obvious fix is worse. A maquetación posting names almost nothing this
   * profile states, so one incidental hit — Git, named by both — decides the top
   * of the list and everything else stays tied in the order it was typed.
   *
   * A tiebreak on ordinary shared vocabulary was built for this and measured
   * against the run that motivated it. It put "Optimicé 300 consultas SQL en
   * PostgreSQL y Redis" above "landing pages de conversión y sitios de
   * portafolio" for a maquetación role, on the strength of "diseño" and
   * "manejo", so it was removed: the prompt presents this order as meaningful,
   * and an order made of coincidences is worse than none. What is left is the
   * honest version — the count, and an instruction that the rest is the model's
   * to read.
   */
  it("still ranks on the one keyword the posting and the profile share", () => {
    const lines = bulletLines(prompt(maquetacion, buriedFrontendProfile));

    expect(lines[0]).toContain("repositorios Git");
    expect(lines[0]).toContain("[1 match]");
  });

  it("tells the model the profile's own order is not a ranking", () => {
    const text = prompt(maquetacion, buriedFrontendProfile);

    expect(text).toContain("SELECTING MATTERS MORE, NOT LESS");
    expect(text).toContain("ranking and must not be used as one");
  });

  it("collapses bullets the candidate typed more than once", () => {
    const lines = bulletLines(prompt(maquetacion, buriedFrontendProfile));
    const modules = lines.filter((l) => l.includes("módulos de negocio personalizados"));

    // Three identical copies in the profile, one line in the prompt.
    expect(modules).toHaveLength(1);
  });

  it("does not put a bullet marker the system prompt forbids into the profile block", () => {
    for (const line of bulletLines(prompt())) expect(line.trimStart().startsWith("*")).toBe(false);
  });

  /**
   * The stated-skills list had neither an order nor a limit, and the model read
   * it the only way a flat list can be read: from the top. A profile with 105
   * skills produced a skills section of Java, JavaScript, TypeScript, Python,
   * Go, Spring Boot, Node.js, MySQL, PostgreSQL, MongoDB, APIs RESTful and SOAP
   * — the first twelve entries, in order — on a CV for an HTML developer whose
   * own profile listed HTML and CSS at the bottom of the same list.
   */
  describe("stated skills", () => {
    const skillsBlock = (analysis: JobAnalysis) => {
      const text = prompt(analysis, buriedFrontendProfile);
      return text.slice(text.indexOf("STATED SKILLS"), text.indexOf("\nLANGUAGES:"));
    };

    it("floats the skills this posting names to the front", () => {
      const block = skillsBlock(maquetacion);
      const first = block.slice(0, block.indexOf("\n") + 200);

      expect(first).toContain("CSS (Tailwind)*");
      expect(first).toContain("HTML*");
      // Ahead of the entries the posting never mentions.
      expect(block.indexOf("HTML*")).toBeLessThan(block.indexOf("SOAP"));
    });

    it("caps the list rather than handing over all 105", () => {
      const block = skillsBlock(maquetacion);
      const listed = block.split(":").slice(1).join(":").split(",").length;

      expect(listed).toBeLessThanOrEqual(41);
      expect(block).toContain("the posting does not name, left out");
    });

    it("keeps the whole list when it fits, and marks nothing without a posting to mark against", () => {
      const text = prompt(maquetacion, backendProfile);
      expect(text).not.toContain("left out");
    });
  });
});

/**
 * The page-fit correction closes the one loop the product measured and then
 * threw away: `CVPreview` renders the CV and compares it to A4, but until this
 * existed "Volver a generar" resent a byte-identical prompt, so the advice the
 * user was given was unfollowable.
 */
describe("buildCVPrompt — measured page fit", () => {
  const withFit = (previousFit?: "over") =>
    buildCVPrompt({
      profile: richOneRole,
      analysis: uala,
      inferredSkills: [],
      outputLanguage: "es",
      previousFit,
    });

  it("says nothing on a first attempt", () => {
    expect(withFit()).not.toContain("MEASURED");
  });

  it("asks for less when it overflowed, without dropping a section", () => {
    const text = withFit("over");
    expect(text).toContain("overflowed");
    expect(text).toContain("Do not drop a whole section");
  });

  it("tells the model the measurement outranks the estimated budget", () => {
    expect(withFit("over")).toContain("The budget above was an estimate");
  });
});

describe("buildCVPrompt — estimates, traits and filler", () => {
  const estimating = profileSchema.parse({
    ...backendProfile,
    experience: [{ ...backendProfile.experience[0], bullets: ["Bajé el abandono del checkout — aprox. 12 %", "Atendí 40 clientes al mes."] }],
  });
  const figures = (profile = estimating) => {
    const text = buildCVPrompt({ profile, analysis: uala, inferredSkills: [], outputLanguage: "es" });
    return text.slice(text.indexOf("=== FIGURES THE CANDIDATE STATED ==="), text.indexOf("=== END FIGURES ==="));
  };

  it("marks the figure the profile gives as an estimate, and says it keeps the mark (PRM-3)", () => {
    const block = figures();
    expect(block).toMatch(/12% \(aprox\.\)/);
    expect(block).not.toContain("40 (aprox.)");
    expect(block).toContain('keeps that\nmark in the rewrite ("aprox.", "approx." or "~")');
  });

  it("says nothing of it where the profile has no estimate", () => {
    const exact = profileSchema.parse({ ...backendProfile, experience: [{ ...backendProfile.experience[0], bullets: ["Atendí 40 clientes al mes."] }] });
    expect(figures(exact)).not.toContain("aprox.");
  });

  it("forbids the traits and the filler by name in the rules for content (PRM-4)", () => {
    const system = BUILD_CV_SYSTEM.replace(/\s+/g, " ");
    expect(system).toContain("No self-assessed traits and no filler, in the summary or in any section");
    for (const trait of ["trabajo en equipo", "proactivo/a", "team player", "synergy"]) expect(system).toContain(`"${trait}"`);
    expect(system).toContain("is answered by a fact the profile states");
  });

  it("no longer suggests «willingness to learn» to a candidate outside their field", () => {
    expect(STRATEGIES.unrelated).not.toContain("willingness to learn");
    expect(STRATEGIES.unrelated.replace(/\s+/g, " ")).toContain("(the reliability or customer contact the profile shows)");
  });
});

describe("buildCVPrompt — the skills section", () => {
  // Dana (§5.5): one role with ten tasks and eight tools, seven of them named by her own lines. Only Figma has no bullet.
  const dana = profileSchema.parse({
    ...backendProfile,
    experience: [
      {
        ...backendProfile.experience[0],
        bullets: [
          "Armé la app en React Native.",
          "Escribí tests con Jest.",
          "Publiqué con Fastlane.",
          "Usé Redux para el estado.",
          "Integré Firebase.",
          "Documenté con Swagger.",
          "Corregí errores de Expo.",
          "Mejoré el arranque.",
          "Armé pantallas nuevas.",
          "Revisé el código de otros.",
        ],
        tags: ["React Native", "Jest", "Fastlane", "Redux", "Firebase", "Swagger", "Expo", "Figma"],
      },
    ],
    skills: [],
  });
  const danaPrompt = () => buildCVPrompt({ profile: dana, analysis: uala, inferredSkills: [], outputLanguage: "es" });

  it("asks a single role with enough material for what the profile has, not for five or six fixed lines (PRM-13)", () => {
    const text = danaPrompt();
    expect(text).toContain("Write 7 bullets, or 8");
    expect(text).toContain("A skills section of up to 2 lines, only with tools a role lists that no bullet had room for.");
    expect(text).toContain("It is not mandatory: leave it out rather than restate a bullet.");
    expect(text).not.toContain("5–6 lines");
    expect(text).not.toContain("mandatory, not a suggestion");
  });

  it("sends the push to fill the page toward tools a role lists, not tools no bullet names (PRM-5)", () => {
    expect(danaPrompt()).toContain("a tool a role lists that no\n  bullet had room for (in the skills section)");
    expect(danaPrompt()).not.toContain("a tool no bullet names");
  });
});

/**
 * Numbers are the only content a rewrite cannot recreate — the honesty rules
 * make the profile their sole source, so one dropped here is gone. The system
 * prompt has said "keep numbers the candidate gave" since it was written and
 * 85% of them still did not reach the CV: an instruction to notice something
 * loses to a list the model can check against.
 */
describe("buildCVPrompt — figures", () => {
  const withFigures = profileSchema.parse({
    ...backendProfile,
    experience: [
      {
        ...backendProfile.experience[0],
        bullets: [
          "Optimicé 500 consultas SQL sobre PostgreSQL y Redis, reduciendo 400 ms la respuesta.",
          "Administré infraestructura cloud con Docker y Kubernetes.",
        ],
      },
    ],
  });

  it("lists every figure the profile states, under the role it came from", () => {
    const text = prompt(uala, withFigures);
    const block = text.slice(text.indexOf("=== FIGURES"), text.indexOf("=== END FIGURES"));

    expect(block).toContain("500");
    expect(block).toContain("400");
    expect(block).toContain(withFigures.experience[0]!.company);
  });

  it("names the failure instead of only stating the rule", () => {
    expect(prompt(uala, withFigures)).toContain("Keeping the bullet and cutting its number");
  });

  it("says nothing at all when the profile states no numbers", () => {
    expect(prompt()).not.toContain("=== FIGURES");
  });
});

/**
 * The retry block: what the previous attempt got wrong, measured in code and fed
 * back. Same closed loop as `previousFit`, for the failures a second attempt can
 * actually fix.
 */
describe("buildCVPrompt — measured gaps", () => {
  const noGaps: CVGaps = {
    droppedFigures: [],
    missingEducation: false,
    contradictedRequirements: [],
    retitledRoles: [],
    copiedBullets: [],
    keywordDumpSections: [],
    summaryRuleViolations: [],
    jargonTerms: [],
    inventedFigures: [],
    overclaimedWork: [],
    droppedApproximations: [],
    selfAssessedTraits: [],
  };

  const withGaps = (gaps?: Partial<CVGaps>) =>
    buildCVPrompt({
      profile: backendProfile,
      analysis: uala,
      inferredSkills: [],
      outputLanguage: "es",
      gaps: gaps && { ...noGaps, ...gaps },
    });

  it("names the copied bullets and says what rewriting means", () => {
    const text = withGaps({
      copiedBullets: [
        "Optimicé sistemas backend sobre PostgreSQL y Redis, mejorando consultas SQL, caching e índices.",
        "Administré infraestructura cloud con Docker, Kubernetes y servicios AWS.",
      ],
    });

    expect(text).toContain("=== MEASURED — FIX THIS ===");
    expect(text).toContain("did not rewrite");
    expect(text).toContain("2 of its");
    expect(text).toContain("Optimicé sistemas backend sobre PostgreSQL");
    // And the way out that is not "pass it through unchanged".
    expect(text).toContain("reason to drop it");
  });

  it("names the section written as a word list", () => {
    const text = withGaps({ keywordDumpSections: ["SKILLS ADICIONALES"] });

    expect(text).toContain('"SKILLS ADICIONALES" as a list of bare words');
  });

  it("quotes the summary back when it says what the candidate wants", () => {
    const text = withGaps({
      summaryRuleViolations: ["Ingeniero full-stack, buscando un rol de Desarrollador HTML."],
    });

    expect(text).toContain("says what the candidate is looking for");
    expect(text).toContain("buscando un rol de Desarrollador HTML");
  });

  it("says nothing on a first attempt", () => {
    expect(withGaps()).not.toContain("MEASURED — FIX THIS");
  });

  it("names the figures that went missing", () => {
    const text = withGaps({ droppedFigures: ["500", "400"] });
    expect(text).toContain("MEASURED — FIX THIS");
    expect(text).toContain("500, 400");
    expect(text).not.toContain("omitted the education section");
  });

  it("asks for the education section back", () => {
    const text = withGaps({ missingEducation: true });
    expect(text).toContain("omitted the education section");
    expect(text).not.toContain("contained no numbers at all");
  });

  it("emits nothing when the gaps object turns out to be empty", () => {
    expect(withGaps({})).not.toContain("MEASURED — FIX THIS");
  });

  /**
   * The two failures added alongside the omissions above. Both are the model
   * contradicting something it can see — the profile's own title, its own
   * coverage report — which is what makes them worth a retry when a fabricated
   * technology is not.
   */
  it("hands back the real job title when the CV invented one", () => {
    const text = withGaps({
      retitledRoles: [{ claimed: "Soporte Técnico y Operaciones", stated: "Software Engineer" }],
    });
    expect(text).toContain('"Soporte Técnico y Operaciones"');
    expect(text).toContain('"Software Engineer"');
    expect(text).toContain("re-titling the post is inventing an employment history");
  });

  it("hands back the numbers the profile never stated and asks for the lines again without them", () => {
    const text = withGaps({ inventedFigures: ["40%", "25"] });
    expect(text).toContain("MEASURED — FIX THIS");
    expect(text).toContain("40%, 25");
    expect(text).toContain("a number nobody");
    expect(text).toContain("keep every figure the");
  });

  it("hands back the estimates the CV stated flat and asks for the word back (VAL-4)", () => {
    const text = withGaps({ droppedApproximations: [{ raw: "12 %", figure: "12%", field: "sections[0].items[0].bullets[1]", line: "Bajé el abandono un 12 %." }] });
    expect(text).toContain("MEASURED — FIX THIS");
    expect(text).toContain("stated as exact 12 %");
    expect(text).toContain('"aprox.", "approx." or\n  "~"');
  });

  it("names the traits the CV said of the candidate and where the way out is (VAL-6)", () => {
    const text = withGaps({ selfAssessedTraits: ["proactivo/a", "trabajo en equipo"] });
    expect(text).toContain('"proactivo/a", "trabajo en equipo"');
    expect(text).toContain("answer it with a fact the profile states");
  });

  it("quotes the line that claims more of the work than the profile does, and names the role", () => {
    const text = withGaps({ overclaimedWork: [{ field: "sections[0].items[1]", where: "Nubesur Estudio", line: "Lideré la definición del roadmap." }] });
    expect(text).toContain('"Lideré la definición del roadmap."');
    expect(text).toContain("the role at Nubesur Estudio");
    expect(text).toContain("more\n  specific, not stronger");
  });

  it("says it is the summary when it is the summary", () => {
    const text = withGaps({ overclaimedWork: [{ field: "summary", where: "", line: "Lidero equipos mobile." }] });
    expect(text).toContain("in the summary");
    expect(text).not.toContain("the role at");
  });

  it("names the requirement the summary and the coverage report disagree on", () => {
    const text = withGaps({ contradictedRequirements: ["Atención al cliente"] });
    expect(text).toContain('"Atención al cliente"');
    expect(text).toContain("only one of them can ship");
  });
});

/**
 * The deny-list for postings the glossary cannot see.
 *
 * `matchKeywords` partitions on `HARD_TERMS`, so a posting naming no technology
 * puts every keyword in `neutral` and the whole "must not appear" block
 * disappears — on exactly the postings where the candidate has least to work
 * with and the model invents most. Dumped for a real groundskeeping ad, the
 * prompt carried no vocabulary block, no overlap block, and a wall of
 * "[0 matches]": no grounding at all, under an order to fill 10–16 bullets.
 */
describe("buildCVPrompt — claims the profile cannot answer", () => {
  const groundskeeping = jobAnalysisSchema.parse({
    title: "Operarios para mantenimiento de espacios verdes",
    company: "",
    language: "es",
    domain: "mantenimiento de espacios verdes y jardinería",
    relevance: "unrelated",
    relevanceReason: "Sin overlap con la experiencia del candidato.",
    requirements: [
      { text: "Experiencia comprobable en corte de césped y mantenimiento de espacios verdes", kind: "hard" },
      { text: "Manejo de bordeadoras y tractor con plataforma de corte", kind: "hard" },
    ],
    responsibilities: [],
    keywords: ["corte de césped", "bordeadoras", "tractor con plataforma de corte"],
  });

  it("names the claims the posting asks for and the profile is silent on", () => {
    const text = prompt(groundskeeping);
    const block = text.slice(text.indexOf("NOTHING IN THE PROFILE ANSWERS THESE"));

    expect(block).toContain("corte de césped");
    expect(block).toContain("bordeadoras");
  });

  it("states the rule in terms of claims, not of product names", () => {
    const text = prompt(groundskeeping);

    expect(text).toContain("is willing to do");
  });

  /**
   * On a direct match the same list would be every ordinary phrase in the ad,
   * which is the documented reason `neutral` is left out: a model told not to
   * write "backend development" stops using its own vocabulary.
   */
  it("stays out of a posting in the candidate's own field", () => {
    expect(prompt()).not.toContain("NOTHING IN THE PROFILE ANSWERS THESE");
  });
});

/**
 * The length budget, which is what actually produced the invented lines.
 *
 * Everything in the budget pushes toward filling the sheet. On a direct posting
 * that pressure lands on material the profile has; outside the candidate's
 * field there is none, and the page gets filled the only way left.
 */
describe("buildCVPrompt — budget outside the candidate's field", () => {
  const unrelated = jobAnalysisSchema.parse({
    ...uala,
    relevance: "unrelated",
    relevanceReason: "Distinto rubro.",
    keywords: [],
    requirements: [],
  });

  it("lowers the target and says the ceiling is not a quota", () => {
    const text = prompt(unrelated);

    expect(text).toContain("Total bullets across all sections: 7–11");
    expect(text).toContain("a ceiling, not a quota");
  });

  it("stops demanding the page be nearly filled", () => {
    expect(prompt(unrelated)).not.toContain("should very\nnearly fill it");
    expect(prompt(uala, richOneRole)).toContain("should very\nnearly fill it");
  });

  it("stops making the skills section mandatory, here and in a profile with the material for it (PRM-13)", () => {
    expect(prompt(unrelated)).not.toContain("mandatory, not a suggestion");
    expect(prompt(uala, richOneRole)).not.toContain("mandatory, not a suggestion");
    expect(prompt(uala, richOneRole)).toContain("It is not mandatory");
  });

  /**
   * Every figure a software profile carries is attached to jargon the strategy
   * orders stripped, so a block insisting they survive is the prompt arguing
   * with itself.
   */
  it("drops the figures block, which the strategy contradicts", () => {
    const withNumbers = profileSchema.parse({
      ...backendProfile,
      experience: [
        {
          ...backendProfile.experience[0],
          bullets: ["Optimicé 500 consultas SQL, reduciendo 40% el tiempo de respuesta."],
        },
      ],
    });
    const forPosting = (analysis: JobAnalysis) =>
      buildCVPrompt({ profile: withNumbers, analysis, inferredSkills: [], outputLanguage: "es" });

    expect(forPosting(uala)).toContain("FIGURES THE CANDIDATE STATED");
    expect(forPosting(unrelated)).not.toContain("FIGURES THE CANDIDATE STATED");
  });

  it("names the availability rule the model kept losing", () => {
    expect(prompt(unrelated)).toContain("THE AVAILABILITY IS THE CANDIDATE'S, NOT THE POSTING'S");
  });
});

/**
 * A blank role reaches the prompt as "(role not given) @ (company not given)"
 * and, worse, counts: the budget branches on how many roles there are, so one
 * unfilled entry moved a one-role profile onto the two-to-three-role budget and
 * halved the page.
 */
describe("buildCVPrompt — blank roles", () => {
  const withBlank = profileSchema.parse({
    ...richOneRole,
    experience: [
      ...richOneRole.experience,
      { id: "blank", company: "", role: "", bullets: [], tags: [] },
    ],
  });

  it("keeps a blank entry out of the profile block", () => {
    const text = buildCVPrompt({
      profile: withBlank,
      analysis: uala,
      inferredSkills: [],
      outputLanguage: "es",
    });

    expect(text).not.toContain("(company not given)");
  });

  it("does not let one change the length budget", () => {
    const text = buildCVPrompt({
      profile: withBlank,
      analysis: uala,
      inferredSkills: [],
      outputLanguage: "es",
    });

    expect(text).toContain("The single role carries the page");
  });
});

/**
 * Skill inference runs once per profile, not once per posting, so the list is
 * everything derivable from the candidate's stack — 46 entries on a real
 * profile, every one a software skill, all of them pasted into a groundskeeping
 * prompt on the same page as "STRIP THE JARGON".
 */
describe("buildCVPrompt — derived skills", () => {
  const skills = [
    // Derived from a term this posting names, so it can carry a requirement.
    { skill: "Goroutines", derivedFrom: "Go", confidence: "high" as const, rationale: "—" },
    { skill: "Poda de arbustos", derivedFrom: "jardinería", confidence: "medium" as const, rationale: "—" },
  ];

  const withSkills = (analysis: JobAnalysis) =>
    buildCVPrompt({ profile: backendProfile, analysis, inferredSkills: skills, outputLanguage: "es" });

  it("keeps the ones this posting asks about", () => {
    expect(withSkills(uala)).toContain("Goroutines");
  });

  it("drops the ones it does not", () => {
    expect(withSkills(uala)).not.toContain("Poda de arbustos");
  });

  // «reviewed by the candidate» was not true of the first CV: nobody had seen the list, and "Git" went from it to a CV
  // whose profile never says it.
  describe("what is left undecided", () => {
    const derived = (prompt: string) => prompt.slice(prompt.indexOf("=== SKILLS ALREADY DERIVED"), prompt.indexOf("=== END DERIVED SKILLS ==="));

    it("does not say the candidate reviewed them, and says they are never written", () => {
      const prompt = withSkills(uala);
      expect(prompt).not.toContain("reviewed by the candidate");
      expect(derived(prompt)).toContain("has not confirmed them");
      expect(derived(prompt)).toContain("Never write one as");
      expect(derived(prompt)).toContain('"inferred": true');
    });

    it("leaves out one the profile already states: that is a fact, not a guess", () => {
      const prompt = buildCVPrompt({
        profile: backendProfile,
        analysis: uala,
        inferredSkills: [{ skill: "Kafka", derivedFrom: "Go", confidence: "high" as const, rationale: "—" }, ...skills],
        outputLanguage: "es",
      });
      expect(derived(prompt)).not.toContain("Kafka");
      expect(derived(prompt)).toContain("Goroutines");
    });
  });
});

/**
 * The budget used to ask for a page without looking at how much the profile had. A role with two tasks was told
 * "write 7 bullets… there is more material than you need", and the five that did not exist were invented. It now reads
 * the profile: what a job may carry is what the profile gives that job, whatever the rest of the profile adds up to.
 */
describe("buildCVPrompt — the budget reads the profile's material", () => {
  const job = (bullets: string[], tags: string[] = [], extra: Record<string, unknown> = {}) => ({
    ...backendProfile.experience[0]!,
    bullets,
    tags,
    ...extra,
  });
  const withProfile = (overrides: Record<string, unknown>) => profileSchema.parse({ ...backendProfile, ...overrides });
  const projects = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `Proyecto ${i}`, description: `Hace la cosa ${i}.` }));

  const unrelated = jobAnalysisSchema.parse({ ...uala, relevance: "unrelated", relevanceReason: "Distinto rubro.", keywords: [], requirements: [] });

  describe("a role with two tasks and nothing else", () => {
    const text = prompt(uala, withProfile({ experience: [job(["Hice A.", "Hice B."])] }));

    it("does not ask for seven bullets or say the profile has more than it needs", () => {
      expect(text).not.toContain("Write 7 bullets");
      expect(text).not.toContain("more material than you need");
      expect(text).not.toContain("you have not run out");
      expect(text).not.toContain("should very\nnearly fill it");
    });

    it("says the line count is a ceiling, with the number the profile holds", () => {
      expect(text).toContain("The profile holds 2 lines of material");
      expect(text).toContain("a ceiling, not a quota");
      expect(text).not.toContain("count the bullets you have written");
      expect(text).not.toContain("add what the profile still");
    });

    it("names the most the role may carry", () => {
      expect(text).toContain("Never more than the profile gives that role (Flash Page: 2)");
    });

    it("makes no skills section out of tools there are none of", () => {
      expect(text).not.toContain("mandatory, not a suggestion");
      expect(text).toContain("No section of tools");
    });
  });

  /** The hole an earlier version left: the whole profile adds up, so the quota came back for a role that has two tasks. */
  describe("a role with two tasks beside plenty of projects and activities", () => {
    const text = prompt(
      uala,
      withProfile({
        experience: [job(["Hice A.", "Hice B."])],
        projects,
        extras: ["Voluntariado", "Club de robótica", "Ayudantía", "Tutoría", "Charlas", "Comunidad"],
      }),
    );

    it("keeps the role at two, and sends the rest of the page to its own sections", () => {
      expect(text).toContain("Never more than the profile gives that role (Flash Page: 2)");
      expect(text).not.toContain("Write 7 bullets");
      expect(text).toContain("Write all 2 bullets");
      expect(text).toContain('a project (in the "projects" section)');
    });

    it("never turns another kind of material into a bullet under a job", () => {
      expect(text).toContain("none becomes a bullet under a job");
    });
  });

  it("holds a role at the profile's count in every branch, outside the field too", () => {
    const poor = withProfile({ experience: [job(["Hice A.", "Hice B."])] });
    expect(prompt(unrelated, poor)).toContain("(Flash Page: 2)");
    expect(prompt(unrelated, poor)).toContain("Write 2 bullets");
    expect(prompt(uala, withProfile({ experience: [job(["A."]), { ...job(["B."]), id: "e2", company: "Acme" }] }))).toContain("(Flash Page: 1, Acme: 1)");
  });

  it("gives three roles of one task each their own ceiling and no quota to fill", () => {
    const text = prompt(
      uala,
      withProfile({ experience: [job(["A."]), { ...job(["B."]), id: "e2", company: "Acme" }, { ...job(["C."]), id: "e3", company: "Zeta" }] }),
    );
    expect(text).toContain("(Flash Page: 1, Acme: 1, Zeta: 1)");
    expect(text).toContain("The profile holds 3 lines");
    expect(text).not.toContain("5–7 bullets");
    expect(text).not.toContain("add what the profile still");
  });

  it("counts a role's tools as at most three lines and never as bullets under it", () => {
    const text = prompt(uala, withProfile({ experience: [job(["A.", "B.", "C."], backendProfile.experience[0]!.tags)] }));
    expect(text).toContain("The profile holds 6 lines");
    expect(text).toContain("A skills section of up to 3 lines");
    expect(text).toContain("(Flash Page: 3)");
  });

  it("keeps today's push for a role with the material to fill the page", () => {
    const text = prompt(uala, richOneRole);
    expect(text).toContain("Write 7 bullets, or 8 if the material supports it");
    expect(text).toContain("there is more material than you need");
    expect(text).toContain("count the bullets you have written");
    expect(text).toContain("(Flash Page: 9)");
  });

  describe("no work history", () => {
    const noJobs = withProfile({ experience: [], projects: projects.slice(0, 3), certifications: [{ id: "c1", name: "Cloud Practitioner", issuer: "AWS" }] });

    for (const [label, analysis] of [["direct", uala], ["unrelated", unrelated]] as const) {
      it(`gets its own text on a ${label} posting`, () => {
        const text = prompt(analysis, noJobs);
        expect(text).toContain("There is no work history in this profile");
        expect(text).toContain("never present a project, a course or an activity as a job");
        for (const absent of ["single role", "0 bullets", "mandatory", "count the bullets", "Never more than the profile gives that role"]) {
          expect(text).not.toContain(absent);
        }
      });
    }

    it("does not count certifications, and sends the projects to their own section", () => {
      const text = prompt(uala, noJobs);
      expect(text).toContain("The profile holds 3 lines");
      expect(text).toContain('The projects go in the "projects" section');
    });
  });

  describe("projects", () => {
    const text = prompt(
      uala,
      withProfile({
        projects: [
          { id: "p1", name: "Turnero", description: "Agenda de turnos.", url: "https://turnero.app" },
          { id: "p2", name: "Blog", description: "", url: "https://blog.example.com" },
          { id: "p3", name: "Solo nombre", description: "", url: "" },
        ],
      }),
    );

    it("labels each by its position and says which have a link, without the link", () => {
      expect(text).toContain("- [P1] Turnero (link on file): Agenda de turnos.");
      expect(text).toContain("- [P2] Blog (link on file)");
      expect(text).not.toContain("turnero.app");
      expect(text).not.toContain("blog.example.com");
    });

    it("does not offer one that is only a name", () => {
      expect(text).not.toContain("Solo nombre");
    });

    it("labels nothing for the generators that do not print a project", async () => {
      const { serializeProfile } = await import("@/lib/ai/prompts/shared");
      expect(serializeProfile(profileSchema.parse({ ...backendProfile, projects: [{ id: "p1", name: "Turnero", description: "Agenda." }] }))).toContain("- Turnero: Agenda.");
    });
  });

  describe("the measured page", () => {
    const fit = (profile: typeof backendProfile, previousFit: "over") =>
      buildCVPrompt({ profile, analysis: uala, inferredSkills: [], outputLanguage: "es", previousFit });
    const thin = withProfile({ experience: [job(["A.", "B."])] });

    it("never sends the model back to fill a short page", () => {
      expect(fit(richOneRole, "over")).not.toContain("add two or three more bullets");
    });

    it("still asks any of them to cut a page that overflowed", () => {
      expect(fit(thin, "over")).toContain("overflowed");
    });
  });

  it("tells a shortened retry not to give a profile without jobs one", () => {
    const floor = CV_REPAIR_FLOOR.replace(/\s+/g, " ");
    expect(floor).toContain("NEVER drop the work experience section if the CV has one");
    expect(floor).toContain("Do not add a work experience section the CV did not have");
  });
});

describe("profileMaterial", () => {
  const rich = profileSchema.parse({
    ...backendProfile,
    experience: [
      { ...backendProfile.experience[0]!, bullets: ["A.", "B.", "a.", "C."], tags: ["Go", "Java", "Spring Boot", "PostgreSQL", "Redis"] },
      { id: "blank", company: "", role: "", bullets: [], tags: [] },
    ],
    skills: ["Go", "Docker"],
    projects: [
      { id: "p1", name: "Con descripción", description: "Algo." },
      { id: "p2", name: "Con link", url: "https://x.example.com" },
      { id: "p3", name: "Solo nombre" },
      { id: "p4", name: "", description: "Sin nombre." },
    ],
    extras: ["Voluntariado", "  "],
    education: [
      { id: "ed1", institution: "UNNOBA", degree: "Analista", highlights: ["Tesis: 9"] },
      { id: "ed2", institution: "Otra", degree: "Curso", highlights: ["Uno", "Dos"] },
      { id: "ed3", institution: "Sin", degree: "Nada" },
    ],
    certifications: [{ id: "c1", name: "Cloud Practitioner" }],
  });

  it("counts each kind by the line it becomes", () => {
    expect(profileMaterial(rich)).toEqual({
      roleBullets: [3], // the repeated task counts once; the blank role is not a role
      projects: 2, // a description or a link; a bare name and a nameless one are not material
      extras: 1,
      studyLines: 2, // one line per study with highlights, however many points
      skillLines: 2, // 5 distinct tools → ceil(5 / 4) lines; Docker is stated but no role or project says where it was used
      total: 3 + 2 + 1 + 2 + 2,
    });
  });

  it("does not count certifications", () => {
    expect(profileMaterial({ ...rich, certifications: [] }).total).toBe(profileMaterial(rich).total);
  });

  it("caps projects at the section's four and tool lines at three", () => {
    const many = profileSchema.parse({
      ...backendProfile,
      projects: Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, description: "x" })),
      skills: Array.from({ length: 40 }, (_, i) => `Tool ${i}`),
    });
    expect(profileMaterial(many)).toMatchObject({ projects: 4, skillLines: 3 });
  });

  it("makes no skills section out of a single line of tools: it needs two", () => {
    expect(profileMaterial(profileSchema.parse({ ...backendProfile, experience: [], skills: ["Go", "Java", "Docker"] })).skillLines).toBe(0);
  });

  it("counts no tools outside the field", () => {
    expect(profileMaterial(backendProfile, { unrelated: true }).skillLines).toBe(0);
  });

  it("counts no stated skill that nothing says where it was used, and counts it once a role lists it (PRM-5)", () => {
    const stated = ["Docker", "MongoDB", "GraphQL", "Figma", "AWS", "Kotlin", "Swift", "Redis"];
    const bare = profileSchema.parse({ ...backendProfile, experience: [{ ...backendProfile.experience[0]!, bullets: ["A."], tags: [] }], skills: stated });
    expect(profileMaterial(bare).skillLines).toBe(0);

    const listed = profileSchema.parse({ ...bare, experience: [{ ...bare.experience[0]!, tags: stated }] });
    expect(profileMaterial(listed).skillLines).toBe(2);
  });
});

describe("unusedSkills (PRM-5)", () => {
  const base = backendProfile.experience[0]!;
  const profile = profileSchema.parse({
    ...backendProfile,
    experience: [{ ...base, bullets: ["Desplegué los servicios en Docker."], tags: ["Redis", "UX"] }],
    projects: [{ id: "p1", name: "Turnero", description: "Hecho con GraphQL.", tags: ["Swift"] }],
    skills: ["Docker", "Redis", "UX", "GraphQL", "Swift", "MongoDB", "Figma"],
  });

  it("is the skills no role lists, no bullet names and no project names", () => {
    expect(unusedSkills(profile)).toEqual(["MongoDB", "Figma"]);
  });

  it("marks them in the stated skills the CV prompt reads, and only them", () => {
    const text = buildCVPrompt({ profile, analysis: uala, inferredSkills: [], outputLanguage: "es" });
    const block = text.slice(text.indexOf("STATED SKILLS"), text.indexOf("\nLANGUAGES:"));
    expect(block).toContain("MongoDB (not used in any role or project)");
    expect(block).toContain("Figma (not used in any role or project)");
    expect(block.match(/not used in any role or project/g)).toHaveLength(2);
  });

  it("is a rule of the system prompt: they are not listed, they go to coverage.omitted", () => {
    const system = BUILD_CV_SYSTEM.replace(/\s+/g, " ");
    expect(system).toContain('A stated skill marked "(not used in any role or project)" is not listed in the CV.');
    expect(system).toContain("Add it to coverage.omitted with the reason that the profile does not show where it was used.");
  });
});

describe("the prompt's rules for rewriting", () => {
  it("lets the opening verb change but never climb a level (PRM-2)", () => {
    expect(STRATEGIES.direct).toContain("never to one that claims more of the");
    expect(STRATEGIES.direct).toContain('"Participé", "colaboré", "apoyé", "ayudé"');
    expect(STRATEGIES.direct).not.toContain("rarely the profile's");
  });

  it("asks for a result or scope per role and bans the empty openers (PRM-2)", () => {
    expect(BUILD_CV_SYSTEM).toContain("action + what + result or scope");
    expect(BUILD_CV_SYSTEM).toContain('Never open on\n  "Responsable de"');
    expect(BUILD_CV_SYSTEM).toContain("Never estimate a number to make the line land");
    expect(BUILD_CV_SYSTEM).not.toContain("Start bullets with a past-tense action verb");
  });

  it("forbids adding a detail the profile does not state, and attaching the posting's specifics to past work (PRM-15)", () => {
    expect(BUILD_CV_SYSTEM).toContain("It may not add a\n  detail the profile does not state");
    expect(BUILD_CV_SYSTEM).toContain("never attach their specifics to the candidate's\n  past work");
  });
});

describe("the order of the sections and the activities (PRM-7, REN-7)", () => {
  const section = (text: string) => text.replace(/\s+/g, " ");

  it("says the order follows the candidate's stage, for a direct match and an adjacent role, and not outside the field", () => {
    for (const strategy of [STRATEGIES.direct, STRATEGIES.adjacent]) {
      const text = section(strategy);
      expect(text).toContain("Section order is applied after you answer, from the candidate's stage");
      expect(text).toContain("education first (with the expected graduation date), then projects, experience and activities");
      expect(text).toContain("teaching, student organisations (with the role held), research and hackathons are real evidence");
      expect(text).toContain("For a long career, leave them out unless the posting asks for what they show.");
      expect(text).not.toContain("Section order: experience, then education");
    }
    expect(section(STRATEGIES.unrelated)).not.toContain("applied after you answer");
  });

  it("labels the profile's other data [O1], [O2]… for the CV, and keeps them plain everywhere else", () => {
    const text = prompt(uala, profileSchema.parse({ ...backendProfile, extras: ["Presido el Club de Robótica.", "  ", "Doy clases de apoyo."] }));
    expect(text).toContain("- [O1] Presido el Club de Robótica.");
    expect(text).toContain("- [O3] Doy clases de apoyo.");
    expect(text).not.toContain("[O2]");
  });

  it("asks the model to point at an activity by its reference and leave the words to the profile", () => {
    const system = section(BUILD_CV_SYSTEM);
    expect(system).toContain('go in an "activities" section, at most 4');
    expect(system).toContain('copy its [On] reference from the profile\'s OTHER block into "ref" and leave "text" as an empty string');
    expect(system).toContain('An "activities" section: 1 to 4 items.');
  });

  it("sends the activities to their own section, in a profile with too little to fill a skills one and in one with no jobs", () => {
    const toolless = backendProfile.experience.map((job) => ({ ...job, tags: [] }));
    const thin = prompt(uala, profileSchema.parse({ ...backendProfile, experience: toolless, skills: [], extras: ["Presido el club.", "Doy clases."] }));
    expect(section(thin)).toContain('The activities and volunteering it lists go in an "activities" section.');
    expect(section(thin)).not.toContain("short section of their own");
    const noJobs = prompt(uala, profileSchema.parse({ ...backendProfile, experience: [], extras: ["Presido el club."] }));
    expect(section(noJobs)).toContain('the activities in the "activities" section');
  });
});
