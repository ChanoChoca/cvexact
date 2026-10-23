import { describe, expect, it } from "vitest";
import { answerCurrentJob, deferQuestion } from "@/lib/onboarding/answer";
import { ENGINE, PRIORITY, WEIGHT } from "@/lib/onboarding/config";
import { NO_SESSION, RETURN_RULES, currentJobGapId, detectGaps, eligibleGaps, nextQuestion, remainingThisSession, type Gap } from "@/lib/onboarding/gaps";
import { labelFor, questionFor } from "@/lib/onboarding/questions";
import { currentJobReviews, jobKnownAt, knownAt, lastReviewed, returnReview } from "@/lib/profile/currency";
import { standBehindJob } from "@/lib/profile/standing";
import { certificationSchema, emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, freshSession, fromSource, profileWith, withJob } from "./helpers/profiles";

/**
 * O4 (e5): a job that is going on never grew old, and it is where what the person forgets piles up. It is asked about — «¿Seguís en…?» —
 * once nobody has looked at it for six months; and a profile nobody has stood behind for two is offered the review of what changed, which
 * says the date it was last reviewed and never how long it has been.
 */

const DAY = 86_400_000;
const after = (days: number) => new Date(NOW.getTime() + days * DAY);
const ctx = (now: string = STAMP) => ({ now, newId: () => `n-${++counter}` });
let counter = 0;
const LATER = "2027-04-10T10:00:00.000Z";

/** A job typed in by the person at the instant of the helpers (2026-09-21), still going on. */
const CURRENT = { company: "Nubia Retail", role: "Analista de Marketing", from: { year: 2022, month: 3 }, to: "current" as const, facts: [{ text: "Armo los informes de ventas" }] };

const gapsOf = (profile: StoredProfile, rule: string, now: Date) => detectGaps(profile, now).filter((found) => found.rule === rule);

describe("when something is known to be true", () => {
  it("is when the person stood behind it, and otherwise when it came in — except what nobody has looked at", () => {
    expect(knownAt({ source: { kind: "manual", at: "2026-03-01T10:00:00.000Z" }, confirmedAt: "2026-06-01T10:00:00.000Z", status: "confirmed" })).toBe("2026-06-01T10:00:00.000Z");
    // A document read and taken as right before the day was kept: all that is known of it is when it came in.
    expect(knownAt({ source: { kind: "cv", at: "2026-03-01T10:00:00.000Z" }, status: "confirmed" })).toBe("2026-03-01T10:00:00.000Z");
    expect(knownAt({ source: { kind: "cv", at: "2026-03-01T10:00:00.000Z" }, status: "proposed" })).toBeNull();
    expect(knownAt({ source: { kind: "legacy", at: "" }, status: "confirmed" })).toBeNull();
    expect(knownAt({})).toBeNull();
  });

  it("is, for a job, the latest of what it is and of every line told of it", () => {
    const profile = profileWith(CURRENT);
    const job = profile.experience[0]!;
    expect(jobKnownAt(job)).toBe(STAMP);
    job.facts[0]!.confirmedAt = LATER;
    expect(jobKnownAt(job)).toBe(LATER);
  });
});

describe("a job that is going on", () => {
  it("is asked about once nothing has been said of it for six months, and not before", () => {
    const profile = profileWith(CURRENT);
    expect(currentJobReviews(profile, after(ENGINE.currency.currentJobDays - 1))).toEqual([]);
    const [review] = currentJobReviews(profile, after(ENGINE.currency.currentJobDays + 1));
    expect(review).toMatchObject({ since: STAMP });
    expect(review!.job.company.value).toBe("Nubia Retail");
  });

  it("is a question with its own id, which has the month it was last looked at in it", () => {
    const profile = profileWith(CURRENT);
    const now = after(200);
    const [found] = gapsOf(profile, "current_job_review", now);
    expect(found).toMatchObject({ rule: "current_job_review", priority: "medium", experienceId: profile.experience[0]!.id, payload: { since: STAMP } });
    expect(found!.id).toBe(currentJobGapId(profile.experience[0]!.id, STAMP));
    expect(found!.id).toBe(`current_job_review:${profile.experience[0]!.id}:2026-09`);
  });

  it("is not asked of a job that ended, one nobody has looked at, one left out of the CVs, or one that is not a job", () => {
    const ended = profileWith({ ...CURRENT, to: { year: 2024, month: 5 } });
    expect(gapsOf(ended, "current_job_review", after(400))).toEqual([]);

    const unlooked = profileWith(CURRENT);
    unlooked.experience[0]!.company = { value: "Nubia Retail", status: "proposed", source: { kind: "cv", at: STAMP } };
    expect(gapsOf(unlooked, "current_job_review", after(400))).toEqual([]);

    const aside = profileWith(CURRENT);
    aside.experience[0]!.excluded = true;
    expect(gapsOf(aside, "current_job_review", after(400))).toEqual([]);

    expect(gapsOf(emptyStoredProfile(), "current_job_review", after(400))).toEqual([]);
  });

  it("is not asked of one nobody can date: what is only read from a document, and never looked at, has no day", () => {
    const profile = profileWith(CURRENT);
    fromSource(profile.experience[0]!, { kind: "legacy", at: "" });
    expect(gapsOf(profile, "current_job_review", after(400))).toEqual([]);
  });

  it("is asked of a job a document brought and a person took as right before the day was kept, by when it came in", () => {
    const profile = profileWith(CURRENT);
    fromSource(profile.experience[0]!, { kind: "cv", at: STAMP });
    // Every field says «cv» and is taken as right: nothing stamped, and the only day is when it came in.
    expect(gapsOf(profile, "current_job_review", after(200))).toHaveLength(1);
  });

  it("goes to whoever has not been looked at for longest, first", () => {
    const profile = profileWith(CURRENT);
    withJob(profile, { company: "Grupo Lumen", role: "Asistente", from: { year: 2021 }, to: "current", facts: [{ text: "Atiendo a los clientes" }] });
    profile.experience.find((job) => job.company.value === "Grupo Lumen")!.facts[0]!.confirmedAt = "2026-12-01T10:00:00.000Z";
    const reviews = currentJobReviews(profile, after(400));
    expect(reviews.map((review) => review.job.company.value)).toEqual(["Nubia Retail", "Grupo Lumen"]);
  });

  it("weighs more than a job's figures and less than a job with nothing in it, and takes part in a session's budget", () => {
    expect(WEIGHT.current_job_review).toBeGreaterThan(WEIGHT.achievement_no_figure);
    expect(WEIGHT.current_job_review).toBeLessThan(WEIGHT.no_content);
    expect(PRIORITY.current_job_review).toBe("medium");
  });

  it("is the question the engine asks first of a profile that has nothing else to ask — and after what a job with nothing in it asks", () => {
    const profile = profileWith({ ...CURRENT, facts: [{ text: "Armo los informes de ventas" }, { kind: "achievement", text: "Subí las ventas un 20%" }] });
    profile.pending.push({ questionId: `more_achievements:${profile.experience[0]!.id}`, ruleId: "more_achievements", state: "na", count: 1, at: STAMP });
    const now = after(200);
    const next = nextQuestion(profile, NO_SESSION, now);
    expect(next).toMatchObject({ kind: "gap", gap: { rule: "current_job_review" } });

    // A job with no achievement yet is asked what improved first: it is what a CV leans on.
    const missing = profileWith(CURRENT);
    expect(nextQuestion(missing, NO_SESSION, now)).toMatchObject({ kind: "gap", gap: { rule: "no_achievements" } });
  });
});

describe("what it asks", () => {
  const stale = () => {
    const profile = profileWith(CURRENT);
    return { profile, found: gapsOf(profile, "current_job_review", after(200))[0]! };
  };

  it("says who they are with, what the profile has as a date, and nothing about how long it has been", () => {
    const { profile, found } = stale();
    const question = questionFor(found, profile);
    expect(question.text).toBe("¿Seguís en Nubia Retail?");
    expect(question.hint).toBe("Figura en curso desde marzo de 2022. Lo último que anotaste de este puesto es de septiembre de 2026.");
    expect(question.hint).not.toMatch(/hace \d|desde hace/i);
    expect(question.control).toEqual({ kind: "current-job", jobId: profile.experience[0]!.id });
    expect(question.context).toBe("Sobre Nubia Retail · puesto actual");
  });

  it("says it by the role when the job has no company, and by the place when it has neither", () => {
    const { profile, found } = stale();
    profile.experience[0]!.company = { value: "", status: "confirmed" };
    expect(questionFor(found, profile).text).toBe("¿Seguís como Analista de Marketing?");
    profile.experience[0]!.role = { value: "", status: "confirmed" };
    expect(questionFor(found, profile).text).toBe("¿Seguís en este puesto?");
  });

  it("names itself in a list of what is left, apart from the job's other questions", () => {
    const { profile, found } = stale();
    expect(labelFor(found, profile)).toBe("Si seguís en Nubia Retail");
  });
});

describe("what an answer does", () => {
  const stale = () => {
    const profile = profileWith(CURRENT);
    const now = after(200);
    return { profile, now, found: gapsOf(profile, "current_job_review", now)[0]! };
  };

  it("«sí, sigo» is the day they stood behind the job, and nothing else changes", () => {
    const { profile, now, found } = stale();
    const before = structuredClone(profile.experience[0]!);
    expect(answerCurrentJob(profile, found, { status: { kind: "still" }, news: "" }, ctx(LATER))).toBeTruthy();
    const job = profile.experience[0]!;
    expect(job.company).toMatchObject({ value: "Nubia Retail", confirmedAt: LATER });
    expect(job.role).toMatchObject({ value: "Analista de Marketing", confirmedAt: LATER });
    expect(job.end).toMatchObject({ value: { current: true }, confirmedAt: LATER });
    expect(job.start.confirmedAt).toBe(LATER);
    // The lines told of it were not asked about, and are not stamped.
    expect(job.facts).toEqual(before.facts);
    expect(job.company.value).toBe(before.company.value);
    expect(profile.history).toEqual([]);
    // It is not asked again until the clock has run again, from today.
    expect(gapsOf(profile, "current_job_review", now)).toEqual([]);
    expect(gapsOf(profile, "current_job_review", new Date(Date.parse(LATER) + (ENGINE.currency.currentJobDays + 1) * DAY))).toHaveLength(1);
    expect(profile.onboarding.askedThisSession).toBe(1);
    expect(profile.onboarding.askedByExperience[job.id]).toBe(1);
  });

  it("«cambió algo» keeps what they now say of the role and the company, with the way back in the history", () => {
    const { profile, found } = stale();
    expect(answerCurrentJob(profile, found, { status: { kind: "still", role: "Coordinadora de Marketing", company: " " }, news: "" }, ctx(LATER))).toBeTruthy();
    const job = profile.experience[0]!;
    expect(job.role).toMatchObject({ value: "Coordinadora de Marketing", status: "edited", original: "Analista de Marketing", confirmedAt: LATER });
    expect(job.company.value).toBe("Nubia Retail");
    expect(profile.history.map((entry) => entry.path.join("/"))).toEqual([`experience/${job.id}/role`]);
  });

  it("«ya terminé» keeps the date it ended on, and the job is no longer one that is going on", () => {
    const { profile, now, found } = stale();
    expect(answerCurrentJob(profile, found, { status: { kind: "ended", end: { year: 2027, month: 2, raw: "feb" } }, news: "" }, ctx(LATER))).toBeTruthy();
    const job = profile.experience[0]!;
    expect(job.end).toMatchObject({ value: { year: 2027, month: 2 }, status: "edited", confirmedAt: LATER });
    expect(job.end.value.current).toBeUndefined();
    expect(gapsOf(profile, "current_job_review", now)).toEqual([]);
  });

  it("«ya terminé» is refused without a year and with an end before the start, and nothing is kept of it", () => {
    const { profile, found } = stale();
    const before = structuredClone(profile);
    expect(answerCurrentJob(profile, found, { status: { kind: "ended", end: { month: 6 } }, news: "Algo que contar" }, ctx(LATER))).toBe(false);
    expect(answerCurrentJob(profile, found, { status: { kind: "ended", end: { year: 2021, month: 12 } }, news: "Algo que contar" }, ctx(LATER))).toBe(false);
    expect(profile).toEqual(before);
    // A year alone is a date.
    expect(answerCurrentJob(profile, found, { status: { kind: "ended", end: { year: 2027 } }, news: "" }, ctx(LATER))).toBeTruthy();
    expect(profile.experience[0]!.end.value).toEqual({ year: 2027 });
  });

  it("«ya terminé» and then «empecé en otro lado»: the job they went on to is a job of its own, from the date they say, and this one is over", () => {
    const { profile, found } = stale();
    const result = answerCurrentJob(
      profile,
      found,
      { status: { kind: "ended", end: { year: 2026, month: 8 }, next: { company: "Grupo Lumen", role: "Jefa de depósito", start: { year: 2026, month: 9 } } }, news: "" },
      ctx(LATER),
    );
    expect(result).toBeTruthy();
    expect(profile.experience).toHaveLength(2);
    const [old] = profile.experience.filter((job) => job.id === found.experienceId);
    expect(old!.end.value).toEqual({ year: 2026, month: 8 });
    expect(old!.company.value).toBe("Nubia Retail");
    const went = profile.experience.find((job) => job.id !== found.experienceId)!;
    expect(went.company.value).toBe("Grupo Lumen");
    expect(went.role.value).toBe("Jefa de depósito");
    expect(went.start.value).toEqual({ year: 2026, month: 9 });
    expect(went.end.value).toEqual({ current: true });
    expect(went.facts).toEqual([]);
    expect(result && result.newJob?.id).toBe(went.id);
    // One answer, counted once, whatever it did.
    expect(profile.onboarding.askedThisSession).toBe(1);
  });

  it("«cambió algo» with another role at the same place: a new job from the date they say, the one before ends that month, and the company is not written over", () => {
    const { profile, found } = stale();
    expect(
      answerCurrentJob(profile, found, { status: { kind: "moved", next: { company: "Nubia Retail", role: "Coordinadora de Marketing", start: { year: 2026, month: 3 } } }, news: "" }, ctx(LATER)),
    ).toBeTruthy();
    expect(profile.experience.map((job) => [job.role.value, job.company.value])).toEqual(
      expect.arrayContaining([
        ["Analista de Marketing", "Nubia Retail"],
        ["Coordinadora de Marketing", "Nubia Retail"],
      ]),
    );
    const before = profile.experience.find((job) => job.id === found.experienceId)!;
    expect(before.end.value).toEqual({ year: 2026, month: 3 });
    const after = profile.experience.find((job) => job.id !== found.experienceId)!;
    expect(after.start.value).toEqual({ year: 2026, month: 3 });
    expect(after.end.value).toEqual({ current: true });
    // They meet in a month and not more: it is not two jobs at once.
    expect(detectGaps(profile, NOW).some((gap) => gap.rule === "overlap")).toBe(false);
  });

  it("«cambió algo» with another place: the same, with the other company", () => {
    const { profile, found } = stale();
    answerCurrentJob(profile, found, { status: { kind: "moved", next: { company: "Grupo Lumen", role: "Analista de Marketing", start: { year: 2026, month: 5 } } }, news: "" }, ctx(LATER));
    expect(profile.experience.map((job) => job.company.value).sort()).toEqual(["Grupo Lumen", "Nubia Retail"]);
    expect(profile.experience.find((job) => job.id === found.experienceId)!.end.value).toEqual({ year: 2026, month: 5 });
  });

  it("what they tell goes to the job it happened in: the new one when they went on to one, and this one when not", () => {
    const { profile, found } = stale();
    answerCurrentJob(
      profile,
      found,
      { status: { kind: "moved", next: { company: "Nubia Retail", role: "Coordinadora", start: { year: 2026, month: 3 } } }, news: "Empecé a coordinar el turno noche." },
      ctx(LATER),
    );
    expect(profile.experience.find((job) => job.id === found.experienceId)!.facts.map((fact) => fact.text)).toEqual(["Armo los informes de ventas"]);
    expect(profile.experience.find((job) => job.id !== found.experienceId)!.facts.map((fact) => fact.text)).toEqual(["Empecé a coordinar el turno noche."]);

    const other = stale();
    const result = answerCurrentJob(other.profile, other.found, { status: { kind: "ended", end: { year: 2026, month: 8 } }, news: "Cerré el inventario anual." }, ctx(LATER));
    expect(result && result.facts.map((fact) => fact.text)).toEqual(["Cerré el inventario anual."]);
    expect(other.profile.experience[0]!.facts.map((fact) => fact.text)).toEqual(["Armo los informes de ventas", "Cerré el inventario anual."]);
  });

  it("refuses a new job that says neither where nor what, or has no year, and an end before the start — and keeps nothing", () => {
    const { profile, found } = stale();
    const before = structuredClone(profile);
    expect(answerCurrentJob(profile, found, { status: { kind: "ended", end: { year: 2026 }, next: { company: " ", role: "", start: { year: 2026 } } }, news: "" }, ctx(LATER))).toBe(false);
    expect(answerCurrentJob(profile, found, { status: { kind: "moved", next: { company: "Grupo Lumen", role: "Jefa", start: { month: 3 } } }, news: "" }, ctx(LATER))).toBe(false);
    expect(answerCurrentJob(profile, found, { status: { kind: "moved", next: { company: "Grupo Lumen", role: "Jefa", start: { year: 2020, month: 1 } } }, news: "" }, ctx(LATER))).toBe(false);
    expect(profile).toEqual(before);
  });

  it("what happened since is told as their own lines, one for each sentence, to this question, and counts once", () => {
    const { profile, found } = stale();
    answerCurrentJob(profile, found, { status: { kind: "still" }, news: "Empecé a llevar las campañas de Meta. Capacité a dos personas nuevas." }, ctx(LATER));
    const facts = profile.experience[0]!.facts;
    expect(facts.map((fact) => fact.text)).toEqual(["Armo los informes de ventas", "Empecé a llevar las campañas de Meta.", "Capacité a dos personas nuevas."]);
    for (const fact of facts.slice(1)) expect(fact).toMatchObject({ kind: "responsibility", status: "confirmed", source: { kind: "answer", questionId: found.id, at: LATER } });
    expect(profile.onboarding.askedThisSession).toBe(1);
  });

  it("«nada nuevo» adds nothing, and it was an answer all the same", () => {
    const { profile, found } = stale();
    answerCurrentJob(profile, found, { status: { kind: "still" }, news: "   " }, ctx(LATER));
    expect(profile.experience[0]!.facts).toHaveLength(1);
    expect(profile.onboarding.askedThisSession).toBe(1);
  });

  it("leaves a question that was put off in the list, and is asked by name after", () => {
    const { profile, now, found } = stale();
    deferQuestion(profile, found, "later", ctx());
    expect(profile.pending.map((entry) => entry.questionId)).toEqual([found.id]);
    answerCurrentJob(profile, found, { status: { kind: "still" }, news: "" }, ctx(LATER));
    expect(profile.pending).toEqual([]);
    expect(gapsOf(profile, "current_job_review", now)).toEqual([]);
  });

  it("does nothing for a job that is gone", () => {
    const { profile, found } = stale();
    profile.experience = [];
    expect(answerCurrentJob(profile, found, { status: { kind: "still" }, news: "" }, ctx(LATER))).toBe(false);
  });

  it("«no aplica» turns down this review, and not the next one", () => {
    const { profile, now, found } = stale();
    deferQuestion(profile, found, "na", ctx());
    expect(eligibleGaps(profile, freshSession(), now).some((gap) => gap.rule === "current_job_review")).toBe(false);
    // Looked at again, it is asked about again in six months: a new question.
    standBehindJob(profile, profile.experience[0]!.id, LATER);
    const nextTime = new Date(Date.parse(LATER) + (ENGINE.currency.currentJobDays + 1) * DAY);
    const again = gapsOf(profile, "current_job_review", nextTime)[0]!;
    expect(again.id).not.toBe(found.id);
    expect(eligibleGaps(profile, freshSession(), nextTime).some((gap) => gap.id === again.id)).toBe(true);
  });
});

describe("standing behind a job", () => {
  it("stamps what the job is and not what is told of it, and passes over what it does not have", () => {
    const profile = profileWith(CURRENT);
    const job = profile.experience[0]!;
    expect(standBehindJob(profile, job.id, LATER)).toBe(true);
    expect(job.city.confirmedAt).toBeUndefined();
    expect(job.employmentType).toBeUndefined();
    expect(job.facts[0]!.confirmedAt).toBeUndefined();
    expect(standBehindJob(profile, "nobody", LATER)).toBe(false);
  });
});

describe("the review of what changed", () => {
  const settled = (): StoredProfile => {
    const profile = profileWith(CURRENT);
    profile.onboarding.done = true;
    profile.onboarding.step = "done";
    return profile;
  };

  it("is offered once nobody has stood behind anything for two months, with the date it was last done", () => {
    const profile = settled();
    expect(returnReview(profile, after(ENGINE.currency.returnDays - 1))).toBeNull();
    expect(returnReview(profile, after(ENGINE.currency.returnDays + 1))).toEqual({ since: STAMP });
    expect(lastReviewed(profile)).toBe(STAMP);
  });

  it("is the latest of anything: a credential's date, the day they said it still holds", () => {
    const profile = settled();
    profile.certifications.push(certificationSchema.parse({ id: "c1", name: { value: "Carnet", status: "confirmed" }, expires: { value: { year: 2031 }, status: "confirmed", confirmedAt: "2026-12-20T10:00:00.000Z" } }));
    expect(lastReviewed(profile)).toBe("2026-12-20T10:00:00.000Z");
    expect(returnReview(profile, after(ENGINE.currency.returnDays + 1))).toBeNull();
  });

  it("is not offered for a profile nobody has begun, or one nobody has ever looked at: there is no date to say", () => {
    expect(returnReview(emptyStoredProfile(), after(400))).toBeNull();
    const unlooked = profileWith(CURRENT);
    fromSource(unlooked.experience[0]!, { kind: "cv", at: STAMP });
    expect(lastReviewed(unlooked)).toBeNull();
    expect(returnReview(unlooked, after(400))).toBeNull();
  });

  it("asks about time and about nothing else, at most three, and counts them with the one it asks next", () => {
    const profile = settled();
    withJob(profile, { company: "Grupo Lumen", role: "Asistente", from: { year: 2021 }, to: "current", facts: [{ text: "Atiendo a los clientes" }] });
    profile.certifications.push(certificationSchema.parse({ id: "c1", name: { value: "Matrícula", status: "confirmed" }, expires: { value: { year: 2026, month: 1 }, status: "confirmed" } }));
    const now = after(300);
    const options = { rules: RETURN_RULES, limit: ENGINE.currency.returnQuestions };
    const found = eligibleGaps(profile, NO_SESSION, now, { rules: RETURN_RULES });
    expect(found.length).toBeGreaterThanOrEqual(3);
    expect(found.every((gap) => RETURN_RULES.has(gap.rule))).toBe(true);
    expect(RETURN_RULES.has("no_content")).toBe(false);

    expect(remainingThisSession(profile, NO_SESSION, now, options)).toBe(3);
    expect(nextQuestion(profile, NO_SESSION, now, options)).toMatchObject({ kind: "gap" });
    const spent = { ...freshSession(), askedThisSession: 2, askedQuick: 1 };
    expect(nextQuestion(profile, spent, now, options)).toMatchObject({ kind: "budget" });
    expect(remainingThisSession(profile, spent, now, options)).toBe(0);
    // Without the limit, the same session goes on.
    expect(nextQuestion(profile, spent, now, { rules: RETURN_RULES })).toMatchObject({ kind: "gap" });
  });

  it("is a session that ends when it has asked what it was going to, and leaves the rest of the engine's questions alone", () => {
    const profile = settled();
    profile.experience[0]!.facts = [];
    const now = after(300);
    expect(eligibleGaps(profile, NO_SESSION, now).some((gap) => gap.rule === "no_content")).toBe(true);
    expect(eligibleGaps(profile, NO_SESSION, now, { rules: RETURN_RULES }).every((gap) => gap.rule !== "no_content")).toBe(true);
  });
});

describe("a question the engine already had", () => {
  it("is as it was for a profile with nothing going on: no job is asked about", () => {
    const profile: StoredProfile = profileWith({ company: "Nubia", role: "Analista", from: { year: 2019 }, to: { year: 2021 }, facts: [{ text: "Armo informes" }] });
    expect(detectGaps(profile, after(900)).some((found: Gap) => found.rule === "current_job_review")).toBe(false);
  });
});
