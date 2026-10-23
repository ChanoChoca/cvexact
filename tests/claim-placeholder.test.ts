import { describe, expect, it } from "vitest";
import { claimPlaceholder } from "@/components/wizard/panels";

describe("the hint where someone says where they used a tool", () => {
  it("gives the shape of the answer, with the tool in it, and nothing of its content", () => {
    expect(claimPlaceholder("Excel")).toBe("Qué hiciste con Excel, dónde y para qué…");
  });

  it("is the same question for a cook as for an engineer: it carries no sample sentence", () => {
    for (const term of ["Terraform", "Autoclave", "Caja registradora", "Facturación electrónica"]) {
      const hint = claimPlaceholder(term);
      expect(hint).toContain(term);
      // What the fixed sample said, for any term at all.
      expect(hint).not.toMatch(/staging|producción|aprovision|entornos/i);
      // A question the person answers, not an instruction they would type back.
      expect(hint.startsWith("Qué hiciste")).toBe(true);
    }
  });
});
