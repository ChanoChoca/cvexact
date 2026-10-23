import { describe, expect, it } from "vitest";
import { provenanceOf, READ_WITH_AI } from "@/lib/onboarding/provenance";

const at = "2026-09-21T00:00:00.000Z";

describe("provenanceOf", () => {
  it.each([
    ["cv", "De tu CV"],
    ["linkedin_pdf", "De LinkedIn"],
    ["linkedin_csv", "De LinkedIn"],
    ["dump", "Lo dijiste vos"],
    ["legacy", "Ya estaba en tu perfil"],
  ] as const)("says where a %s value came from", (kind, label) => {
    expect(provenanceOf("confirmed", { kind, at })?.label).toBe(label);
    expect(provenanceOf("proposed", { kind, at })?.label).toBe(label);
  });

  describe("what the person typed or answered", () => {
    it.each(["manual", "answer"] as const)("says nothing of a %s value: they know they wrote it", (kind) => {
      for (const status of ["proposed", "confirmed", "edited"] as const) expect(provenanceOf(status, { kind, at }), status).toBeNull();
    });
  });

  describe("a document read with a model", () => {
    it.each([
      ["cv", "De tu CV · leído con IA", "cv"],
      ["linkedin_pdf", "De LinkedIn · leído con IA", "linkedin"],
      ["linkedin_csv", "De LinkedIn · leído con IA", "linkedin"],
      ["dump", "Lo dijiste vos · leído con IA", "said"],
    ] as const)("says so of a %s value, after where it came from", (kind, label, tone) => {
      expect(provenanceOf("confirmed", { kind, via: "ai", at })).toEqual({ label, tone });
      expect(provenanceOf("proposed", { kind, via: "ai", at })).toEqual({ label, tone });
    });

    it("says it in the words the receipts use", () => {
      expect(READ_WITH_AI).toBe("leído con IA");
    });

    it("says nothing of it for what a person typed or answered: nothing read that", () => {
      expect(provenanceOf("confirmed", { kind: "manual", via: "ai", at })).toBeNull();
      expect(provenanceOf("confirmed", { kind: "answer", via: "ai", at })).toBeNull();
      expect(provenanceOf("confirmed", { kind: "legacy", via: "ai", at })?.label).toBe("Ya estaba en tu perfil");
    });

    it("still says it was edited, and nothing else, once the person has changed it", () => {
      expect(provenanceOf("edited", { kind: "cv", via: "ai", at })).toEqual({ label: "Editado por vos", tone: "edited" });
    });
  });

  it("says a value was edited, whatever it was before, unless it was theirs to begin with", () => {
    const edited = { label: "Editado por vos", tone: "edited" };
    for (const kind of ["cv", "linkedin_pdf", "linkedin_csv", "dump", "legacy"] as const) expect(provenanceOf("edited", { kind, at }), kind).toEqual(edited);
    expect(provenanceOf("edited", undefined)).toEqual(edited);
  });

  it("says nothing about a value with no source", () => {
    expect(provenanceOf("confirmed", undefined)).toBeNull();
  });
});
