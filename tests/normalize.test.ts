import { describe, expect, it } from "vitest";
import {
  normalizeForComparison,
  normalizeForFingerprint,
  normalizeForSearch,
  normalizeText,
  skillKey,
} from "@/lib/text/normalize";

/**
 * `normalizeForComparison` used to be `lib/ai/evidence.ts#normalize`, which
 * replaced every non-alphanumeric character with a space — collapsing "C",
 * "C#" and "C++" into the same string. These cases pin the fix and the one
 * equivalence ("Node.js" == "Node JS") that the fix must not break.
 */
describe("normalizeForComparison", () => {
  it("keeps C, C# and C++ distinct", () => {
    const c = normalizeForComparison("C");
    const cSharp = normalizeForComparison("C#");
    const cPlusPlus = normalizeForComparison("C++");
    expect(new Set([c, cSharp, cPlusPlus]).size).toBe(3);
  });

  it("keeps F# distinct from F", () => {
    expect(normalizeForComparison("F#")).not.toBe(normalizeForComparison("F"));
  });

  it("does not collide .NET with C, C# or C++ either", () => {
    const dotnet = normalizeForComparison(".NET");
    expect(dotnet).not.toBe(normalizeForComparison("C"));
    expect(dotnet).not.toBe(normalizeForComparison("C#"));
    expect(dotnet).not.toBe(normalizeForComparison("C++"));
  });

  it("still unifies Node.js, Node JS and NODE.JS", () => {
    const forms = ["Node.js", "Node JS", "NODE.JS", "  node   js  "];
    const normalized = new Set(forms.map(normalizeForComparison));
    expect(normalized.size).toBe(1);
  });

  it("folds case and accents for company/role names", () => {
    expect(normalizeForComparison("Compañía Andina")).toBe(normalizeForComparison("COMPANIA ANDINA"));
  });

  it("collapses internal whitespace and trims", () => {
    expect(normalizeForComparison("  React   JS  ")).toBe("react js");
  });

  it("treats an empty or blank string as empty", () => {
    expect(normalizeForComparison("")).toBe("");
    expect(normalizeForComparison("   ")).toBe("");
  });
});

/**
 * Must stay byte-identical to the generated SQL column in
 * `lib/db/schema.ts` (`lower(regexp_replace(value, '[^a-zA-Z0-9]', '', 'g'))`)
 * so the JS-side dedup key never drifts from what's already stored/indexed
 * in Postgres.
 */
describe("normalizeForFingerprint", () => {
  function sqlEquivalent(value: string): string {
    return value.toLowerCase().replace(/[^a-zA-Z0-9]/g, "");
  }

  it.each([
    "Mercado Libre",
    "MercadoLibre S.A.",
    "Café & Co.",
    "Compañía Andina",
    "AT&T",
    "",
    "   ",
    "3M",
  ])("matches the SQL regex for %j", (value) => {
    expect(normalizeForFingerprint(value)).toBe(sqlEquivalent(value));
  });

  it("does not fold accents — it deletes the accented letter, like Postgres does", () => {
    expect(normalizeForFingerprint("café")).toBe("caf");
  });
});

describe("normalizeForSearch", () => {
  it("keeps punctuation and multi-word phrases intact", () => {
    expect(normalizeForSearch("C++ Institute")).toBe("c++ institute");
    expect(normalizeForSearch("salario mínimo")).toBe("salario minimo");
  });

  it("folds case and accents so a plain-ASCII query matches an accented value", () => {
    expect(normalizeForSearch("Compañía")).toContain("compania");
  });
});

describe("normalizeText", () => {
  it("can be told to keep everything but casefold", () => {
    expect(normalizeText("Jane.Doe@Example.com", { stripDiacritics: false, punctuation: "keep" })).toBe(
      "jane.doe@example.com",
    );
  });

  it("supports widening preserveSymbols for a non-tech domain", () => {
    expect(normalizeText("R&D", { preserveSymbols: "#+&" })).toBe("r&d");
  });
});

describe("skillKey", () => {
  it("joins one skill written with different spacing, dots or case", () => {
    expect(skillKey("Node.js")).toBe(skillKey("NodeJS"));
    expect(skillKey("node js")).toBe(skillKey("Node.js"));
    expect(skillKey("Tienda Nube")).toBe(skillKey("Tiendanube"));
    expect(skillKey("Power BI")).toBe(skillKey("power bi"));
    expect(skillKey("Administración de sistemas")).toBe(skillKey("administracion de sistemas"));
  });

  it("keeps apart what only a symbol tells apart", () => {
    expect(new Set([skillKey("C"), skillKey("C#"), skillKey("C++")]).size).toBe(3);
  });

  it("knows the few longer or shorter spellings a CV and a LinkedIn export disagree on", () => {
    expect(skillKey("Postgres")).toBe(skillKey("PostgreSQL"));
    expect(skillKey("React.js")).toBe(skillKey("React"));
    expect(skillKey("ReactJS")).toBe(skillKey("React"));
    expect(skillKey("Vue.js")).toBe(skillKey("Vue"));
    expect(skillKey("Express.js")).toBe(skillKey("Express"));
    expect(skillKey("React Native")).not.toBe(skillKey("React"));
  });
});
