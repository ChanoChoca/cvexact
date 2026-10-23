import { describe, expect, it } from "vitest";
import {
  buildInterviewPrepPrompt,
  INTERVIEW_PREP_SYSTEM,
} from "@/lib/ai/prompts/interview-prep";
import { jobAnalysisSchema, type JobAnalysis } from "@/lib/schemas/job";
import { devProfile } from "./fixtures";

/**
 * The prep sheet is read by the candidate during the interview, so its language
 * follows the interview itself: when the candidate describes that interview in
 * a language different from the posting's, the description wins — it is the
 * language the questions will come in. These pin the directive in both
 * directions, plus the fallback that keeps the posting's language.
 */

const analysis: JobAnalysis = jobAnalysisSchema.parse({
  title: "Atención al cliente",
  company: "Mercado Libre",
  language: "es",
  domain: "customer support",
  relevance: "adjacent",
  relevanceReason: "Perfil técnico aplicando a un rol de atención.",
  requirements: [{ text: "Disponibilidad para turnos rotativos.", kind: "hard" }],
});

const flat = (text: string) => text.replace(/\s+/g, " ");

function prompt(context = "") {
  return buildInterviewPrepPrompt({
    profile: devProfile,
    analysis,
    context,
    outputLanguage: "es",
  });
}

describe("buildInterviewPrepPrompt", () => {
  it("carries the posting's language as the default output language", () => {
    expect(prompt()).toContain('OUTPUT LANGUAGE: write every user-visible string in "es"');
  });

  it("follows the language the candidate described the interview in", () => {
    const text = prompt("Panel interview in English, three interviewers, 40 minutes");

    expect(flat(text)).toContain('a language other than "es"');
    expect(flat(text)).toContain("the language the interview itself will be conducted in");
  });

  it("names no interview language when the candidate gave no context", () => {
    expect(prompt()).not.toContain("the interview itself will be conducted in");
  });

  it("the system prompt still writes for a second screen under pressure", () => {
    expect(flat(INTERVIEW_PREP_SYSTEM)).toContain("skimmable under pressure");
  });
});
