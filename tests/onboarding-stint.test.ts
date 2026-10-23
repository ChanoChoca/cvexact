import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuestionBody, type QuestionHandlers } from "@/components/onboarding/QuestionBody";
import { answerHandled, answerReason, answerSkillLevels } from "@/lib/onboarding/answer";
import { PRIORITY } from "@/lib/onboarding/config";
import { detectGaps, eligibleGaps, type Gap } from "@/lib/onboarding/gaps";
import { labelFor, questionFor } from "@/lib/onboarding/questions";
import { addSkill } from "@/lib/profile/entities";
import { toPlainProfile } from "@/lib/profile/project";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, freshSession, newId, profileWith } from "./helpers/profiles";

/**
 * UI-1 and UI-5: a stay of under a year is asked whether it deserves a line on the CV, and so is a pause between two jobs; the skills are asked how well
 * they are known, once. Both answers are the person's, written as they gave them and nowhere else.
 */

const ctx = { now: STAMP, newId };
const LATER = { now: "2026-10-05T09:30:00.000Z", newId };

const SHORT = { company: "Tiendix", role: "Desarrollador", from: { year: 2025, month: 4 }, to: { year: 2025, month: 6 }, facts: [{ text: "Armé el catálogo" }] };
const stints = (profile: StoredProfile): Gap[] => detectGaps(profile, NOW).filter((found) => found.rule === "short_stint");

describe("a stay of under a year", () => {
  it("is a question about that job, with its own id", () => {
    const profile = profileWith(SHORT);
    const [found] = stints(profile);
    expect(found).toMatchObject({ id: `short_stint:${profile.experience[0]!.id}`, priority: "low", experienceId: profile.experience[0]!.id });
    const question = questionFor(found!, profile);
    expect(question.text).toBe("¿Querés agregar un motivo breve?");
    expect(question.hint).toBe("Va en una línea del CV, debajo del puesto, con tus palabras. Podés no explicarlo.");
    expect(question.control).toEqual({ kind: "reason", jobId: profile.experience[0]!.id });
    expect(labelFor(found!, profile)).toBe("Un motivo breve para Tiendix");
  });

  it("counts the months the way the CV prints them, both ends included", () => {
    expect(stints(profileWith({ ...SHORT, from: { year: 2025, month: 1 }, to: { year: 2025, month: 11 } }))).toHaveLength(1);
    expect(stints(profileWith({ ...SHORT, from: { year: 2025, month: 1 }, to: { year: 2025, month: 12 } }))).toEqual([]);
  });

  it("is not asked of what a year does not say, of a job that goes on, or of one from long ago", () => {
    expect(stints(profileWith({ ...SHORT, from: { year: 2025 }, to: { year: 2025 } }))).toEqual([]);
    expect(stints(profileWith({ ...SHORT, to: "current" }))).toEqual([]);
    expect(stints(profileWith({ ...SHORT, from: { year: 2012, month: 4 }, to: { year: 2012, month: 6 } }))).toEqual([]);
  });

  it("is not asked of an internship, a freelance or a contract, nor once there is a reason", () => {
    for (const employmentType of ["internship", "freelance", "contract", "volunteer"] as const) {
      const profile = profileWith(SHORT);
      profile.experience[0]!.employmentType = { value: employmentType, status: "confirmed" };
      expect(stints(profile), employmentType).toEqual([]);
    }
    const profile = profileWith(SHORT);
    profile.experience[0]!.note = { value: "Cierre del área", status: "confirmed" };
    expect(stints(profile)).toEqual([]);
  });

  it("is one of the quick questions", () => {
    expect(PRIORITY.short_stint).toBe("low");
  });

  it("the reason is written as the job's note, as the person wrote it, and the question is gone", () => {
    const profile = profileWith(SHORT);
    const [found] = stints(profile);
    expect(answerReason(profile, found!, profile.experience[0]!.id, "  Cierre del área   de desarrollo ", LATER)).toBe(true);
    expect(profile.experience[0]!.note).toMatchObject({ value: "Cierre del área de desarrollo", status: "confirmed", source: { kind: "manual" } });
    expect(stints(profile)).toEqual([]);
    expect(toPlainProfile(profile).experience[0]!.note).toBe("Cierre del área de desarrollo");
  });

  it("a reason is at most a line, and nothing written is nothing kept", () => {
    const profile = profileWith(SHORT);
    const [found] = stints(profile);
    expect(answerReason(profile, found!, profile.experience[0]!.id, "   ", LATER)).toBe(false);
    expect(answerReason(profile, found!, "otro", "Motivo", LATER)).toBe(false);
    expect(profile.experience[0]!.note).toBeUndefined();
    answerReason(profile, found!, profile.experience[0]!.id, "x".repeat(300), LATER);
    expect(profile.experience[0]!.note!.value).toHaveLength(120);
  });

  it("«Prefiero no explicarlo» keeps it from being asked again", () => {
    const profile = profileWith(SHORT);
    const [found] = stints(profile);
    answerHandled(profile, found!, LATER);
    expect(eligibleGaps(profile, freshSession(), NOW).some((gap) => gap.id === found!.id)).toBe(false);
  });

  it("is answered with a box, «Agregar al CV» and «Prefiero no explicarlo»", () => {
    const profile = profileWith(SHORT);
    const question = questionFor(stints(profile)[0]!, profile);
    const noop = () => undefined;
    const html = renderToStaticMarkup(createElement(QuestionBody, { question, profile, handlers: { reason: noop, decline: noop } as unknown as QuestionHandlers }));
    expect(html.match(/<input/g)).toHaveLength(1);
    for (const label of ["Agregar al CV", "Prefiero no explicarlo"]) expect(html).toContain(`>${label}</button>`);
  });
});

describe("a pause between two jobs", () => {
  const PAUSE = [
    { company: "Pagaluz", role: "Dev", from: { year: 2021, month: 1 }, to: { year: 2022, month: 12 } },
    { company: "Nubesur", role: "Dev", from: { year: 2023, month: 7 }, to: "current" as const },
  ];
  const gapOf = (profile: StoredProfile) => detectGaps(profile, NOW).find((found) => found.rule === "career_gap")!;

  it("offers the job that follows it as where a reason is written", () => {
    const profile = profileWith(...PAUSE);
    const nubesur = profile.experience.find((job) => job.company.value === "Nubesur")!;
    expect(gapOf(profile).payload.reasonJobId).toBe(nubesur.id);
    expect(questionFor(gapOf(profile), profile).control).toMatchObject({ kind: "gap-action", reasonJobId: nubesur.id });
  });

  it("does not offer it once that job has its reason", () => {
    const profile = profileWith(...PAUSE);
    profile.experience.find((job) => job.company.value === "Nubesur")!.note = { value: "Pausa por cuidado familiar", status: "confirmed" };
    expect(gapOf(profile).payload.reasonJobId).toBeUndefined();
  });

  it("the reason goes on the job that follows, and the pause is not asked about again", () => {
    const profile = profileWith(...PAUSE);
    const found = gapOf(profile);
    const nubesur = profile.experience.find((job) => job.company.value === "Nubesur")!;
    expect(answerReason(profile, found, found.payload.reasonJobId as string, "Pausa por cuidado familiar", LATER)).toBe(true);
    expect(nubesur.note!.value).toBe("Pausa por cuidado familiar");
    expect(eligibleGaps(profile, freshSession(), NOW).some((gap) => gap.id === found.id)).toBe(false);
  });
});

describe("how well each skill is known", () => {
  const withSkills = (...names: string[]): StoredProfile => {
    const profile = profileWith({ company: "Nubesur", role: "Desarrollador", from: { year: 2022 }, to: "current", facts: [{ text: "Maqueté pantallas" }] });
    for (const name of names) addSkill(profile, name, ctx, profile.experience[0]!.id);
    return profile;
  };
  const levelsOf = (profile: StoredProfile) => detectGaps(profile, NOW).filter((found) => found.rule === "skill_levels");

  it("is one question for all of them, from three skills on", () => {
    expect(levelsOf(withSkills("React", "Docker"))).toEqual([]);
    const profile = withSkills("React", "Docker", "SQL");
    const [found] = levelsOf(profile);
    expect(found).toMatchObject({ id: "skill_levels:all", priority: "low" });
    const question = questionFor(found!, profile);
    expect(question.control).toEqual({ kind: "skill-levels", skills: profile.skills.map((skill) => ({ id: skill.id, name: skill.name.value })) });
    expect(labelFor(found!, profile)).toBe("Cuánto manejás cada habilidad");
  });

  it("saves only what was tapped, as the person's own marks, and is not asked again", () => {
    const profile = withSkills("React", "Docker", "SQL");
    const [found] = levelsOf(profile);
    const [react, docker, sql] = profile.skills;
    expect(answerSkillLevels(profile, found!, { [react!.id]: "strong", [sql!.id]: "basic" }, LATER)).toBe(true);
    expect(react!.level).toMatchObject({ value: "strong", status: "confirmed", source: { kind: "manual" } });
    expect(docker!.level).toBeUndefined();
    expect(levelsOf(profile)).toEqual([]);
    expect(toPlainProfile(profile).skillLevels).toEqual({ React: "strong", SQL: "basic" });
  });

  it("says nothing was saved when nothing was tapped", () => {
    const profile = withSkills("React", "Docker", "SQL");
    expect(answerSkillLevels(profile, levelsOf(profile)[0]!, {}, LATER)).toBe(false);
    expect(levelsOf(profile)).toHaveLength(1);
  });

  it("is not asked again once any of them has a level, wherever it came from", () => {
    const profile = withSkills("React", "Docker", "SQL");
    profile.skills[1]!.level = { value: "working", status: "confirmed" };
    expect(levelsOf(profile)).toEqual([]);
  });
});
