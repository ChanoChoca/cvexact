import { describe, expect, it } from "vitest";
import {
  ANSWER_QUESTIONS_SYSTEM,
  buildAnswersPrompt,
} from "@/lib/ai/prompts/answer-questions";
import { jobAnalysisSchema, type JobAnalysis } from "@/lib/schemas/job";
import { profileSchema } from "@/lib/schemas/profile";
import { fullstackProfile } from "./fixtures";

/**
 * The answer generator's job is to be honest without being self-defeating, and
 * the two used to be in tension because only one of them was in the prompt.
 *
 * Asked "¿cuántos años de experiencia tenés con React.js, TypeScript y
 * Node.js?", a profile holding all three since May 2024 answered "0 años ...
 * como combinación específica". That is false by more than two years, and it
 * goes into an employer's form under the candidate's name. These cases pin the
 * two changes that make it unavailable: the arithmetic arrives computed, and
 * the prompt says each technology is counted on its own.
 */

/**
 * The prompt as one line. Every assertion about its wording goes through this:
 * the source is hard-wrapped for reading, and a test that pins where the wrap
 * falls fails the next time a sentence is edited by a word.
 */
const flat = (text: string) => text.replace(/\s+/g, " ");

/** 27 months after the fixture's Mayo 2024 start. */
const NOW = new Date(2026, 7, 20);

const QUESTION = "¿Cuántos años de experiencia tenés con React.js, TypeScript y Node.js?";

function analysis(overrides: Partial<JobAnalysis> = {}): JobAnalysis {
  return jobAnalysisSchema.parse({
    title: "Desarrollador Full Stack",
    company: "Ualá",
    language: "es",
    domain: "software engineering",
    relevance: "direct",
    relevanceReason: "Full stack developer applying to a full stack role.",
    requirements: [{ text: "React", kind: "hard" }],
    keywords: ["React", "Node.js"],
    ...overrides,
  });
}

function prompt(
  overrides: Partial<Parameters<typeof buildAnswersPrompt>[0]> = {},
): string {
  return buildAnswersPrompt({
    questions: [QUESTION],
    profile: fullstackProfile,
    analysis: analysis(),
    outputLanguage: "es",
    now: NOW,
    ...overrides,
  });
}

describe("ANSWER_QUESTIONS_SYSTEM", () => {
  it("forbids opening on the gap, as the email prompt already did", () => {
    expect(flat(ANSWER_QUESTIONS_SYSTEM)).toContain("Never open on what the candidate lacks");
    expect(flat(ANSWER_QUESTIONS_SYSTEM)).toContain("No apologising, no hedging");
  });

  it("names the qualifiers that talked the model out of real experience", () => {
    for (const weasel of [
      '"formal"',
      '"as a specific combination"',
      '"in the same project"',
      '"at the same time"',
    ]) {
      expect(flat(ANSWER_QUESTIONS_SYSTEM)).toContain(weasel);
    }
  });

  it("sends the model to the computed block instead of the dates", () => {
    expect(flat(ANSWER_QUESTIONS_SYSTEM)).toContain(
      "EXPERIENCE ARITHMETIC block gives you the figure",
    );
    expect(flat(ANSWER_QUESTIONS_SYSTEM)).toContain("never answer zero");
  });

  it("tells the model a stated-skill entry still gets full confidence", () => {
    expect(flat(ANSWER_QUESTIONS_SYSTEM)).toContain(
      "coming from the candidate's stated skills rather than a specific role's bullets",
    );
    expect(flat(ANSWER_QUESTIONS_SYSTEM)).toContain("do not invent a specific project or feature");
  });

  it("says a multi-technology question is not a question about co-occurrence", () => {
    expect(flat(ANSWER_QUESTIONS_SYSTEM)).toContain(
      "a question about each of them, not about whether they were ever used " +
        "together in one project",
    );
  });

  it("no longer sends the coverage report to a generator that has none", () => {
    // The clause lived in HONESTY_RULES and reached six prompts that emit no
    // coverage report. In this one it read as "state the shortfall".
    expect(ANSWER_QUESTIONS_SYSTEM).not.toContain("coverage report");
  });

  it("makes a stated form limit a hard constraint", () => {
    expect(flat(ANSWER_QUESTIONS_SYSTEM)).toContain("it is a hard constraint");
    expect(flat(ANSWER_QUESTIONS_SYSTEM)).toContain("never stop mid-sentence");
  });
});

describe("buildAnswersPrompt — experience arithmetic", () => {
  it("gives the model two years, not the zero it used to derive", () => {
    const text = prompt();

    expect(text).toContain("Total professional experience: 2 years 3 months.");
    expect(text).not.toContain("0 years");
  });

  it("counts each technology the question names, separately", () => {
    const text = prompt();

    for (const term of ["React", "TypeScript", "Node.js"]) {
      expect(text).toMatch(
        new RegExp(`- ${term.replace(".", "\\.")} — 2 years 3 months: .*Flash Page`),
      );
    }
  });

  it("takes terms from the question even when the posting never names them", () => {
    // TypeScript is in neither the keywords nor the requirements above; the
    // form asked about it, which is the only thing that matters here.
    expect(analysis().keywords).not.toContain("TypeScript");
    expect(prompt()).toContain("- TypeScript — 2 years 3 months");
  });

  it("lists a technology it was asked about and the profile lacks, with an order to follow", () => {
    const text = prompt({ questions: ["¿Trabajaste con Kubernetes?"] });

    expect(text).toContain("Asked about and absent from the profile: Kubernetes.");
    expect(text).toContain("Do not lead with them either");
  });

  it("states no number at all when the profile's dates cannot be read", () => {
    const undated = profileSchema.parse({
      fullName: "Sin Fechas",
      experience: [
        { id: "e1", company: "X", role: "Dev", start: "", end: "", bullets: [], tags: ["React"] },
      ],
    });
    const text = prompt({ profile: undated });

    expect(text).toContain("no length of experience can be stated");
    expect(text).toContain("length unknown, the profile gives no dates");
    expect(text).not.toContain("Total professional experience:");
  });

  it("credits a technology stated only in the skills list, and tells the model not to invent a project for it", () => {
    const withAngular = { ...fullstackProfile, skills: [...fullstackProfile.skills, "Angular"] };
    const text = prompt({ questions: ["¿Cuántos años de experiencia tenés con Angular?"], profile: withAngular });

    expect(text).toContain("Angular — listed in the candidate's skills, not tied to a specific role");
    expect(text).toContain("Credit the full 2 years 3 months of general experience");
    expect(text).toContain("do not invent a specific project, feature or codebase that named it");
    expect(text).not.toContain("Asked about and absent from the profile: Angular");
  });
});

describe("buildAnswersPrompt — context parity with the CV", () => {
  it("carries the relevance reason, not the bare enum", () => {
    expect(prompt()).toContain(
      "direct — Full stack developer applying to a full stack role.",
    );
  });

  it("carries the strategy block for the posting's relevance", () => {
    expect(prompt()).toContain("STRATEGY — DIRECT MATCH");
    expect(prompt({ analysis: analysis({ relevance: "unrelated" }) })).toContain(
      "DO NOT SIGNAL THAT THE JOB IS BENEATH THEM",
    );
  });

  it("carries the computed posting match", () => {
    expect(prompt()).toContain("WHAT THIS POSTING ASKS THAT THE PROFILE ANSWERS");
  });

  it("marks the tools this posting names and ranks the bullets by it", () => {
    const text = prompt();
    expect(text).toContain("React*");
    expect(text).toContain("matches]");
  });

  it("degrades gracefully when the client has no derived skills cached", () => {
    expect(prompt()).toContain("None supplied.");
  });
});

describe("buildAnswersPrompt — language", () => {
  /*
   * El idioma del aviso es sólo el default: cada respuesta va en el idioma en
   * que se hizo su pregunta, porque un formulario puede mezclar lenguas y una
   * respuesta en otra lengua se lee como escrita por otra persona.
   */

  it("makes each question's own language the language of its answer", () => {
    expect(flat(prompt())).toContain(
      "Each answer, though, is written in the language its own question was asked in",
    );
  });

  it("names the posting's language as the fallback, not as the rule", () => {
    expect(flat(prompt())).toContain('the default is "es" — the posting\'s language');
  });

  it("keeps the fallback when the pasted questions are in another language", () => {
    const text = prompt({
      questions: ["Tell us about your experience with React and Node.js"],
      outputLanguage: "es",
    });

    expect(text).toContain('the default is "es"');
    expect(text).toContain("1. Tell us about your experience with React and Node.js");
  });

  it("the system prompt states the rule for mixed-language forms", () => {
    expect(flat(ANSWER_QUESTIONS_SYSTEM)).toContain(
      "answer in the language each question was asked in",
    );
  });
});

describe("buildAnswersPrompt — retry", () => {
  it("says nothing about a previous attempt on the first call", () => {
    expect(prompt()).not.toContain("MEASURED — FIX THIS");
  });

  it("feeds the measured gap back, quoting the question it belongs to", () => {
    const text = prompt({
      gaps: [{ question: QUESTION, problem: "The profile's dates back 2 year(s)." }],
    });

    expect(text).toContain("MEASURED — FIX THIS");
    expect(text).toContain(`- On "${QUESTION}": The profile's dates back 2 year(s).`);
  });
});

describe("buildAnswersPrompt — form limits", () => {
  it("turns a limit stated in the question into an explicit tag", () => {
    const text = prompt({
      questions: ["¿Por qué querés trabajar acá? (máx. 300 caracteres)"],
    });

    expect(text).toContain("1. ¿Por qué querés trabajar acá? [limit: 300 characters]");
    // The boilerplate is not handed over as part of the question to answer:
    // the model echoes what it is given, and the stored question is what the
    // employer's form asked.
    expect(text).not.toContain("(máx. 300 caracteres)");
  });

  it("tags a word limit as words, not characters", () => {
    const text = prompt({
      questions: ["Contá tu experiencia en 150 palabras o menos."],
    });

    expect(text).toContain("[limit: 150 words]");
    expect(text).toContain("1. Contá tu experiencia. [limit: 150 words]");
  });

  it("tags each question with its own limit, and none where there is none", () => {
    const text = prompt({
      questions: [
        "¿Por qué querés trabajar acá? (máx. 300 caracteres)",
        "¿Cuál es tu disponibilidad horaria?",
      ],
    });

    expect(text).toContain("[limit: 300 characters]");
    expect(text).toContain("2. ¿Cuál es tu disponibilidad horaria?");
  });

  it("tags an explicit questionLimit typed next to the question, overriding the parsed one", () => {
    const text = prompt({
      questions: ["¿Por qué querés trabajar acá? (máx. 300 caracteres)"],
      questionLimits: [150],
    });

    expect(text).toContain("1. ¿Por qué querés trabajar acá? [limit: 150 characters]");
  });

  it("tags an explicit questionLimit when the question states no limit of its own", () => {
    const text = prompt({
      questions: ["¿Cuál es tu disponibilidad horaria?"],
      questionLimits: [200],
    });

    expect(text).toContain("1. ¿Cuál es tu disponibilidad horaria? [limit: 200 characters]");
  });
});
