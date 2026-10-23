import { describe, expect, it } from "vitest";
import { pairBySimilarity, similarity } from "@/lib/text/similarity";

describe("similarity", () => {
  it("is 1 for the same text however it is cased, accented or punctuated", () => {
    expect(similarity("Atendí clientes.", "atendi CLIENTES")).toBe(1);
  });

  it("reads a small edit as close", () => {
    expect(
      similarity(
        "Coordiné con dos diseñadores y un backend para entregar cada sprint.",
        "Coordino con dos diseñadores para entregar sprints",
      ),
    ).toBeGreaterThan(0.6);
    expect(similarity("React", "React Native")).toBeGreaterThan(0.4);
  });

  it("reads unrelated lines as far apart", () => {
    expect(similarity("Atendía clientes en el mostrador", "Programé un sistema de reservas en Python")).toBeLessThan(
      0.3,
    );
  });

  it("is 0 against empty text and symmetric otherwise", () => {
    expect(similarity("algo", "")).toBe(0);
    expect(similarity("Excel avanzado", "Excel")).toBe(similarity("Excel", "Excel avanzado"));
  });
});

describe("pairBySimilarity", () => {
  it("pairs exact matches first, so duplicates stay apart", () => {
    const { pairs, removed, added } = pairBySimilarity(["a b c", "a b c"], ["a b c"], 0.5);
    expect(pairs).toEqual([[0, 0]]);
    expect(removed).toEqual([1]);
    expect(added).toEqual([]);
  });

  it("pairs a reworded line with its original, and leaves an unrelated one unpaired", () => {
    const { pairs, removed, added } = pairBySimilarity(
      ["Atendía clientes en el mostrador", "Cerraba la caja"],
      ["Atendía a los clientes en el mostrador principal", "Programé un sistema de reservas"],
      0.45,
    );
    expect(pairs).toEqual([[0, 0]]);
    expect(removed).toEqual([1]);
    expect(added).toEqual([1]);
  });

  it("gives each line to at most one partner, best first", () => {
    const { pairs } = pairBySimilarity(["excel avanzado", "excel"], ["excel"], 0.4);
    expect(pairs).toEqual([[1, 0]]);
  });

  it("pairs nothing below the threshold", () => {
    const { pairs, removed, added } = pairBySimilarity(["hola"], ["adiós"], 0.9);
    expect(pairs).toEqual([]);
    expect(removed).toEqual([0]);
    expect(added).toEqual([0]);
  });

  describe("positional", () => {
    it("pairs what is left over in place when the count did not change", () => {
      const { pairs, removed, added } = pairBySimilarity(["a b c", "x y z"], ["a b c", "totalmente otra"], 0.5, {
        positional: true,
      });
      expect(pairs).toEqual([
        [0, 0],
        [1, 1],
      ]);
      expect(removed).toEqual([]);
      expect(added).toEqual([]);
    });

    it("falls back to likeness when the count changed", () => {
      const { pairs, removed, added } = pairBySimilarity(["uno dos tres", "cuatro cinco"], ["completamente distinto"], 0.5, {
        positional: true,
      });
      expect(pairs).toEqual([]);
      expect(removed).toEqual([0, 1]);
      expect(added).toEqual([0]);
    });

    it("still pairs exact matches before anything positional", () => {
      const { pairs } = pairBySimilarity(["a", "b"], ["b", "c"], 0.5, { positional: true });
      expect(pairs).toContainEqual([1, 0]);
      expect(pairs).toContainEqual([0, 1]);
    });
  });
});
