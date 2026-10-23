import { describe, expect, it } from "vitest";
import { answerConditions, answerConditionsChanged, answerNoLonger, answerRenewal, deferQuestion } from "@/lib/onboarding/answer";
import { ENGINE, PRIORITY, WEIGHT } from "@/lib/onboarding/config";
import { NO_SESSION, conditionsGapId, credentialGapId, detectGaps, eligibleGaps, isReviewRule, nextQuestion, type Gap } from "@/lib/onboarding/gaps";
import { labelFor, questionFor } from "@/lib/onboarding/questions";
import { pendingItems } from "@/lib/onboarding/session";
import { confirmPractical } from "@/lib/profile/credentials";
import { credentialReviews } from "@/lib/profile/currency";
import { reviewItems } from "@/lib/profile/to-review";
import { leftToDo, leftToDoLine, profileTasks } from "@/lib/profile/tasks";
import { certificationSchema, emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, freshSession, newId, profileWith } from "./helpers/profiles";

/**
 * O2 (e5), the part the engine plays: what has a date on it is asked about once the date is near or past, what was said about how
 * they can work is asked after once it has gone unsaid long enough, and what the answers do. All of it a question and none of it a
 * decision: nothing expires, archives or leaves a CV unless the person says so.
 */

let n = 0;
const ctx = (now: string = STAMP) => ({ now, newId: () => `q-${++n}` });
const LATER = "2026-10-05T09:30:00.000Z";

const withCert = (profile: StoredProfile, name: string, year: number, month?: number) => {
  const cert = certificationSchema.parse({
    id: `cert-${++n}`,
    name: { value: name, status: "confirmed" },
    expires: { value: { year, ...(month ? { month } : {}) }, status: "confirmed", source: { kind: "manual", at: "2024-01-01T00:00:00.000Z" } },
  });
  profile.certifications.push(cert);
  return cert;
};

const withPractical = (profile: StoredProfile, at: string, extra: Partial<StoredProfile["legacy"]["practical"]["value"]> = {}) => {
  profile.legacy.practical = {
    value: { availability: "Tiempo completo", driverLicense: "", ownVehicle: false, willingToRelocate: false, workEligibility: "", ...extra },
    status: "confirmed",
    source: { kind: "answer", at },
  };
};

const gapsOf = (profile: StoredProfile, rule: string) => detectGaps(profile, NOW).filter((found) => found.rule === rule);
const gapOf = (profile: StoredProfile, rule: string): Gap => gapsOf(profile, rule)[0]!;

describe("the questions about a date", () => {
  it("are one for each credential that is near or past its date, with what it is and why", () => {
    const profile = emptyStoredProfile();
    const lapsed = withCert(profile, "Matrícula de gasista", 2026, 3);
    const soon = withCert(profile, "Carnet de manipulación de alimentos", 2026, 10);
    withCert(profile, "Curso de Excel", 2031, 1);
    const found = gapsOf(profile, "credential_expiry");
    expect(found.map((gap) => gap.id)).toEqual([`credential_expiry:cert:${lapsed.id}:2026-03`, `credential_expiry:cert:${soon.id}:2026-10`]);
    expect(found[0]!.payload).toMatchObject({ subject: { kind: "certification", id: lapsed.id }, name: "Matrícula de gasista", lapsed: true });
    // Until the last moment of 31 October: forty days from noon on the 21st of September, and the part of the day left makes it forty-one.
    expect(found[1]!.payload).toMatchObject({ subject: { kind: "certification", id: soon.id }, lapsed: false, days: 41 });
    expect(found.every((gap) => gap.priority === "low" && gap.experienceId === undefined)).toBe(true);
  });

  it("have the date in their id, so «No aplica» turns down this lapse and not the credential", () => {
    const profile = emptyStoredProfile();
    const cert = withCert(profile, "Matrícula de gasista", 2026, 3);
    const first = gapOf(profile, "credential_expiry");
    deferQuestion(profile, first, "na", ctx());
    expect(eligibleGaps(profile, freshSession(), NOW).some((gap) => gap.rule === "credential_expiry")).toBe(false);

    // Renewed — and it lapses again, years from now: a new question, not the one that was put aside.
    answerRenewal(profile, first, { year: 2026, month: 5 }, ctx());
    expect(profile.certifications.find((entry) => entry.id === cert.id)!.expires?.value).toEqual({ year: 2026, month: 5 });
    const again = gapOf(profile, "credential_expiry");
    expect(again.id).toBe(`credential_expiry:cert:${cert.id}:2026-05`);
    expect(again.id).not.toBe(first.id);
    expect(eligibleGaps(profile, freshSession(), NOW).some((gap) => gap.id === again.id)).toBe(true);
  });

  it("are not asked of what has no date, what is far from it, or what the person set aside", () => {
    const profile = emptyStoredProfile();
    profile.certifications.push(certificationSchema.parse({ id: "x", name: { value: "Curso sin fecha", status: "confirmed" } }));
    withCert(profile, "Matrícula lejana", 2032, 5);
    const aside = withCert(profile, "Matrícula vieja", 2020, 1);
    aside.excluded = true;
    expect(gapsOf(profile, "credential_expiry")).toEqual([]);
  });

  it("include the driving licence, by its class, with a date of its own", () => {
    const profile = emptyStoredProfile();
    withPractical(profile, STAMP, { driverLicense: "B1" });
    profile.legacy.driverLicenseExpires = { value: { year: 2026, month: 4 }, status: "confirmed" };
    const found = gapOf(profile, "credential_expiry");
    expect(found.id).toBe("credential_expiry:license:2026-04");
    expect(found.payload).toMatchObject({ subject: { kind: "license" }, name: "Licencia de conducir (B1)", lapsed: true });
    expect(credentialGapId({ subject: { kind: "license" }, expires: { year: 2026, month: 4 } })).toBe(found.id);
  });

  it("ask after what was said about how they can work only once it has gone unsaid for ninety days", () => {
    const fresh = emptyStoredProfile();
    withPractical(fresh, "2026-07-01T12:00:00.000Z");
    expect(gapsOf(fresh, "conditions_review")).toEqual([]);

    const stale = emptyStoredProfile();
    withPractical(stale, "2026-06-01T12:00:00.000Z", { driverLicense: "B1", ownVehicle: true });
    const [found] = gapsOf(stale, "conditions_review");
    expect(found).toMatchObject({ id: "conditions_review:2026-06", priority: "low" });
    expect(found!.payload).toMatchObject({ since: "2026-06-01T12:00:00.000Z", line: "Tiempo completo · Licencia B1 · Vehículo propio" });
    // The days it takes are the engine's, and are starting values like the rest of its numbers.
    expect(ENGINE.currency).toMatchObject({ credentialSoonDays: 60, conditionsDays: 90 });
  });

  it("have the month of the last time they stood behind what they said in their id, so «No aplica» turns down this review and not the question for good (U18)", () => {
    const profile = emptyStoredProfile();
    withPractical(profile, "2026-01-01T12:00:00.000Z", { driverLicense: "B1" });
    const found = gapOf(profile, "conditions_review");
    expect(found.id).toBe("conditions_review:2026-01");
    expect(found.id).toBe(conditionsGapId({ since: "2026-01-01T12:00:00.000Z" }));
    deferQuestion(profile, found, "na", ctx());
    expect(eligibleGaps(profile, NO_SESSION, NOW).map((gap) => gap.id)).not.toContain(found.id);

    // They stand behind it some other way —from the profile, say— and when it has gone as long it is a question of its own again.
    confirmPractical(profile, ctx(LATER));
    const later = new Date(new Date(LATER).getTime() + 100 * 86_400_000);
    const again = detectGaps(profile, later).find((gap) => gap.rule === "conditions_review")!;
    expect(again.id).toBe("conditions_review:2026-10");
    expect(eligibleGaps(profile, NO_SESSION, later).map((gap) => gap.id)).toContain(again.id);
  });

  it("weigh little against the rest and are one-tap, counted as quick ones", () => {
    expect(WEIGHT.credential_expiry).toBeGreaterThan(WEIGHT.conditions_review);
    expect(PRIORITY.credential_expiry).toBe("low");
    expect(PRIORITY.conditions_review).toBe("low");

    const profile = emptyStoredProfile();
    withCert(profile, "Matrícula de gasista", 2026, 3);
    expect(nextQuestion(profile, NO_SESSION, NOW)).toMatchObject({ kind: "gap", gap: { rule: "credential_expiry" } });
    // The quick ones of a session are used up: it waits for the next, and says so.
    const spent = { ...freshSession(), askedQuick: ENGINE.session.maxQuick };
    expect(nextQuestion(profile, spent, NOW)).toMatchObject({ kind: "budget" });
  });

  it("are the same questions however many times the profile is read", () => {
    const profile = emptyStoredProfile();
    withCert(profile, "Matrícula de gasista", 2026, 3);
    withPractical(profile, "2026-01-01T12:00:00.000Z");
    expect(detectGaps(profile, NOW)).toEqual(detectGaps(structuredClone(profile), NOW));
    // What time brings is listed apart, in «Para revisar»: the dates, the job that goes on, the stretch with nothing since, the skill nothing has backed.
    for (const rule of ["credential_expiry", "conditions_review", "current_job_review", "since_last", "skill_stale"] as const) expect(isReviewRule(rule)).toBe(true);
    expect(isReviewRule("practical")).toBe(false);
    expect(isReviewRule("no_content")).toBe(false);
  });
});

describe("what they are asked, in words", () => {
  const profile = () => {
    const stored = emptyStoredProfile();
    withCert(stored, "Matrícula de gasista", 2026, 3);
    withCert(stored, "Carnet de manipulación de alimentos", 2026, 10);
    return stored;
  };

  it("says the date as the person gave it, and asks about the renewal in the same words for every kind of credential", () => {
    const stored = profile();
    const [lapsed, soon] = gapsOf(stored, "credential_expiry");
    expect(questionFor(lapsed!, stored)).toMatchObject({
      text: "«Matrícula de gasista» venció en marzo de 2026. ¿Hiciste la renovación?",
      hint: "Si la hiciste, poné la fecha nueva. Si todavía no, lo dejamos para después.",
      control: { kind: "renewal", subject: { kind: "certification" } },
    });
    expect(questionFor(soon!, stored).text).toBe("«Carnet de manipulación de alimentos» vence en octubre de 2026. ¿Ya hiciste la renovación?");
  });

  it("says a year alone as a year, and does not invent the month", () => {
    const stored = emptyStoredProfile();
    withCert(stored, "Habilitación", 2025);
    expect(questionFor(gapOf(stored, "credential_expiry"), stored).text).toBe("«Habilitación» venció en 2025. ¿Hiciste la renovación?");
  });

  it("names what it is about in the list of what is left, where there is no room for the question", () => {
    const stored = profile();
    const [lapsed, soon] = gapsOf(stored, "credential_expiry");
    expect(labelFor(lapsed!, stored)).toBe("La renovación de «Matrícula de gasista»: venció en marzo de 2026");
    expect(labelFor(soon!, stored)).toBe("La renovación de «Carnet de manipulación de alimentos»: vence en octubre de 2026");
  });

  it("shows what was said about how they can work before asking whether it still holds", () => {
    const stored = emptyStoredProfile();
    withPractical(stored, "2026-01-01T12:00:00.000Z", { driverLicense: "B1" });
    const found = gapOf(stored, "conditions_review");
    expect(questionFor(found, stored)).toMatchObject({
      text: "¿Sigue igual lo que anotaste para trabajar?",
      hint: "Tenés anotado: Tiempo completo · Licencia B1.",
      control: { kind: "conditions" },
    });
    expect(labelFor(found, stored)).toBe("Si lo práctico para trabajar sigue igual");
  });
});

describe("what an answer does", () => {
  it("«renewed» keeps the new date, as the person standing behind the credential again", () => {
    const profile = emptyStoredProfile();
    const cert = withCert(profile, "Matrícula de gasista", 2026, 3);
    const found = gapOf(profile, "credential_expiry");
    expect(answerRenewal(profile, found, { year: 2031, month: 3, raw: "marzo 2031" }, ctx(LATER))).toBe(true);
    // An edit of a value that was there keeps where it came from and what it was; the day they stood behind it is what moves.
    expect(profile.certifications[0]).toMatchObject({ id: cert.id, expires: { value: { year: 2031, month: 3 }, status: "edited", original: { year: 2026, month: 3 }, confirmedAt: LATER } });
    expect(credentialReviews(profile, NOW)).toEqual([]);
    // It counted as one of the quick questions of the session, and left the queue.
    expect(profile.onboarding.askedQuick).toBe(1);
  });

  it("«renewed» for the licence keeps its date apart from its class", () => {
    const profile = emptyStoredProfile();
    withPractical(profile, STAMP, { driverLicense: "B1" });
    profile.legacy.driverLicenseExpires = { value: { year: 2026, month: 4 }, status: "confirmed" };
    expect(answerRenewal(profile, gapOf(profile, "credential_expiry"), { year: 2030, month: 4 }, ctx(LATER))).toBe(true);
    expect(profile.legacy.driverLicenseExpires).toMatchObject({ value: { year: 2030, month: 4 }, confirmedAt: LATER });
    expect(profile.legacy.practical.value.driverLicense).toBe("B1");
  });

  it("«no sé hasta cuándo» takes the date off: a credential with none is not asked about again", () => {
    const profile = emptyStoredProfile();
    withCert(profile, "Matrícula de gasista", 2026, 3);
    expect(answerRenewal(profile, gapOf(profile, "credential_expiry"), null, ctx(LATER))).toBe(true);
    expect(gapsOf(profile, "credential_expiry")).toEqual([]);
    // The credential is still there, and still goes in the CV: nothing said it was no longer theirs.
    expect(profile.certifications[0]!.excluded).toBeUndefined();
  });

  it("does not save a month with no year as if it were a date, and does not count it", () => {
    const profile = emptyStoredProfile();
    withCert(profile, "Matrícula de gasista", 2026, 3);
    expect(answerRenewal(profile, gapOf(profile, "credential_expiry"), { month: 5 }, ctx(LATER))).toBe(false);
    expect(profile.certifications[0]!.expires?.value).toEqual({ year: 2026, month: 3 });
    expect(profile.onboarding.askedQuick).toBe(0);
  });

  it("does nothing for a credential that is gone since", () => {
    const profile = emptyStoredProfile();
    const cert = withCert(profile, "Matrícula de gasista", 2026, 3);
    const found = gapOf(profile, "credential_expiry");
    profile.certifications = profile.certifications.filter((entry) => entry.id !== cert.id);
    expect(answerRenewal(profile, found, { year: 2031 }, ctx(LATER))).toBe(false);
    expect(answerNoLonger(profile, found, ctx(LATER))).toBe(false);
    expect(answerRenewal(profile, { ...found, payload: {} }, { year: 2031 }, ctx(LATER))).toBe(false);
  });

  it("«ya no corresponde» sets a credential aside, in no CV and not asked about, and does not delete it", () => {
    const profile = emptyStoredProfile();
    withCert(profile, "Matrícula de gasista", 2026, 3);
    expect(answerNoLonger(profile, gapOf(profile, "credential_expiry"), ctx(LATER))).toBe(true);
    expect(profile.certifications).toHaveLength(1);
    expect(profile.certifications[0]!.excluded).toBe(true);
    expect(gapsOf(profile, "credential_expiry")).toEqual([]);
    expect(profile.archive).toEqual([]);
  });

  it("«ya no corresponde» for the licence takes its class and its date out of what they said they can do", () => {
    const profile = emptyStoredProfile();
    withPractical(profile, STAMP, { driverLicense: "B1", ownVehicle: true });
    profile.legacy.driverLicenseExpires = { value: { year: 2026, month: 4 }, status: "confirmed" };
    expect(answerNoLonger(profile, gapOf(profile, "credential_expiry"), ctx(LATER))).toBe(true);
    expect(profile.legacy.practical.value).toMatchObject({ driverLicense: "", ownVehicle: true, availability: "Tiempo completo" });
    expect(gapsOf(profile, "credential_expiry")).toEqual([]);
  });

  it("«sigue igual» keeps the day they said so, and the question is not asked again until it has gone as long", () => {
    const profile = emptyStoredProfile();
    withPractical(profile, "2026-01-01T12:00:00.000Z", { driverLicense: "B1" });
    const found = gapOf(profile, "conditions_review");
    expect(answerConditions(profile, found, ctx(LATER))).toBe(true);
    expect(profile.legacy.practical.confirmedAt).toBe(LATER);
    expect(profile.legacy.practical.value.driverLicense).toBe("B1");
    expect(gapsOf(profile, "conditions_review")).toEqual([]);
    expect(profile.onboarding.askedQuick).toBe(1);
    // A hundred days after, it is a question again — from the day they said so, and not from the first time.
    const later = new Date(new Date(LATER).getTime() + 100 * 86_400_000);
    expect(detectGaps(profile, later).some((gap) => gap.rule === "conditions_review")).toBe(true);
  });

  it("«cambió algo» keeps what they now say, as theirs and from today, and counts as one of the quick questions", () => {
    const profile = emptyStoredProfile();
    withPractical(profile, "2026-01-01T12:00:00.000Z", { driverLicense: "B1", ownVehicle: true });
    const found = gapOf(profile, "conditions_review");
    const changed = { availability: "  Fines de semana ", driverLicense: "B2", workEligibility: "", ownVehicle: false, willingToRelocate: true };
    expect(answerConditionsChanged(profile, found, changed, ctx(LATER))).toBe(true);
    expect(profile.legacy.practical.value).toEqual({ availability: "Fines de semana", driverLicense: "B2", workEligibility: "", ownVehicle: false, willingToRelocate: true });
    expect(profile.legacy.practical).toMatchObject({ status: "edited", confirmedAt: LATER });
    expect(profile.history.filter((entry) => entry.path.join("/") === "legacy/practical")).toHaveLength(1);
    expect(gapsOf(profile, "conditions_review")).toEqual([]);
    expect(profile.onboarding.askedQuick).toBe(1);
  });

  it("«cambió algo» with nothing changed is «sigue igual»: no step in the history, and the day is today", () => {
    const profile = emptyStoredProfile();
    withPractical(profile, "2026-01-01T12:00:00.000Z", { driverLicense: "B1" });
    const found = gapOf(profile, "conditions_review");
    expect(answerConditionsChanged(profile, found, structuredClone(profile.legacy.practical.value), ctx(LATER))).toBe(true);
    expect(profile.history).toEqual([]);
    expect(profile.legacy.practical.confirmedAt).toBe(LATER);
    expect(gapsOf(profile, "conditions_review")).toEqual([]);
  });

  it("«cambió algo» with all of it cleared says there is nothing to say any more, and it is not asked about again", () => {
    const profile = emptyStoredProfile();
    withPractical(profile, "2026-01-01T12:00:00.000Z", { driverLicense: "B1", ownVehicle: true });
    const found = gapOf(profile, "conditions_review");
    expect(answerConditionsChanged(profile, found, { availability: "", driverLicense: "", workEligibility: "", ownVehicle: false, willingToRelocate: false }, ctx(LATER))).toBe(true);
    expect(profile.legacy.practical.value).toEqual({ availability: "", driverLicense: "", workEligibility: "", ownVehicle: false, willingToRelocate: false });
    expect(gapsOf(profile, "conditions_review")).toEqual([]);
  });

  it("«más tarde» and «saltar» wait, and «no aplica» is for good — for this lapse", () => {
    const profile = emptyStoredProfile();
    withCert(profile, "Matrícula de gasista", 2026, 3);
    const found = gapOf(profile, "credential_expiry");
    deferQuestion(profile, found, "later", ctx());
    // It waits for the next session, but is still a date to settle, and «Para revisar» says so.
    expect(reviewItems(profile, NOW).map((item) => item.id)).toEqual([found.id]);
    deferQuestion(profile, found, "na", ctx());
    expect(reviewItems(profile, NOW)).toEqual([]);
  });
});

describe("what is left to do about a date", () => {
  const settled = (): StoredProfile => {
    const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current", facts: [{ text: "Armo los pedidos del local" }, { kind: "achievement", text: "Subí las ventas un 20%" }] });
    profile.contact.fullName = { value: "Lucía Pérez", status: "confirmed" };
    profile.objective = { value: "Analista", status: "confirmed" };
    profile.onboarding.done = true;
    profile.onboarding.step = "done";
    profile.pending.push({ questionId: `more_achievements:${profile.experience[0]!.id}`, ruleId: "more_achievements", state: "na", count: 1, at: STAMP });
    withPractical(profile, STAMP);
    return profile;
  };

  it("is not a task of the list: it is in «Para revisar», each date as the question that settles it", () => {
    const profile = settled();
    expect(profileTasks(profile, NOW)).toEqual([]);
    expect(reviewItems(profile, NOW)).toEqual([]);
    const lapsed = withCert(profile, "Matrícula de gasista", 2026, 3);
    const soon = withCert(profile, "Carnet de manipulación de alimentos", 2026, 10);
    // «Fechas para revisar» is gone from the list of what is left: the block has them.
    expect(profileTasks(profile, NOW)).toEqual([]);
    const items = reviewItems(profile, NOW);
    expect(items.map((item) => item.kind)).toEqual(["credential", "credential"]);
    expect(items.map((item) => item.id)).toEqual([`credential_expiry:cert:${lapsed.id}:2026-03`, `credential_expiry:cert:${soon.id}:2026-10`]);
    expect(items.map((item) => item.label)).toEqual([
      "La renovación de «Matrícula de gasista»: venció en marzo de 2026",
      "La renovación de «Carnet de manipulación de alimentos»: vence en octubre de 2026",
    ]);
    expect(items.every((item) => !item.later)).toBe(true);
  });

  it("counts what they said about how they can work with the credentials, after them", () => {
    const profile = settled();
    withPractical(profile, "2026-01-01T12:00:00.000Z");
    expect(reviewItems(profile, NOW).map((item) => item.kind)).toEqual(["conditions"]);
    withCert(profile, "Matrícula de gasista", 2026, 3);
    expect(reviewItems(profile, NOW).map((item) => item.kind)).toEqual(["credential", "conditions"]);
  });

  it("is not said twice among the questions: put off or not, it is listed in «Para revisar» and not among what was put off", () => {
    const profile = settled();
    // Something to ask that makes it better: a job with no figures.
    profile.experience[0]!.facts.push({ id: newId(), kind: "responsibility", text: "Atiendo a los clientes", source: { kind: "manual", at: STAMP }, status: "confirmed" });
    profile.pending = [];
    withCert(profile, "Matrícula de gasista", 2026, 3);
    const found = gapOf(profile, "credential_expiry");
    deferQuestion(profile, found, "skipped", ctx());
    expect(pendingItems(profile, NOW).some((item) => item.id === found.id)).toBe(false);
    expect(reviewItems(profile, NOW).map((item) => item.id)).toEqual([found.id]);
    expect(profileTasks(profile, NOW).map((task) => task.id)).not.toContain("dates");
  });

  it("does not make a session out of a date: there is nothing to ask that makes the profile better", () => {
    const profile = settled();
    withCert(profile, "Matrícula de gasista", 2026, 3);
    expect(leftToDo(profile, NOW)).toMatchObject({ somethingToAsk: false, toSettle: 1 });
  });

  it("is said in a line when the session closes or the profile is left", () => {
    const profile = settled();
    withCert(profile, "Matrícula de gasista", 2026, 3);
    expect(leftToDoLine(leftToDo(profile, NOW))).toBe("confirmar 1 cosa");
    withCert(profile, "Carnet de manipulación de alimentos", 2026, 10);
    expect(leftToDoLine(leftToDo(profile, NOW))).toBe("confirmar 2 cosas");
  });

  it("goes when it is settled", () => {
    const profile = settled();
    withCert(profile, "Matrícula de gasista", 2026, 3);
    answerRenewal(profile, gapOf(profile, "credential_expiry"), { year: 2031 }, ctx(LATER));
    expect(reviewItems(profile, NOW)).toEqual([]);
    expect(profileTasks(profile, NOW)).toEqual([]);
  });
});
