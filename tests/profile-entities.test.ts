import { describe, expect, it } from "vitest";
import { answerFigure, metricFromAnswer } from "@/lib/onboarding/answer";
import { detectGaps } from "@/lib/onboarding/gaps";
import { editFieldAt, isBlankText, undoLast } from "@/lib/profile/edit";
import { acceptInferredSkill, addCertification, addLanguage, addSkill, moveEntity, setLanguageLevel, unlinkSkill } from "@/lib/profile/entities";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, profileWith, withJob } from "./helpers/profiles";

let n = 0;
const ctx = (now: string = STAMP) => ({ now, newId: () => `e-${++n}` });

describe("editing any field where it lives", () => {
  const draft = () => profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current" });

  it("keeps what was there and says the person changed it", () => {
    const profile = draft();
    const job = profile.experience[0]!;
    expect(editFieldAt(profile, ["experience", job.id, "company"], "Nubia SA", isBlankText, ctx())).toBe(true);
    expect(job.company).toMatchObject({ value: "Nubia SA", status: "edited", original: "Nubia Retail" });
    expect(profile.history.at(-1)).toMatchObject({ op: "set", path: ["experience", job.id, "company"] });
  });

  it("treats filling a blank as saying it, not correcting it", () => {
    const profile = draft();
    const job = profile.experience[0]!;
    editFieldAt(profile, ["experience", job.id, "city"], "Valencia", isBlankText, ctx());
    expect(job.city).toMatchObject({ value: "Valencia", status: "confirmed", source: { kind: "manual" } });
    expect(job.city).not.toHaveProperty("original");
  });

  it("does nothing, and records nothing, when the value is the same", () => {
    const profile = draft();
    const job = profile.experience[0]!;
    const before = profile.history.length;
    expect(editFieldAt(profile, ["experience", job.id, "company"], "Nubia Retail", isBlankText, ctx())).toBe(true);
    expect(profile.history).toHaveLength(before);
    expect(job.company.status).toBe("confirmed");
  });

  it("says there is nothing to edit at a path that is not a field", () => {
    const profile = draft();
    expect(editFieldAt(profile, ["experience", "no-existe", "company"], "x", isBlankText, ctx())).toBe(false);
    expect(editFieldAt(profile, ["experience", profile.experience[0]!.id], "x", isBlankText, ctx())).toBe(false);
    expect(editFieldAt(profile, ["objective"], "Gerente", isBlankText, ctx())).toBe(true);
  });

  it("can be undone", () => {
    const profile = draft();
    const job = profile.experience[0]!;
    editFieldAt(profile, ["experience", job.id, "company"], "Nubia SA", isBlankText, ctx());
    const undone = undoLast(profile, ctx());
    expect(undone.ok && undone.profile.experience[0]!.company).toMatchObject({ value: "Nubia Retail", status: "confirmed" });
  });
});

describe("skills", () => {
  it("are added as the person's own", () => {
    const profile = emptyStoredProfile();
    const skill = addSkill(profile, "  Google Ads ", ctx())!;
    expect(skill).toMatchObject({ name: { value: "Google Ads", status: "confirmed", source: { kind: "manual" } }, experienceIds: [] });
    expect(profile.history.at(-1)).toMatchObject({ op: "add", path: ["skills", skill.id] });
  });

  it("are not added twice, in any case or with accents, and a job is linked to the one that is there", () => {
    const profile = profileWith({ company: "A", role: "x" });
    const job = profile.experience[0]!;
    const first = addSkill(profile, "Análisis de datos", ctx())!;
    const again = addSkill(profile, "analisis de DATOS", ctx(), job.id)!;
    expect(again.id).toBe(first.id);
    expect(profile.skills).toHaveLength(1);
    expect(again.experienceIds).toEqual([job.id]);
  });

  it("ignore a blank name", () => {
    expect(addSkill(emptyStoredProfile(), "   ", ctx())).toBeNull();
  });

  describe("a deduced one the person says is theirs", () => {
    const inferred = { skill: "Control de versiones", derivedFrom: "Git", confidence: "high" as const, rationale: "—" };

    it("is linked to the jobs whose own lines name what it was deduced from, and to no other", () => {
      const profile = profileWith({ company: "A", role: "x", facts: [{ text: "Gestioné ramas y pull requests en Git." }] });
      const other = withJob(profile, { company: "B", role: "y", facts: [{ text: "Atendí el mostrador." }] });
      const skill = acceptInferredSkill(profile, inferred, ctx())!;
      expect(skill).toMatchObject({ name: { value: "Control de versiones", status: "confirmed", source: { kind: "manual" } }, experienceIds: [profile.experience[0]!.id] });
      expect(skill.experienceIds).not.toContain(other.id);
      // Linked, so the profile does not ask «¿dónde la usaste?» about a skill it was just told.
      expect(detectGaps(profile, NOW).some((gap) => gap.rule === "skill_unused")).toBe(false);
    });

    it("is still added when no job names it", () => {
      const profile = profileWith({ company: "A", role: "x", facts: [{ text: "Atendí el mostrador." }] });
      expect(acceptInferredSkill(profile, inferred, ctx())).toMatchObject({ experienceIds: [] });
      expect(profile.skills).toHaveLength(1);
    });
  });

  it("stay among the person's skills when no longer counted as used in a job", () => {
    const profile = profileWith({ company: "A", role: "x" });
    const job = profile.experience[0]!;
    const skill = addSkill(profile, "SEO", ctx(), job.id)!;
    expect(unlinkSkill(profile, skill.id, job.id)).toBe(true);
    expect(profile.skills[0]!.experienceIds).toEqual([]);
    expect(unlinkSkill(profile, skill.id, job.id)).toBe(false);
  });
});

describe("languages", () => {
  it("are added with the level if there is one, and not twice", () => {
    const profile = emptyStoredProfile();
    const language = addLanguage(profile, "Inglés", "B2", ctx())!;
    expect(language.level).toMatchObject({ value: { cefr: "B2" }, status: "confirmed" });
    expect(addLanguage(profile, "ingles", undefined, ctx())).toBeNull();
    expect(profile.languages).toHaveLength(1);
  });

  it("have a level that can be set, changed and taken off", () => {
    const profile = emptyStoredProfile();
    const language = addLanguage(profile, "Francés", undefined, ctx())!;
    expect(detectGaps(profile, NOW).some((gap) => gap.rule === "language_no_level")).toBe(true);
    setLanguageLevel(profile, language.id, "A2", ctx());
    expect(language.level.value).toEqual({ cefr: "A2", raw: "Básico (A2)" });
    setLanguageLevel(profile, language.id, "B1", ctx());
    expect(language.level).toMatchObject({ value: { cefr: "B1" }, status: "edited" });
    setLanguageLevel(profile, language.id, null, ctx());
    expect(language.level.value).toEqual({});
  });
});

describe("certifications", () => {
  it("are added with what was given, and nothing invented for the rest", () => {
    const profile = emptyStoredProfile();
    const cert = addCertification(profile, { name: "Google Ads Certification", date: { year: 2022 } }, ctx())!;
    expect(cert).toMatchObject({ name: { value: "Google Ads Certification" }, issuer: { value: "" }, date: { value: { year: 2022 } } });
    expect(cert.date.value).not.toHaveProperty("month");
  });

  it("need a name", () => {
    expect(addCertification(emptyStoredProfile(), { name: "  " }, ctx())).toBeNull();
  });
});

describe("the order the person keeps", () => {
  it("can be changed a place at a time, and stops at the ends", () => {
    const profile = profileWith({ company: "A", role: "a" }, { company: "B", role: "b" }, { company: "C", role: "c" });
    const [a, b, c] = profile.experience.map((job) => job.id) as [string, string, string];
    expect(moveEntity(profile, "experience", c, -1)).toBe(true);
    expect(profile.experience.map((job) => job.id)).toEqual([a, c, b]);
    expect(moveEntity(profile, "experience", a, -1)).toBe(false);
    expect(moveEntity(profile, "experience", b, 1)).toBe(false);
    expect(moveEntity(profile, "experience", "no-existe", 1)).toBe(false);
  });
});

describe("a figure, as typed", () => {
  it("is exact, or a range that says it is approximate, or the record of not knowing", () => {
    expect(metricFromAnswer({ kind: "exact", value: " 20 ", unit: " % " })).toEqual({ value: "20", unit: "%", approx: false });
    expect(metricFromAnswer({ kind: "range", from: "20", to: "25", unit: "%" })).toEqual({ value: "20-25", unit: "%", approx: true });
    expect(metricFromAnswer({ kind: "unknown" })).toEqual({ unknown: true });
  });

  it("is nothing when it is not a number", () => {
    expect(metricFromAnswer({ kind: "exact", value: "muchos", unit: "" })).toBeNull();
    expect(metricFromAnswer({ kind: "range", from: "1", to: "casi", unit: "" })).toBeNull();
  });

  it("is the same one the question stores", () => {
    const profile = profileWith({ company: "A", role: "x", from: { year: 2024 }, to: "current", facts: [{ kind: "achievement", text: "Subí las ventas" }] });
    const found = detectGaps(profile, NOW).find((gap) => gap.rule === "achievement_no_figure")!;
    answerFigure(profile, found, profile.experience[0]!.facts[0]!.id, { kind: "range", from: "20", to: "25", unit: "%" }, ctx());
    expect(profile.experience[0]!.facts[0]!.metric).toEqual(metricFromAnswer({ kind: "range", from: "20", to: "25", unit: "%" }));
  });
});
