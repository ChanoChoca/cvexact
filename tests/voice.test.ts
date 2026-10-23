import { describe, expect, it } from "vitest";
import { RULES } from "@/lib/voice";
import { copyOf, sourcesUnder } from "./helpers/copy";

/**
 * The product speaks in one voice and one vocabulary (`lib/voice.ts`). This reads the strings of everything a person
 * can see — every screen, component and message — for the words the glossary replaced, so a screen written from habit
 * says so here and not in a user's lap. It reads everything and excludes by name, so that a screen that did not exist
 * when this was written is read too.
 */
const EXCLUDED: ReadonlyArray<readonly [path: string, why: string]> = [
  ["app/legales", "legal pages: their own register and their own review, and not this test's to change"],
  ["lib/legal", "the consent and the policy's texts: same reason (the one exception, `data-flow.ts`, is product copy and is read)"],
  ["lib/email", "transactional emails, some of them the legal acknowledgment of a right of withdrawal: same reason"],
  ["lib/ai", "prompts, which speak to a model, and the checks of what it wrote, where «suman» is arithmetic (\"tus fechas suman 3 años\")"],
  ["lib/fixtures", "the sample CV, whose placeholders are written in the voice of a CV template and not of the app"],
  ["components/landing", "the landing's illustrations, which draw a CV and a profile and are not the app"],
  ["lib/voice.ts", "the glossary itself, which names the words it replaced"],
  ["lib/jobs/requirement-words.ts", "the dictionary of how postings ask — «lo que necesitás», «se valora», «suma» —, which quotes them and is nobody's voice"],
];
const KEPT = ["lib/legal/data-flow.ts"];

const excluded = (file: string) => !KEPT.includes(file) && EXCLUDED.some(([path]) => file === path || file.startsWith(`${path}/`));
const files = ["app", "components", "lib"].flatMap(sourcesUnder).filter((file) => !excluded(file));

describe("the product's own words", () => {
  it("reads the product: a test that reads nothing proves nothing", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(files.flatMap(copyOf).length).toBeGreaterThan(5000);
    // What is read and what is not, by name.
    expect(files).toContain("components/profile/ProfileHub.tsx");
    expect(files).toContain("lib/storage/local.ts");
    expect(files).toContain("lib/legal/data-flow.ts");
    expect(files).not.toContain("app/legales/terminos/page.tsx");
    expect(files).not.toContain("lib/voice.ts");
  });

  // A rule that does not catch what it is for, or that catches what is right, is worse than none: it says "all good".
  for (const rule of RULES) {
    it(`the rule for ${rule.use} catches what it is for and lets the right words through`, () => {
      for (const text of rule.catches) expect(rule.not.test(text), `should catch «${text}»`).toBe(true);
      for (const text of rule.lets) expect(rule.not.test(text), `should let «${text}» through`).toBe(false);
    });
  }

  for (const rule of RULES) {
    it(`say ${rule.use}`, () => {
      const found = files
        .filter((file) => !rule.unless?.includes(file))
        .flatMap((file) =>
          copyOf(file)
            .filter((copy) => rule.not.test(copy.text))
            .map((copy) => `${file}:${copy.line}  «${copy.text.slice(0, 110)}»`),
        );
      expect(found, `Should be ${rule.use}`).toEqual([]);
    });
  }
});
