import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuestionBody, type QuestionHandlers } from "@/components/onboarding/QuestionBody";
import { answerAbbreviation, answerHandled, deferQuestion } from "@/lib/onboarding/answer";
import { PRIORITY } from "@/lib/onboarding/config";
import { detectGaps, eligibleGaps, type Gap } from "@/lib/onboarding/gaps";
import { labelFor, questionFor } from "@/lib/onboarding/questions";
import { addSkill } from "@/lib/profile/entities";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, freshSession, newId, profileWith } from "./helpers/profiles";

/**
 * UI-2: a skill written as its initials — «RN», «TS», «Go» — is asked once whether it is the whole name, because the table of names that mean
 * one thing (`TERM_ALIASES`) cannot read them as it: «RN» is also a nurse. The answer is the person's, and «Sí» renames the skill.
 */

const ctx = { now: STAMP, newId };
const LATER = { now: "2026-10-05T09:30:00.000Z", newId };

const withSkills = (...names: string[]): StoredProfile => {
  const profile = profileWith({ company: "Nubesur", role: "Desarrollador", from: { year: 2022 }, to: "current", facts: [{ text: "Maqueté pantallas" }] });
  for (const name of names) addSkill(profile, name, ctx, profile.experience[0]!.id);
  return profile;
};
const gapsOf = (profile: StoredProfile): Gap[] => detectGaps(profile, NOW).filter((found) => found.rule === "abbreviated_skill");

describe("a skill written as its initials", () => {
  it.each([
    ["RN", "React Native", "React Native"],
    ["TS", "TypeScript", "TypeScript"],
    ["Go", "Golang", "Go (Golang)"],
    ["rn", "React Native", "React Native"],
  ])("«%s» is a question, with the skill's id in its own and what it would be called", (written, means, name) => {
    const profile = withSkills(written, "Docker");
    const found = gapsOf(profile);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: `abbreviated_skill:${profile.skills[0]!.id}`, priority: "low", payload: { skillId: profile.skills[0]!.id, short: written, means, name } });
  });

  it("is not asked of a skill that is not on the short list, nor of one written whole", () => {
    expect(gapsOf(withSkills("React Native", "TypeScript", "Golang", "Docker", "R"))).toEqual([]);
  });

  it("is not asked where the person lists the whole name as well", () => {
    expect(gapsOf(withSkills("RN", "React Native"))).toEqual([]);
    expect(gapsOf(withSkills("Go", "Golang"))).toEqual([]);
  });

  it("says it in fixed words: the question, why, and the line it has in a list", () => {
    const profile = withSkills("RN");
    const found = gapsOf(profile)[0]!;
    const question = questionFor(found, profile);
    expect(question.text).toBe("¿“RN” es React Native?");
    expect(question.hint).toBe("Si es así, queda con el nombre completo, que es el que suelen pedir los avisos. Lo que escribiste en tus puestos no cambia.");
    expect(question.control).toEqual({ kind: "abbreviation", skillId: found.payload.skillId });
    expect(labelFor(found, profile)).toBe("Si “RN” es React Native");
  });

  it("is one of the quick questions", () => {
    expect(PRIORITY.abbreviated_skill).toBe("low");
  });

  it("«Sí» renames the skill and keeps what it was written as, where it is linked, and the question is gone", () => {
    const profile = withSkills("RN");
    const found = gapsOf(profile)[0]!;
    const linked = profile.skills[0]!.experienceIds;
    expect(answerAbbreviation(profile, found, found.payload.skillId as string, found.payload.name as string, LATER)).toBe(true);
    expect(profile.skills[0]!.name).toMatchObject({ value: "React Native", status: "edited", original: "RN" });
    expect(profile.skills[0]!.experienceIds).toEqual(linked);
    expect(gapsOf(profile)).toEqual([]);
    expect(profile.pending.some((entry) => entry.questionId === found.id)).toBe(false);
  });

  it("«Sí» to «Go» leaves it answering for Go and for Golang", () => {
    const profile = withSkills("Go");
    const found = gapsOf(profile)[0]!;
    answerAbbreviation(profile, found, found.payload.skillId as string, found.payload.name as string, LATER);
    expect(profile.skills[0]!.name.value).toBe("Go (Golang)");
  });

  it("«Sí» on a skill that is no longer there changes nothing", () => {
    const profile = withSkills("RN");
    const found = gapsOf(profile)[0]!;
    expect(answerAbbreviation(profile, found, "otra", "React Native", LATER)).toBe(false);
    expect(profile.skills[0]!.name.value).toBe("RN");
  });

  it("«No, es otra cosa» leaves the skill as it is and is not asked again", () => {
    const profile = withSkills("RN");
    const found = gapsOf(profile)[0]!;
    answerHandled(profile, found, LATER);
    expect(profile.skills[0]!.name.value).toBe("RN");
    expect(eligibleGaps(profile, freshSession(), NOW).some((gap) => gap.id === found.id)).toBe(false);
  });

  it("«Ahora no» puts it off for this visit, and it comes back in the next", () => {
    const profile = withSkills("RN");
    const found = gapsOf(profile)[0]!;
    deferQuestion(profile, found, "later", LATER);
    expect(eligibleGaps(profile, { ...freshSession(), startedAt: "2026-10-05T09:00:00.000Z" }, NOW).some((gap) => gap.id === found.id)).toBe(false);
    expect(eligibleGaps(profile, { ...freshSession(), startedAt: "2026-10-06T09:00:00.000Z" }, NOW).some((gap) => gap.id === found.id)).toBe(true);
  });

  it("is answered with «Sí», «No, es otra cosa» and «Ahora no», and nothing else to tap", () => {
    const profile = withSkills("RN");
    const question = questionFor(gapsOf(profile)[0]!, profile);
    const noop = () => undefined;
    const handlers = { abbreviation: { yes: noop, no: noop, later: noop } } as unknown as QuestionHandlers;
    const html = renderToStaticMarkup(createElement(QuestionBody, { question, profile, handlers }));
    expect(html.match(/<button/g)).toHaveLength(3);
    for (const label of ["Sí", "No, es otra cosa", "Ahora no"]) expect(html).toContain(`>${label}</button>`);
  });
});
