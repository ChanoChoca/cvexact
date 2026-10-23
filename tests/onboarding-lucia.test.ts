import { describe, expect, it } from "vitest";
import { linesFromRuns } from "@/lib/parse/lines";
import { parseLinkedInPdf } from "@/lib/parse/linkedin-pdf";
import { applyParsedDocument } from "@/lib/parse/to-profile";
import {
  answerFigure,
  answerLanguageLevel,
  answerNarrative,
  answerObjective,
  answerPeople,
  answerTools,
  deferQuestion,
  finishAchievements,
} from "@/lib/onboarding/answer";
import { detectGaps, followUpGaps, nextQuestion, type Gap } from "@/lib/onboarding/gaps";
import { questionFor, type Question } from "@/lib/onboarding/questions";
import { confirmAll, editExperience } from "@/lib/onboarding/review";
import { beginSession, pendingItems, progressByExperience, sessionOf, summaryOfSession } from "@/lib/onboarding/session";
import { toPlainProfile } from "@/lib/profile/project";
import { emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { LINKEDIN_ES_BARE, layout } from "./fixtures/linkedin-layout";
import { NOW, STAMP } from "./helpers/profiles";

/**
 * The spec's own example, end to end: Lucía has LinkedIn and no CV, and wants to be
 * a marketing manager. Her profile is titles and dates; what follows is what the
 * engine asks her, in the order it asks it, with what she answers.
 *
 * The test plays the part of the screens: it asks the engine for the next
 * question, reads it as the card would, answers it with the same functions the
 * card calls, and checks the profile after. Nothing here is a model.
 */

let n = 0;
const ctx = (now: string = STAMP) => ({ now, newId: () => `l-${++n}` });

/** What the LinkedIn PDF and the first screens leave: the skeleton read and confirmed, and her objective. */
function afterTheSkeleton(): StoredProfile {
  const doc = parseLinkedInPdf(linesFromRuns(layout(LINKEDIN_ES_BARE), { splitAt: 150 }))!;
  const { profile } = applyParsedDocument(
    emptyStoredProfile(),
    doc,
    { name: "Profile.pdf", fileHash: "h-lucia", pasted: false, chars: 1 },
    { sourceId: "src-1", now: STAMP, newId: ctx().newId },
  );
  profile.onboarding.route = "linkedin";
  confirmAll(profile);
  answerObjective(profile, "Responsable de marketing digital", ctx());
  beginSession(profile, NOW);
  return profile;
}

type Asked = { gap: Gap; question: Question };

/** The next card, or why there is none. */
function card(draft: StoredProfile, at: Date = NOW): Asked | "budget" | "none" {
  const next = nextQuestion(draft, sessionOf(draft), at);
  if (next.kind !== "gap") return next.kind;
  return { gap: next.gap, question: questionFor(next.gap, draft) };
}

const asked = (draft: StoredProfile, at?: Date): Asked => {
  const next = card(draft, at);
  if (typeof next === "string") throw new Error(`expected a question, got "${next}"`);
  return next;
};

const job = (draft: StoredProfile, company: string) => draft.experience.find((entry) => entry.company.value === company)!;

/** What a model that splits an answer finer would return: pieces of what was written, and nothing else. */
const FINER = () => [
  "Llevo las campañas de Google Ads y Meta",
  "el SEO de la web",
  "preparo los informes mensuales para dirección",
  "coordino a la agencia que nos hace el contenido",
];
const STORY =
  "Llevo las campañas de Google Ads y Meta, el SEO de la web y preparo los informes mensuales para dirección. También coordino a la agencia que nos hace el contenido.";

describe("what she starts with", () => {
  it("is three jobs and a degree, read from LinkedIn and confirmed, with nothing under any of them", () => {
    const draft = afterTheSkeleton();
    expect(draft.experience.map((entry) => entry.company.value)).toEqual(["Nubia Retail", "Grupo Lumen", "Agencia Faro"]);
    expect(draft.experience.every((entry) => entry.facts.length === 0)).toBe(true);
    expect(draft.skills.map((skill) => skill.name.value)).toEqual(["Google Analytics", "SEO", "HubSpot", "Email marketing", "Copywriting"]);
    expect(draft.objective.value).toBe("Responsable de marketing digital");
  });

  it("is asked, first, about the job she has now, in the present tense", () => {
    const first = asked(afterTheSkeleton());
    expect(first.question).toMatchObject({
      rule: "no_content",
      context: "Sobre Nubia Retail · puesto actual",
      text: "¿De qué te encargás en Nubia Retail?",
      control: { kind: "narrative" },
    });
    expect(first.question.hint).toMatch(/qué hacés, para quién y con qué/);
  });
});

describe("the first session", () => {
  const draft = afterTheSkeleton();
  const nubia = job(draft, "Nubia Retail");
  const lumen = job(draft, "Grupo Lumen");

  it("what she does: her own words, as four facts, and no example given", () => {
    const { gap } = asked(draft);
    const created = answerNarrative(draft, gap, nubia.id, STORY, { split: FINER }, ctx());
    expect(created.map((fact) => fact.text)).toEqual(FINER());
    expect(nubia.facts.every((fact) => fact.kind === "responsibility" && fact.source.kind === "answer")).toBe(true);
    // The tools she named come up while her words are still on screen.
    const follow = followUpGaps(draft, created, NOW);
    expect(follow.map((found) => found.rule)).toEqual(["loose_tool"]);
    expect(questionFor(follow[0]!, draft).control).toMatchObject({ kind: "tools", tools: ["Google Ads", "Meta"] });
  });

  it("the tools she named: both, as skills, linked to the job that names them", () => {
    const found = detectGaps(draft, NOW).find((gap) => gap.rule === "loose_tool")!;
    answerTools(draft, found, ["Google Ads", "Meta"], ["Google Ads", "Meta"], ctx());
    const added = draft.skills.filter((skill) => ["Google Ads", "Meta"].includes(skill.name.value));
    expect(added).toHaveLength(2);
    expect(added.every((skill) => skill.experienceIds.includes(nubia.id))).toBe(true);
  });

  it("what improved: the question about achievements is next, ahead of the people she leads", () => {
    const next = asked(draft);
    expect(next.question).toMatchObject({ rule: "no_achievements", text: "¿Hubo algo que mejorara gracias a tu trabajo en Nubia Retail?", control: { kind: "achievement-types" } });
  });

  it("each achievement, in her words, and its figure asked right after, as part of the same question", () => {
    const found = asked(draft).gap;

    const [sales] = answerNarrative(draft, found, nubia.id, "Rehíce la estructura de las campañas de búsqueda y subió la conversión de la tienda online", { kind: "achievement", questionId: `${found.id}:sales` }, ctx());
    const [salesFigure] = followUpGaps(draft, [sales!], NOW);
    expect(salesFigure).toMatchObject({ rule: "achievement_no_figure" });
    expect(questionFor(salesFigure!, draft).control).toMatchObject({ kind: "figure", quote: sales!.text });
    expect(answerFigure(draft, salesFigure!, sales!.id, { kind: "range", from: "20", to: "25", unit: "%" }, ctx(), { followUp: true })).toBe(true);
    expect(sales!.metric).toEqual({ value: "20-25", unit: "%", approx: true });
    // Kept beside her words, not written into them.
    expect(sales!.text).not.toMatch(/20|25/);

    const [costs] = answerNarrative(draft, found, nubia.id, "Bajé el costo por lead cambiando las audiencias en Meta", { kind: "achievement", questionId: `${found.id}:costs` }, ctx());
    const [costsFigure] = followUpGaps(draft, [costs!], NOW);
    answerFigure(draft, costsFigure!, costs!.id, { kind: "unknown" }, ctx(), { followUp: true });
    expect(costs!.metric).toEqual({ unknown: true });

    finishAchievements(draft, found, 2, ctx());
    // Two achievements, two figures asked, one question counted.
    expect(draft.onboarding.askedByExperience[nubia.id]).toBe(2);
  });

  it("the people she leads: asked because of what she wants to be, and not settled by coordinating an agency", () => {
    const next = asked(draft);
    expect(next.question).toMatchObject({ rule: "scope_unknown", text: "¿Tenés personas a cargo?", control: { kind: "people" } });
    answerPeople(draft, next.gap, { yes: false }, ctx());
    expect(nubia.facts.some((fact) => fact.kind === "scope")).toBe(false);
  });

  it("the next job: the one before it, in the past tense, with no more asked about this one", () => {
    // Nubia has had its three: what she does, what improved, whom she leads.
    expect(draft.onboarding.askedByExperience[nubia.id]).toBe(3);
    const next = asked(draft);
    expect(next.question).toMatchObject({ rule: "no_content", context: "Sobre Grupo Lumen", text: "¿De qué te encargabas en Grupo Lumen?" });
    // She does not ask about an assistant leading people because of what she wants to become.
    expect(detectGaps(draft, NOW).some((gap) => gap.rule === "scope_unknown" && gap.experienceId === lumen.id)).toBe(false);
    deferQuestion(draft, next.gap, "later", ctx());
  });

  it("a quick one: the level of English, and not of Spanish, which LinkedIn already gave", () => {
    const next = asked(draft);
    expect(next.question).toMatchObject({ rule: "language_no_level", text: "¿Qué nivel de Inglés tenés?", control: { kind: "level" } });
    answerLanguageLevel(draft, next.gap, (next.question.control as { languageId: string }).languageId, "B2", ctx());
    expect(draft.languages.find((entry) => entry.name.value === "Inglés")!.level.value).toEqual({ cefr: "B2", raw: "Intermedio alto (B2)" });
  });

  it("then the session is over, and says why: what is left is for another time", () => {
    // Two quick ones asked — the tools and the level — and the deepening not used up.
    expect(draft.onboarding).toMatchObject({ askedQuick: 2, askedThisSession: 4 });
    expect(card(draft)).toBe("budget");
  });

  it("says what she did today: six facts and one achievement with a figure", () => {
    expect(summaryOfSession(draft)).toEqual({ facts: 6, figures: 1 });
  });

  it("says what is left: what she put off, the figure she did not have, and the old job, as optional", () => {
    expect(pendingItems(draft, NOW).map((item) => [item.kind, item.label])).toEqual([
      ["later", "Qué hacías en Grupo Lumen"],
      ["figure", "La cifra de «Bajé el costo por lead cambiando las audiencias…»"],
      ["optional", "Qué hacías en Agencia Faro (opcional)"],
    ]);
  });

  it("shows, per job, how far each is", () => {
    expect(progressByExperience(draft, NOW).map((entry) => [entry.label, entry.facts, entry.hasAchievement, entry.hasFigure])).toEqual([
      ["Nubia Retail", 6, true, true],
      ["Grupo Lumen", 0, false, false],
      ["Agencia Faro", 0, false, false],
    ]);
  });

  it("already makes a profile a CV can be written from", () => {
    const plain = toPlainProfile(draft);
    expect(plain.experience[0]!.bullets).toContain("Rehíce la estructura de las campañas de búsqueda y subió la conversión de la tienda online — aprox. 20–25 %");
    expect(plain.experience[0]!.bullets).toContain("Bajé el costo por lead cambiando las audiencias en Meta");
  });

  describe("two days later", () => {
    const later = new Date(NOW.getTime() + 2 * 24 * 3_600_000);

    it("is a new session, and starts with what she put off", () => {
      expect(beginSession(draft, later)).toBe(true);
      expect(draft.onboarding).toMatchObject({ askedThisSession: 0, askedQuick: 0, sessionCount: 2 });
      const next = asked(draft, later);
      expect(next.question).toMatchObject({ rule: "no_content", context: "Sobre Grupo Lumen" });
    });

    it("fixing the end of that job to the month the next began is an edit of hers, and asks nothing", () => {
      editExperience(draft, lumen.id, { end: { year: 2021, month: 3 } }, ctx(later.toISOString()));
      expect(lumen.end).toMatchObject({ value: { year: 2021, month: 3 }, status: "edited" });
      expect(detectGaps(draft, later).some((gap) => gap.rule === "overlap")).toBe(false);
    });

    it("fixing it to a date that really overlaps does ask, once", () => {
      editExperience(draft, lumen.id, { end: { year: 2021, month: 7 } }, ctx(later.toISOString()));
      const overlap = detectGaps(draft, later).filter((gap) => gap.rule === "overlap");
      expect(overlap).toHaveLength(1);
      expect(questionFor(overlap[0]!, draft).text).toBe("¿Trabajaste en Nubia Retail y en Grupo Lumen a la vez?");
    });
  });
});

describe("the same session without a model", () => {
  it("keeps to her sentences, and is no worse for it", () => {
    const draft = afterTheSkeleton();
    const nubia = job(draft, "Nubia Retail");
    const created = answerNarrative(draft, asked(draft).gap, nubia.id, STORY, {}, ctx());
    expect(created.map((fact) => fact.text)).toEqual([
      "Llevo las campañas de Google Ads y Meta, el SEO de la web y preparo los informes mensuales para dirección.",
      "También coordino a la agencia que nos hace el contenido.",
    ]);
    expect(followUpGaps(draft, created, NOW).map((found) => found.rule)).toEqual(["loose_tool"]);
    expect(card(draft)).not.toBe("none");
  });
});
