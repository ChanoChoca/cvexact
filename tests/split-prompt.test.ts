import { describe, expect, it } from "vitest";
import { SPLIT_SYSTEM, buildSplitPrompt, splitSchema } from "@/lib/ai/prompts/split";

/**
 * "Separar" and "reescribir" are one instruction apart for a model, so the
 * prompt spends its words on the difference — and everything it returns is
 * checked again afterwards (`lib/parse/verify-extraction.ts`'s `verifySplit`),
 * so a model that ignores this is caught, not trusted.
 */

const says = (phrase: string) => new RegExp(phrase.trim().replace(/\s+/g, "\\s+"), "i");

describe("el sistema del separador", () => {
  it("pide transcribir, no reescribir", () => {
    expect(SPLIT_SYSTEM).toMatch(says("You are transcribing, not writing"));
    expect(SPLIT_SYSTEM).toMatch(says("no synonyms, no reordering within a piece"));
  });

  it("exige que cada trozo sea una corrida literal de palabras de la respuesta", () => {
    expect(SPLIT_SYSTEM).toMatch(says("a run of consecutive words taken verbatim"));
  });

  it("no divide una frase larga que dice una sola cosa", () => {
    expect(SPLIT_SYSTEM).toMatch(says("A single statement that merely runs long is one piece"));
  });

  it("prohíbe agregar o fusionar en una generalidad que no está en el texto", () => {
    expect(SPLIT_SYSTEM).toMatch(says("Never add a statement the person did not make"));
  });
});

describe("el esquema del separador", () => {
  it("acepta una respuesta vacía de trozos", () => {
    expect(splitSchema.parse({}).pieces).toEqual([]);
  });

  it("tiene un tope de trozos por respuesta, que rechaza en vez de recortar en silencio", () => {
    // Rejecting rather than truncating is deliberate: it is what lets
    // `generate()`'s repair loop (`clipToLimits`) catch an over-limit response
    // and ask the model to trim, instead of silently keeping only the first 12.
    const many = Array.from({ length: 20 }, (_, i) => `pieza ${i}`);
    expect(splitSchema.safeParse({ pieces: many }).success).toBe(false);
    expect(splitSchema.safeParse({ pieces: many.slice(0, 12) }).success).toBe(true);
  });
});

describe("el prompt del separador", () => {
  it("lleva la respuesta entera, verbatim", () => {
    const answer = "Llevo las campañas de Google Ads y Meta, el SEO de la web y preparo los informes.";
    expect(buildSplitPrompt(answer)).toContain(answer);
  });
});
