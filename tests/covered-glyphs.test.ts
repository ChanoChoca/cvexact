import { describe, expect, it } from "vitest";
import { withCoveredGlyphs } from "@/lib/cv/fonts";

describe("withCoveredGlyphs", () => {
  it("swaps the symbols the typography lacks, anywhere in the document", () => {
    const cv = { summary: "Migré → nube", items: [{ bullets: ["✓ ﬁnal", "N‑1 ≥ 2"] }], n: 3 };
    expect(withCoveredGlyphs(cv)).toEqual({
      summary: "Migré -> nube",
      items: [{ bullets: ["- final", "N-1 >= 2"] }],
      n: 3,
    });
  });

  it("leaves covered text and the original untouched", () => {
    const cv = { text: "Gestión – equipo • 20% · €5", flecha: "a → b" };
    expect(withCoveredGlyphs({ text: cv.text }).text).toBe(cv.text);
    withCoveredGlyphs(cv);
    expect(cv.flecha).toBe("a → b");
  });
});
