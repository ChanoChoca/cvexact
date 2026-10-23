import { describe, expect, it } from "vitest";
import { deferQuestion } from "@/lib/onboarding/answer";
import { detectGaps, eligibleGaps } from "@/lib/onboarding/gaps";
import { BATCH_MAX, BATCH_MIN, questionFor, skeletonBatch } from "@/lib/onboarding/questions";
import { editExperience } from "@/lib/onboarding/review";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, freshSession, newId, profileWith } from "./helpers/profiles";

/**
 * Three or more jobs asking for their start are one question — a table, a row for each — instead of a run of cards that ask
 * the same thing again and again. Nothing is asked that the cards would not have asked, and a row left blank stays a question.
 */

const NAMES = ["Nubia Retail", "Grupo Lumen", "Delta SA", "Kiosco del Centro", "Estudio Norte", "Bar La Esquina", "Panadería Sur", "Otra más"];
/** Jobs with a company and a role and no start: what a document with no dates gives. */
const undated = (count: number): StoredProfile => profileWith(...NAMES.slice(0, count).map((company) => ({ company, role: "Asistente" })));

const eligible = (profile: StoredProfile) => eligibleGaps(profile, freshSession(), NOW);
const leadOf = (profile: StoredProfile) => eligible(profile)[0]!;
const batchOf = (profile: StoredProfile) => skeletonBatch(leadOf(profile), eligible(profile), profile);

describe("the start of several jobs, asked at once", () => {
  it("is one question when three jobs ask for their start", () => {
    const profile = undated(3);
    const question = batchOf(profile)!;
    expect(question).toMatchObject({
      id: "incomplete_skeleton:batch:start",
      rule: "incomplete_skeleton",
      text: "¿Cuándo empezaste en cada uno de estos puestos?",
      hint: "Poné el año de cada uno, y el mes si lo recordás. Los que no sepas, dejalos en blanco: te los preguntamos aparte.",
    });
    expect(question.control.kind).toBe("skeleton-batch");
  });

  it("has a row for each job, named as a question names it, in the order the profile lists them", () => {
    const profile = undated(3);
    const control = batchOf(profile)!.control;
    if (control.kind !== "skeleton-batch") throw new Error("not a batch");
    expect(control.rows.map((row) => row.label)).toEqual(["Nubia Retail", "Grupo Lumen", "Delta SA"]);
    expect(control.rows.map((row) => row.experienceId)).toEqual(profile.experience.map((job) => job.id));
    // Each row is the job's own question, so that deferring the table defers each of them.
    expect(control.rows.map((row) => row.gapId)).toEqual(profile.experience.map((job) => `incomplete_skeleton:${job.id}:start`));
  });

  it("is not for two: a pair is two cards", () => {
    expect(BATCH_MIN).toBe(3);
    expect(batchOf(undated(2))).toBeNull();
    expect(batchOf(undated(1))).toBeNull();
  });

  it("holds six rows at most, the first six the profile lists: more is a screen too dense for a phone", () => {
    expect(BATCH_MAX).toBe(6);
    const profile = undated(8);
    const control = batchOf(profile)!.control;
    if (control.kind !== "skeleton-batch") throw new Error("not a batch");
    expect(control.rows.map((row) => row.label)).toEqual(NAMES.slice(0, 6));
  });

  it("is only for the start: a company or a role missing in three jobs is still a card each", () => {
    const noCompany = profileWith(...[0, 1, 2].map((index) => ({ role: `Rol ${index}`, from: { year: 2020 + index } })));
    const lead = leadOf(noCompany);
    expect(lead.payload.missing).toEqual(["company"]);
    expect(skeletonBatch(lead, eligible(noCompany), noCompany)).toBeNull();
  });

  it("does not count a job whose start was turned down: it is not asked, so it is not a row", () => {
    const profile = undated(3);
    const turned = detectGaps(profile, NOW).find((found) => found.id === `incomplete_skeleton:${profile.experience[2]!.id}:start`)!;
    deferQuestion(profile, turned, "na", { newId, now: STAMP });
    expect(batchOf(profile)).toBeNull();
    // With a fourth job still asking there are three again, and the one turned down is not among them.
    const four = undated(4);
    const gap = detectGaps(four, NOW).find((found) => found.id === `incomplete_skeleton:${four.experience[3]!.id}:start`)!;
    deferQuestion(four, gap, "na", { newId, now: STAMP });
    const control = batchOf(four)!.control;
    if (control.kind !== "skeleton-batch") throw new Error("not a batch");
    expect(control.rows.map((row) => row.experienceId)).toEqual(four.experience.slice(0, 3).map((job) => job.id));
  });

  it("falls back to the card as the rows are answered: what is left is asked as it always was", () => {
    const profile = undated(3);
    editExperience(profile, profile.experience[0]!.id, { start: { year: 2019 } });
    expect(batchOf(profile)).toBeNull();
    expect(questionFor(leadOf(profile), profile).control).toEqual({ kind: "skeleton", field: "start" });
  });

  it("is smaller as the rows are answered, and a job left blank stays in it", () => {
    const profile = undated(4);
    editExperience(profile, profile.experience[0]!.id, { start: { year: 2019 } });
    const control = batchOf(profile)!.control;
    if (control.kind !== "skeleton-batch") throw new Error("not a batch");
    expect(control.rows).toHaveLength(3);
    expect(control.rows.map((row) => row.experienceId)).not.toContain(profile.experience[0]!.id);
  });

  it("tells two jobs at one employer apart, as a question does", () => {
    const profile = profileWith({ company: "Nubia Retail", role: "Analista" }, { company: "Nubia Retail", role: "Coordinadora" }, { company: "Grupo Lumen", role: "Asistente" });
    const control = batchOf(profile)!.control;
    if (control.kind !== "skeleton-batch") throw new Error("not a batch");
    expect(control.rows.map((row) => row.label)).toEqual(["Nubia Retail · Analista", "Nubia Retail · Coordinadora", "Grupo Lumen"]);
  });

  it("is never made of what the engine would not ask: a job past its use is not a row", () => {
    // Every start gap is blocking, so an old job asks too: the table is what the cards would have been, no more.
    const profile = undated(3);
    expect(eligible(profile).filter((found) => found.rule === "incomplete_skeleton")).toHaveLength(3);
  });
});
