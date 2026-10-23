import { describe, expect, it } from "vitest";
import { answerFigure, answerNarrative, deferQuestion } from "@/lib/onboarding/answer";
import { ENGINE } from "@/lib/onboarding/config";
import { detectGaps, nextQuestion } from "@/lib/onboarding/gaps";
import { beginSession, extendSession, gapMarks, pendingHref, pendingItems, progressByExperience, sessionOf, summaryOfSession } from "@/lib/onboarding/session";
import { emptyStoredProfile, projectSchema } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, profileWith } from "./helpers/profiles";

let n = 0;
const ctx = (now = STAMP) => ({ now, newId: () => `s-${++n}` });
const CURRENT = { company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current" as const };
const hoursLater = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

describe("beginning a session", () => {
  it("starts the first one, and counts it", () => {
    const draft = emptyStoredProfile();
    expect(beginSession(draft, NOW)).toBe(true);
    expect(draft.onboarding.sessionCount).toBe(1);
    expect(draft.onboarding.sessionStartedAt).toBe(NOW.toISOString());
  });

  it("does not start another for a visit soon after the last", () => {
    const draft = emptyStoredProfile();
    beginSession(draft, NOW);
    draft.onboarding.askedThisSession = 4;
    expect(beginSession(draft, hoursLater(ENGINE.session.staleAfterHours - 1))).toBe(false);
    expect(draft.onboarding.sessionCount).toBe(1);
    expect(draft.onboarding.askedThisSession).toBe(4);
  });

  it("starts a new one after a long gap, with the budget back", () => {
    const draft = emptyStoredProfile();
    beginSession(draft, NOW);
    Object.assign(draft.onboarding, { askedThisSession: 6, askedQuick: 2, askedByExperience: { a: 3 } });
    expect(beginSession(draft, hoursLater(ENGINE.session.staleAfterHours + 1))).toBe(true);
    expect(draft.onboarding).toMatchObject({ sessionCount: 2, askedThisSession: 0, askedQuick: 0, askedByExperience: {} });
  });

  it("reads the counters back as the engine's session", () => {
    const draft = emptyStoredProfile();
    beginSession(draft, NOW);
    draft.onboarding.askedThisSession = 2;
    expect(sessionOf(draft)).toEqual({ askedThisSession: 2, askedQuick: 0, askedByExperience: {}, startedAt: NOW.toISOString() });
  });

  it("brings back what was put off with 'más tarde', in the next session and not before", () => {
    const draft = profileWith(CURRENT);
    beginSession(draft, NOW);
    const found = detectGaps(draft, NOW).find((gap) => gap.rule === "no_content")!;
    deferQuestion(draft, found, "later", ctx());
    const stillThisOne = pendingItems(draft, NOW).map((item) => item.id);
    expect(stillThisOne).toContain(found.id);
  });
});

describe("asking for more", () => {
  it("gives the budget back, in the same session", () => {
    const draft = emptyStoredProfile();
    beginSession(draft, NOW);
    Object.assign(draft.onboarding, { askedThisSession: 6, askedQuick: 2, askedByExperience: { a: 3 } });
    extendSession(draft);
    expect(draft.onboarding).toMatchObject({ sessionCount: 1, askedThisSession: 0, askedQuick: 0, askedByExperience: {}, sessionStartedAt: NOW.toISOString() });
  });

  it("keeps what was put off with 'más tarde' put off, because it is still the same session", () => {
    const draft = profileWith(CURRENT);
    beginSession(draft, NOW);
    const found = detectGaps(draft, NOW).find((gap) => gap.rule === "no_content")!;
    deferQuestion(draft, found, "later", ctx(new Date(NOW.getTime() + 60_000).toISOString()));
    extendSession(draft);
    expect(nextQuestion(draft, sessionOf(draft), NOW)).not.toMatchObject({ gap: { id: found.id } });
  });
});

// `/postular`'s own metrics panel used to decide whether to show at all with
// `NO_SESSION` — always fresh — while `QuestionLoop` underneath it asked with
// whatever session was actually on the stored profile, possibly spent days
// ago in onboarding and never refreshed since. The fix is `Wizard.tsx` calling
// `beginSession` once on mount, unconditionally: these two are what makes
// that safe — a stale session's budget really does come back, and a fresh
// one, called again moments later, is left exactly as it was.
describe("a visit that calls beginSession on mount, unconditionally", () => {
  it("gives an old, spent session its budget back — nextQuestion finds something again", () => {
    const draft = profileWith(CURRENT);
    beginSession(draft, NOW);
    draft.onboarding.askedThisSession = ENGINE.session.maxQuestions;
    const later = hoursLater(ENGINE.session.staleAfterHours + 1);
    beginSession(draft, later); // what Wizard.tsx now does on mount
    expect(nextQuestion(draft, sessionOf(draft), later, { only: draft.experience[0]!.id })).toMatchObject({ kind: "gap" });
  });

  it("leaves a session that is still fresh exactly as spent as it was", () => {
    const draft = profileWith(CURRENT);
    beginSession(draft, NOW);
    draft.onboarding.askedThisSession = ENGINE.session.maxQuestions;
    const soon = hoursLater(ENGINE.session.staleAfterHours - 1);
    beginSession(draft, soon); // the same call, too soon to count as a new visit
    expect(nextQuestion(draft, sessionOf(draft), soon, { only: draft.experience[0]!.id }).kind).toBe("budget");
  });
});

describe("gapMarks — the profile card's own 'Falta un logro' / 'Falta una cifra'", () => {
  it("marks a job with tasks but no achievement", () => {
    const draft = profileWith({ ...CURRENT, facts: [{ text: "Llevo las campañas" }] });
    expect(gapMarks(draft, draft.experience[0]!.id, NOW)).toEqual(["Falta un logro"]);
  });

  it("marks an achievement with no figure, and only that", () => {
    const draft = profileWith({ ...CURRENT, facts: [{ kind: "achievement", text: "Subí la conversión" }] });
    expect(gapMarks(draft, draft.experience[0]!.id, NOW)).toEqual(["Falta una cifra"]);
  });

  it("marks nothing once the achievement already has a figure", () => {
    const draft = profileWith({ ...CURRENT, facts: [{ kind: "achievement", text: "Subí la conversión un 20%" }] });
    expect(gapMarks(draft, draft.experience[0]!.id, NOW)).toEqual([]);
  });

  it("does not mark what was said 'no aplica' to", () => {
    const draft = profileWith({ ...CURRENT, facts: [{ text: "Llevo las campañas" }] });
    const found = detectGaps(draft, NOW).find((gap) => gap.rule === "no_achievements")!;
    deferQuestion(draft, found, "na");
    expect(gapMarks(draft, draft.experience[0]!.id, NOW)).toEqual([]);
  });

  it("does not mark a job that has nothing at all yet — that is 'no_content', a different gap", () => {
    const draft = profileWith(CURRENT);
    expect(gapMarks(draft, draft.experience[0]!.id, NOW)).toEqual([]);
  });
});

describe("progress, by job", () => {
  it("says what each job has and what is left of it", () => {
    const draft = profileWith(
      { ...CURRENT, facts: [{ kind: "achievement", text: "Subí las ventas", metric: { value: "20", unit: "%", approx: false } }, { text: "Llevo campañas" }] },
      { company: "Grupo Lumen", role: "Asistente", from: { year: 2018, month: 9 }, to: { year: 2021, month: 2 } },
    );
    const [nubia, lumen] = progressByExperience(draft, NOW);
    expect(nubia).toMatchObject({ label: "Nubia Retail", facts: 2, hasAchievement: true, hasFigure: true });
    expect(lumen).toMatchObject({ label: "Grupo Lumen", facts: 0, hasAchievement: false, hasFigure: false });
    expect(lumen!.open).toBeGreaterThan(0);
  });

  it("does not count the tools listed beside a job as what was done in it", () => {
    const draft = profileWith({ ...CURRENT, facts: [{ kind: "tool", text: "HubSpot" }] });
    expect(progressByExperience(draft, NOW)[0]!.facts).toBe(0);
  });

  it("does not list a job that is only the ghost of a blank form", () => {
    expect(progressByExperience(profileWith({}), NOW)).toEqual([]);
  });

  it("tells two jobs at one company apart, so a list does not say 'Acme' twice", () => {
    const draft = profileWith(
      { company: "Acme", role: "Analista", from: { year: 2018 }, to: { year: 2020 } },
      { company: "Acme", role: "Gerente", from: { year: 2021 }, to: "current" },
    );
    expect(progressByExperience(draft, NOW).map((job) => job.label)).toEqual(["Acme · Analista", "Acme · Gerente"]);
  });
});

describe("a CV line that already reports a result", () => {
  it("counts as an achievement, with its figure when the words carry one", () => {
    const draft = profileWith({ ...CURRENT, facts: [{ text: "Llevo las campañas" }, { text: "Reduje el costo por lead un 30%" }] });
    expect(progressByExperience(draft, NOW)[0]).toMatchObject({ hasAchievement: true, hasFigure: true });
    expect(gapMarks(draft, draft.experience[0]!.id, NOW)).toEqual([]);
  });

  it("is not marked for a figure once the person has said there are none in their work", () => {
    const draft = profileWith({ ...CURRENT, facts: [{ text: "Implementé testing automatizado, reduciendo regresiones" }] });
    expect(gapMarks(draft, draft.experience[0]!.id, NOW)).toEqual(["Falta una cifra"]);
    draft.fatigue.achievement_no_figure = { skipped: 0, unknown: 0, off: true };
    expect(gapMarks(draft, draft.experience[0]!.id, NOW)).toEqual([]);
  });

  it("is marked for its missing figure, never for a missing achievement", () => {
    const draft = profileWith({ ...CURRENT, facts: [{ text: "Implementé testing automatizado, reduciendo regresiones" }] });
    expect(progressByExperience(draft, NOW)[0]).toMatchObject({ hasAchievement: true, hasFigure: false });
    expect(gapMarks(draft, draft.experience[0]!.id, NOW)).toEqual(["Falta una cifra"]);
  });

  it("is listed for its figure once nobody knew it, like an achievement told as one", () => {
    const draft = profileWith({ ...CURRENT, facts: [{ text: "Implementé testing automatizado, reduciendo regresiones", metric: { unknown: true } }] });
    expect(pendingItems(draft, NOW)).toContainEqual(expect.objectContaining({ kind: "figure", experienceId: draft.experience[0]!.id }));
  });
});

describe("what a session did", () => {
  it("counts the facts and the figures that came from answering, since it began", () => {
    const draft = profileWith(CURRENT);
    draft.onboarding.sessionStartedAt = NOW.toISOString();
    const gap = detectGaps(draft, NOW).find((found) => found.rule === "no_content")!;
    answerNarrative(draft, gap, draft.experience[0]!.id, "Llevo las campañas. Preparo informes.", {}, ctx());
    const [story] = answerNarrative(draft, gap, draft.experience[0]!.id, "Rehíce la estructura de las campañas y subió la conversión", { kind: "achievement" }, ctx());
    const figure = detectGaps(draft, NOW).find((found) => found.rule === "achievement_no_figure")!;
    answerFigure(draft, figure, story!.id, { kind: "range", from: "20", to: "25", unit: "%" }, ctx(), { followUp: true });
    expect(summaryOfSession(draft)).toEqual({ facts: 3, figures: 1 });
  });

  it("does not count what was already there before the session", () => {
    const draft = profileWith({ ...CURRENT, facts: [{ text: "Llevo las campañas" }] });
    draft.onboarding.sessionStartedAt = NOW.toISOString();
    expect(summaryOfSession(draft)).toEqual({ facts: 0, figures: 0 });
  });

  it("does not count a 'no lo sé' as a figure", () => {
    const draft = profileWith({ ...CURRENT, facts: [{ kind: "achievement", text: "Bajé el costo" }] });
    draft.onboarding.sessionStartedAt = NOW.toISOString();
    const found = detectGaps(draft, NOW).find((gap) => gap.rule === "achievement_no_figure")!;
    answerFigure(draft, found, draft.experience[0]!.facts[0]!.id, { kind: "unknown" }, ctx(), { followUp: true });
    expect(summaryOfSession(draft).figures).toBe(0);
  });
});

describe("what is left", () => {
  it("lists what was put off, in the words of a list and with the question to ask it", () => {
    const draft = profileWith(CURRENT, { company: "Grupo Lumen", role: "Asistente", from: { year: 2018, month: 9 }, to: { year: 2021, month: 2 } });
    const found = detectGaps(draft, NOW).find((gap) => gap.rule === "no_content" && gap.experienceId === draft.experience[1]!.id)!;
    deferQuestion(draft, found, "later", ctx());
    const [item] = pendingItems(draft, NOW).filter((entry) => entry.kind === "later");
    expect(item).toMatchObject({ label: "Qué hacías en Grupo Lumen", kind: "later", experienceId: draft.experience[1]!.id });
    expect(item!.question).toMatchObject({ rule: "no_content", control: { kind: "narrative" } });
  });

  it("lists an achievement whose figure nobody had, to add if it turns up", () => {
    const draft = profileWith({ ...CURRENT, facts: [{ kind: "achievement", text: "Bajé el costo por lead cambiando las audiencias en Meta", metric: { unknown: true } }] });
    expect(pendingItems(draft, NOW)).toContainEqual(
      expect.objectContaining({ kind: "figure", label: expect.stringMatching(/^La cifra de «Bajé el costo por lead cambiando las audiencias.*…»$/) }),
    );
  });

  it("lists an old job the profile will not ask about, as optional", () => {
    const draft = profileWith(CURRENT, { company: "Agencia Faro", role: "Prácticas", from: { year: 2018, month: 2 }, to: { year: 2018, month: 7 } });
    expect(pendingItems(draft, NOW)).toContainEqual(expect.objectContaining({ kind: "optional", label: "Qué hacías en Agencia Faro (opcional)" }));
  });

  it("lists a project and the practical facts that were put off, each as its own line", () => {
    const draft = profileWith(CURRENT);
    draft.projects.push(projectSchema.parse({ id: "p1", name: { value: "Tienda online", status: "confirmed" } }));
    for (const rule of ["project_no_description", "practical"]) deferQuestion(draft, detectGaps(draft, NOW).find((gap) => gap.rule === rule)!, "skipped", ctx());
    const items = pendingItems(draft, NOW).filter((entry) => entry.kind === "skipped");
    expect(items.map((entry) => entry.label)).toEqual(["Qué hiciste en Tienda online", "Lo práctico para trabajar"]);
    // Neither is about a job, and each opens its own question.
    expect(items.every((entry) => entry.experienceId === undefined)).toBe(true);
    expect(items.map(pendingHref)).toEqual([
      `/perfil/preguntas?pregunta=${encodeURIComponent("project_no_description:p1")}`,
      `/perfil/preguntas?pregunta=${encodeURIComponent("practical:all")}`,
    ]);
    expect(items.map((entry) => entry.question?.control.kind)).toEqual(["project", "practical"]);
  });

  it("does not list what was turned down for good", () => {
    const draft = profileWith(CURRENT);
    const found = detectGaps(draft, NOW).find((gap) => gap.rule === "no_content")!;
    deferQuestion(draft, found, "na", ctx());
    expect(pendingItems(draft, NOW).filter((item) => item.id === found.id)).toEqual([]);
  });

  it("does not list what was put off and has since been answered", () => {
    const draft = profileWith(CURRENT);
    const found = detectGaps(draft, NOW).find((gap) => gap.rule === "no_content")!;
    deferQuestion(draft, found, "later", ctx());
    answerNarrative(draft, found, draft.experience[0]!.id, "Llevo las campañas.", {}, ctx());
    expect(pendingItems(draft, NOW).filter((item) => item.id === found.id)).toEqual([]);
  });
});

describe("picking up what is left", () => {
  const OLD = { company: "Agencia Faro", role: "Prácticas", from: { year: 2018, month: 2 }, to: { year: 2018, month: 7 } };

  it("opens what was put off as its own question, whichever way it was put off", () => {
    const draft = profileWith(CURRENT, { company: "Grupo Lumen", role: "Asistente", from: { year: 2018, month: 9 }, to: { year: 2021, month: 2 } });
    const found = detectGaps(draft, NOW).find((gap) => gap.rule === "no_content" && gap.experienceId === draft.experience[1]!.id)!;
    for (const state of ["later", "skipped"] as const) {
      deferQuestion(draft, found, state, ctx());
      const item = pendingItems(draft, NOW).find((entry) => entry.id === found.id)!;
      expect(item.kind).toBe(state);
      expect(pendingHref(item)).toBe(`/perfil/preguntas?pregunta=${encodeURIComponent(found.id)}`);
    }
  });

  it("opens an old job left as optional as the question about what it was", () => {
    const draft = profileWith(CURRENT, OLD);
    const item = pendingItems(draft, NOW).find((entry) => entry.kind === "optional")!;
    expect(pendingHref(item)).toBe(`/perfil/preguntas?pregunta=${encodeURIComponent(item.id)}`);
    expect(item.id).toBe(`no_content:${draft.experience[1]!.id}`);
  });

  it("takes a figure nobody had to the line it is about, in the profile, since there is no question to ask", () => {
    const draft = profileWith({ ...CURRENT, facts: [{ kind: "achievement", text: "Bajé el costo por lead", metric: { unknown: true } }] });
    const item = pendingItems(draft, NOW).find((entry) => entry.kind === "figure")!;
    expect(item.factId).toBe(draft.experience[0]!.facts[0]!.id);
    expect(pendingHref(item)).toBe(`/perfil?tarea=${encodeURIComponent(item.factId!)}`);
  });

  it("writes an id with colons and slashes in a way a URL keeps whole", () => {
    const href = pendingHref({ id: "career_gap:24000:24100/x?y", kind: "later", label: "" });
    expect(new URL(href, "https://example.test").searchParams.get("pregunta")).toBe("career_gap:24000:24100/x?y");
  });
});

describe("the roles offered for an objective", () => {
  it("are the person's own, newest first, once each", async () => {
    const { objectiveSuggestions } = await import("@/lib/onboarding/objective");
    const draft = profileWith(
      { company: "A", role: "Asistente de Marketing", from: { year: 2018, month: 9 }, to: { year: 2021, month: 2 } },
      { company: "B", role: "Analista de Marketing Digital", from: { year: 2021, month: 3 }, to: "current" },
      { company: "C", role: "asistente de marketing", from: { year: 2016, month: 1 }, to: { year: 2018, month: 1 } },
      { company: "D", role: "", from: { year: 2015 } },
    );
    expect(objectiveSuggestions(draft)).toEqual(["Analista de Marketing Digital", "Asistente de Marketing"]);
  });

  it("are no more than a few", async () => {
    const { objectiveSuggestions } = await import("@/lib/onboarding/objective");
    const draft = profileWith(...["a", "b", "c", "d", "e", "f"].map((role, i) => ({ company: role, role: `Rol ${role}`, from: { year: 2010 + i, month: 1 }, to: { year: 2011 + i, month: 1 } })));
    expect(objectiveSuggestions(draft)).toHaveLength(4);
  });
});
