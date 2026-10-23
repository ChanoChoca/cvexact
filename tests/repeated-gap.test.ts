import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { countLine, repeatedRequirement, type RepeatedRequirement, type SeenOffer } from "@/lib/jobs/repeated";
import { answerOfferedClaim, answerOfferedConditions, answerOfferedCredential, declineOffered, deferQuestion } from "@/lib/onboarding/answer";
import { ENGINE, PRIORITY, WEIGHT } from "@/lib/onboarding/config";
import { NO_SESSION, detectGaps, eligibleGaps, nextQuestion, priorityOf, remainingThisSession, repeatedGapId, type Signals } from "@/lib/onboarding/gaps";
import { labelFor, questionFor } from "@/lib/onboarding/questions";
import { useEngineSignals } from "@/lib/onboarding/use-signals";
import { editContext } from "@/lib/profile/edit";
import { toPlainProfile } from "@/lib/profile/project";
import { emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, newId, withJob } from "./helpers/profiles";

/**
 * O10 in the engine: the rule that asks what comes up in several of the offers the person analysed (`repeated_requirement`). It is one more question of
 * the engine, with its weight and inside its budget, and it exists only when something that has the offers tells the engine about it: with nothing
 * said — which is how everyone has it, while the experiment is off — the engine sees the profile and only the profile.
 */

const DAY = 86_400_000;
const offer = (id: string, days: number, company: string, ...lines: string[]): SeenOffer => ({
  id,
  createdAt: new Date(NOW.getTime() - days * DAY).toISOString(),
  jobText: [`Oferta ${id}`, "", "Requisitos:", ...lines.map((line) => `- ${line}`)].join("\n"),
  analysis: { company },
});
const OFFERS = [offer("a", 1, "Nubia Retail", "Manejo de Excel"), offer("b", 3, "Grupo Lumen", "Manejo de Excel"), offer("c", 6, "Casa Verde", "Manejo de Excel")];
const ctx = () => editContext({ now: STAMP, newId });

function withProfile(): StoredProfile {
  const profile = emptyStoredProfile();
  withJob(profile, { company: "Acme", role: "Analista", from: { year: 2020 }, to: "current", facts: [{ text: "Armé los informes mensuales de ventas" }] });
  return profile;
}
const repeatedFor = (profile: StoredProfile): RepeatedRequirement => {
  const found = repeatedRequirement({ offers: OFFERS, profile: toPlainProfile(profile), stored: profile, now: NOW });
  if (!found) throw new Error("the offers should have asked for something");
  return found;
};
const signalsFor = (profile: StoredProfile): Signals => ({ repeated: repeatedFor(profile) });

describe("the rule, when nobody tells the engine about the offers", () => {
  it("is not there: the engine sees the profile and only the profile", () => {
    const profile = withProfile();
    expect(detectGaps(profile, NOW).map((found) => found.rule)).not.toContain("repeated_requirement");
    expect(detectGaps(profile, NOW, {}).map((found) => found.rule)).not.toContain("repeated_requirement");
    expect(detectGaps(profile, NOW, { repeated: null }).map((found) => found.rule)).not.toContain("repeated_requirement");
    expect(eligibleGaps(profile, NO_SESSION, NOW).map((found) => found.rule)).not.toContain("repeated_requirement");
    expect(eligibleGaps(profile, NO_SESSION, NOW, { signals: {} }).map((found) => found.rule)).not.toContain("repeated_requirement");
  });

  it("is not there for what asks the engine only to count: the tasks, the return review and the first CV, which never get the offers", () => {
    const profile = withProfile();
    const without = remainingThisSession(profile, NO_SESSION, NOW);
    expect(remainingThisSession(profile, NO_SESSION, NOW, { signals: {} })).toBe(without);
    expect(remainingThisSession(profile, NO_SESSION, NOW, { signals: signalsFor(profile) })).toBe(without + 1);
  });

  it("is not there for a component that is not told: the hook gives nothing while the switch is off", () => {
    function Probe() {
      return createElement("span", null, JSON.stringify(useEngineSignals(emptyStoredProfile(), NOW)));
    }
    expect(renderToStaticMarkup(createElement(Probe))).toBe("<span>{}</span>");
  });
});

describe("the rule, when they are", () => {
  it("is one gap, about no job, with the id of what the offers count, a medium weight, and the question inside", () => {
    const profile = withProfile();
    const signals = signalsFor(profile);
    const gaps = detectGaps(profile, NOW, signals).filter((found) => found.rule === "repeated_requirement");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ id: "repeated_requirement:tool:excel", rule: "repeated_requirement", priority: "medium" });
    expect(gaps[0]!.experienceId).toBeUndefined();
    expect(gaps[0]!.id).toBe(repeatedGapId(signals.repeated!));
    expect(gaps[0]!.payload.ask).toEqual(signals.repeated);
    expect(PRIORITY.repeated_requirement).toBe("medium");
    expect(WEIGHT.repeated_requirement).toBeGreaterThan(0);
  });

  it("is asked in the words of the question of one offer, with the count of what they saw as its hint, and the line and the answers as its control", () => {
    const profile = withProfile();
    const [found] = detectGaps(profile, NOW, signalsFor(profile)).filter((entry) => entry.rule === "repeated_requirement");
    const question = questionFor(found!, profile);
    expect(question.text).toBe("¿Usaste Excel en algún trabajo, curso o proyecto?");
    expect(question.hint).toBe(countLine(repeatedFor(profile)));
    expect(question.hint).toBe("Aparece en 3 de las últimas 3 ofertas que analizaste.");
    expect(question.control).toEqual({ kind: "requirement-ask", ask: repeatedFor(profile) });
    expect(labelFor(found!, profile)).toBe("Lo que piden varias ofertas: Excel");
  });

  it("is asked a second time, a year after a «no», as one question — the day and whether it still is so — and not the first time's under another", () => {
    const profile = withProfile();
    const said = new Date(NOW.getTime() - 400 * DAY).toISOString();
    const ask: RepeatedRequirement = { ...repeatedFor(profile), again: said };
    const [found] = detectGaps(profile, NOW, { repeated: ask }).filter((entry) => entry.rule === "repeated_requirement");
    const question = questionFor(found!, profile);
    expect(question.text).toMatch(/^Anotaste el \d+ de \w+ de \d{4} que no lo tenías\. ¿Sigue siendo así\?$/);
    expect(question.text).not.toContain("¿Usaste Excel");
    expect((question.text.match(/¿/g) ?? []).length).toBe(1);
    expect(question.hint).toBe(countLine(ask));
  });

  it("is a question like any other: weighed, inside the session's budget, and put off for the session it was put off in", () => {
    const profile = withProfile();
    const signals = signalsFor(profile);
    expect(eligibleGaps(profile, NO_SESSION, NOW, { signals }).map((found) => found.rule)).toContain("repeated_requirement");
    const [found] = detectGaps(profile, NOW, signals).filter((entry) => entry.rule === "repeated_requirement");
    expect(priorityOf(found!, profile, NOW)).toBeGreaterThan(0);

    // The budget: with the session's questions spent, a medium question waits for the next one.
    const spent = { ...NO_SESSION, askedThisSession: ENGINE.session.maxQuestions };
    const next = nextQuestion(profile, spent, NOW, { signals });
    expect(next.kind === "gap" && next.gap.rule === "repeated_requirement").toBe(false);

    // «Ahora no»: not again in this session; and «no aplica» is for good.
    const later = structuredClone(profile);
    deferQuestion(later, found!, "later", ctx());
    const session = { ...NO_SESSION, startedAt: STAMP };
    expect(eligibleGaps(later, session, NOW, { signals }).map((entry) => entry.rule)).not.toContain("repeated_requirement");
    expect(eligibleGaps(later, { ...NO_SESSION, startedAt: new Date(NOW.getTime() + DAY).toISOString() }, NOW, { signals }).map((entry) => entry.rule)).toContain("repeated_requirement");
    const never = structuredClone(profile);
    deferQuestion(never, found!, "na", ctx());
    expect(eligibleGaps(never, { ...NO_SESSION, startedAt: new Date(NOW.getTime() + 9 * DAY).toISOString() }, NOW, { signals }).map((entry) => entry.rule)).not.toContain("repeated_requirement");
  });

  it("is not put to a person whose skeleton is incomplete before it is complete: what makes a job a job comes first", () => {
    const profile = emptyStoredProfile();
    withJob(profile, { company: "", role: "Analista", from: { year: 2020 }, to: "current" });
    const next = nextQuestion(profile, NO_SESSION, NOW, { signals: signalsFor(withProfile()) });
    expect(next.kind === "gap" && next.gap.priority).toBe("blocking");
  });
});

describe("what answering does, and what happens to the question after it", () => {
  const stillAsked = (profile: StoredProfile) => repeatedRequirement({ offers: OFFERS, profile: toPlainProfile(profile), stored: profile, now: NOW });

  it("«Sí, usé Excel»: the line is a task of the job they chose, in their words; Excel is among their skills; the question is not asked again", () => {
    const profile = withProfile();
    const job = profile.experience[0]!;
    const ask = repeatedFor(profile);
    expect(answerOfferedClaim(profile, { kind: "tool", thing: ask.thing }, "Armaba las planillas de comisiones", job.id, ctx())).toBe(true);
    expect(job.facts.at(-1)).toMatchObject({ text: "Armaba las planillas de comisiones", kind: "responsibility", status: "confirmed" });
    expect(job.facts.at(-1)!.source).toMatchObject({ kind: "answer" });
    expect(profile.skills.find((skill) => skill.name.value === "Excel")?.experienceIds).toEqual([job.id]);
    expect(profile.onboarding.askedThisSession).toBe(1);
    expect(stillAsked(profile)).toBeNull();
  });

  it("a line with nothing in it is not an answer, and nothing is counted", () => {
    const profile = withProfile();
    expect(answerOfferedClaim(profile, { kind: "tool", thing: "Excel" }, "   ", profile.experience[0]!.id, ctx())).toBe(false);
    expect(profile.onboarding.askedThisSession).toBe(0);
    expect(stillAsked(profile)).not.toBeNull();
  });

  it("with no job to put it in, a task is a note and a tool is a skill alone", () => {
    const profile = emptyStoredProfile();
    expect(answerOfferedClaim(profile, { kind: "tool", thing: "Excel" }, "Lo usé en mi emprendimiento", null, ctx())).toBe(true);
    expect(profile.notes.map((note) => note.text)).toEqual(["Lo usé en mi emprendimiento"]);
    expect(profile.skills.map((skill) => skill.name.value)).toEqual(["Excel"]);
  });

  it("«No»: a «no» with its day and the line it was said to, which the question is not asked against again", () => {
    const profile = withProfile();
    const ask = repeatedFor(profile);
    declineOffered(profile, ask.thing, ask.fragment, ctx());
    expect(profile.declined).toHaveLength(1);
    expect(profile.declined[0]).toMatchObject({ kind: "requirement", text: "Excel", quote: "Manejo de Excel", at: STAMP });
    expect(profile.onboarding.askedThisSession).toBe(1);
    expect(stillAsked(profile)).toBeNull();
  });

  it("«Sí, la tengo» to a credential, and a «Sí» to a condition, go where an offer's go, and end the question", () => {
    const offers = ["a", "b", "c"].map((id, index) => offer(id, index + 1, `Empresa ${id}`, "Libreta sanitaria", "Licencia de conducir B1"));
    const profile = withProfile();
    const first = repeatedRequirement({ offers, profile: toPlainProfile(profile), stored: profile, now: NOW });
    expect(first).toMatchObject({ kind: "credential" });
    expect(answerOfferedCredential(profile, { name: "Libreta sanitaria" }, first!.thing, ctx())).toBe(true);
    expect(profile.certifications.map((cert) => cert.name.value)).toEqual(["Libreta sanitaria"]);
    const second = repeatedRequirement({ offers, profile: toPlainProfile(profile), stored: profile, now: NOW });
    expect(second).toMatchObject({ kind: "license" });
    expect(answerOfferedConditions(profile, { driverLicense: "B1" }, second!.thing, ctx())).toBe(true);
    expect(repeatedRequirement({ offers, profile: toPlainProfile(profile), stored: profile, now: NOW })).toBeNull();
  });
});
