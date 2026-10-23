import { describe, expect, it } from "vitest";
import { answerHandled, answerNoteLeft, answerNotePlaced, answerSkillUsed, deferQuestion } from "@/lib/onboarding/answer";
import { PRIORITY, WEIGHT } from "@/lib/onboarding/config";
import { detectGaps, eligibleGaps, notePlaceGapId, nextQuestion, type Gap, type Signals } from "@/lib/onboarding/gaps";
import { labelFor, questionFor } from "@/lib/onboarding/questions";
import { pendingItems } from "@/lib/onboarding/session";
import { removeSkill } from "@/lib/onboarding/review";
import { captureNote, sentencesToPlace, unsortedNotes } from "@/lib/profile/capture";
import { addSkill } from "@/lib/profile/entities";
import { backedUntil, staleGapId } from "@/lib/profile/staleness";
import { leftToDo, profileTasks } from "@/lib/profile/tasks";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, freshSession, newId, profileWith } from "./helpers/profiles";

/**
 * The two questions of the stage that builds what is off — what they wrote down, offered to the job it names (O15), and a skill nothing has backed for years
 * (O17) — in the engine: when each exists, what it says, what each answer does and that nothing is decided for the person. Both exist only when the engine is told
 * it may ask (`Signals`): without that it sees the profile as it always did.
 */

const ctx = { now: STAMP, newId };
const LATER = { now: "2026-10-05T09:30:00.000Z", newId };
const CAPTURE: Signals = { capture: true };
const STALE: Signals = { stale: true };

/** A profile with two jobs, the one going on being Logística Sur. */
const base = () =>
  profileWith(
    { company: "Logística Sur", role: "Operario de depósito", from: { year: 2023 }, to: "current", facts: [{ text: "Armo los pedidos del día" }] },
    { company: "Panadería Don Julio", role: "Ayudante", from: { year: 2018 }, to: { year: 2021 }, facts: [{ text: "Atendía el mostrador" }] },
  );
const jobNamed = (profile: StoredProfile, company: string) => profile.experience.find((job) => job.company.value === company)!;
const gapsOf = (profile: StoredProfile, rule: string, signals: Signals) => detectGaps(profile, NOW, signals).filter((found) => found.rule === rule);
const gapOf = (profile: StoredProfile, rule: string, signals: Signals): Gap => gapsOf(profile, rule, signals)[0]!;

describe("what they wrote down, offered to its job (O15)", () => {
  it("is a question only when the engine is told it may be, so that it sees the profile and nothing else the way it always did", () => {
    const profile = base();
    captureNote(profile, "En Logística Sur reordené el sector de picking", "capture", ctx);
    expect(detectGaps(profile, NOW).some((found) => found.rule === "note_to_place")).toBe(false);
    expect(detectGaps(profile, NOW, {}).some((found) => found.rule === "note_to_place")).toBe(false);
    expect(detectGaps(profile, NOW, { stale: true }).some((found) => found.rule === "note_to_place")).toBe(false);
    expect(gapsOf(profile, "note_to_place", CAPTURE)).toHaveLength(1);
  });

  it("is one for each note that names one job, about that job, with the note's id in its own", () => {
    const profile = base();
    const first = captureNote(profile, "En Logística Sur reordené el sector de picking", "capture", ctx);
    const second = captureNote(profile, "Como ayudante aprendí a calcular las masas", "capture", ctx);
    captureNote(profile, "Estuve pensando en volver a estudiar", "capture", ctx);
    if (!first.ok || !second.ok) throw new Error("not written");
    const found = gapsOf(profile, "note_to_place", CAPTURE);
    expect(found.map((gap) => gap.id)).toEqual([notePlaceGapId(first.note.id), notePlaceGapId(second.note.id)]);
    expect(found[0]).toMatchObject({ experienceId: jobNamed(profile, "Logística Sur").id, priority: "medium", payload: { noteId: first.note.id, label: "Operario de depósito · Logística Sur" } });
    expect(found[1]!.experienceId).toBe(jobNamed(profile, "Panadería Don Julio").id);
  });

  it("says where it would go, when it was written, and the sentences to tick — fixed words, the same for everyone", () => {
    const profile = base();
    captureNote(profile, "En Logística Sur reordené el sector de picking. Capacité a dos personas.", "capture", { now: "2026-09-03T12:00:00.000Z", newId });
    const found = gapOf(profile, "note_to_place", CAPTURE);
    const question = questionFor(found, profile);
    expect(question.text).toBe("¿Esto va en «Operario de depósito · Logística Sur»?");
    expect(question.hint).toBe("La anotaste el 3 de septiembre de 2026.");
    expect(question.context).toBe("Sobre lo que anotaste");
    expect(question.control).toEqual({
      kind: "note-place",
      noteId: found.payload.noteId,
      jobId: jobNamed(profile, "Logística Sur").id,
      label: "Operario de depósito · Logística Sur",
      sentences: ["En Logística Sur reordené el sector de picking.", "Capacité a dos personas."],
    });
    expect(labelFor(found, profile)).toBe("Dónde va lo que anotaste: «En Logística Sur reordené el sector de…»");
    expect(`${question.text} ${question.hint}`).not.toMatch(/falta|incompleto|hace \d+ (?:meses|días) que no|%/i);
  });

  it("weighs less than what a job is missing and as a deepening question, and is not one of the quick ones", () => {
    expect(PRIORITY.note_to_place).toBe("medium");
    expect(WEIGHT.note_to_place).toBeGreaterThan(WEIGHT.skill_unused);
    expect(WEIGHT.note_to_place).toBeLessThan(WEIGHT.no_content);
  });

  it("«Sí» makes tasks of the ticked sentences, in the words they were written in, settles the note and is not asked again", () => {
    const profile = base();
    captureNote(profile, "En Logística Sur reordené el sector de picking. Capacité a dos personas.", "capture", ctx);
    const found = gapOf(profile, "note_to_place", CAPTURE);
    const job = jobNamed(profile, "Logística Sur");
    const control = questionFor(found, profile).control;
    if (control.kind !== "note-place") throw new Error("not a note");
    expect(answerNotePlaced(profile, found, control.noteId, control.jobId, [control.sentences[1]!], LATER)).toBe(true);
    expect(job.facts.map((fact) => fact.text)).toEqual(["Armo los pedidos del día", "Capacité a dos personas."]);
    expect(unsortedNotes(profile)).toEqual([]);
    expect(gapsOf(profile, "note_to_place", CAPTURE)).toEqual([]);
    expect(profile.onboarding.askedThisSession).toBe(1);
  });

  it("«Sí» with nothing ticked does nothing, and the question is still there", () => {
    const profile = base();
    captureNote(profile, "En Logística Sur reordené el sector de picking", "capture", ctx);
    const found = gapOf(profile, "note_to_place", CAPTURE);
    const job = jobNamed(profile, "Logística Sur");
    expect(answerNotePlaced(profile, found, String(found.payload.noteId), job.id, [], LATER)).toBe(false);
    expect(job.facts).toHaveLength(1);
    expect(gapsOf(profile, "note_to_place", CAPTURE)).toHaveLength(1);
    expect(profile.onboarding.askedThisSession).toBe(0);
  });

  it("«No va ahí» leaves it as a note, settled, with nothing written from it and nothing asked again", () => {
    const profile = base();
    captureNote(profile, "En Logística Sur reordené el sector de picking", "capture", ctx);
    const found = gapOf(profile, "note_to_place", CAPTURE);
    expect(answerNoteLeft(profile, found, String(found.payload.noteId), LATER)).toBe(true);
    expect(jobNamed(profile, "Logística Sur").facts).toHaveLength(1);
    expect(profile.notes[0]!.settledAt).toBe(LATER.now);
    expect(gapsOf(profile, "note_to_place", CAPTURE)).toEqual([]);
  });

  it("«Ahora no» puts it off like any question, with nothing settled and nothing said of whether it belongs", () => {
    const profile = base();
    captureNote(profile, "En Logística Sur reordené el sector de picking", "capture", ctx);
    const found = gapOf(profile, "note_to_place", CAPTURE);
    deferQuestion(profile, found, "later", ctx);
    expect(profile.pending).toEqual([expect.objectContaining({ questionId: found.id, state: "later" })]);
    expect(profile.notes[0]!.settledAt).toBeUndefined();
    expect(unsortedNotes(profile)).toHaveLength(1);
  });

  it("is asked within the budget of the session, after what a job is missing, and not at all once the budget is spent", () => {
    const profile = base();
    captureNote(profile, "En Logística Sur reordené el sector de picking", "capture", ctx);
    expect(eligibleGaps(profile, freshSession(), NOW, { signals: CAPTURE }).some((gap) => gap.rule === "note_to_place")).toBe(true);
    // The budget of the session is the engine's, for this one as for the rest: spent — the questions that go deep and the quick ones —, it says there is
    // more for next time and asks nothing.
    const spent = { ...freshSession(), askedThisSession: 6, askedQuick: 2 };
    expect(nextQuestion(profile, spent, NOW, { signals: CAPTURE }).kind).toBe("budget");
    // With room in it, the note is a question like any other of its weight.
    const only = nextQuestion(profile, freshSession(), NOW, { signals: CAPTURE, rules: new Set(["note_to_place"]) });
    expect(only).toMatchObject({ kind: "gap", gap: { rule: "note_to_place" } });
  });

  it("is never one of the things left to do: writing something down adds nothing to the list of what is missing", () => {
    const profile = base();
    const before = leftToDo(profile, NOW);
    const tasksBefore = profileTasks(profile, NOW).map((task) => task.id);
    captureNote(profile, "En Logística Sur reordené el sector de picking", "capture", ctx);
    const gap = gapOf(profile, "note_to_place", CAPTURE);
    deferQuestion(profile, gap, "later", ctx);
    expect(pendingItems(profile, NOW).some((item) => item.id === gap.id)).toBe(false);
    expect(profileTasks(profile, NOW).map((task) => task.id)).toEqual(tasksBefore);
    expect(leftToDo(profile, NOW)).toEqual(before);
  });
});

describe("a skill nothing has backed for years (O17)", () => {
  /** Excel, linked to a job that ended in `year`/`month`; typed in long ago, so that it is the job that backs it. */
  function withStale(year: number, month: number, name = "Excel") {
    const profile = profileWith(
      { company: "Nubia", role: "Analista", from: { year: 2015 }, to: { year, month } },
      { company: "Lumen", role: "Asistente", from: { year: 2023 }, to: "current" },
    );
    const skill = addSkill(profile, name, { now: "2005-01-01T00:00:00.000Z", newId }, jobNamed(profile, "Nubia").id)!;
    return { profile, skill };
  }

  it("is a question only when the engine is told it may be", () => {
    const { profile } = withStale(2019, 6);
    expect(detectGaps(profile, NOW).some((found) => found.rule === "skill_stale")).toBe(false);
    expect(detectGaps(profile, NOW, CAPTURE).some((found) => found.rule === "skill_stale")).toBe(false);
    expect(gapsOf(profile, "skill_stale", STALE)).toHaveLength(1);
  });

  it("is one for each skill, with the year it counts from in its id and the kind of skill in what it carries", () => {
    const { profile, skill } = withStale(2019, 6);
    const found = gapOf(profile, "skill_stale", STALE);
    expect(found.id).toBe(`skill_stale:${skill.id}:2019`);
    expect(found).toMatchObject({ priority: "low", payload: { skillId: skill.id, name: "Excel", since: 2019, segment: "technical" } });
    expect(found.id).toBe(staleGapId({ skill, since: backedUntil(profile, skill, NOW)! }));
  });

  it("asks the trades later than the tools: five years and not three", () => {
    const tool = withStale(2022, 8, "Excel");
    expect(gapsOf(tool.profile, "skill_stale", STALE)).toHaveLength(1);
    const trade = withStale(2022, 8, "Soldadura MIG");
    expect(gapsOf(trade.profile, "skill_stale", STALE)).toEqual([]);
    const oldTrade = withStale(2021, 8, "Soldadura MIG");
    expect(gapsOf(oldTrade.profile, "skill_stale", STALE)).toHaveLength(1);
  });

  it("says the year that backs it and not how long that is, and says what «ya no» does", () => {
    const { profile } = withStale(2019, 6);
    const found = gapOf(profile, "skill_stale", STALE);
    const question = questionFor(found, profile);
    expect(question.text).toBe("Figura «Excel», pero lo último que la respalda en tu perfil es de 2019. ¿La seguís usando?");
    expect(question.hint).toBe("Si ya no, la sacamos de tus CV y queda en la papelera de tu perfil, por si querés recuperarla.");
    expect(question.control).toEqual({ kind: "skill-stale", skillId: found.payload.skillId });
    expect(labelFor(found, profile)).toBe("Si todavía usás Excel");
    expect(`${question.text} ${question.hint}`).not.toMatch(/hace \d+ (?:años|meses) que no|atrás|desactualizad|vencid|obsolet/i);
  });

  it("is one of the quick questions, behind the rest", () => {
    expect(PRIORITY.skill_stale).toBe("low");
    expect(WEIGHT.skill_stale).toBe(WEIGHT.skill_unused);
  });

  it("«Sí, la sigo usando» keeps it as it is, with today as the day they stand behind it, and the question is gone", () => {
    const { profile, skill } = withStale(2019, 6);
    const found = gapOf(profile, "skill_stale", STALE);
    expect(answerSkillUsed(profile, found, skill.id, LATER)).toBe(true);
    expect(profile.skills[0]!.name.value).toBe("Excel");
    expect(profile.skills[0]!.name.confirmedAt).toBe(LATER.now);
    expect(gapsOf(profile, "skill_stale", STALE)).toEqual([]);
    expect(answerSkillUsed(profile, found, "otra", LATER)).toBe(false);
  });

  it("«Ya no» takes it out of the profile as any removal is — to the archive, where it comes back from — and is not asked again", () => {
    const { profile, skill } = withStale(2019, 6);
    const found = gapOf(profile, "skill_stale", STALE);
    removeSkill(profile, skill.id, LATER);
    answerHandled(profile, found, LATER);
    expect(profile.skills).toEqual([]);
    expect(profile.archive).toEqual([expect.objectContaining({ kind: "skill", label: "Excel" })]);
    expect(gapsOf(profile, "skill_stale", STALE)).toEqual([]);
  });

  it("«Ahora no» puts it off, and a later lapse — another year — is asked again", () => {
    const { profile, skill } = withStale(2019, 6);
    const found = gapOf(profile, "skill_stale", STALE);
    deferQuestion(profile, found, "na", LATER);
    expect(eligibleGaps(profile, freshSession(), NOW, { signals: STALE }).some((gap) => gap.id === found.id)).toBe(false);
    // The job it was linked to is another that ended in another year: it is another question.
    const other = profile.experience.find((job) => job.company.value === "Nubia")!;
    other.end = { ...other.end, value: { year: 2020, month: 6 } };
    const again = gapOf(profile, "skill_stale", STALE);
    expect(again.id).toBe(`skill_stale:${skill.id}:2020`);
    expect(again.id).not.toBe(found.id);
  });

  it("is never one of the things left to do or among the dates to settle: it is a question when someone opens the questions, and nothing else", () => {
    const { profile } = withStale(2019, 6);
    const found = gapOf(profile, "skill_stale", STALE);
    deferQuestion(profile, found, "later", ctx);
    expect(pendingItems(profile, NOW).some((item) => item.id === found.id)).toBe(false);
    expect(profileTasks(profile, NOW).some((task) => /Excel|usando/i.test(`${task.title} ${task.detail}`))).toBe(false);
  });

  it("does nothing to a skill by itself: asking is all the engine does", () => {
    const { profile } = withStale(2019, 6);
    const before = JSON.stringify(profile.skills);
    detectGaps(profile, NOW, STALE);
    eligibleGaps(profile, freshSession(), NOW, { signals: STALE });
    expect(JSON.stringify(profile.skills)).toBe(before);
    expect(sentencesToPlace({ text: "" })).toEqual([]);
  });
});
