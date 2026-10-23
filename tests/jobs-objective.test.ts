import { describe, expect, it } from "vitest";
import { objectiveFit, objectiveOverlap } from "@/lib/jobs/objective";

describe("what the person is after, against a posting's title", () => {
  it("shares a word however it is cased, accented or pluralised", () => {
    expect(objectiveOverlap("Analista de marketing", "ANALISTAS de Marketíng Digital")).toBe(1);
    expect(objectiveOverlap("Diseño de producto", "Diseñadora de producto")).toBe(1);
  });

  it("is the share of the objective's words the title says, not of the title's", () => {
    expect(objectiveOverlap("Analista de marketing digital", "Analista de datos")).toBeCloseTo(1 / 3);
    expect(objectiveOverlap("Analista", "Analista de marketing digital senior")).toBe(1);
  });

  it("reads the posting's own terms too", () => {
    expect(objectiveOverlap("Desarrollo web", "Ingeniero", ["Desarrollo", "React"])).toBe(0.5);
  });

  it("does not take the little words for what the person is after", () => {
    expect(objectiveOverlap("Jefe de la tienda", "Encargado de la sucursal para el centro")).toBe(0);
  });

  it("keeps the short words that say something: UX, QA, BI", () => {
    expect(objectiveOverlap("UX", "Diseñador UX")).toBe(1);
  });

  it("is nothing for no objective, or no words in it", () => {
    expect(objectiveOverlap("", "Analista")).toBe(0);
    expect(objectiveOverlap("de la", "Analista")).toBe(0);
  });

  it("is a match when a word is shared, a mismatch when none is, and unknown with nothing to compare", () => {
    expect(objectiveFit("Analista de marketing", "Analista de datos")).toBe("match");
    expect(objectiveFit("Analista de marketing", "Chef ejecutivo")).toBe("mismatch");
    expect(objectiveFit("", "Chef ejecutivo")).toBe("unknown");
    expect(objectiveFit("Analista", "  ")).toBe("unknown");
  });
});
