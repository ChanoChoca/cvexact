import { describe, expect, it } from "vitest";
import { packSentences, splitSentences } from "@/lib/text/sentences";

describe("splitSentences", () => {
  it("splits on sentence ends followed by a capital", () => {
    expect(splitSentences("Llevo las campañas. Preparo los informes! ¿Y las métricas? Sí.")).toEqual([
      "Llevo las campañas.",
      "Preparo los informes!",
      "¿Y las métricas?",
      "Sí.",
    ]);
  });

  it("does not split at an abbreviation, an initial or a dotted acronym", () => {
    expect(splitSentences("Trabajé con el Ing. Pérez en Acme S.A. de C.V. durante tres años.")).toEqual([
      "Trabajé con el Ing. Pérez en Acme S.A. de C.V. durante tres años.",
    ]);
    expect(splitSentences("Reporté a J. Smith. Después cambié de área.")).toEqual([
      "Reporté a J. Smith.",
      "Después cambié de área.",
    ]);
  });

  it("does not split a decimal", () => {
    expect(splitSentences("Bajé la latencia de 4.5 a 1.2 segundos. Luego migré.")).toEqual([
      "Bajé la latencia de 4.5 a 1.2 segundos.",
      "Luego migré.",
    ]);
  });

  it("does not split at a lower-case word after a full stop", () => {
    expect(splitSentences("Usé etc. para todo")).toEqual(["Usé etc. para todo"]);
  });

  it("collapses whitespace and returns nothing for nothing", () => {
    expect(splitSentences("  Uno.\n\n  Dos.  ")).toEqual(["Uno.", "Dos."]);
    expect(splitSentences("   ")).toEqual([]);
  });
});

describe("packSentences", () => {
  it("packs whole sentences up to the limit, in order", () => {
    const text = "Primera oración corta. Segunda oración corta. Tercera oración corta. Cuarta.";
    const pieces = packSentences(text, 50);
    expect(pieces.every((p) => p.length <= 50)).toBe(true);
    expect(pieces.join(" ")).toBe(text);
    expect(pieces).toHaveLength(2);
  });

  it("returns one piece when it all fits", () => {
    expect(packSentences("Una. Dos.", 100)).toEqual(["Una. Dos."]);
  });

  it("cuts a sentence longer than the limit at a space, and only that", () => {
    const long = `Palabra ${"palabra ".repeat(40).trim()}.`;
    const pieces = packSentences(`Corta. ${long}`, 100);
    expect(pieces[0]).toBe("Corta.");
    expect(pieces.slice(1).every((p) => p.length <= 100)).toBe(true);
    expect(pieces.slice(1).join(" ")).toBe(long);
  });
});
