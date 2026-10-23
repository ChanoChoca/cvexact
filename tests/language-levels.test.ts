import { describe, expect, it } from "vitest";
import { answerLanguageLevel } from "@/lib/onboarding/answer";
import { detectGaps } from "@/lib/onboarding/gaps";
import { mergeLanguageInto } from "@/lib/onboarding/merge";
import { LEVEL_OPTIONS, questionFor } from "@/lib/onboarding/questions";
import { addLanguage, setLanguageLevel } from "@/lib/profile/entities";
import { LEVEL_NOTE, levelCode, levelPhrase, levelWord, namesLevel, pickedLevel } from "@/lib/profile/language-levels";
import { languageLevelText } from "@/lib/profile/project";
import { CEFR_LEVELS, emptyStoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP } from "./helpers/profiles";

let n = 0;
const ctx = () => ({ now: STAMP, newId: () => `ll-${++n}` });

describe("the levels, in words", () => {
  it("give every step of the scale a word of its own, so two chips never read the same", () => {
    const words = CEFR_LEVELS.map(levelWord);
    expect(new Set(words).size).toBe(CEFR_LEVELS.length);
    expect(words.every((word) => word.trim().length > 0)).toBe(true);
    // The four words anyone says, and "nativo", are among them.
    expect(words).toEqual(expect.arrayContaining(["Básico", "Intermedio", "Avanzado", "Nativo"]));
  });

  it("keep the framework's code as the small help, and none for 'Nativo', which is not a step of that scale", () => {
    expect(CEFR_LEVELS.filter((level) => level !== "native").map(levelCode)).toEqual(["A1", "A2", "B1", "B2", "C1", "C2"]);
    expect(levelCode("native")).toBeUndefined();
    expect(levelPhrase("C1")).toBe("Avanzado (C1)");
    expect(levelPhrase("native")).toBe("Nativo");
  });

  it("are what the chips say, with the code under the word", () => {
    expect(LEVEL_OPTIONS.map((option) => [option.label, option.hint])).toEqual([
      ["Principiante", "A1"],
      ["Básico", "A2"],
      ["Intermedio", "B1"],
      ["Intermedio alto", "B2"],
      ["Avanzado", "C1"],
      ["Casi nativo", "C2"],
      ["Nativo", undefined],
    ]);
  });

  it("are in voseo and never give an example of what to answer, only a note that the match is approximate", () => {
    expect(LEVEL_NOTE).toMatch(/aproximada/);
    expect(LEVEL_NOTE).not.toMatch(/por ejemplo|p\. ?ej|ej\.:|«/i);
    expect(LEVEL_NOTE).not.toMatch(/\b(elige|puedes|tienes)\b/i);
  });

  it("are the note under the question about a language's level", () => {
    const profile = emptyStoredProfile();
    profile.languages.push({ id: "l1", name: { value: "Inglés", status: "confirmed" }, level: { value: {}, status: "confirmed" } });
    const gap = detectGaps(profile, NOW).find((found) => found.rule === "language_no_level")!;
    expect(questionFor(gap, profile)).toMatchObject({ text: "¿Qué nivel de Inglés tenés?", hint: LEVEL_NOTE, control: { kind: "level", languageId: "l1" } });
  });
});

describe("a level that was picked", () => {
  it("is stored as the code and the phrase the person tapped, the shape a level from a document already has", () => {
    expect(pickedLevel("B2")).toEqual({ cefr: "B2", raw: "Intermedio alto (B2)" });
    expect(pickedLevel("native")).toEqual({ cefr: "native", raw: "Nativo" });
  });

  it("is what an answer saves, and what the CV prints", () => {
    const draft = emptyStoredProfile();
    draft.languages.push({ id: "l1", name: { value: "Inglés", status: "confirmed" }, level: { value: {}, status: "confirmed" } });
    const gap = detectGaps(draft, NOW)[0]!;
    answerLanguageLevel(draft, gap, "l1", "C1", ctx());
    expect(draft.languages[0]!.level).toMatchObject({ value: { cefr: "C1", raw: "Avanzado (C1)" }, status: "confirmed", source: { kind: "answer" } });
    expect(languageLevelText(draft.languages[0]!)).toBe("Avanzado (C1)");
    expect(detectGaps(draft, NOW)).toEqual([]);
  });

  it("is the same whether it comes from the question, from adding a language or from changing it in the profile", () => {
    const profile = emptyStoredProfile();
    const added = addLanguage(profile, "Francés", "A2", ctx())!;
    expect(added.level.value).toEqual({ cefr: "A2", raw: "Básico (A2)" });
    setLanguageLevel(profile, added.id, "native", ctx());
    expect(added.level.value).toEqual({ cefr: "native", raw: "Nativo" });
    setLanguageLevel(profile, added.id, null, ctx());
    expect(added.level.value).toEqual({});
  });

  it("does not turn a document's 'Avanzado' into a code: nobody said C1", () => {
    const profile = emptyStoredProfile();
    const language = addLanguage(profile, "Inglés", undefined, ctx())!;
    const src = (quote: string) => ({ kind: "cv" as const, at: STAMP, quote });
    mergeLanguageInto(language, { value: "Avanzado", quote: "Avanzado" }, src, { newId: ctx().newId, now: STAMP });
    expect(language.level.value).toEqual({ raw: "Avanzado" });
  });
});

describe("a level the person picked, against a document that gives one", () => {
  const picked = (level: "C1" | "B2") => {
    const profile = emptyStoredProfile();
    const language = addLanguage(profile, "Inglés", level, ctx())!;
    // The way a question stores it: an answer fills a blank, it does not correct a value.
    language.level = { ...language.level, status: "confirmed" };
    return language;
  };
  const read = (language: ReturnType<typeof picked>, text: string) =>
    mergeLanguageInto(language, { value: text, quote: text }, (quote) => ({ kind: "linkedin_pdf", at: STAMP, quote }), { newId: ctx().newId, now: STAMP });

  it("is not replaced by a different level: that is a conflict to settle", () => {
    const language = picked("C1");
    const { conflicts } = read(language, "B2");
    expect(language.level.value).toEqual({ cefr: "C1", raw: "Avanzado (C1)" });
    expect(conflicts).toHaveLength(1);
  });

  it("agrees with the same level said in its word, its code or both", () => {
    for (const text of ["Avanzado", "avanzado", "C1", "c1", "Avanzado (C1)"]) {
      const language = picked("C1");
      expect(read(language, text).conflicts, text).toEqual([]);
      expect(language.level.value).toEqual({ cefr: "C1", raw: "Avanzado (C1)" });
    }
  });

  it("knows which text names which level", () => {
    expect(namesLevel("B2", "Intermedio alto")).toBe(true);
    expect(namesLevel("B2", "B2")).toBe(true);
    expect(namesLevel("B2", "Intermedio")).toBe(false);
    expect(namesLevel("native", "nativo")).toBe(true);
  });
});
