import { describe, expect, it } from "vitest";
import { answerTransferable, deferQuestion } from "@/lib/onboarding/answer";
import { detectGaps, eligibleGaps, type Gap } from "@/lib/onboarding/gaps";
import { labelFor, questionFor } from "@/lib/onboarding/questions";
import { toPlainProfile } from "@/lib/profile/project";
import { setFactExcluded } from "@/lib/profile/facts";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, freshSession, newId, profileWith } from "./helpers/profiles";

/**
 * Someone changing sector who said what they are after is asked, once, which of their latest job's lines carry over to it. The
 * lines are picked, and marked: their words are not touched, and what they pick is what the generators start from for a posting
 * in the new field.
 */

const ctx = { now: STAMP, newId };

const switching = (objective = "Diseño de producto"): StoredProfile => {
  const profile = profileWith(
    { company: "Nubia Retail", role: "Analista de marketing", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes de campañas" }, { text: "Coordino con el equipo de diseño" }, { text: "Llevo las redes sociales de la marca" }] },
    { company: "Grupo Lumen", role: "Asistente", from: { year: 2018 }, to: { year: 2021 }, facts: [{ text: "Atendía a los clientes" }, { text: "Cargaba los pedidos" }] },
  );
  profile.onboarding.situation = "switch";
  profile.objective = { value: objective, status: "confirmed" };
  return profile;
};
const bridge = (profile: StoredProfile): Gap | undefined => detectGaps(profile, NOW).find((found) => found.rule === "transferable");

describe("when it is asked", () => {
  it("is of the latest job, for someone changing sector with an objective", () => {
    const profile = switching();
    const found = bridge(profile)!;
    expect(found).toMatchObject({ rule: "transferable", priority: "medium", experienceId: profile.experience[0]!.id });
    expect(found.id).toBe(`transferable:${profile.experience[0]!.id}`);
  });

  it("is not asked without the objective, or of someone who is not changing sector", () => {
    expect(bridge(switching(""))).toBeUndefined();
    const experienced = switching();
    experienced.onboarding.situation = "experienced";
    expect(bridge(experienced)).toBeUndefined();
    const nobody = switching();
    delete nobody.onboarding.situation;
    expect(bridge(nobody)).toBeUndefined();
  });

  it("needs two lines to choose among, and skips a job left out of every CV", () => {
    const one = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes" }] });
    one.onboarding.situation = "switch";
    one.objective = { value: "Diseño de producto", status: "confirmed" };
    expect(bridge(one)).toBeUndefined();

    const profile = switching();
    profile.experience[0]!.excluded = true;
    // The next job down has two lines, and is the one that can still be on a CV.
    expect(bridge(profile)!.experienceId).toBe(profile.experience[1]!.id);
  });

  it("does not count a line the person left out of their CVs", () => {
    const profile = switching();
    const job = profile.experience[0]!;
    setFactExcluded(profile, job.id, job.facts[0]!.id, true, ctx);
    setFactExcluded(profile, job.id, job.facts[1]!.id, true, ctx);
    expect(bridge(profile)!.experienceId).toBe(profile.experience[1]!.id);
  });

  it("is a job's own question: held to its budget, and after what the job is missing", () => {
    const profile = switching();
    const asked = eligibleGaps(profile, freshSession(), NOW).filter((found) => found.experienceId === profile.experience[0]!.id).map((found) => found.rule);
    expect(asked).toContain("transferable");
    const missing = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current" });
    missing.onboarding.situation = "switch";
    missing.objective = { value: "Diseño", status: "confirmed" };
    expect(bridge(missing)).toBeUndefined();
  });

  it("is not asked again once a line was marked, or the question was put aside for good", () => {
    const marked = switching();
    answerTransferable(marked, bridge(marked)!, marked.experience[0]!.id, [marked.experience[0]!.facts[0]!.id], ctx);
    expect(bridge(marked)).toBeUndefined();

    const declined = switching();
    deferQuestion(declined, bridge(declined)!, "na", ctx);
    expect(eligibleGaps(declined, freshSession(), NOW).some((found) => found.rule === "transferable")).toBe(false);
  });
});

describe("what is asked", () => {
  it("names the job and the objective, with the lines to tick as they were said, and a way out", () => {
    const profile = switching();
    const question = questionFor(bridge(profile)!, profile);
    expect(question.text).toBe("De lo que hacés en Nubia Retail, ¿qué te sirve para «Diseño de producto»?");
    expect(question.control).toMatchObject({
      kind: "pick-facts",
      none: "Ninguna me sirve",
      facts: [{ text: "Armo los informes de campañas" }, { text: "Coordino con el equipo de diseño" }, { text: "Llevo las redes sociales de la marca" }],
    });
    expect(question.hint).toMatch(/Tildá/);
  });

  it("says «hacías» of a job that ended, and has a line of its own in a list", () => {
    const profile = switching();
    profile.experience[0]!.end = { value: { year: 2024 }, status: "confirmed" };
    expect(questionFor(bridge(profile)!, profile).text).toContain("De lo que hacías en Nubia Retail");
    expect(labelFor(bridge(profile)!, profile)).toBe("Qué te sirve de Nubia Retail para «Diseño de producto»");
  });
});

describe("answering", () => {
  it("marks the lines picked, and only those, and leaves their words as they were", () => {
    const profile = switching();
    const job = profile.experience[0]!;
    const before = job.facts.map((fact) => fact.text);
    const ok = answerTransferable(profile, bridge(profile)!, job.id, [job.facts[1]!.id, job.facts[2]!.id], ctx);
    expect(ok).toBe(true);
    expect(job.facts.map((fact) => Boolean(fact.transferable))).toEqual([false, true, true]);
    expect(job.facts.map((fact) => fact.text)).toEqual(before);
    expect(profile.onboarding.askedThisSession).toBe(1);
  });

  it("is an answer to pick none: it is put aside for good, and nothing is marked", () => {
    const profile = switching();
    const job = profile.experience[0]!;
    expect(answerTransferable(profile, bridge(profile)!, job.id, [], ctx)).toBe(true);
    expect(job.facts.some((fact) => fact.transferable)).toBe(false);
    expect(profile.pending.some((entry) => entry.questionId === `transferable:${job.id}` && entry.state === "na")).toBe(true);
  });

  it("refuses lines the job does not have", () => {
    const profile = switching();
    expect(answerTransferable(profile, bridge(profile)!, profile.experience[0]!.id, ["nobody"], ctx)).toBe(false);
    expect(answerTransferable(profile, bridge(profile)!, "nobody", ["x"], ctx)).toBe(false);
  });

  it("reaches the plain profile as the lines to lead with", () => {
    const profile = switching();
    const job = profile.experience[0]!;
    answerTransferable(profile, bridge(profile)!, job.id, [job.facts[1]!.id], ctx);
    expect(toPlainProfile(profile).experience[0]!.transferable).toEqual(["Coordino con el equipo de diseño"]);
  });
});
