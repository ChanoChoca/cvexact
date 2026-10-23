import { describe, expect, it } from "vitest";
import {
  buildVideoScriptPrompt,
  VERBATIM_CEILING_SECONDS,
  VIDEO_REPAIR_FLOOR,
  wordBudget,
} from "@/lib/ai/prompts/video-script";
import { NAME_PLACEHOLDER } from "@/lib/ai/prompts/shared";
import { jobAnalysisSchema, type JobAnalysis } from "@/lib/schemas/job";
import { devProfile } from "./fixtures";

/**
 * The video script has one constraint the other generators do not: it must fit
 * a duration the employer set, and going over is what gets a submission
 * discarded. That budget is computed here rather than by the model, so these
 * pin it — along with the branch that decides whether the employer's own topics
 * drive the blocks or the default structure does.
 */

const analysis: JobAnalysis = jobAnalysisSchema.parse({
  title: "Atención al cliente",
  company: "Mercado Libre",
  language: "es",
  domain: "customer support",
  relevance: "adjacent",
  relevanceReason: "Perfil técnico aplicando a un rol de atención.",
  requirements: [{ text: "Disponibilidad para turnos rotativos.", kind: "hard" }],
  responsibilities: ["Responder consultas de clientes por chat."],
  keywords: ["atención al cliente", "turnos rotativos"],
});

function prompt(over: Partial<Parameters<typeof buildVideoScriptPrompt>[0]> = {}) {
  return buildVideoScriptPrompt({
    profile: devProfile,
    analysis,
    topics: "",
    durationSeconds: 120,
    outputLanguage: "es",
    ...over,
  });
}

describe("buildVideoScriptPrompt", () => {
  it("carries the employer's own topics verbatim", () => {
    const text = prompt({
      topics: "Contanos sobre vos\n¿Por qué te interesa este puesto?",
    });

    expect(text).toContain("=== WHAT THE EMPLOYER ASKS THE VIDEO TO COVER ===");
    expect(text).toContain("Contanos sobre vos");
    expect(text).toContain("¿Por qué te interesa este puesto?");
    expect(text).not.toContain("did not specify topics");
  });

  it("falls back to the default structure when no topics were given", () => {
    const text = prompt({ topics: "   " });

    expect(text).toContain("The employer did not specify topics");
    expect(text).not.toContain("=== WHAT THE EMPLOYER ASKS THE VIDEO TO COVER ===");
  });

  it("states the duration and the word budget it implies", () => {
    expect(wordBudget(120)).toBe(280);
    expect(wordBudget(600)).toBe(1400);
    expect(prompt()).toContain("Total length: 120 seconds (about 280 words of speech)");
    expect(prompt({ durationSeconds: 30 })).toContain(
      "Total length: 30 seconds (about 70 words of speech)",
    );
    expect(prompt({ durationSeconds: 600 })).toContain(
      "Total length: 600 seconds (about 1400 words of speech)",
    );
  });

  it("pins the requested duration as totalSeconds", () => {
    expect(prompt({ durationSeconds: 180 })).toContain('Set "totalSeconds" to 180.');
  });

  it("sacrifices the least specific parts first when it must shorten", () => {
    const floor = VIDEO_REPAIR_FLOOR;

    expect(floor.indexOf('"tips"')).toBeLessThan(floor.indexOf('"keyPoints"'));
    // Dropping a block breaks the timeline: the seconds no longer add up to the
    // duration the posting asked for.
    expect(floor).toContain("NEVER drop a block");
  });

  it("asks for the output language it was given", () => {
    expect(prompt({ outputLanguage: "en" })).toContain('OUTPUT LANGUAGE: write every user-visible string in "en"');
  });

  it("follows the topics' language when the employer asked in another one", () => {
    const text = prompt({
      topics: "Tell us about yourself and why you want this role",
      outputLanguage: "es",
    });

    // The employer watches the video, so the topics they wrote set its language.
    expect(text).toContain('a language other than "es"');
    expect(text).toContain("the topics' language");
  });

  it("names no topics' language when the employer did not specify any", () => {
    expect(prompt({ topics: "   " })).not.toContain("the topics' language");
  });

  // A ten-minute script is 1400 words: nobody memorises that, and reading it
  // off a screen is the impression the video exists to avoid. The threshold is
  // pinned from both sides because that is what an edit moves by accident.
  it("asks for a fully written script up to the verbatim ceiling", () => {
    const text = prompt({ durationSeconds: VERBATIM_CEILING_SECONDS });

    expect(text).toContain('every block is "mode": "verbatim"');
    expect(text).not.toContain('"mode": "outline"');
  });

  it("switches to a hybrid register one second past it", () => {
    const text = prompt({ durationSeconds: VERBATIM_CEILING_SECONDS + 1 });

    expect(text).toContain('"mode": "outline"');
    expect(text).toContain("FIRST block and the LAST block");
    // The failure this guards: guidance long enough to be read aloud, which
    // gives the candidate a teleprompter under a different name.
    expect(text).toContain("40–70 words");
  });

  it("passes the job and the profile through", () => {
    const text = prompt();

    expect(text).toContain("Atención al cliente");
    expect(text).toContain("Mercado Libre");
    // El nombre real no cruza — ver `lib/ai/prompts/shared.ts` — así que lo
    // que el prompt lleva es el placeholder, no `devProfile.fullName`.
    expect(text).not.toContain(devProfile.fullName);
    expect(text).toContain(NAME_PLACEHOLDER);
    expect(text).toContain("(not generated yet — rely on the profile)");
  });
});
