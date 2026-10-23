import { describe, expect, it } from "vitest";
import { hasSomethingToScore } from "@/lib/jobs/readiness";
import { scoreJobPosting } from "@/lib/jobs/score";
import { toPlainProfile } from "@/lib/profile/project";
import { addLanguage, addSkill } from "@/lib/profile/entities";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, profileWith } from "./helpers/profiles";

const POSTING = {
  title: "Analista de marketing",
  tags: ["SEO", "Google Ads"],
  description: "Buscamos analista con experiencia en SEO y Google Ads.",
  workMode: "remote",
  seniority: "unknown",
  language: "es",
  location: "",
};

describe("a profile there is something to score against", () => {
  it("is not an empty one, and not one with only a name", () => {
    expect(hasSomethingToScore(emptyStoredProfile())).toBe(false);
    const named = emptyStoredProfile();
    named.contact.fullName = { value: "Lucía Méndez", status: "confirmed" };
    expect(hasSomethingToScore(named)).toBe(false);
  });

  it("is one with a career, whether or not it has a name: the name is not part of the fit", () => {
    const profile = profileWith({ company: "Nubia", role: "Analista", from: { year: 2021, month: 3 }, to: "current" });
    expect(profile.contact.fullName.value).toBe("");
    expect(hasSomethingToScore(profile)).toBe(true);
  });

  it("is one with only skills, which a posting can be matched against", () => {
    const profile = emptyStoredProfile();
    addSkill(profile, "SEO", { now: STAMP, newId: () => "s1" });
    expect(hasSomethingToScore(profile)).toBe(true);
  });

  it("is not one with only a language: a language is not a career", () => {
    const profile = emptyStoredProfile();
    addLanguage(profile, "Inglés", "B2", { now: STAMP, newId: () => "l1" });
    expect(hasSomethingToScore(profile)).toBe(false);
  });

  it("gets the same fit with a name as without it", () => {
    const withoutName = profileWith({ company: "Nubia", role: "Analista de marketing", from: { year: 2021, month: 3 }, to: "current", facts: [{ text: "Hice SEO y manejé Google Ads" }] });
    const withName = structuredClone(withoutName);
    withName.contact.fullName = { value: "Lucía Méndez", status: "confirmed" };
    expect(scoreJobPosting(toPlainProfile(withoutName), POSTING, NOW)).toEqual(scoreJobPosting(toPlainProfile(withName), POSTING, NOW));
  });
});
