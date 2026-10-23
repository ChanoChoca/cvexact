import type { CredentialReview } from "@/lib/profile/currency";
import { confirmPractical, dropLicense, setCertificationExcluded, setCertificationExpiry, setLicenseExpiry } from "@/lib/profile/credentials";
import { boundsOf, dateFromParts, type DateValue, type EndDateValue } from "@/lib/profile/dates";
import { declineThings, declinedBy, keepDeclined, withdrawDeclinedFor } from "@/lib/profile/declined";
import { placeNote, settleNote } from "@/lib/profile/capture";
import { confirmFieldAt, editContext, editedField, editFieldAt, isBlankList, isBlankText, recordChange, jsonEqual, upsertFieldAt, type EditContext } from "@/lib/profile/edit";
import { addCertification, addSkill } from "@/lib/profile/entities";
import { removeFact, setFactTransferable } from "@/lib/profile/facts";
import { standBehindJob } from "@/lib/profile/standing";
import { pickedLevel } from "@/lib/profile/language-levels";
import { isPracticalEmpty } from "@/lib/profile/practical-facts";
import type { Practical } from "@/lib/schemas/profile";
import { JOB_NOTE_MAX, STUDY_HIGHLIGHT_MAX, type CefrLevel, type Fact, type FactKind, type Metric, type SkillLevel, type StoredExperience, type StoredProfile } from "@/lib/schemas/profile-v2";
import { normalizeForComparison, skillKey } from "@/lib/text/normalize";
import type { Gap } from "./gaps";
import { addEntry, blankForm } from "./entries";
import { FIGURE_NUMBER } from "./figure";
import { takeFromTray } from "./notes";
import { splitAnswer } from "./split";
import { toolsIn } from "./tools";

/**
 * What answering a question changes in the profile.
 *
 * Each answer becomes facts or fields credited to the person who gave it, with the
 * words they used and the question they answered as its origin — nothing is
 * composed for them and no number is rounded. "No lo sé" is an answer: it is
 * recorded as an absence, so the question is not asked again and the profile does
 * not pretend to know.
 *
 * All of these edit a draft and say whether they found what they were asked
 * about; the counters of the session are kept here too, so a caller cannot answer
 * a question without it counting.
 */

const find = (draft: StoredProfile, id: string): StoredExperience | undefined => draft.experience.find((job) => job.id === id);

/**
 * A question that has been dealt with, one way or another, counts against the
 * session — the deepening ones against its budget, the one-tap ones against their
 * own limit, and the skeleton's against nothing: it is what makes a job a job.
 */
function counted(draft: StoredProfile, found: Pick<Gap, "priority" | "experienceId">): void {
  if (found.priority === "blocking") return;
  const { onboarding } = draft;
  if (found.priority === "low") {
    onboarding.askedQuick += 1;
    return;
  }
  onboarding.askedThisSession += 1;
  if (found.experienceId) {
    onboarding.askedByExperience[found.experienceId] = (onboarding.askedByExperience[found.experienceId] ?? 0) + 1;
  }
}

function upsertPending(
  draft: StoredProfile,
  key: { questionId: string; ruleId: string; entityId?: string | undefined },
  state: "later" | "skipped" | "na",
  ctx: EditContext,
): void {
  const existing = draft.pending.find((entry) => entry.questionId === key.questionId);
  if (existing) {
    existing.state = state;
    existing.count += 1;
    existing.at = ctx.now;
    return;
  }
  draft.pending.push({
    questionId: key.questionId,
    ruleId: key.ruleId,
    ...(key.entityId ? { entityId: key.entityId } : {}),
    state,
    count: 1,
    at: ctx.now,
  });
}

// --- The three ways not to answer ----------------------------------------------------------------

/**
 * "Más tarde" comes back next session; "Saltar" comes back, weighed less, and makes
 * the next question of its kind less likely; "No aplica" never comes back.
 */
export function deferQuestion(draft: StoredProfile, found: Gap, state: "later" | "skipped" | "na", ctx: EditContext = editContext()): void {
  if (found.rule === "loose_tool" && state === "na") {
    // Every tool offer shares one id, so "no aplica" on it would turn down all
    // of them for good — the ones on the card and any the person names later.
    // It is about these tools: turned down one by one, like "Ninguna".
    declineTools(draft, (found.payload.tools as string[] | undefined) ?? [], ctx);
    counted(draft, found);
    return;
  }
  upsertPending(draft, { questionId: found.id, ruleId: found.rule, entityId: found.experienceId }, state, ctx);
  if (state === "skipped") {
    const entry = draft.fatigue[found.rule] ?? { skipped: 0, unknown: 0 };
    entry.skipped += 1;
    draft.fatigue[found.rule] = entry;
  }
  counted(draft, found);
}

/**
 * Asks again what was put off, skipped or turned down. The profile is not touched —
 * only what became of the questions — and the wear that skipping put on each kind of
 * question goes with it.
 */
export function resetQuestions(draft: StoredProfile): void {
  draft.pending = [];
  draft.fatigue = {};
}

/** A question that turned out to have been answered some other way: leaves the queue, counts nothing. */
export function dropPending(draft: StoredProfile, questionId: string): void {
  draft.pending = draft.pending.filter((entry) => entry.questionId !== questionId);
}

// --- Facts ---------------------------------------------------------------------------------------

function addFact(
  draft: StoredProfile,
  job: StoredExperience,
  fact: { kind: FactKind; text: string; questionId: string; metric?: Metric },
  ctx: EditContext,
): Fact {
  const created: Fact = {
    id: ctx.newId(),
    kind: fact.kind,
    text: fact.text,
    ...(fact.metric ? { metric: fact.metric } : {}),
    source: { kind: "answer", questionId: fact.questionId, quote: fact.text.slice(0, 600), at: ctx.now },
    status: "confirmed",
  };
  job.facts.push(created);
  recordChange(draft, { op: "add", path: ["experience", job.id, "facts", created.id], label: fact.text.slice(0, 80) }, ctx);
  return created;
}

/**
 * A free answer, as the facts it says. One per sentence unless `split` — the model's
 * finer division, checked against the answer — says otherwise; either way the
 * pieces are the person's words and nothing else.
 */
export function answerNarrative(
  draft: StoredProfile,
  found: Pick<Gap, "id" | "priority" | "experienceId">,
  experienceId: string,
  text: string,
  options: { kind?: "responsibility" | "achievement"; questionId?: string; split?: (text: string) => string[] } = {},
  ctx: EditContext = editContext(),
): Fact[] {
  const job = find(draft, experienceId);
  if (!job) return [];
  const pieces = (options.split ?? splitAnswer)(text).map((piece) => piece.trim()).filter(Boolean);
  const facts = pieces.map((piece) =>
    addFact(draft, job, { kind: options.kind ?? "responsibility", text: piece, questionId: options.questionId ?? found.id }, ctx),
  );
  // An achievement is told inside the question about achievements, which counts once, when it is done.
  if (facts.length > 0 && options.kind !== "achievement") counted(draft, found);
  return facts;
}

/**
 * "Separar con tu IA": a different split of an answer already told, not a new
 * one. The old facts are archived like any removal — restorable, undoable —
 * and the new ones are credited the same way the deterministic split would
 * have credited them, to the same question. Nothing here touches the
 * session's question budget: the answer was counted once, when it was first
 * given, and a finer reading of it is not a second question.
 */
export function replaceFactsWithSplit(
  draft: StoredProfile,
  experienceId: string,
  oldFactIds: readonly string[],
  pieces: readonly string[],
  questionId: string,
  ctx: EditContext = editContext(),
): Fact[] {
  const job = find(draft, experienceId);
  if (!job || pieces.length === 0) return [];
  for (const factId of oldFactIds) removeFact(draft, experienceId, factId, ctx);
  return pieces.map((piece) => addFact(draft, job, { kind: "responsibility", text: piece, questionId }, ctx));
}

/** "Nada que destacar" is a complete answer; so is skipping every follow-up. */
export function finishAchievements(draft: StoredProfile, found: Gap, created: number, ctx: EditContext = editContext()): void {
  if (created > 0) {
    counted(draft, found);
    return;
  }
  deferQuestion(draft, found, "skipped", ctx);
}

export type FigureAnswer =
  /** `approx`: the person said it is about that much ("aprox. 150"), not a range but not exact either. */
  | { kind: "exact"; value: string; unit: string; approx?: boolean }
  | { kind: "range"; from: string; to: string; unit: string }
  | { kind: "unknown" }
  /** "En mi trabajo no se miden cifras": nothing goes on this line, and no line is asked for a figure again. */
  | { kind: "measureless" };

// A plain run of digits, or one grouped by thousands with either separator
// ("1.500.000", "1,500,000"), optionally followed by a decimal tail using
// either separator too ("1.500.000,5", "1,500.5") — kept exactly as typed,
// never reformatted or parsed as a number, so this only has to recognise the
// shape, not settle which separator means what in whose locale. The shape is
// `FIGURE_NUMBER`'s, the one the single-line figure box reads by.
const NUMBER = FIGURE_NUMBER;

/**
 * A figure as it is kept: exact, or a range that says it is approximate, or the
 * record of not knowing. Null when what was typed is not a number.
 */
export function metricFromAnswer(answer: FigureAnswer): Metric | null {
  if (answer.kind === "measureless") return null;
  if (answer.kind === "unknown") return { unknown: true };
  if (answer.kind === "exact") {
    return NUMBER.test(answer.value.trim()) ? { value: answer.value.trim(), unit: answer.unit.trim(), approx: answer.approx === true } : null;
  }
  return NUMBER.test(answer.from.trim()) && NUMBER.test(answer.to.trim())
    ? { value: `${answer.from.trim()}-${answer.to.trim()}`, unit: answer.unit.trim(), approx: true }
    : null;
}

/**
 * The figure for an achievement, kept beside its text and never written into it.
 * A range is approximate by nature and says so. Refuses what is not a number.
 *
 * Asked right after the achievement was told, it is the second half of the same
 * question and counts for nothing; asked on its own, about an achievement that came
 * from a CV, it is a question like any other.
 */
export function answerFigure(
  draft: StoredProfile,
  found: Gap,
  factId: string,
  answer: FigureAnswer,
  ctx: EditContext = editContext(),
  options: { followUp?: boolean } = {},
): boolean {
  const job = found.experienceId ? find(draft, found.experienceId) : undefined;
  const fact = job?.facts.find((entry) => entry.id === factId);
  if (!job || !fact) return false;

  if (answer.kind === "measureless") {
    // Not "no lo sé": that is a number that exists and was not known, and stays on the list of figures to add if it turns
    // up. This is a kind of work with no numbers in it — said once, for the whole profile, and taken back by asking again.
    const entry = draft.fatigue.achievement_no_figure ?? { skipped: 0, unknown: 0 };
    entry.off = true;
    draft.fatigue.achievement_no_figure = entry;
    if (!options.followUp) counted(draft, found);
    return true;
  }

  const metric = metricFromAnswer(answer);
  if (!metric) return false;
  if (answer.kind === "unknown") {
    const entry = draft.fatigue.achievement_no_figure ?? { skipped: 0, unknown: 0 };
    entry.unknown += 1;
    draft.fatigue.achievement_no_figure = entry;
  }

  const before = structuredClone(fact);
  fact.metric = metric;
  // A figure they gave is the person standing behind the task again; «no lo sé» says nothing about it.
  if (!("unknown" in metric)) fact.confirmedAt = ctx.now;
  recordChange(draft, { op: "set", path: ["experience", job.id, "facts", fact.id], before, after: fact }, ctx);
  if (!options.followUp) counted(draft, found);
  return true;
}

/** People in charge: a fact with the number the person gave, or a recorded "no". */
export function answerPeople(
  draft: StoredProfile,
  found: Gap,
  answer: { yes: boolean; count?: string },
  ctx: EditContext = editContext(),
): boolean {
  const job = found.experienceId ? find(draft, found.experienceId) : undefined;
  if (!job) return false;
  if (!answer.yes) {
    upsertPending(draft, { questionId: found.id, ruleId: found.rule, entityId: job.id }, "na", ctx);
    counted(draft, found);
    return true;
  }
  const count = answer.count?.trim() ?? "";
  if (count && !NUMBER.test(count)) return false;
  addFact(
    draft,
    job,
    {
      kind: "scope",
      text: count ? `Personas a cargo: ${count}` : "Con personas a cargo",
      questionId: found.id,
      ...(count ? { metric: { value: count, unit: "personas", approx: false } } : {}),
    },
    ctx,
  );
  counted(draft, found);
  return true;
}

/** The month of a date the person only gave the year of. "No" is recorded and not asked again. */
export function answerMonth(
  draft: StoredProfile,
  found: Gap,
  which: "start" | "end",
  month: number | null,
  ctx: EditContext = editContext(),
): boolean {
  const job = found.experienceId ? find(draft, found.experienceId) : undefined;
  if (!job) return false;
  if (month === null || month < 1 || month > 12) {
    upsertPending(draft, { questionId: found.id, ruleId: found.rule, entityId: job.id }, "na", ctx);
    counted(draft, found);
    return true;
  }
  const current = which === "start" ? job.start : job.end;
  const value: DateValue = { year: current.value.year!, month };
  const next = editedField(current, value, { isEmpty: (v) => v.year === undefined, origin: "answer", now: ctx.now });
  if (next !== current) {
    recordChange(draft, { op: "set", path: ["experience", job.id, which], before: current, after: next }, ctx);
    if (which === "start") job.start = next;
    else job.end = next;
  }
  counted(draft, found);
  return true;
}

// --- Skills and languages ----------------------------------------------------------------------------

/**
 * The tools the person confirmed become skills, with their own mention as the
 * quote; the ones they turned down are remembered and never offered again. A skill
 * is linked to the jobs whose own words name it — a literal match, not a guess.
 */
export function answerTools(draft: StoredProfile, found: Gap, accepted: readonly string[], offered: readonly string[], ctx: EditContext = editContext()): void {
  const known = new Set(draft.skills.map((skill) => skillKey(skill.name.value)));
  for (const tool of accepted) {
    const key = skillKey(tool);
    if (known.has(key)) continue;
    known.add(key);
    const jobs = draft.experience
      .filter((job) => job.facts.some((fact) => (fact.kind === "tool" ? skillKey(fact.text) === key : toolsIn(fact.text).some((named) => skillKey(named) === key))))
      .map((job) => job.id);
    const skill = {
      id: ctx.newId(),
      name: { value: tool, status: "confirmed" as const, source: { kind: "answer" as const, questionId: found.id, quote: tool, at: ctx.now } },
      experienceIds: jobs,
    };
    draft.skills.push(skill);
    recordChange(draft, { op: "add", path: ["skills", skill.id], label: tool }, ctx);
  }
  declineTools(
    draft,
    offered.filter((tool) => !accepted.some((a) => skillKey(a) === skillKey(tool))),
    ctx,
  );
  counted(draft, found);
}

/**
 * Tools the person does not want among their skills, remembered one by one so
 * none of them is offered again — and so a tool they name later, in some other
 * answer, still is.
 */
export function declineTools(draft: StoredProfile, tools: readonly string[], ctx: EditContext = editContext()): void {
  for (const tool of tools) {
    const key = skillKey(tool);
    if (key) upsertPending(draft, { questionId: `loose_tool:item:${key}`, ruleId: "loose_tool", entityId: key }, "na", ctx);
  }
}

export function answerSkillUses(draft: StoredProfile, found: Gap, skillId: string, experienceIds: readonly string[], ctx: EditContext = editContext()): boolean {
  const skill = draft.skills.find((entry) => entry.id === skillId);
  if (!skill) return false;
  if (experienceIds.length === 0) {
    upsertPending(draft, { questionId: found.id, ruleId: found.rule }, "na", ctx);
  } else {
    skill.experienceIds = [...new Set([...skill.experienceIds, ...experienceIds])];
  }
  counted(draft, found);
  return true;
}

export function answerLanguageLevel(draft: StoredProfile, found: Gap, languageId: string, level: CefrLevel | "unknown", ctx: EditContext = editContext()): boolean {
  const language = draft.languages.find((entry) => entry.id === languageId);
  if (!language) return false;
  if (level === "unknown") {
    upsertPending(draft, { questionId: found.id, ruleId: found.rule }, "na", ctx);
  } else {
    const next = editedField(language.level, pickedLevel(level), {
      isEmpty: (value) => !value.cefr && !value.raw,
      origin: "answer",
      now: ctx.now,
    });
    if (!jsonEqual(next, language.level)) {
      recordChange(draft, { op: "set", path: ["languages", language.id, "level"], before: language.level, after: next }, ctx);
      language.level = next;
    }
  }
  counted(draft, found);
  return true;
}

/**
 * The question was dealt with some way other than answering it — two jobs at once,
 * confirmed; dates corrected; the missing stretch filled in by adding something.
 * It counts as asked, and is not asked again.
 */
export function answerHandled(draft: StoredProfile, found: Gap, ctx: EditContext = editContext()): void {
  upsertPending(draft, { questionId: found.id, ruleId: found.rule }, "na", ctx);
  counted(draft, found);
}

/** Two jobs at once, confirmed: fine, and not asked about again. */
export const answerOverlap = answerHandled;

/**
 * A line the person's own document could not place, taken as the answer to the question about the job it names: "¿De qué
 * te encargabas?" takes it as a task, "¿Hubo algo que mejorara?" as an achievement. They chose it, so it is theirs and
 * confirmed, in the words it had. Counts as the question answered, and says which fact it made.
 */
export function answerFromTray(
  draft: StoredProfile,
  found: Gap,
  unassignedId: string,
  as: "task" | "achievement",
  ctx: EditContext = editContext(),
): Fact | null {
  if (!found.experienceId) return null;
  const fact = takeFromTray(draft, unassignedId, found.experienceId, as === "achievement" ? "achievement" : "responsibility", ctx);
  if (fact) counted(draft, found);
  return fact;
}

// --- Projects and the practical facts ------------------------------------------------------------------

/** A project's description holds this much; an answer cut at it says so in the box, not by losing its tail later. */
export const PROJECT_DESCRIPTION_MAX = 800;

/**
 * What the person did in a project, in their words, kept as the project's description. A project has one
 * description and no list of things done, so — unlike a job — the answer is not split: it is one piece of
 * their writing, credited to them, filled in where there was nothing. Refuses an empty answer.
 */
export function answerProject(
  draft: StoredProfile,
  found: Pick<Gap, "id" | "priority" | "experienceId">,
  projectId: string,
  text: string,
  ctx: EditContext = editContext(),
): boolean {
  const project = draft.projects.find((entry) => entry.id === projectId);
  const description = text.trim().slice(0, PROJECT_DESCRIPTION_MAX);
  if (!project || !description) return false;
  const next = editedField(project.description, description, { isEmpty: (value) => value === "", origin: "answer", now: ctx.now });
  if (next !== project.description) {
    recordChange(draft, { op: "set", path: ["projects", project.id, "description"], before: project.description, after: next }, ctx);
    project.description = next;
  }
  dropPending(draft, found.id);
  counted(draft, found);
  return true;
}

/**
 * The lines of a job the person said carry over to the kind of job they are after, marked — and their words not touched. Picking
 * none is an answer too, «Ninguna me sirve», and is put aside for good: it is the one question whose honest answer is often that
 * nothing does. Refuses a pick of lines the job does not have.
 */
export function answerTransferable(
  draft: StoredProfile,
  found: Gap,
  experienceId: string,
  factIds: readonly string[],
  ctx: EditContext = editContext(),
): boolean {
  const job = find(draft, experienceId);
  if (!job) return false;
  const picked = factIds.filter((id) => job.facts.some((fact) => fact.id === id));
  if (factIds.length > 0 && picked.length === 0) return false;
  if (picked.length === 0) {
    deferQuestion(draft, found, "na", ctx);
    return true;
  }
  for (const id of picked) setFactTransferable(draft, experienceId, id, true, ctx);
  dropPending(draft, found.id);
  counted(draft, found);
  return true;
}

/** How many points a study keeps: a line of a CV each, and a handful is what a page has room for. */
export const STUDY_POINTS_MAX = 8;

/**
 * What stands out of a study, in the person's words, kept as its points: one for each line or sentence they wrote, each as it was
 * typed — the grade too, if they gave it. Added to the points the study has, never in place of them, and a point already there is
 * not there twice. Refuses an answer with nothing in it.
 */
export function answerStudy(
  draft: StoredProfile,
  found: Pick<Gap, "id" | "priority" | "experienceId">,
  educationId: string,
  text: string,
  ctx: EditContext = editContext(),
): boolean {
  const study = draft.education.find((entry) => entry.id === educationId);
  const said = splitAnswer(text)
    .map((point) => point.slice(0, STUDY_HIGHLIGHT_MAX).trim())
    .filter(Boolean);
  if (!study || said.length === 0) return false;

  const known = new Set(study.highlights.value.map((point) => normalizeForComparison(point)));
  const added = said.filter((point) => {
    const key = normalizeForComparison(point);
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });
  const points = [...study.highlights.value, ...added].slice(0, STUDY_POINTS_MAX);
  const next = editedField(study.highlights, points, { isEmpty: isBlankList, origin: "answer", now: ctx.now });
  if (next !== study.highlights) {
    recordChange(draft, { op: "set", path: ["education", study.id, "highlights"], before: study.highlights, after: next }, ctx);
    study.highlights = next;
  }
  dropPending(draft, found.id);
  counted(draft, found);
  return true;
}

/**
 * What the person marked about how they can work: only what they marked is kept — a text left empty or
 * a switch left off says nothing, so none of it is written as a "no". Refuses an answer with nothing in it;
 * saying there is nothing to say is "No aplica", which `deferQuestion` records and never asks again.
 */
export function answerPractical(
  draft: StoredProfile,
  found: Pick<Gap, "id" | "priority" | "experienceId">,
  answer: Partial<Practical>,
  ctx: EditContext = editContext(),
): boolean {
  const current = draft.legacy.practical.value;
  const next: Practical = {
    availability: (answer.availability?.trim() || current.availability).slice(0, 200),
    driverLicense: (answer.driverLicense?.trim() || current.driverLicense).slice(0, 80),
    workEligibility: (answer.workEligibility?.trim() || current.workEligibility).slice(0, 200),
    ownVehicle: answer.ownVehicle === true || current.ownVehicle,
    willingToRelocate: answer.willingToRelocate === true || current.willingToRelocate,
  };
  if (isPracticalEmpty(next)) return false;
  const field = editedField(draft.legacy.practical, next, { isEmpty: isPracticalEmpty, origin: "answer", now: ctx.now });
  if (field !== draft.legacy.practical) {
    recordChange(draft, { op: "set", path: ["legacy", "practical"], before: draft.legacy.practical, after: field }, ctx);
    draft.legacy.practical = field;
  }
  // Put off before, and answered now: it is no longer a pending question.
  dropPending(draft, found.id);
  counted(draft, found);
  return true;
}

// --- What has a date on it ------------------------------------------------------------------------------------

/** The credential a question about a date is about: the one it names, which the profile may no longer have. */
const subjectOf = (found: Pick<Gap, "payload">): CredentialReview["subject"] | null => {
  const subject = found.payload.subject as CredentialReview["subject"] | undefined;
  return subject && (subject.kind === "license" || (subject.kind === "certification" && typeof subject.id === "string")) ? subject : null;
};

/**
 * «¿Hiciste la renovación?», answered with the new date: it is kept as the date the credential holds until, which is the person
 * standing behind it again. «No sé hasta cuándo» (`null`) takes the date off — a credential with no date is not asked after, and
 * the person did renew it, which is what they were asked. False when the credential is gone, or the date is not one.
 */
export function answerRenewal(
  draft: StoredProfile,
  found: Pick<Gap, "id" | "priority" | "experienceId" | "payload">,
  expires: DateValue | null,
  ctx: EditContext = editContext(),
): boolean {
  const subject = subjectOf(found);
  if (!subject) return false;
  // A date with a month and no year is not one: it is asked for again, not saved as «mayo» of no year.
  if (expires !== null && expires.year === undefined) return false;
  const ok = subject.kind === "license" ? setLicenseExpiry(draft, expires, ctx, "answer") : setCertificationExpiry(draft, subject.id, expires, ctx, "answer");
  if (!ok) return false;
  dropPending(draft, found.id);
  counted(draft, found);
  return true;
}

/**
 * «Ya no corresponde»: the credential is no longer theirs. A certificate stays in the profile and goes in no CV — the same as any
 * other thing they set aside (`excluded`); a licence goes from what they said about how they can work, with its date. Either way it
 * can be undone, and neither is asked about again: there is no date left to ask after.
 */
export function answerNoLonger(draft: StoredProfile, found: Pick<Gap, "id" | "priority" | "experienceId" | "payload">, ctx: EditContext = editContext()): boolean {
  const subject = subjectOf(found);
  if (!subject) return false;
  const ok = subject.kind === "license" ? dropLicense(draft, ctx) : setCertificationExcluded(draft, subject.id, true, ctx);
  if (!ok) return false;
  dropPending(draft, found.id);
  counted(draft, found);
  return true;
}

/**
 * «Sigue igual»: what they said about how they can work still holds — or they have just changed it where it stands, which comes to the
 * same. The day is what is kept, and the question is not asked again until it has gone as long as it did the first time.
 */
export function answerConditions(draft: StoredProfile, found: Pick<Gap, "id" | "priority" | "experienceId">, ctx: EditContext = editContext()): boolean {
  confirmPractical(draft, ctx);
  dropPending(draft, found.id);
  counted(draft, found);
  return true;
}

/**
 * «Cambió algo»: what they now say about how they can work, in place of what they said before — corrected in the card and sent with
 * «Listo», not edited in the profile as each field is touched, because the first edit would be the person standing behind it and the
 * question would be gone from under their hands. A correction that ends where it began is the same as saying it still holds. Clearing
 * all of it is a way to say there is nothing to say any more, and it is accepted as that.
 */
export function answerConditionsChanged(draft: StoredProfile, found: Pick<Gap, "id" | "priority" | "experienceId">, next: Practical, ctx: EditContext = editContext()): boolean {
  const clean: Practical = {
    availability: next.availability.trim().slice(0, 200),
    driverLicense: next.driverLicense.trim().slice(0, 80),
    workEligibility: next.workEligibility.trim().slice(0, 200),
    ownVehicle: next.ownVehicle === true,
    willingToRelocate: next.willingToRelocate === true,
  };
  editFieldAt(draft, ["legacy", "practical"], clean, isPracticalEmpty, ctx, "answer");
  confirmPractical(draft, ctx);
  dropPending(draft, found.id);
  counted(draft, found);
  return true;
}

// --- A job that is going on ------------------------------------------------------------------------------------

/** A job they started: where, as what, and from when — what a form that adds one asks, and nothing else. */
export type NewJob = { company: string; role: string; start: DateValue };

export type CurrentJobAnswer = {
  /**
   * Still there — with the role or the company corrected where it stands, when what was written was wrong, and left out for what was not —;
   * over, since this date, and the job they went on to, when they went on to one; or changed: another role at the same place, or another place,
   * which is a job of its own that starts when the other ends. A date is a month and a year, or a year alone: what is kept is what was said.
   */
  status:
    | { kind: "still"; role?: string; company?: string }
    | { kind: "ended"; end: DateValue; next?: NewJob }
    | { kind: "moved"; next: NewJob };
  /** What happened in the time since, in their own words: duties, results, a course. Empty when nothing — which is an answer as complete as any. */
  news: string;
};

/** What an answer to «¿Seguís en…?» kept: the lines they told, and the job they went on to when there was one. */
export type CurrentJobResult = { facts: Fact[]; newJob?: StoredExperience };

const isBlankEnd = (value: EndDateValue): boolean => value.year === undefined && !value.raw && !value.current;

/** A job that can be started: it says where or as what, and from which year. */
const startable = (job: NewJob): boolean => (job.company.trim() !== "" || job.role.trim() !== "") && job.start.year !== undefined;

/**
 * «¿Seguís en…?», and what happened since. Still there: the day they stood behind the job is today, and what was wrong in it — the role, the
 * company — is kept as they corrected it. Over: the date it ended, which is the end of a job that was going on — and the job they started, when they
 * started one, as an entry of its own. Changed: the role they have now, there or somewhere else, is a new job from the date they say, and the one
 * before it ends that month: the company is never written over the one that was, which is the history of where they worked.
 *
 * What they add of the time since is told as their own lines, one for each sentence, credited to this question, and goes where it happened: to the
 * job they went on to when they went on to one, and to this one when not. All of it is one answer and counts once.
 *
 * Refuses a date with no year — a month alone is not a date —, an end before the start, and a new job that says neither where nor what. Nothing is
 * kept of a refused answer.
 */
export function answerCurrentJob(
  draft: StoredProfile,
  found: Pick<Gap, "id" | "priority" | "experienceId">,
  answer: CurrentJobAnswer,
  ctx: EditContext = editContext(),
): CurrentJobResult | false {
  const job = found.experienceId ? find(draft, found.experienceId) : undefined;
  if (!job) return false;
  const at = ["experience", job.id];
  const status = answer.status;
  let newJob: StoredExperience | undefined;

  if (status.kind === "still") {
    const role = status.role?.trim();
    const company = status.company?.trim();
    if (role) editFieldAt(draft, [...at, "role"], role, isBlankText, ctx, "answer");
    if (company) editFieldAt(draft, [...at, "company"], company, isBlankText, ctx, "answer");
    standBehindJob(draft, job.id, ctx.now);
  } else {
    // It ends the day it was said to, or — when they changed — the month the next one starts.
    const end = status.kind === "ended" ? status.end : status.next.start;
    const next = status.next;
    if (end.year === undefined) return false;
    const ended = dateFromParts(end.year, end.month);
    const from = boundsOf(job.start.value);
    const to = boundsOf(ended);
    if (from && to && to.max < from.min) return false;
    if (next && !startable(next)) return false;
    editFieldAt(draft, [...at, "end"], ended as EndDateValue, isBlankEnd, ctx, "answer");
    if (next) {
      const id = addEntry(draft, { ...blankForm("job"), what: next.role, where: next.company, from: next.start, current: true }, { newId: ctx.newId, now: ctx.now });
      newJob = id ? find(draft, id) : undefined;
    }
  }

  const facts: Fact[] = [];
  const where = newJob ?? job;
  for (const piece of splitAnswer(answer.news).map((text) => text.trim()).filter(Boolean)) {
    facts.push(addFact(draft, where, { kind: "responsibility", text: piece, questionId: found.id }, ctx));
  }
  dropPending(draft, found.id);
  counted(draft, found);
  return { facts, ...(newJob ? { newJob } : {}) };
}

// --- The objective ----------------------------------------------------------------------------------------

/**
 * What kind of job they are after. Asked as a question of the session (`found`) it counts against
 * it like any other; typed into the profile it is only an edit. Not wanting to say is the card's
 * "No aplica" — `deferQuestion` — and puts it out of the queue the same way.
 */
export function answerObjective(draft: StoredProfile, text: string, ctx: EditContext = editContext(), found?: Pick<Gap, "priority" | "experienceId">): void {
  const value = text.trim();
  if (!value) return;
  const next = editedField(draft.objective, value, { isEmpty: (v) => v === "", origin: "answer", now: ctx.now });
  if (next !== draft.objective) {
    recordChange(draft, { op: "set", path: ["objective"], before: draft.objective, after: next }, ctx);
    draft.objective = next;
  }
  dropPending(draft, "objective");
  if (found) counted(draft, found);
}

// --- What an offer asked ------------------------------------------------------------------------------------

/**
 * The one question a posting puts (`lib/jobs/requirement-ask.ts`) is dealt with whichever way — yes, no, not now — and counts against the session
 * like any other, so that an offer cannot ask what the onboarding would not. The answers below count themselves; a tool or a task said yes to goes
 * through the line the person writes (`/postular`, `claimGap`), which is not one of them, and is counted with this.
 */
export function countOffered(draft: StoredProfile): void {
  counted(draft, { priority: "medium" });
}

/**
 * «Sí, lo usé» or «Sí, lo hice», to a tool or a task an offer asked for: the line they wrote, in their words and not the offer's, as a task of the
 * job they chose — and a tool also among their skills, linked to that job. With no job to put it in, a task is a note and a tool is a skill alone.
 * What the offer said and how the question was worded are not kept. A «no» they had said to it is taken back. False for a line with nothing in it.
 *
 * The same thing the posting's panel does when someone says they did use what it asks for (`claimGap`, in the wizard), for whoever asks outside it:
 * the engine's own question about what comes up in several offers, and the one about what they were asked at an interview.
 */
export function answerOfferedClaim(
  draft: StoredProfile,
  found: { kind: "tool" | "task"; thing: string },
  where: string,
  jobId: string | null,
  ctx: EditContext = editContext(),
): boolean {
  const line = where.trim();
  if (!line) return false;
  const job = jobId ? find(draft, jobId) : undefined;
  if (job) addFact(draft, job, { kind: "responsibility", text: line, questionId: `offer:${skillKey(found.thing)}` }, ctx);
  else draft.notes.push({ id: ctx.newId(), text: line.slice(0, 2000), at: ctx.now });
  if (found.kind === "tool") addSkill(draft, found.thing, ctx, job?.id);
  withdrawDeclinedFor(draft, "requirement", [found.thing], ctx);
  counted(draft, { priority: "medium" });
  return true;
}

/**
 * «Sí, la tengo», to a credential the offer asked for: what they hold, with the month it lapses if they say, kept as a certification of their
 * own — the name they type, never the offer's words. A «no» they had said to it is taken back. False for a name with nothing in it.
 */
export function answerOfferedCredential(
  draft: StoredProfile,
  values: { name: string; expires?: DateValue },
  thing: string,
  ctx: EditContext = editContext(),
): boolean {
  if (!addCertification(draft, values, ctx)) return false;
  withdrawDeclinedFor(draft, "requirement", [thing], ctx);
  counted(draft, { priority: "medium" });
  return true;
}

/**
 * «Sí», to a condition the offer asked for — a licence, a vehicle, an availability, a permit: kept with the rest of how they can work, in what
 * they typed. What they did not say is not touched, and nothing is written as a «no». False when there was nothing in the answer.
 */
export function answerOfferedConditions(draft: StoredProfile, answer: Partial<Practical>, thing: string, ctx: EditContext = editContext()): boolean {
  if (!answerPractical(draft, { id: `offer:${skillKey(thing)}`, priority: "medium" }, answer, ctx)) return false;
  withdrawDeclinedFor(draft, "requirement", [thing], ctx);
  return true;
}

/** «No», to what the offer asked: a «no» with its day, in the profile — the same one «No lo tengo» makes in the panel — and not asked again in the next posting. */
export function declineOffered(draft: StoredProfile, thing: string, fragment: string, ctx: EditContext = editContext()): void {
  declineThings(draft, "requirement", [thing], { quote: fragment }, ctx);
  counted(draft, { priority: "medium" });
}

/** The second asking, answered: the «no» is kept as it was said, and it is not asked a third time. */
function keepNo(draft: StoredProfile, thing: string, ctx: EditContext): void {
  const said = declinedBy(draft, "requirement", thing);
  if (said) keepDeclined(draft, said.id, ctx);
}

/**
 * «Ahora no»: this posting only, and it says nothing of whether they have it — also the second time, a year after a «no». It is not an answer, so it is
 * not kept as one: the «no» stays as it was, to be asked once more the next time an offer asks for the same, and only «Sigue siendo no» ends it. A button
 * that says «ahora no» that is kept as «no» for good is a decision taken for the person and not told to them.
 */
export function putOffOffered(draft: StoredProfile): void {
  counted(draft, { priority: "medium" });
}

/** «Sigue siendo no»: the second asking, answered the same. That was the last. */
export function keepOffered(draft: StoredProfile, thing: string, ctx: EditContext = editContext()): void {
  keepNo(draft, thing, ctx);
  counted(draft, { priority: "medium" });
}

// --- What they wrote down, and what nothing backs (O15, O17) ------------------------------------------------

/**
 * «Sí, va ahí»: the sentences of a note they wrote down, made tasks of the job it names — in the words it was written in, credited to them —
 * and the note dealt with: it is no longer «sin ordenar» and is not asked about again. False when nothing was ticked, or there was nothing to add.
 */
export function answerNotePlaced(
  draft: StoredProfile,
  found: Pick<Gap, "id" | "priority" | "experienceId">,
  noteId: string,
  jobId: string,
  sentences: readonly string[],
  ctx: EditContext = editContext(),
): boolean {
  if (!placeNote(draft, noteId, jobId, sentences, ctx)) return false;
  dropPending(draft, found.id);
  counted(draft, found);
  return true;
}

/** «No va ahí»: the note stays as the note it is — dealt with, not asked about again, and nothing is written from it. */
export function answerNoteLeft(draft: StoredProfile, found: Pick<Gap, "id" | "priority" | "experienceId">, noteId: string, ctx: EditContext = editContext()): boolean {
  settleNote(draft, noteId, ctx);
  dropPending(draft, found.id);
  counted(draft, found);
  return true;
}

/**
 * «Sí, la sigo usando»: the person stands behind the skill again, today. The skill is not touched — only the day they last said it holds changes,
 * and that is what the next question about it counts from. False when there is no such skill.
 */
export function answerSkillUsed(draft: StoredProfile, found: Pick<Gap, "id" | "priority" | "experienceId">, skillId: string, ctx: EditContext = editContext()): boolean {
  if (!confirmFieldAt(draft, ["skills", skillId, "name"], ctx.now)) return false;
  dropPending(draft, found.id);
  counted(draft, found);
  return true;
}

/**
 * The reason for a short stay, or for the pause before a job, as the person wrote it: the job's note, a line of the CV that is theirs and nobody
 * else's. An edit like any other — it keeps what it replaced, and can be undone. False when there is no such job or nothing was written.
 */
export function answerReason(draft: StoredProfile, found: Gap, jobId: string, text: string, ctx: EditContext = editContext()): boolean {
  const note = text.replace(/\s+/g, " ").trim().slice(0, JOB_NOTE_MAX);
  if (!note || !upsertFieldAt(draft, ["experience", jobId, "note"], note, isBlankText, ctx)) return false;
  // Settled either way: a short stay stops being one once it has its note, but a pause stays a pause, and asking after it again would not be listening.
  answerHandled(draft, found, ctx);
  return true;
}

/**
 * How well they know their skills, as far as they marked: each mark an edit of that skill, and the question settled whether they marked all of
 * them or some — what they left alone stays unmarked, and is not asked again. False when nothing was marked.
 */
export function answerSkillLevels(draft: StoredProfile, found: Gap, levels: Readonly<Record<string, SkillLevel>>, ctx: EditContext = editContext()): boolean {
  let marked = 0;
  for (const [skillId, level] of Object.entries(levels)) {
    if (upsertFieldAt(draft, ["skills", skillId, "level"], level, (value) => !value, ctx)) marked += 1;
  }
  if (marked === 0) return false;
  answerHandled(draft, found, ctx);
  return true;
}

/**
 * «Sí, “RN” es React Native»: the skill is called by its whole name, an edit of the name that keeps what it was written as, so that undoing
 * it brings the initials back. Where it is linked and when it was last stood behind do not change. False when there is no such skill.
 */
export function answerAbbreviation(draft: StoredProfile, found: Pick<Gap, "id" | "priority" | "experienceId">, skillId: string, name: string, ctx: EditContext = editContext()): boolean {
  if (!editFieldAt(draft, ["skills", skillId, "name"], name, isBlankText, ctx)) return false;
  dropPending(draft, found.id);
  counted(draft, found);
  return true;
}
