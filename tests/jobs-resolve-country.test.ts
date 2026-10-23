import { describe, expect, it } from "vitest";
import { resolveCountry } from "../scripts/jobs/shared.mjs";

/**
 * `country` gates the Presencial/Híbrido filter (only "AR" passes) and orders
 * the feed for the visitor's country, so a wrong answer is worse than none:
 * every ambiguous input has to come back "".
 */
describe("resolveCountry", () => {
  it("keeps the Argentine markers", () => {
    for (const place of ["Buenos Aires, Argentina", "CABA", "Rosario", "Córdoba", "Mar del Plata"]) {
      expect(resolveCountry(place)).toBe("AR");
    }
  });

  it("resolves other countries from an unambiguous name", () => {
    expect(resolveCountry("São Paulo, Brasil")).toBe("BR");
    expect(resolveCountry("Berlin")).toBe("DE");
    expect(resolveCountry("EE. UU.")).toBe("US");
    expect(resolveCountry("UK")).toBe("GB");
    expect(resolveCountry("México")).toBe("MX");
  });

  it("returns '' when the text names no country", () => {
    for (const place of ["", "Worldwide", "Anywhere", "Remote", "Europe", "LATAM"]) {
      expect(resolveCountry(place)).toBe("");
    }
  });

  it("returns '' when the text names two countries", () => {
    expect(resolveCountry("USA, Canada")).toBe("");
    expect(resolveCountry("Argentina, Brasil")).toBe("");
  });

  it("does not let a homonym pass for Argentina", () => {
    expect(resolveCountry("Santa Fe, New Mexico")).toBe("");
    expect(resolveCountry("Salta")).toBe("AR");
  });

  it("matches whole words, not substrings", () => {
    expect(resolveCountry("Indiana")).toBe("");
    expect(resolveCountry("Cabal Street")).toBe("");
  });
});
