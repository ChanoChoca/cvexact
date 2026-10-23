import { describe, expect, it } from "vitest";
import { detectGaps, type Gap } from "@/lib/onboarding/gaps";
import { DRAFT_MAX, clearDraft, cycleHasMore, draftFor, resumeBuilder, resumeCycle, saveBuilder, saveCycle, saveDraft, storeCycle, type Cycle } from "@/lib/onboarding/resume";
import { emptyStoredProfile, storedProfileSchema, type StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, profileWith } from "./helpers/profiles";

const CURRENT = { company: "Nubia Retail", role: "Analista de Marketing", from: { year: 2021, month: 3 }, to: "current" as const };

/** What the browser does to a profile between one visit and the next: written out, and read back through the schema. */
const reloaded = (profile: StoredProfile): StoredProfile => storedProfileSchema.parse(JSON.parse(JSON.stringify(profile)));

const gapOf = (profile: StoredProfile, rule: string): Gap => detectGaps(profile, NOW).find((found) => found.rule === rule)!;

/** A job with one result told and its figure not given: the middle of the achievements cycle. */
function midCycle(): { profile: StoredProfile; cycle: Cycle } {
  const profile = profileWith({ ...CURRENT, facts: [{ text: "Llevo las campañas" }] });
  const job = profile.experience[0]!;
  const found = gapOf(profile, "no_achievements");
  job.facts.push({ id: "told", kind: "achievement", text: "Rehíce las campañas y subió la conversión", source: { kind: "answer", questionId: `${found.id}:sales`, at: "" }, status: "confirmed" });
  const figureGap = gapOf(profile, "achievement_no_figure");
  return {
    profile,
    cycle: { gap: found, experienceId: job.id, remaining: ["costs", "time"], created: 1, figure: { gap: figureGap, factId: "told", quote: "Rehíce las campañas y subió la conversión" } },
  };
}

describe("the achievements cycle, left half told", () => {
  it("comes back as it was left, after the profile has been written out and read in again", () => {
    const { profile, cycle } = midCycle();
    saveCycle(profile, cycle);
    expect(resumeCycle(reloaded(profile))).toEqual(cycle);
  });

  it("keeps only what it needs of the question: its id, its rule, and the job", () => {
    const { cycle } = midCycle();
    expect(storeCycle(cycle)).toEqual({
      gapId: cycle.gap.id,
      rule: "no_achievements",
      experienceId: cycle.experienceId,
      remaining: ["costs", "time"],
      created: 1,
      figure: { gapId: cycle.figure!.gap.id, factId: "told" },
    });
  });

  it("is nothing when none was left", () => {
    expect(resumeCycle(profileWith(CURRENT))).toBeNull();
  });

  it("is over when there is nothing left in it, and says so by leaving no trace", () => {
    const { profile, cycle } = midCycle();
    saveCycle(profile, cycle);
    expect(profile.onboarding.cycle).toBeDefined();
    saveCycle(profile, { ...cycle, remaining: [], figure: undefined });
    expect(profile.onboarding.cycle).toBeUndefined();
    saveCycle(profile, cycle);
    saveCycle(profile, null);
    expect(profile.onboarding.cycle).toBeUndefined();
    expect(cycleHasMore({ ...cycle, remaining: [], figure: undefined })).toBe(false);
    expect(cycleHasMore({ ...cycle, remaining: ["costs"], figure: undefined })).toBe(true);
    expect(cycleHasMore({ ...cycle, remaining: [] })).toBe(true);
  });

  it("is not resumed for a job that is gone, or one the asker is not asking about", () => {
    const { profile, cycle } = midCycle();
    saveCycle(profile, cycle);
    expect(resumeCycle(profile, cycle.experienceId)).not.toBeNull();
    expect(resumeCycle(profile, "another-job")).toBeNull();
    profile.experience.length = 0;
    expect(resumeCycle(profile)).toBeNull();
  });

  it("drops a kind this version does not know, and is over if that was all that was left", () => {
    const { profile, cycle } = midCycle();
    saveCycle(profile, { ...cycle, remaining: ["costs"] });
    profile.onboarding.cycle!.remaining = ["costs", "teleportation", "time"];
    expect(resumeCycle(profile)?.remaining).toEqual(["costs", "time"]);

    profile.onboarding.cycle!.remaining = ["teleportation"];
    profile.onboarding.cycle!.figure = undefined;
    expect(resumeCycle(profile)).toBeNull();
  });

  it("does not wait for a figure whose achievement is gone, or that has been given since", () => {
    const { profile, cycle } = midCycle();
    saveCycle(profile, { ...cycle, remaining: ["costs"] });
    expect(resumeCycle(profile)?.figure?.quote).toBe("Rehíce las campañas y subió la conversión");

    // Given somewhere else — another tab, the profile's own card — in the meantime.
    profile.experience[0]!.facts.find((fact) => fact.id === "told")!.metric = { value: "20", unit: "%", approx: false };
    expect(resumeCycle(profile)?.figure).toBeUndefined();
    expect(resumeCycle(profile)?.remaining).toEqual(["costs"]);

    // The achievement itself removed.
    profile.experience[0]!.facts = profile.experience[0]!.facts.filter((fact) => fact.id !== "told");
    expect(resumeCycle(profile)?.figure).toBeUndefined();
  });

  it("is read leniently: a cycle nobody can make sense of is no cycle, and costs the profile nothing", () => {
    const { profile } = midCycle();
    const raw = JSON.parse(JSON.stringify(profile));
    raw.onboarding.cycle = { gapId: 42, remaining: "all of them" };
    const read = storedProfileSchema.parse(raw);
    expect(read.onboarding.cycle).toBeUndefined();
    expect(read.experience).toHaveLength(1);
  });

  it("is told with the rule it began with, so an 'ask more' cycle resumes as one", () => {
    const { cycle } = midCycle();
    expect(storeCycle({ ...cycle, gap: { ...cycle.gap, rule: "more_achievements" } }).rule).toBe("more_achievements");
  });
});

describe("an answer being typed", () => {
  it("is given back to the question it was for, and to no other", () => {
    const profile = emptyStoredProfile();
    saveDraft(profile, "no_content:a", "Atiendo a los clientes y armo los pedidos");
    expect(draftFor(profile, "no_content:a")).toBe("Atiendo a los clientes y armo los pedidos");
    expect(draftFor(profile, "no_content:b")).toBeUndefined();
  });

  it("is one at a time: the one being typed", () => {
    const profile = emptyStoredProfile();
    saveDraft(profile, "no_content:a", "uno");
    saveDraft(profile, "no_content:b", "dos");
    expect(draftFor(profile, "no_content:a")).toBeUndefined();
    expect(draftFor(profile, "no_content:b")).toBe("dos");
  });

  it("is gone when emptied, cleared, or only spaces", () => {
    const profile = emptyStoredProfile();
    saveDraft(profile, "q", "algo");
    saveDraft(profile, "q", "   ");
    expect(profile.onboarding.draft).toBeUndefined();
    saveDraft(profile, "q", "algo");
    clearDraft(profile);
    expect(draftFor(profile, "q")).toBeUndefined();
  });

  it("is never longer than a box takes, and survives the profile being written out and read in again", () => {
    const profile = emptyStoredProfile();
    saveDraft(profile, "q", "x".repeat(DRAFT_MAX + 500));
    expect(draftFor(reloaded(profile), "q")).toHaveLength(DRAFT_MAX);
  });
});

describe("the guided profile's steps", () => {
  it("starts at the first step when nothing was kept", () => {
    expect(resumeBuilder(emptyStoredProfile(), 4)).toBe(0);
  });

  it("comes back to the step after a reload", () => {
    const profile = emptyStoredProfile();
    saveBuilder(profile, 2);
    expect(profile.onboarding.builder).toEqual({ index: 2 });
    expect(resumeBuilder(reloaded(profile), 4)).toBe(2);
  });

  it("keeps nothing at the first step: it is where everyone begins", () => {
    const profile = emptyStoredProfile();
    saveBuilder(profile, 3);
    saveBuilder(profile, 0);
    expect(profile.onboarding.builder).toBeUndefined();
  });

  it("drops what the lists it replaced kept: an entry half written is not carried over", () => {
    const profile = emptyStoredProfile();
    profile.onboarding.builder = { index: 1, form: { kind: "study", what: "Licenciatura", where: "", from: {}, to: {}, current: false } };
    saveBuilder(profile, 2);
    expect(profile.onboarding.builder).toEqual({ index: 2 });
  });

  it("keeps the person on a step that exists", () => {
    const profile = emptyStoredProfile();
    saveBuilder(profile, 9);
    expect(resumeBuilder(profile, 4)).toBe(3);
  });

  it("is read leniently: a step nobody can make sense of is the first", () => {
    const raw = JSON.parse(JSON.stringify(emptyStoredProfile()));
    raw.onboarding.builder = { index: "second", form: 7 };
    expect(resumeBuilder(storedProfileSchema.parse(raw), 4)).toBe(0);

    raw.onboarding.builder = "everything";
    expect(storedProfileSchema.parse(raw).onboarding.builder).toBeUndefined();
  });
});
