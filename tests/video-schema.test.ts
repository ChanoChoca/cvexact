import { describe, expect, it } from "vitest";
import {
  VIDEO_SCRIPT_LABEL_DEFAULTS,
  videoScriptSchema,
} from "@/lib/schemas/outputs";

/**
 * Scripts live in the user's browser and are read back with a bare
 * `JSON.parse` (see `loadApplications` in lib/storage/local.ts), so a stored
 * script never re-runs these defaults. What this pins is the other half of that
 * bargain: a script produced by an older version of the app must still parse
 * when it does go through the schema — on the way into the PDF route, which is
 * where a missing field would turn into a 400 the user reads as "your script is
 * broken".
 */

const stored = {
  language: "es",
  jobTitle: "Atención al cliente",
  company: "Mercado Libre",
  totalSeconds: 120,
  blocks: [
    {
      topic: "Contanos sobre vos",
      seconds: 60,
      script: "Hola, soy Ana.",
      keyPoints: ["Nombre y años"],
    },
    { topic: "Disponibilidad", seconds: 60, script: "Tengo turnos rotativos." },
  ],
  tips: ["Mirá el lente."],
};

describe("videoScriptSchema", () => {
  it("reads a block with no mode as one to say word for word", () => {
    const parsed = videoScriptSchema.parse(stored);

    expect(parsed.blocks.map((b) => b.mode)).toEqual(["verbatim", "verbatim"]);
    expect(parsed.blocks[1].keyPoints).toEqual([]);
  });

  it("fills in the labels a script written before the PDF existed lacks", () => {
    const parsed = videoScriptSchema.parse(stored);

    expect(parsed.labels).toEqual(VIDEO_SCRIPT_LABEL_DEFAULTS);
  });

  it("fills in only the labels a partial object leaves out", () => {
    const parsed = videoScriptSchema.parse({
      ...stored,
      labels: { tips: "Before you record" },
    });

    expect(parsed.labels.tips).toBe("Before you record");
    expect(parsed.labels.outline).toBe(VIDEO_SCRIPT_LABEL_DEFAULTS.outline);
  });

  it("takes a ten-minute script: enough blocks, and long enough ones", () => {
    // 12 blocks and a 3-minute verbatim block are both inside what a ten-minute
    // video needs, and both were outside the first version's limits.
    const long = videoScriptSchema.parse({
      ...stored,
      totalSeconds: 600,
      blocks: Array.from({ length: 12 }, (_, i) => ({
        topic: `Tema ${i + 1}`,
        seconds: 50,
        mode: i === 0 || i === 11 ? "verbatim" : "outline",
        script: "palabra ".repeat(400).trim(),
        keyPoints: Array.from({ length: 8 }, (_, k) => `Punto ${k + 1}`),
      })),
    });

    expect(long.blocks).toHaveLength(12);
    expect(long.blocks[1].mode).toBe("outline");
    expect(long.blocks[1].keyPoints).toHaveLength(8);
  });
});
