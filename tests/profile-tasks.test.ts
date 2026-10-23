import { describe, expect, it } from "vitest";
import { deferQuestion } from "@/lib/onboarding/answer";
import { ENGINE } from "@/lib/onboarding/config";
import { detectGaps } from "@/lib/onboarding/gaps";
import { isReturning, leftToDo, leftToDoLine, profileTasks, welcomeBack } from "@/lib/profile/tasks";
import { NAME_MISSING, NAME_MISSING_COST } from "@/lib/profile/name-missing";
import { emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, newId, profileWith } from "./helpers/profiles";

const CURRENT = { company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current" as const };
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const ids = (profile: StoredProfile) => profileTasks(profile, NOW).map((task) => task.id);

/** A profile with everything said, a name and a finished first-run flow: what is left is only what the test adds. */
function settled(): StoredProfile {
  const profile = profileWith({ ...CURRENT, facts: [{ text: "Armo los pedidos del local" }, { kind: "achievement", text: "Subí las ventas un 20%" }] });
  profile.contact.fullName = { value: "Lucía Pérez", status: "confirmed" };
  profile.objective = { value: "Analista", status: "confirmed" };
  profile.legacy.practical = { value: { availability: "Tiempo completo", driverLicense: "", ownVehicle: false, willingToRelocate: false, workEligibility: "" }, status: "confirmed" };
  profile.onboarding.done = true;
  profile.onboarding.step = "done";
  // What the job still asks, turned down for good: nothing is left to ask.
  profile.pending.push({ questionId: `more_achievements:${profile.experience[0]!.id}`, ruleId: "more_achievements", state: "na", count: 1, at: STAMP });
  return profile;
}

describe("what is left to do", () => {
  it("is nothing for a profile that is settled, and for one nobody has begun", () => {
    expect(ids(settled())).toEqual([]);
    expect(ids(emptyStoredProfile())).toEqual([]);
  });

  it("starts with finishing what was begun: the guided steps, left half way", () => {
    const profile = settled();
    profile.onboarding.done = false;
    profile.onboarding.step = "steps";
    expect(profileTasks(profile, NOW)[0]).toMatchObject({ id: "continue", action: { href: "/perfil/empezar" } });
  });

  it("does not ask to finish a screen that is the profile's now: the review of what was read and the questions have nothing to go back to", () => {
    const profile = settled();
    profile.onboarding.done = false;
    for (const step of ["review", "deepen", "objective", "contact"]) {
      profile.onboarding.step = step;
      expect(ids(profile), step).not.toContain("continue");
    }
    // …and a moment or a way of telling it, which became the guided steps, is still half done.
    for (const step of ["situation", "dump"]) {
      profile.onboarding.step = step;
      expect(ids(profile), step).toContain("continue");
    }
  });

  it("does not ask to finish what has already been said to be ready: «Tu perfil está listo» leaves nothing unfinished", () => {
    const profile = settled();
    profile.onboarding.done = false;
    profile.onboarding.step = "firstValue";
    expect(ids(profile)).not.toContain("continue");
  });

  it("does not list the texts with no place: the profile does not show them, and the review of a document does", () => {
    const profile = settled();
    profile.unassigned.push({ id: "u1", text: "Hobbies: ajedrez", kind: "interests" }, { id: "u2", text: "Referencias a pedido", kind: "references" });
    expect(profileTasks(profile, NOW)).toEqual([]);
  });

  it("does not list what is said where it is: a name that is missing (in «Datos personales» and over the CV) and a reading that left doubts (on the job, and over the CV)", () => {
    const profile = settled();
    profile.contact.fullName = { value: "", status: "confirmed" };
    profile.experience[0]!.company = { value: "Nubia Retail", status: "proposed" };
    expect(ids(profile)).toEqual([]);
  });

  it("offers the questions when there are some, and lists what was put off under them", () => {
    const profile = profileWith(CURRENT);
    profile.contact.fullName = { value: "Lucía Pérez", status: "confirmed" };
    profile.onboarding.done = true;
    const found = detectGaps(profile, NOW).find((gap) => gap.rule === "no_content")!;
    deferQuestion(profile, found, "later", { now: STAMP, newId });
    const [task] = profileTasks(profile, NOW);
    expect(task).toMatchObject({ id: "questions", action: { label: "Seguir con las preguntas", href: "/perfil/preguntas" } });
    expect(task!.detail).toMatch(/Unas pocas preguntas más/);
    expect(task!.detail).toMatch(/1 cosa que dejaste para después/);
    expect(task!.items?.map((item) => item.label)).toEqual(["Qué hacías en Nubia Retail"]);
  });

  it("is its own list when nothing is left to ask but something was put off: no button, the lines are the way in", () => {
    const profile = settled();
    // A figure nobody had: to add if it turns up, with no question to ask about it.
    profile.experience[0]!.facts.push({ id: "f-unknown", kind: "achievement", text: "Bajé los costos", metric: { unknown: true }, source: { kind: "manual", at: STAMP }, status: "confirmed" });
    const [task] = profileTasks(profile, NOW);
    expect(task).toMatchObject({ id: "questions", items: [{ kind: "figure" }] });
    expect(task!.action).toBeUndefined();
  });

  it("comes in the order that matters: what was begun, then the questions — with a name missing and a doubtful reading, which are not in the list", () => {
    const profile = profileWith(CURRENT);
    profile.onboarding.done = false;
    profile.onboarding.step = "steps";
    profile.experience[0]!.company = { value: "Nubia Retail", status: "proposed" };
    expect(ids(profile)).toEqual(["continue", "questions"]);
  });
});

describe("what a person is told they left", () => {
  it("is said in a line, in the order it would be done", () => {
    const profile = profileWith(CURRENT);
    profile.experience[0]!.company = { value: "Nubia Retail", status: "proposed" };
    expect(leftToDoLine(leftToDo(profile, NOW))).toBe("revisar 1 bloque y contestar unas preguntas");
    expect(leftToDoLine(leftToDo(settled(), NOW))).toBeNull();
    const only = profileWith(CURRENT);
    expect(leftToDoLine(leftToDo(only, NOW))).toBe("contestar unas preguntas");
  });

  it("counts a bloque as one and several as several", () => {
    const profile = profileWith({ ...CURRENT, company: "A" }, { company: "B", role: "x", from: { year: 2019 }, to: { year: 2020 } });
    for (const job of profile.experience) job.company = { value: job.company.value, status: "proposed" };
    expect(leftToDoLine(leftToDo(profile, NOW))).toMatch(/^revisar 2 bloques/);
  });

  it("is only for someone coming back: longer ago than a session lasts", () => {
    const profile = profileWith(CURRENT);
    profile.updatedAt = hoursAgo(ENGINE.session.staleAfterHours - 1);
    expect(isReturning(profile, NOW)).toBe(false);
    expect(welcomeBack(profile, NOW)).toBeNull();
    profile.updatedAt = hoursAgo(ENGINE.session.staleAfterHours + 1);
    expect(isReturning(profile, NOW)).toBe(true);
    expect(welcomeBack(profile, NOW)).toBe("Retomamos donde lo dejaste. Te faltaba contestar unas preguntas.");
  });

  it("says where they were even when there is nothing left to do, and nothing to a profile nobody has put anything in", () => {
    const profile = settled();
    profile.updatedAt = hoursAgo(72);
    expect(welcomeBack(profile, NOW)).toBe("Retomamos donde lo dejaste.");
    const nothing = emptyStoredProfile();
    nothing.updatedAt = hoursAgo(72);
    expect(welcomeBack(nothing, NOW)).toBeNull();
  });

  it("is not said when nobody can say when it was last touched", () => {
    const profile = profileWith(CURRENT);
    profile.updatedAt = "";
    expect(isReturning(profile, NOW)).toBe(false);
    expect(welcomeBack(profile, NOW)).toBeNull();
  });
});

describe("the name, said once (U05)", () => {
  it("costs the same everywhere: the CV comes out with no heading, and cannot be adapted to an offer", () => {
    expect(NAME_MISSING_COST).toBe("Sin él, el CV sale sin encabezado y no se puede adaptar a una oferta.");
    expect(NAME_MISSING).toBe(`Falta tu nombre. ${NAME_MISSING_COST}`);
    // Neither of the two things that were not true: that it cannot be generated at all, and that the CV cannot be made.
    expect(NAME_MISSING).not.toMatch(/no se puede (generar|armar)/);
  });
});

describe("what the list sees of what is switched on (U44)", () => {
  /** What the engine is told, with the offers they analysed, when «Lo que piden varias de las ofertas» is on: Excel, in 3 of the last 10. */
  const REPEATED = { kind: "tool", type: "tool", thing: "Excel", key: "tool:excel", fragment: "Manejo de Excel", question: "¿Usaste Excel en algún trabajo, curso o proyecto?", count: 3, of: 10, obligation: "unstated" } as const;

  it("says a profile has a question to ask when the session would ask one: it was «al día» while it had, and did one thing and said another", () => {
    const profile = settled();
    expect(leftToDo(profile, NOW).somethingToAsk).toBe(false);
    expect(ids(profile)).toEqual([]);
    expect(leftToDo(profile, NOW, { repeated: REPEATED }).somethingToAsk).toBe(true);
    expect(profileTasks(profile, NOW, { repeated: REPEATED }).map((task) => task.id)).toEqual(["questions"]);
  });

  it("is as it always was with nothing told to the engine — for everyone, while the switches are off", () => {
    const profile = settled();
    expect(profileTasks(profile, NOW, {})).toEqual(profileTasks(profile, NOW));
    expect(leftToDo(profile, NOW, {})).toEqual(leftToDo(profile, NOW));
  });

  it("lists what was put off of it, with the others: a question put off is a question put off", () => {
    const profile = settled();
    const found = detectGaps(profile, NOW, { repeated: REPEATED }).find((gap) => gap.rule === "repeated_requirement")!;
    deferQuestion(profile, found, "later", { now: STAMP, newId });
    expect(leftToDo(profile, NOW).pending).toEqual([]);
    expect(leftToDo(profile, NOW, { repeated: REPEATED }).pending).toEqual([expect.objectContaining({ id: found.id, kind: "later" })]);
  });

  it("does not list what a note says or what time brings: writing something down adds nothing to what is missing, and what lapses is in «Para revisar»", () => {
    const profile = settled();
    const before = leftToDo(profile, NOW);
    expect(leftToDo(profile, NOW, { capture: true })).toEqual(before);
    expect(leftToDo(profile, NOW, { stale: true }).somethingToAsk).toBe(false);
    expect(profileTasks(profile, NOW, { capture: true, stale: true }).map((task) => task.id)).toEqual([]);
  });
});
