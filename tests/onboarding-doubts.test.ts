import { describe, expect, it } from "vitest";
import { detectGaps } from "@/lib/onboarding/gaps";
import { FIXABLE_DOUBTS, needsAttention, resolveEducationDoubt, resolveExperienceDoubt, reviewCounts, settleEducationDoubts, settleExperienceDoubts, swapCompanyAndRole } from "@/lib/onboarding/review";
import { editFieldAt, isBlankText } from "@/lib/profile/edit";
import { emptyStoredProfile, type StoredEducation, type StoredExperience, type StoredProfile } from "@/lib/schemas/profile-v2";

/**
 * A doubt put right from its own card: the one missing thing, asked right under the doubt. What settles a doubt is the
 * field it is about, so that is what is edited — and the block is the person's only once nothing is left in doubt.
 */

const NOW = new Date("2026-09-21T12:00:00.000Z");
const AT = NOW.toISOString();
const ctx = () => ({ now: AT, newId: () => "id-x" });
const proposed = <T>(value: T) => ({ value, status: "proposed" as const, source: { kind: "cv" as const, docId: "src-1", at: AT } });

function job(doubts: string[], over: Partial<StoredExperience> = {}): StoredProfile {
  const profile = emptyStoredProfile();
  profile.experience.push({
    id: "e1",
    company: proposed("Nubia Retail"),
    role: proposed("Analista"),
    city: proposed(""),
    country: proposed(""),
    start: proposed({ year: 2021, month: 3 }),
    end: proposed({ year: 2023 }),
    facts: [],
    review: { confidence: "low", doubts, span: [0, 0] },
    ...over,
  });
  return profile;
}

function study(doubts: string[], over: Partial<StoredEducation> = {}): StoredProfile {
  const profile = emptyStoredProfile();
  profile.education.push({
    id: "s1",
    institution: proposed("Instituto Norte"),
    degree: proposed("Tecnicatura en Marketing"),
    city: proposed(""),
    country: proposed(""),
    start: proposed({ year: 2016 }),
    end: proposed({ year: 2019 }),
    honors: proposed(""),
    highlights: { value: [], status: "confirmed" },
    status: { value: "completed", status: "proposed" },
    review: { confidence: "low", doubts, span: [0, 0] },
    ...over,
  });
  return profile;
}

const blank = { value: {}, status: "proposed" as const };

describe("what a card can resolve itself", () => {
  it("is the blanks, not the looks: which line is which and a guessed city stay for the form", () => {
    expect(FIXABLE_DOUBTS.experience).toEqual(["no_company", "no_role", "no_dates", "unreadable_date", "no_end"]);
    expect(FIXABLE_DOUBTS.education).toEqual(["no_institution", "no_degree", "no_dates", "unreadable_date", "no_end"]);
  });
});

describe("the company or the role of a job, written under the doubt", () => {
  it("sets the role, takes that doubt away and — it being the last — leaves the block the person's", () => {
    const profile = job(["no_role"], { role: proposed("") });
    expect(needsAttention(profile.experience[0]!)).toBe(true);
    expect(resolveExperienceDoubt(profile, "e1", { doubt: "no_role", value: "  Analista de datos " }, ctx())).toBe(true);
    const found = profile.experience[0]!;
    expect(found.role.value).toBe("Analista de datos");
    expect(found.role.status).not.toBe("proposed");
    expect(found.review).toBeUndefined();
    expect(needsAttention(found)).toBe(false);
    expect(reviewCounts(profile).doubtful).toBe(0);
  });

  it("sets the company the same way", () => {
    const profile = job(["no_company"], { company: proposed("") });
    expect(resolveExperienceDoubt(profile, "e1", { doubt: "no_company", value: "Nubia Retail" }, ctx())).toBe(true);
    expect(profile.experience[0]!.company.value).toBe("Nubia Retail");
  });

  it("leaves the other doubts where they were, and the block waiting for them", () => {
    const profile = job(["no_role", "no_end"], { role: proposed(""), end: blank });
    expect(resolveExperienceDoubt(profile, "e1", { doubt: "no_role", value: "Analista" }, ctx())).toBe(true);
    const found = profile.experience[0]!;
    expect(found.review?.doubts).toEqual(["no_end"]);
    // Still a block read with doubts: the end field is still a reading nobody stood behind.
    expect(needsAttention(found)).toBe(true);
  });

  it("refuses a blank, and changes nothing", () => {
    const profile = job(["no_role"], { role: proposed("") });
    const before = JSON.stringify(profile);
    expect(resolveExperienceDoubt(profile, "e1", { doubt: "no_role", value: "   " }, ctx())).toBe(false);
    expect(JSON.stringify(profile)).toBe(before);
  });

  it("says no to a job that is not there", () => {
    expect(resolveExperienceDoubt(job(["no_role"]), "nope", { doubt: "no_role", value: "Analista" }, ctx())).toBe(false);
  });
});

describe("the dates of a job, written under the doubt", () => {
  it("sets the whole stretch when none was found, and the skeleton's question about the start goes with the doubt", () => {
    const profile = job(["no_dates"], { start: blank, end: blank });
    expect(detectGaps(profile, NOW).map((found) => found.id)).toContain("incomplete_skeleton:e1:start");
    expect(resolveExperienceDoubt(profile, "e1", { doubt: "no_dates", start: { year: 2020, month: 3 }, end: {}, current: true }, ctx())).toBe(true);
    const found = profile.experience[0]!;
    expect(found.start.value).toEqual({ year: 2020, month: 3 });
    expect(found.end.value).toEqual({ current: true });
    expect(found.review).toBeUndefined();
    expect(detectGaps(profile, NOW).map((entry) => entry.id)).not.toContain("incomplete_skeleton:e1:start");
  });

  it("sets two dates, and a stretch read again after a date that could not be read", () => {
    const profile = job(["unreadable_date"], { start: proposed({ raw: "marzo del 21" }), end: proposed({ year: 2023 }) });
    expect(resolveExperienceDoubt(profile, "e1", { doubt: "unreadable_date", start: { year: 2021, month: 3 }, end: { year: 2023, month: 6 }, current: false }, ctx())).toBe(true);
    expect(profile.experience[0]!.start.value).toEqual({ year: 2021, month: 3 });
    expect(profile.experience[0]!.end.value).toEqual({ year: 2023, month: 6 });
  });

  it("refuses a stretch with no start: the start is what a job cannot go without", () => {
    const profile = job(["no_dates"], { start: blank, end: blank });
    expect(resolveExperienceDoubt(profile, "e1", { doubt: "no_dates", start: {}, end: { year: 2023 }, current: false }, ctx())).toBe(false);
    expect(profile.experience[0]!.review?.doubts).toEqual(["no_dates"]);
  });

  it("sets only the end when that is what was missing, as a date or as «Actualmente»", () => {
    const dated = job(["no_end"], { end: blank });
    expect(resolveExperienceDoubt(dated, "e1", { doubt: "no_end", end: { year: 2024, month: 8 }, current: false }, ctx())).toBe(true);
    expect(dated.experience[0]!.end.value).toEqual({ year: 2024, month: 8 });
    expect(dated.experience[0]!.start.value).toEqual({ year: 2021, month: 3 });

    const going = job(["no_end"], { end: blank });
    expect(resolveExperienceDoubt(going, "e1", { doubt: "no_end", end: {}, current: true }, ctx())).toBe(true);
    expect(going.experience[0]!.end.value).toEqual({ current: true });
  });

  it("refuses an end that says nothing", () => {
    const profile = job(["no_end"], { end: blank });
    expect(resolveExperienceDoubt(profile, "e1", { doubt: "no_end", end: {}, current: false }, ctx())).toBe(false);
  });
});

describe("a study's doubts", () => {
  it("sets the institution and the degree", () => {
    const profile = study(["no_institution", "no_degree"], { institution: proposed(""), degree: proposed("") });
    expect(resolveEducationDoubt(profile, "s1", { doubt: "no_institution", value: "Instituto Norte" }, ctx())).toBe(true);
    expect(profile.education[0]!.review?.doubts).toEqual(["no_degree"]);
    expect(resolveEducationDoubt(profile, "s1", { doubt: "no_degree", value: "Tecnicatura en Marketing" }, ctx())).toBe(true);
    expect(profile.education[0]!.institution.value).toBe("Instituto Norte");
    expect(profile.education[0]!.degree.value).toBe("Tecnicatura en Marketing");
    expect(profile.education[0]!.review).toBeUndefined();
  });

  it("sets its dates; «Actualmente» is its status and clears the end, as the card's own form does", () => {
    const profile = study(["no_dates"], { start: blank, end: blank });
    expect(resolveEducationDoubt(profile, "s1", { doubt: "no_dates", start: { year: 2023 }, end: {}, current: true }, ctx())).toBe(true);
    const found = profile.education[0]!;
    expect(found.start.value).toEqual({ year: 2023 });
    expect(found.end.value).toEqual({});
    expect(found.status.value).toBe("in_progress");
  });

  it("sets an end it was missing, and refuses a blank institution", () => {
    const profile = study(["no_end", "no_institution"], { end: blank, institution: proposed("") });
    expect(resolveEducationDoubt(profile, "s1", { doubt: "no_end", end: { year: 2019 }, current: false }, ctx())).toBe(true);
    expect(profile.education[0]!.end.value).toEqual({ year: 2019 });
    expect(resolveEducationDoubt(profile, "s1", { doubt: "no_institution", value: " " }, ctx())).toBe(false);
  });

  it("does not take a job's doubt for a study's", () => {
    const profile = study(["no_company"]);
    expect(resolveEducationDoubt(profile, "s1", { doubt: "no_company", value: "x" }, ctx())).toBe(false);
  });
});

describe("a field changed by hand in the card", () => {
  /** What `TextCell` and `DateCell` do: the edit, and in the same save the card settling what it put right. */
  const typeJob = (profile: StoredProfile, field: "company" | "role" | "city" | "country", value: string) => {
    editFieldAt(profile, ["experience", "e1", field], value, isBlankText, ctx());
    return settleExperienceDoubts(profile, "e1");
  };

  it("puts the doubt right and, it being the last, leaves the job the person's: no «Está bien» to press", () => {
    const profile = job(["no_company"], { company: proposed("") });
    expect(needsAttention(profile.experience[0]!)).toBe(true);
    expect(typeJob(profile, "company", "Nubia Retail")).toBe(true);
    expect(profile.experience[0]!.review).toBeUndefined();
    expect(needsAttention(profile.experience[0]!)).toBe(false);
    expect(reviewCounts(profile).doubtful).toBe(0);
  });

  it("goes doubt by doubt: the one put right goes, and the job stays marked for the other", () => {
    const profile = job(["no_company", "no_end"], { company: proposed(""), end: blank });
    expect(typeJob(profile, "company", "Nubia Retail")).toBe(false);
    expect(profile.experience[0]!.review?.doubts).toEqual(["no_end"]);
    expect(needsAttention(profile.experience[0]!)).toBe(true);
    editFieldAt(profile, ["experience", "e1", "end"], { current: true }, () => false, ctx());
    expect(settleExperienceDoubts(profile, "e1")).toBe(true);
    expect(profile.experience[0]!.review).toBeUndefined();
  });

  it("needs the start for a stretch, and an end or «Actualmente» for an end", () => {
    const profile = job(["no_dates"], { start: blank, end: blank });
    editFieldAt(profile, ["experience", "e1", "end"], { year: 2023 }, () => false, ctx());
    expect(settleExperienceDoubts(profile, "e1")).toBe(false);
    expect(profile.experience[0]!.review?.doubts).toEqual(["no_dates"]);
    editFieldAt(profile, ["experience", "e1", "start"], { year: 2021 }, () => false, ctx());
    expect(settleExperienceDoubts(profile, "e1")).toBe(true);
  });

  it("does not take a text another reading filled in for the person having put it right", () => {
    const profile = job(["no_company"], { company: proposed("Nubia Retail") });
    expect(typeJob(profile, "city", "Valencia")).toBe(false);
    expect(profile.experience[0]!.review?.doubts).toEqual(["no_company"]);
    expect(needsAttention(profile.experience[0]!)).toBe(true);
  });

  it("takes a guessed city as looked at once the person changes the city or the country, and no other field", () => {
    const untouched = job(["location_guess"], { city: proposed("Valencia") });
    expect(typeJob(untouched, "role", "Analista de datos")).toBe(false);
    expect(untouched.experience[0]!.review?.doubts).toEqual(["location_guess"]);

    const changed = job(["location_guess"], { city: proposed("Valencia") });
    expect(typeJob(changed, "city", "Valencia, España")).toBe(true);
    expect(changed.experience[0]!.review).toBeUndefined();
  });

  it("takes which line is which as looked at once the company or the role is changed, and drops the candidates", () => {
    const profile = job(["company_or_role", "no_end"], { end: blank });
    profile.experience[0]!.review!.candidates = ["Nubia Retail", "Analista"];
    expect(typeJob(profile, "company", "Nubia Retail SA")).toBe(false);
    expect(profile.experience[0]!.review?.doubts).toEqual(["no_end"]);
    expect(profile.experience[0]!.review?.candidates).toBeUndefined();
  });

  it("never settles a doubt it does not know, nor a job marked only for being unsure", () => {
    const strange = job(["algo_nuevo"]);
    expect(typeJob(strange, "company", "Otra")).toBe(false);
    expect(strange.experience[0]!.review?.doubts).toEqual(["algo_nuevo"]);

    const unsure = job([]);
    expect(typeJob(unsure, "company", "Otra")).toBe(false);
    expect(needsAttention(unsure.experience[0]!)).toBe(true);
  });

  it("does the same for a study: its degree, and «Actualmente» as the answer to a missing end", () => {
    const profile = study(["no_degree", "no_end"], { degree: proposed(""), end: blank });
    editFieldAt(profile, ["education", "s1", "degree"], "Tecnicatura en Marketing", isBlankText, ctx());
    expect(settleEducationDoubts(profile, "s1")).toBe(false);
    expect(profile.education[0]!.review?.doubts).toEqual(["no_end"]);
    editFieldAt(profile, ["education", "s1", "status"], "in_progress", () => false, ctx());
    expect(settleEducationDoubts(profile, "s1")).toBe(true);
    expect(needsAttention(profile.education[0]!)).toBe(false);
  });

  it("says no to a job or a study that is not there", () => {
    expect(settleExperienceDoubts(job(["no_role"]), "nope")).toBe(false);
    expect(settleEducationDoubts(study(["no_degree"]), "nope")).toBe(false);
  });

  it("leaves the job the person's when swapping company and role was the last doubt, and marked when it was not", () => {
    const last = job(["company_or_role"]);
    expect(swapCompanyAndRole(last, "e1", ctx())).toBe(true);
    expect(last.experience[0]!.review).toBeUndefined();
    expect(needsAttention(last.experience[0]!)).toBe(false);

    const more = job(["company_or_role", "no_end"], { end: blank });
    swapCompanyAndRole(more, "e1", ctx());
    expect(more.experience[0]!.review?.doubts).toEqual(["no_end"]);
  });
});
