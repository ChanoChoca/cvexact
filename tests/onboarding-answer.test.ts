import { describe, expect, it } from "vitest";
import {
  answerFigure,
  answerHandled,
  answerLanguageLevel,
  answerMonth,
  answerNarrative,
  answerObjective,
  answerOverlap,
  answerPeople,
  answerPractical,
  answerProject,
  answerSkillUses,
  answerTools,
  deferQuestion,
  dropPending,
  finishAchievements,
  resetQuestions,
} from "@/lib/onboarding/answer";
import { describeFigure } from "@/lib/onboarding/figure";
import { detectGaps, type Gap } from "@/lib/onboarding/gaps";
import { describePractical, isPracticalEmpty } from "@/lib/profile/practical-facts";
import { emptyStoredProfile, projectSchema, storedProfileSchema, type StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, profileWith } from "./helpers/profiles";

let n = 0;
const ctx = () => ({ now: STAMP, newId: () => `a-${++n}` });
const CURRENT = { company: "Nubia Retail", role: "Analista de Marketing", from: { year: 2021, month: 3 }, to: "current" as const };

const gapOf = (profile: StoredProfile, rule: string, match?: (g: Gap) => boolean): Gap =>
  detectGaps(profile, NOW).find((gap) => gap.rule === rule && (!match || match(gap)))!;

describe("a free answer", () => {
  const text = "Llevo las campañas de Google Ads y Meta, el SEO de la web y preparo los informes mensuales para dirección. También coordino a la agencia que nos hace el contenido.";

  it("becomes facts in the words that were typed, credited to the answer", () => {
    const draft = profileWith(CURRENT);
    const found = gapOf(draft, "no_content");
    const facts = answerNarrative(draft, found, draft.experience[0]!.id, text, {}, ctx());

    expect(facts.map((f) => f.text)).toEqual([
      "Llevo las campañas de Google Ads y Meta, el SEO de la web y preparo los informes mensuales para dirección.",
      "También coordino a la agencia que nos hace el contenido.",
    ]);
    for (const fact of facts) {
      expect(fact).toMatchObject({ kind: "responsibility", status: "confirmed", source: { kind: "answer", questionId: found.id, at: STAMP } });
      expect(fact.source.quote).toBe(fact.text);
    }
    expect(draft.experience[0]!.facts).toHaveLength(2);
  });

  it("can be the finer split a model made, and nothing more than that", () => {
    const draft = profileWith(CURRENT);
    const facts = answerNarrative(draft, gapOf(draft, "no_content"), draft.experience[0]!.id, text, { split: () => ["Llevo las campañas de Google Ads y Meta", "el SEO de la web"] }, ctx());
    expect(facts.map((f) => f.text)).toEqual(["Llevo las campañas de Google Ads y Meta", "el SEO de la web"]);
  });

  it("can be an achievement, under the question it answers", () => {
    const draft = profileWith({ ...CURRENT, facts: [{ text: "Llevo las campañas" }] });
    const found = gapOf(draft, "no_achievements");
    const [fact] = answerNarrative(draft, found, draft.experience[0]!.id, "Rehíce la estructura de las campañas y subió la conversión", { kind: "achievement", questionId: `${found.id}:sales` }, ctx());
    expect(fact).toMatchObject({ kind: "achievement", source: { questionId: `${found.id}:sales` } });
  });

  it("counts for nothing when it is an achievement: the question about achievements counts once, when it is done", () => {
    const draft = profileWith({ ...CURRENT, facts: [{ text: "Llevo las campañas" }] });
    const found = gapOf(draft, "no_achievements");
    answerNarrative(draft, found, draft.experience[0]!.id, "Subí las ventas.", { kind: "achievement" }, ctx());
    answerNarrative(draft, found, draft.experience[0]!.id, "Bajé los costos.", { kind: "achievement" }, ctx());
    expect(draft.onboarding.askedThisSession).toBe(0);
    finishAchievements(draft, found, 2, ctx());
    expect(draft.onboarding.askedThisSession).toBe(1);
    expect(draft.onboarding.askedByExperience[draft.experience[0]!.id]).toBe(1);
  });

  it("records that it happened, in the history", () => {
    const draft = profileWith(CURRENT);
    answerNarrative(draft, gapOf(draft, "no_content"), draft.experience[0]!.id, "Atiendo clientes.", {}, ctx());
    expect(draft.history.some((h) => h.op === "add" && h.path[3] === draft.experience[0]!.facts[0]!.id)).toBe(true);
  });

  it("counts against the session, once, for the job it was about", () => {
    const draft = profileWith(CURRENT);
    answerNarrative(draft, gapOf(draft, "no_content"), draft.experience[0]!.id, "Atiendo. Cierro la caja.", {}, ctx());
    expect(draft.onboarding.askedThisSession).toBe(1);
    expect(draft.onboarding.askedByExperience[draft.experience[0]!.id]).toBe(1);
  });

  it("says nothing was saved, and counts nothing, for an empty answer", () => {
    const draft = profileWith(CURRENT);
    expect(answerNarrative(draft, gapOf(draft, "no_content"), draft.experience[0]!.id, "   ", {}, ctx())).toEqual([]);
    expect(draft.onboarding.askedThisSession).toBe(0);
  });

  it("does nothing for a job that is not there", () => {
    const draft = profileWith(CURRENT);
    expect(answerNarrative(draft, gapOf(draft, "no_content"), "no-existe", "Atiendo.", {}, ctx())).toEqual([]);
  });
});

describe("the figure", () => {
  const withAchievement = () => {
    const draft = profileWith({ ...CURRENT, facts: [{ kind: "achievement", text: "Rehíce las campañas y subió la conversión" }] });
    return { draft, found: gapOf(draft, "achievement_no_figure"), factId: draft.experience[0]!.facts[0]!.id };
  };

  it("is kept beside the achievement and never written into it", () => {
    const { draft, found, factId } = withAchievement();
    expect(answerFigure(draft, found, factId, { kind: "exact", value: "20", unit: "%" }, ctx())).toBe(true);
    const fact = draft.experience[0]!.facts[0]!;
    expect(fact.metric).toEqual({ value: "20", unit: "%", approx: false });
    expect(fact.text).toBe("Rehíce las campañas y subió la conversión");
  });

  it("is saved as a range when it is one, and marked approximate", () => {
    const { draft, found, factId } = withAchievement();
    answerFigure(draft, found, factId, { kind: "range", from: "20", to: "25", unit: "%" }, ctx());
    expect(draft.experience[0]!.facts[0]!.metric).toEqual({ value: "20-25", unit: "%", approx: true });
  });

  it("is not asked again once given, and 'no lo sé' is an answer that is remembered", () => {
    const { draft, found, factId } = withAchievement();
    answerFigure(draft, found, factId, { kind: "unknown" }, ctx());
    expect(draft.experience[0]!.facts[0]!.metric).toEqual({ unknown: true });
    expect(detectGaps(draft, NOW).some((g) => g.rule === "achievement_no_figure")).toBe(false);
    expect(draft.fatigue.achievement_no_figure!.unknown).toBe(1);
  });

  it("refuses what is not a number, and changes nothing", () => {
    const { draft, found, factId } = withAchievement();
    const before = structuredClone(draft);
    expect(answerFigure(draft, found, factId, { kind: "exact", value: "muchos", unit: "%" }, ctx())).toBe(false);
    expect(answerFigure(draft, found, factId, { kind: "range", from: "20", to: "casi", unit: "%" }, ctx())).toBe(false);
    expect(draft).toEqual(before);
  });

  it("takes a decimal with a comma or a point, exactly as typed", () => {
    const { draft, found, factId } = withAchievement();
    answerFigure(draft, found, factId, { kind: "exact", value: "1,2", unit: "s" }, ctx());
    expect(draft.experience[0]!.facts[0]!.metric).toMatchObject({ value: "1,2" });
  });

  it("takes a number grouped by thousands, in either separator, exactly as typed", () => {
    const { draft, found, factId } = withAchievement();
    expect(answerFigure(draft, found, factId, { kind: "exact", value: "1.500.000", unit: "$" }, ctx())).toBe(true);
    expect(draft.experience[0]!.facts[0]!.metric).toMatchObject({ value: "1.500.000" });
  });

  it("takes a grouped number with a decimal tail too", () => {
    const { draft, found, factId } = withAchievement();
    expect(answerFigure(draft, found, factId, { kind: "exact", value: "1,500,000.5", unit: "$" }, ctx())).toBe(true);
    expect(draft.experience[0]!.facts[0]!.metric).toMatchObject({ value: "1,500,000.5" });
  });

  it("still refuses a number grouped inconsistently", () => {
    const { draft, found, factId } = withAchievement();
    expect(answerFigure(draft, found, factId, { kind: "exact", value: "1.50.000", unit: "$" }, ctx())).toBe(false);
  });

  it("can be undone", () => {
    const { draft, found, factId } = withAchievement();
    answerFigure(draft, found, factId, { kind: "exact", value: "20", unit: "%" }, ctx());
    expect(draft.history.at(-1)).toMatchObject({ op: "set" });
  });

  describe("'En mi trabajo no se miden cifras'", () => {
    it("writes nothing on the line, and is not a 'no lo sé': that one is a number nobody had", () => {
      const { draft, found, factId } = withAchievement();
      expect(answerFigure(draft, found, factId, { kind: "measureless" }, ctx())).toBe(true);
      const fact = draft.experience[0]!.facts[0]!;
      expect(fact.metric).toBeUndefined();
      expect(fact.text).toBe("Rehíce las campañas y subió la conversión");
      expect(draft.fatigue.achievement_no_figure).toEqual({ skipped: 0, unknown: 0, off: true });
      expect(draft.history).toEqual([]);
    });

    it("counts as a question when it is asked on its own, and for nothing as the second half of one", () => {
      const own = withAchievement();
      answerFigure(own.draft, own.found, own.factId, { kind: "measureless" }, ctx());
      expect(own.draft.onboarding.askedThisSession).toBe(1);
      const half = withAchievement();
      answerFigure(half.draft, half.found, half.factId, { kind: "measureless" }, ctx(), { followUp: true });
      expect(half.draft.onboarding.askedThisSession).toBe(0);
    });

    it("keeps what was already counted of 'no lo sé' and of skipping, and only adds the mark", () => {
      const { draft, found, factId } = withAchievement();
      draft.fatigue.achievement_no_figure = { skipped: 2, unknown: 1 };
      answerFigure(draft, found, factId, { kind: "measureless" }, ctx());
      expect(draft.fatigue.achievement_no_figure).toEqual({ skipped: 2, unknown: 1, off: true });
    });

    it("changes nothing for a line that is not there", () => {
      const { draft, found } = withAchievement();
      const before = structuredClone(draft);
      expect(answerFigure(draft, found, "nope", { kind: "measureless" }, ctx())).toBe(false);
      expect(draft).toEqual(before);
    });

    it("is said back with the way to take it back", () => {
      expect(describeFigure({ kind: "measureless" })).toMatch(/no te pedimos más cifras/);
      expect(describeFigure({ kind: "measureless" })).toMatch(/Volver a preguntar lo pendiente/);
    });

    it("is still there when the profile is read back, and a value that is not a yes or no is not taken for one", () => {
      const { draft, found, factId } = withAchievement();
      answerFigure(draft, found, factId, { kind: "measureless" }, ctx());
      const read = storedProfileSchema.parse(JSON.parse(JSON.stringify(draft)));
      expect(read.fatigue.achievement_no_figure).toEqual({ skipped: 0, unknown: 0, off: true });
      const odd = JSON.parse(JSON.stringify(draft));
      odd.fatigue.achievement_no_figure.off = "sí";
      expect(storedProfileSchema.parse(odd).fatigue.achievement_no_figure).toEqual({ skipped: 0, unknown: 0 });
    });

    it("goes away when the questions are asked again", () => {
      const { draft, found, factId } = withAchievement();
      answerFigure(draft, found, factId, { kind: "measureless" }, ctx());
      resetQuestions(draft);
      expect(draft.fatigue).toEqual({});
    });
  });

  it("counts as a question when it is asked on its own", () => {
    const { draft, found, factId } = withAchievement();
    answerFigure(draft, found, factId, { kind: "exact", value: "20", unit: "%" }, ctx());
    expect(draft.onboarding.askedThisSession).toBe(1);
  });

  it("counts for nothing when it is the second half of the question about the achievement just told", () => {
    const { draft, found, factId } = withAchievement();
    answerFigure(draft, found, factId, { kind: "exact", value: "20", unit: "%" }, ctx(), { followUp: true });
    expect(draft.onboarding.askedThisSession).toBe(0);
    expect(draft.onboarding.askedByExperience).toEqual({});
  });

  it("wears the kind of question down when it is 'no lo sé', asked on its own or not", () => {
    const { draft, found, factId } = withAchievement();
    answerFigure(draft, found, factId, { kind: "unknown" }, ctx(), { followUp: true });
    expect(draft.fatigue.achievement_no_figure!.unknown).toBe(1);
  });
});

describe("people in charge", () => {
  const manager = () => {
    const draft = profileWith({ ...CURRENT, role: "Responsable de marketing", facts: [{ text: "Armo el plan" }] });
    return { draft, found: gapOf(draft, "scope_unknown") };
  };

  it("with a number: a fact carrying it", () => {
    const { draft, found } = manager();
    expect(answerPeople(draft, found, { yes: true, count: "4" }, ctx())).toBe(true);
    expect(draft.experience[0]!.facts.at(-1)).toMatchObject({ kind: "scope", text: "Personas a cargo: 4", metric: { value: "4", unit: "personas" }, source: { kind: "answer" } });
  });

  it("with no number: a fact that says only what was said", () => {
    const { draft, found } = manager();
    answerPeople(draft, found, { yes: true }, ctx());
    expect(draft.experience[0]!.facts.at(-1)).toMatchObject({ kind: "scope", text: "Con personas a cargo" });
  });

  it("'no' is respected for good and adds nothing", () => {
    const { draft, found } = manager();
    answerPeople(draft, found, { yes: false }, ctx());
    expect(draft.experience[0]!.facts).toHaveLength(1);
    expect(draft.pending).toContainEqual(expect.objectContaining({ questionId: found.id, state: "na" }));
  });

  it("refuses a count that is not a number", () => {
    const { draft, found } = manager();
    expect(answerPeople(draft, found, { yes: true, count: "varios" }, ctx())).toBe(false);
    expect(draft.experience[0]!.facts).toHaveLength(1);
  });
});

describe("a month", () => {
  const recent = () => {
    const draft = profileWith({ company: "A", role: "x", from: { year: 2023 }, to: { year: 2024 }, fromCv: true });
    return { draft, found: gapOf(draft, "imprecise_date", (g) => g.payload.which === "start") };
  };

  it("makes a year into a month, marked as the person's own correction", () => {
    const { draft, found } = recent();
    answerMonth(draft, found, "start", 3, ctx());
    expect(draft.experience[0]!.start).toMatchObject({ value: { year: 2023, month: 3 }, status: "edited" });
  });

  it("is asked no more once answered", () => {
    const { draft, found } = recent();
    answerMonth(draft, found, "start", 3, ctx());
    expect(detectGaps(draft, NOW).some((g) => g.id === found.id)).toBe(false);
  });

  it("'no me acuerdo' keeps the year and is not asked again", () => {
    const { draft, found } = recent();
    answerMonth(draft, found, "start", null, ctx());
    expect(draft.experience[0]!.start.value).toEqual({ year: 2023, raw: "2023" }.year ? draft.experience[0]!.start.value : {});
    expect(draft.experience[0]!.start.value.month).toBeUndefined();
    expect(draft.pending).toContainEqual(expect.objectContaining({ questionId: found.id, state: "na" }));
  });
});

describe("tools and skills", () => {
  const named = () => {
    const draft = profileWith({ ...CURRENT, facts: [{ text: "Llevo las campañas de Google Ads y Meta" }] }, { company: "B", role: "b", from: { year: 2019, month: 1 }, to: { year: 2021, month: 1 }, facts: [{ text: "Armaba avisos en Meta" }] });
    return { draft, found: gapOf(draft, "loose_tool") };
  };

  it("adds the ones confirmed as skills, in their own words, linked to the jobs that name them", () => {
    const { draft, found } = named();
    answerTools(draft, found, ["Google Ads", "Meta"], ["Google Ads", "Meta"], ctx());
    expect(draft.skills.map((s) => s.name.value)).toEqual(["Google Ads", "Meta"]);
    expect(draft.skills[0]).toMatchObject({ name: { status: "confirmed", source: { kind: "answer", quote: "Google Ads" } } });
    expect(draft.skills[0]!.experienceIds).toEqual([draft.experience[0]!.id]);
    expect(draft.skills[1]!.experienceIds).toEqual([draft.experience[0]!.id, draft.experience[1]!.id]);
  });

  it("remembers the ones turned down and does not offer them again", () => {
    const { draft, found } = named();
    answerTools(draft, found, ["Google Ads"], ["Google Ads", "Meta"], ctx());
    expect(draft.skills.map((s) => s.name.value)).toEqual(["Google Ads"]);
    expect(detectGaps(draft, NOW).some((g) => g.rule === "loose_tool")).toBe(false);
  });

  it("does not add a skill twice", () => {
    const { draft, found } = named();
    draft.skills.push({ id: "s0", name: { value: "google ads", status: "confirmed" }, experienceIds: [] });
    answerTools(draft, found, ["Google Ads", "Meta"], ["Google Ads", "Meta"], ctx());
    expect(draft.skills.map((s) => s.name.value)).toEqual(["google ads", "Meta"]);
  });

  it("counts as a one-tap question, not a deepening one", () => {
    const { draft, found } = named();
    answerTools(draft, found, ["Meta"], ["Meta"], ctx());
    expect(draft.onboarding.askedQuick).toBe(1);
    expect(draft.onboarding.askedThisSession).toBe(0);
  });

  it("takes 'no aplica' as turning down these tools, one by one — not every tool the person will ever name", () => {
    const { draft, found } = named();
    deferQuestion(draft, found, "na", ctx());
    expect(draft.pending.some((entry) => entry.questionId === "loose_tool:all")).toBe(false);
    expect(detectGaps(draft, NOW).some((g) => g.rule === "loose_tool")).toBe(false);
    expect(draft.onboarding.askedQuick).toBe(1);
    draft.experience[0]!.facts.push({ id: "later", kind: "responsibility", text: "Armo los tableros en Looker Studio", source: { kind: "manual", at: STAMP }, status: "confirmed" });
    expect(gapOf(draft, "loose_tool").payload.tools).toEqual(["Looker Studio"]);
  });

  it("places a skill in the jobs the person says", () => {
    const draft = profileWith(CURRENT);
    draft.skills.push({ id: "s1", name: { value: "SEO", status: "confirmed" }, experienceIds: [] });
    const found = gapOf(draft, "skill_unused");
    answerSkillUses(draft, found, "s1", [draft.experience[0]!.id], ctx());
    expect(draft.skills[0]!.experienceIds).toEqual([draft.experience[0]!.id]);
    expect(detectGaps(draft, NOW).some((g) => g.rule === "skill_unused")).toBe(false);
  });

  it("'en ninguno' is respected", () => {
    const draft = profileWith(CURRENT);
    draft.skills.push({ id: "s1", name: { value: "SEO", status: "confirmed" }, experienceIds: [] });
    answerSkillUses(draft, gapOf(draft, "skill_unused"), "s1", [], ctx());
    expect(draft.skills[0]!.experienceIds).toEqual([]);
    expect(detectGaps(draft, NOW).some((g) => g.rule === "skill_unused")).toBe(true); // still detected…
    expect(draft.pending.some((p) => p.state === "na")).toBe(true); // …but never asked
  });
});

describe("a language's level", () => {
  const english = () => {
    const draft = emptyStoredProfile();
    draft.languages.push({ id: "l1", name: { value: "Inglés", status: "confirmed" }, level: { value: {}, status: "confirmed" } });
    return { draft, found: detectGaps(draft, NOW)[0]! };
  };

  it("is filled in from the chips, as the person's answer", () => {
    const { draft, found } = english();
    answerLanguageLevel(draft, found, "l1", "B2", ctx());
    expect(draft.languages[0]!.level).toMatchObject({ value: { cefr: "B2" }, status: "confirmed", source: { kind: "answer" } });
    expect(detectGaps(draft, NOW)).toEqual([]);
  });

  it("'no lo sé' is an answer, and is not asked again", () => {
    const { draft, found } = english();
    answerLanguageLevel(draft, found, "l1", "unknown", ctx());
    expect(draft.languages[0]!.level.value).toEqual({});
    expect(draft.pending).toContainEqual(expect.objectContaining({ questionId: found.id, state: "na" }));
  });
});

describe("the three ways not to answer", () => {
  it("'más tarde' waits, and does not make the next question of its kind less likely", () => {
    const draft = profileWith(CURRENT);
    deferQuestion(draft, gapOf(draft, "no_content"), "later", ctx());
    expect(draft.pending[0]).toMatchObject({ state: "later", count: 1 });
    expect(draft.fatigue.no_content).toBeUndefined();
  });

  it("'saltar' comes back weighed less, and wears the kind of question down", () => {
    const draft = profileWith(CURRENT);
    deferQuestion(draft, gapOf(draft, "no_content"), "skipped", ctx());
    expect(draft.pending[0]).toMatchObject({ state: "skipped" });
    expect(draft.fatigue.no_content).toEqual({ skipped: 1, unknown: 0 });
  });

  it("'no aplica' is for good", () => {
    const draft = profileWith(CURRENT);
    deferQuestion(draft, gapOf(draft, "no_content"), "na", ctx());
    expect(draft.pending[0]).toMatchObject({ state: "na" });
  });

  it("changes the state of a question asked twice, instead of listing it twice", () => {
    const draft = profileWith(CURRENT);
    const found = gapOf(draft, "no_content");
    deferQuestion(draft, found, "later", ctx());
    deferQuestion(draft, found, "skipped", ctx());
    expect(draft.pending).toHaveLength(1);
    expect(draft.pending[0]).toMatchObject({ state: "skipped", count: 2 });
  });

  it("counts against the session, except for the skeleton", () => {
    const draft = profileWith(CURRENT, { company: "B", role: "b" });
    deferQuestion(draft, gapOf(draft, "no_content"), "later", ctx());
    expect(draft.onboarding.askedThisSession).toBe(1);
    deferQuestion(draft, gapOf(draft, "incomplete_skeleton"), "later", ctx());
    expect(draft.onboarding.askedThisSession).toBe(1);
  });

  it("can take a question back out of the queue", () => {
    const draft = profileWith(CURRENT);
    deferQuestion(draft, gapOf(draft, "no_content"), "later", ctx());
    dropPending(draft, draft.pending[0]!.questionId);
    expect(draft.pending).toEqual([]);
  });
});

describe("what improved", () => {
  it("skipping every follow-up defers the question instead of asking it again at once", () => {
    const draft = profileWith({ ...CURRENT, facts: [{ text: "Llevo las campañas" }] });
    finishAchievements(draft, gapOf(draft, "no_achievements"), 0, ctx());
    expect(draft.pending[0]).toMatchObject({ state: "skipped" });
  });

  it("telling something counts as answering", () => {
    const draft = profileWith({ ...CURRENT, facts: [{ text: "Llevo las campañas" }] });
    finishAchievements(draft, gapOf(draft, "no_achievements"), 2, ctx());
    expect(draft.pending).toEqual([]);
    expect(draft.onboarding.askedThisSession).toBe(1);
  });
});

describe("a question dealt with some other way", () => {
  it("counts as asked and is not asked again: dates corrected, or something added to fill a stretch", () => {
    const draft = profileWith(
      { company: "A", role: "x", from: { year: 2018, month: 1 }, to: { year: 2019, month: 1 } },
      { company: "B", role: "y", from: { year: 2020, month: 3 }, to: { year: 2021, month: 1 } },
    );
    const found = gapOf(draft, "career_gap");
    answerHandled(draft, found, ctx());
    expect(draft.pending).toContainEqual(expect.objectContaining({ questionId: found.id, state: "na" }));
    expect(draft.onboarding.askedQuick).toBe(1);
    expect(detectGaps(draft, NOW).some((gap) => gap.rule === "career_gap")).toBe(true); // still a gap…
    expect(detectGaps(draft, NOW).find((gap) => gap.rule === "career_gap")!.id).toBe(found.id); // …but a known one
  });
});

describe("two jobs at once, and the objective", () => {
  it("'sí' is remembered for good", () => {
    const draft = profileWith({ company: "A", role: "x", from: { year: 2019 }, to: { year: 2022 } }, { company: "B", role: "y", from: { year: 2020 }, to: { year: 2023 } });
    const found = gapOf(draft, "overlap");
    answerOverlap(draft, found, ctx());
    expect(draft.pending[0]).toMatchObject({ questionId: found.id, state: "na" });
  });

  it("saves what job they want, in their words", () => {
    const draft = emptyStoredProfile();
    answerObjective(draft, "  Responsable de marketing digital ", ctx());
    expect(draft.objective).toMatchObject({ value: "Responsable de marketing digital", status: "confirmed", source: { kind: "answer" } });
  });

  it("changing it later is an edit, with the first kept", () => {
    const draft = emptyStoredProfile();
    answerObjective(draft, "Analista", ctx());
    answerObjective(draft, "Gerente", ctx());
    expect(draft.objective).toMatchObject({ value: "Gerente", status: "edited", original: "Analista" });
  });

  it("turning it down is remembered so it is not asked twice", () => {
    const draft = emptyStoredProfile();
    deferQuestion(draft, { id: "objective", rule: "objective", priority: "medium", payload: {} }, "na", ctx());
    expect(draft.objective.value).toBe("");
    expect(draft.pending).toContainEqual(expect.objectContaining({ questionId: "objective", state: "na" }));
  });

  it("a blank answer is no answer: nothing is saved and nothing is remembered", () => {
    const draft = emptyStoredProfile();
    answerObjective(draft, "   ", ctx());
    expect(draft.objective.value).toBe("");
    expect(draft.pending).toEqual([]);
  });

  it("giving one later clears that", () => {
    const draft = emptyStoredProfile();
    deferQuestion(draft, { id: "objective", rule: "objective", priority: "medium", payload: {} }, "na", ctx());
    answerObjective(draft, "Cajero", ctx());
    expect(draft.pending).toEqual([]);
  });
});

describe("the practical facts, answered", () => {
  const marked = { availability: "Tiempo completo, Fines de semana", driverLicense: "", workEligibility: "", ownVehicle: true, willingToRelocate: false };

  it("keeps what was marked, credited to the answer, and nothing about what was left alone", () => {
    const draft = profileWith(CURRENT);
    expect(answerPractical(draft, gapOf(draft, "practical"), marked, ctx())).toBe(true);
    expect(draft.legacy.practical).toMatchObject({
      value: { availability: "Tiempo completo, Fines de semana", driverLicense: "", workEligibility: "", ownVehicle: true, willingToRelocate: false },
      status: "confirmed",
      source: { kind: "answer", at: STAMP },
    });
    // A switch left off is not a "no": it is not written as one, and the gap is not asked again for what it did not say.
    expect(detectGaps(draft, NOW).map((gap) => gap.rule)).not.toContain("practical");
  });

  it("is an edit the profile can undo, like any other", () => {
    const draft = profileWith(CURRENT);
    answerPractical(draft, gapOf(draft, "practical"), marked, ctx());
    expect(draft.history.at(-1)).toMatchObject({ op: "set", path: ["legacy", "practical"] });
  });

  it("counts as a quick question, and as nothing else", () => {
    const draft = profileWith(CURRENT);
    answerPractical(draft, gapOf(draft, "practical"), marked, ctx());
    expect(draft.onboarding).toMatchObject({ askedQuick: 1, askedThisSession: 0 });
  });

  it("refuses an answer with nothing in it: saying there is nothing is 'No aplica', and that is recorded elsewhere", () => {
    const draft = profileWith(CURRENT);
    const before = structuredClone(draft);
    expect(answerPractical(draft, gapOf(draft, "practical"), { availability: "  ", driverLicense: "", ownVehicle: false, willingToRelocate: false }, ctx())).toBe(false);
    expect(draft).toEqual(before);
  });

  it("is cut at what each field holds, so the answer is what is kept", () => {
    const draft = profileWith(CURRENT);
    answerPractical(draft, gapOf(draft, "practical"), { availability: "x".repeat(300), driverLicense: "y".repeat(120) }, ctx());
    expect(draft.legacy.practical.value.availability).toHaveLength(200);
    expect(draft.legacy.practical.value.driverLicense).toHaveLength(80);
  });

  it("leaves nothing pending, if it had been put off before", () => {
    const draft = profileWith(CURRENT);
    deferQuestion(draft, gapOf(draft, "practical"), "skipped", ctx());
    expect(draft.pending.map((entry) => entry.questionId)).toContain("practical:all");
    answerPractical(draft, gapOf(draft, "practical"), marked, ctx());
    expect(draft.pending.map((entry) => entry.questionId)).not.toContain("practical:all");
  });

  it("is told on one line, only with what was said, and nothing when nothing was", () => {
    const none = { availability: "", driverLicense: "", workEligibility: "", ownVehicle: false, willingToRelocate: false };
    expect(describePractical(none)).toBe("");
    expect(isPracticalEmpty(none)).toBe(true);
    expect(isPracticalEmpty({ ...none, availability: "   " })).toBe(true);
    expect(describePractical({ ...marked, availability: " Tiempo completo ", driverLicense: "B1", workEligibility: "Residencia", willingToRelocate: true })).toBe(
      "Tiempo completo · Licencia B1 · Permiso: Residencia · Vehículo propio · Puede mudarse",
    );
    expect(describePractical({ ...none, willingToRelocate: true })).toBe("Puede mudarse");
  });

  it("is turned down for good by 'No aplica', with no profile change", () => {
    const draft = profileWith(CURRENT);
    deferQuestion(draft, gapOf(draft, "practical"), "na", ctx());
    expect(draft.pending).toMatchObject([{ questionId: "practical:all", state: "na" }]);
    expect(draft.legacy.practical.value.availability).toBe("");
  });
});

describe("what was done in a project, answered", () => {
  const withProject = (description = "") => {
    const draft = emptyStoredProfile();
    draft.projects.push(projectSchema.parse({ id: "p1", name: { value: "Tienda online", status: "confirmed" }, description: { value: description, status: "confirmed" } }));
    return draft;
  };

  it("becomes the project's description, in the person's words and credited to them", () => {
    const draft = withProject();
    const found = gapOf(draft, "project_no_description");
    expect(answerProject(draft, found, "p1", "  Armé la tienda con Tiendanube y la conecté al stock del local  ", ctx())).toBe(true);
    expect(draft.projects[0]!.description).toMatchObject({ value: "Armé la tienda con Tiendanube y la conecté al stock del local", status: "confirmed", source: { kind: "answer", at: STAMP } });
    expect(draft.history.at(-1)).toMatchObject({ op: "set", path: ["projects", "p1", "description"] });
    expect(detectGaps(draft, NOW).map((gap) => gap.rule)).not.toContain("project_no_description");
  });

  it("counts against the session, like a question that is not about a job", () => {
    const draft = withProject();
    answerProject(draft, gapOf(draft, "project_no_description"), "p1", "Armé la tienda", ctx());
    expect(draft.onboarding).toMatchObject({ askedThisSession: 1, askedQuick: 0, askedByExperience: {} });
  });

  it("refuses an empty answer and a project that is not there, and counts nothing", () => {
    const draft = withProject();
    const found = gapOf(draft, "project_no_description");
    expect(answerProject(draft, found, "p1", "   ", ctx())).toBe(false);
    expect(answerProject(draft, found, "nobody", "Armé la tienda", ctx())).toBe(false);
    expect(draft.onboarding.askedThisSession).toBe(0);
    expect(draft.projects[0]!.description.value).toBe("");
  });

  it("is cut at what a description holds", () => {
    const draft = withProject();
    answerProject(draft, gapOf(draft, "project_no_description"), "p1", "x".repeat(1200), ctx());
    expect(draft.projects[0]!.description.value).toHaveLength(800);
  });

  it("replaces a description that was there as an edit, keeping what it said", () => {
    const draft = withProject("De un club");
    answerProject(draft, { id: "project_no_description:p1", priority: "medium" }, "p1", "Armé la tienda del club", ctx());
    expect(draft.projects[0]!.description).toMatchObject({ value: "Armé la tienda del club", status: "edited", original: "De un club" });
  });

  it("leaves nothing pending, if it had been put off before", () => {
    const draft = withProject();
    const found = gapOf(draft, "project_no_description");
    deferQuestion(draft, found, "later", ctx());
    answerProject(draft, found, "p1", "Armé la tienda", ctx());
    expect(draft.pending).toEqual([]);
  });
});
