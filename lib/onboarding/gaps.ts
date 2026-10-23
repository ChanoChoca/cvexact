import type { RepeatedRequirement } from "@/lib/jobs/repeated";
import { boundsOf, dateKey, monthIndex, type Bounds, type DateValue, type EndDateValue } from "@/lib/profile/dates";
import { conditionsReview, credentialReviews, currentJobReviews, type ConditionsReview, type CredentialReview } from "@/lib/profile/currency";
import { wordsOf } from "@/lib/parse/dictionaries";
import { placeableNotes } from "@/lib/profile/capture";
import { isPracticalEmpty } from "@/lib/profile/practical-facts";
import { staleGapId, staleSkills } from "@/lib/profile/staleness";
import { jobsByRecency, studiesByRecency } from "@/lib/profile/timeline";
import { isMeaningfulExperience, type Fact, type StoredEducation, type StoredExperience, type StoredProfile } from "@/lib/schemas/profile-v2";
import { skillKey } from "@/lib/text/normalize";
import { ENGINE, PRIORITY, WEIGHT, type Priority, type RuleId } from "./config";
import { statesQuantity } from "./figure";
import { IMPACTS, coveredImpacts, isResultFact, type Impact } from "./results";
import { ABBREVIATED_SKILLS, declinedToolKeys, mentionsSkill, toolsIn } from "./tools";
import { vagueScaleIn } from "./vague";

/**
 * What the profile is missing, and which of it is worth asking about now.
 *
 * Everything here is arithmetic on the profile: no model decides what to ask,
 * which is what makes the questions the same for the same profile, testable, and
 * free. The pieces are separate because they change for different reasons —
 * `detectGaps` says what is absent, `priorityOf` how much it matters, and
 * `eligibleGaps` what this person, in this session, can be asked without being
 * pestered.
 */

export type Gap = {
  /** Stable for the same gap across sessions: what `pending` and the fatigue counters key on. */
  id: string;
  rule: RuleId;
  priority: Priority;
  /** The job the gap is about, when it is about one. */
  experienceId?: string;
  /** Rule-specific facts the question needs: which fields are missing, which tools, the span. */
  payload: Record<string, unknown>;
};

/**
 * What the engine is told that the profile does not hold: things about the person's search, which live apart from the profile — the offers they
 * analysed — and that whoever asks (`QuestionLoop`) reads and passes in. Nothing, until a caller has them: the engine on its own, and everything
 * that asks it for a count (`tasks.ts`, `return.ts`, `first-value.ts`), sees the profile and only the profile.
 */
export type Signals = {
  /** A thing that several of the offers they analysed ask for (O10): off unless the experiment is on (`lib/experiments.ts`). */
  repeated?: RepeatedRequirement | null | undefined;
  /** The notes they wrote down are offered to the job they name (O15): only when «Anotá algo» is on. */
  capture?: boolean | undefined;
  /** A skill that nothing has backed for years is asked about (O17): only when that is on. */
  stale?: boolean | undefined;
  /** The CV they are looking at came out short because the profile has little to put on it (`thin_cv`): what else there is to list is asked, whatever they already have. */
  thin?: boolean | undefined;
};

export type Session = {
  askedThisSession: number;
  askedQuick: number;
  askedByExperience: Record<string, number>;
  startedAt: string;
};

/** A visit that has just begun: nothing asked yet, and nothing put off "until later" that still counts as this visit's. */
export const NO_SESSION: Session = { askedThisSession: 0, askedQuick: 0, askedByExperience: {}, startedAt: "" };

/**
 * The three things a job cannot go without, in the order they are asked: when, then where, then what. Each is its own
 * question, with its own id, so that "Dejarlo así" on the year somebody does not know turns down the year and not the
 * company and the role that they do.
 */
export const SKELETON_FIELDS = ["start", "company", "role"] as const;
export type SkeletonField = (typeof SKELETON_FIELDS)[number];

/**
 * The id of the question about one credential's date. The date is in it, on purpose: «No aplica» turns down *this* lapse, and
 * a credential renewed to a new date — which lapses again in years — is a new question, not one the person already put aside.
 */
export const credentialGapId = (review: Pick<CredentialReview, "subject" | "expires">): string =>
  review.subject.kind === "certification"
    ? `credential_expiry:cert:${review.subject.id}:${dateKey(review.expires)}`
    : `credential_expiry:license:${dateKey(review.expires)}`;

/**
 * The id of the question about a job that is going on: «¿Seguís en…?». The month of the last time it was looked at is in it, on purpose —
 * «No aplica» turns down *this* review, and a job looked at again, which is asked about again in six months, is a new question.
 */
export const currentJobGapId = (jobId: string, since: string): string => `current_job_review:${jobId}:${since.slice(0, 7)}`;

/**
 * The id of the question about how they can work: «¿Sigue igual lo que anotaste para trabajar?». The month of the last time they stood behind it is in it,
 * on purpose, like the others: «No aplica» turns down *this* review, and what is said again — which is asked about again when it has gone as long — is a new
 * question. With an id that never changed, one «No aplica» silenced it for good, and nothing on the screen said so.
 */
export const conditionsGapId = (review: Pick<ConditionsReview, "since">): string => `conditions_review:${review.since.slice(0, 7)}`;
export const notePlaceGapId = (noteId: string): string => `note_to_place:${noteId}`;

/** The id of the question about a thing that repeats in the offers: by what it is counted by, so that it is one question however many offers say it. */
export const repeatedGapId = (found: Pick<RepeatedRequirement, "key">): string => `repeated_requirement:${found.key}`;

const gap = (rule: RuleId, id: string, experienceId: string | undefined, payload: Record<string, unknown> = {}): Gap => ({
  id,
  rule,
  priority: PRIORITY[rule],
  ...(experienceId ? { experienceId } : {}),
  payload,
});

/**
 * The question about one credential's date, built from the review that asks it: what a screen needs to settle it where it says it
 * (the page of an application, with the CV in front) without going through the engine, which would ask it in its own turn and place.
 */
export const credentialGap = (review: CredentialReview): Gap =>
  gap("credential_expiry", credentialGapId(review), undefined, {
    subject: review.subject,
    name: review.name,
    expires: review.expires,
    lapsed: review.expiry.state === "lapsed",
    days: review.expiry.days,
  });

// --- Reading the profile ---------------------------------------------------------------------

const monthNow = (now: Date) => now.getFullYear() * 12 + now.getMonth();

/** The middle of what a date can be: the month itself when there is one, the middle of the year when there is not. */
const middle = (bounds: Bounds) => (bounds.min + bounds.max) / 2;

type Span = { start: Bounds; end: Bounds; from: DateValue; to: EndDateValue; jobId?: string };

function spanOf(start: DateValue, end: EndDateValue, now: Date): Span | null {
  const from = boundsOf(start);
  const to = end.current ? { min: monthNow(now), max: monthNow(now) } : boundsOf(end);
  return from && to ? { start: from, end: to, from: start, to: end } : null;
}

/** Jobs that are short by nature: an internship, a freelance, a contract, or something that is not employment. */
const SHORT_BY_NATURE: ReadonlySet<string> = new Set(["internship", "freelance", "contract", "volunteer", "teaching", "research", "student_org"]);

/**
 * A job that began and ended within a year, by the months both dates say: a bare year does not say how long it lasted, and a question that
 * called a whole year «poco tiempo» would be inventing it. Months are counted as the CV prints them, both ends included.
 */
function isShortStint(job: StoredExperience, now: Date): boolean {
  const { start, end } = job;
  if (end.value.current || start.value.month === undefined || end.value.month === undefined) return false;
  if (SHORT_BY_NATURE.has(job.employmentType?.value ?? "")) return false;
  const from = monthIndex(start.value);
  const to = monthIndex(end.value);
  return from !== null && to !== null && to - from + 1 < ENGINE.shortStint.months && (yearsSinceEnd(job, now) ?? Infinity) <= ENGINE.shortStint.withinYears;
}

/** Facts that say what the person did: not the tools listed beside them. */
export const contentFacts = (job: StoredExperience): Fact[] =>
  job.facts.filter((fact) => fact.kind !== "tool" && fact.text.trim() !== "");

const label = (job: StoredExperience): string => job.company.value.trim() || job.role.value.trim();

/** Years since the job ended; 0 for one that is going on; `null` when nobody can say. */
export function yearsSinceEnd(job: StoredExperience, now: Date): number | null {
  if (job.end.value.current) return 0;
  const end = monthIndex(job.end.value);
  return end === null ? null : Math.max(0, (monthNow(now) - end) / 12);
}

function recencyOf(job: StoredExperience, now: Date): number {
  const years = yearsSinceEnd(job, now);
  // A job with no readable end is treated as recent: not knowing is no reason to ask less.
  if (years === null) return 0.8;
  return ENGINE.recency.find((band) => years <= band.upToYears)!.factor;
}

const PEOPLE_ROLE = /\b(jef[ea]|gerente|director[a]?|coordinador[a]?|responsable|l[ií]der|lead|head|manager|supervisor[a]?|encargad[oa]|capataz|team\s*lead|subgerente|jefe de)\b/i;
/**
 * Words that say the person led people. Coordinating an agency or a supplier is not
 * among them: those are other companies, not people in charge, and treating them as
 * the answer would skip the question a manager most needs to be asked.
 */
const TEAM_MENTION = /\b(equipo|equipos|team|personas a cargo|a cargo de|reportes directos|direct reports|supervis\w*|dirig\w*|lider\w*)\b/i;
/** A role that says it is not one that leads: an objective of leading says nothing about it. */
const JUNIOR_ROLE = /\b(asistente|auxiliar|pasante|pr[aá]cticas?|practicante|becari[oa]|beca|intern|internship|trainee|junior|jr|aprendiz|ayudante|cadete)\b/i;
const MANAGEMENT_OBJECTIVE = /\b(jef[ea]|gerente|director|coordinador|responsable|l[ií]der|lead|head|manager|supervisor|encargado)\b/i;

/**
 * Whether the person has already been through the kinds of change for this
 * job: told an achievement from them — its answer carries the question's id
 * — or said there was nothing to highlight. Either way, "¿algo más?" would be
 * the same list shown again.
 */
function answeredWhatImproved(job: StoredExperience, profile: StoredProfile): boolean {
  const asked = [`no_achievements:${job.id}`, `more_achievements:${job.id}`];
  return (
    job.facts.some((fact) => fact.source.kind === "answer" && asked.some((id) => fact.source.questionId?.startsWith(`${id}:`))) ||
    profile.pending.some((entry) => entry.state === "na" && asked.includes(entry.questionId))
  );
}

/**
 * What "¿algo más?" is about, for a job whose lines already tell results: the
 * kinds of change they cover and which results they are, so the question can
 * show both instead of offering again what the person already said. Nothing
 * when there is no result yet (that is `no_achievements`), when the results
 * already cover every kind, or when the person has already answered it.
 */
function moreToTell(job: StoredExperience, profile: StoredProfile, results: readonly Fact[]): { covered: Impact[]; factIds: string[] } | null {
  if (results.length === 0 || answeredWhatImproved(job, profile)) return null;
  const covered = coveredImpacts(results);
  if (covered.length === IMPACTS.length) return null;
  return { covered, factIds: results.map((fact) => fact.id) };
}

/** How many words a line has, as a person counts them. */
const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * A job told in one line, or in lines too short to say what was done («Atención al público», «Caja»): not nothing, which is
 * `no_content`, but not enough to read either. Never one that tells a result — that is what a CV leans on — and not once
 * the person has answered it: a second short line is what they have to say, and asking again is not listening.
 */
function isThin(job: StoredExperience, content: readonly Fact[], now: Date): boolean {
  if (content.length === 0 || content.some(isResultFact)) return false;
  if ((yearsSinceEnd(job, now) ?? 0) > ENGINE.thinContent.withinYears) return false;
  const answered = job.facts.some((fact) => fact.source.kind === "answer" && fact.source.questionId?.startsWith(`thin_content:${job.id}`));
  if (answered) return false;
  return content.length === 1 || content.every((fact) => wordCount(fact.text) < ENGINE.thinContent.shortWords);
}

const STOPWORDS = new Set(["de", "la", "el", "en", "y", "a", "un", "una", "los", "las", "del", "para", "con", "por", "the", "of", "and", "in", "at"]);

const contentWords = (text: string) => wordsOf(text).filter((word) => word.length > 2 && !STOPWORDS.has(word));

// --- Detecting gaps ------------------------------------------------------------------------------

export function detectGaps(profile: StoredProfile, now: Date = new Date(), signals: Signals = {}): Gap[] {
  const gaps: Gap[] = [];
  const jobs = profile.experience.filter(isMeaningfulExperience);
  const objective = profile.objective.value.trim();
  const skillNames = new Set(profile.skills.map((skill) => skillKey(skill.name.value)));

  for (const job of jobs) {
    const jobLabel = label(job);

    // Blocking: a job needs a company, a role and a start before anything else about it is worth asking. One question
    // for each that is missing, so that putting one of them aside leaves the others to be asked.
    const lacks: Record<SkeletonField, boolean> = {
      start: job.start.value.year === undefined,
      company: !job.company.value.trim(),
      role: !job.role.value.trim(),
    };
    for (const field of SKELETON_FIELDS) {
      if (lacks[field]) gaps.push(gap("incomplete_skeleton", `incomplete_skeleton:${job.id}:${field}`, job.id, { missing: [field] }));
    }

    const content = contentFacts(job);
    // A line that already reports a result is the answer to "what improved?":
    // what it may still lack is its figure, asked about that line by name, and
    // any other kind of change it does not tell — asked as "¿algo más?".
    const results = content.filter(isResultFact);
    if (content.length === 0) {
      gaps.push(gap("no_content", `no_content:${job.id}`, job.id));
    } else if (results.length === 0) {
      gaps.push(gap("no_achievements", `no_achievements:${job.id}`, job.id));
    } else {
      const more = moreToTell(job, profile, results);
      if (more) gaps.push(gap("more_achievements", `more_achievements:${job.id}`, job.id, more));
    }

    for (const fact of results) {
      // A year is not a figure: "Aumenté las ventas en 2022" still has no "how much".
      const hasFigure = statesQuantity(fact.text);
      if (!fact.metric && !hasFigure) {
        gaps.push(gap("achievement_no_figure", `achievement_no_figure:${job.id}:${fact.id}`, job.id, { factId: fact.id }));
      }
    }

    // A line that says «muchos clientes» and not how many: the same figure, asked about a duty. Not a line that reports a
    // result (that one is asked above), and not one that already has a number in it or beside it.
    for (const fact of content) {
      if (isResultFact(fact) || fact.metric || statesQuantity(fact.text)) continue;
      const vague = vagueScaleIn(fact.text);
      if (vague) gaps.push(gap("vague_scale", `vague_scale:${job.id}:${fact.id}`, job.id, { factId: fact.id, phrase: vague.phrase, flavor: vague.flavor }));
    }

    if (isThin(job, content, now)) gaps.push(gap("thin_content", `thin_content:${job.id}`, job.id, { lines: content.length }));

    // A short stay the person has not said anything about: a line on the CV that tells why, in their words, or nothing.
    if (!job.note?.value.trim() && isShortStint(job, now)) gaps.push(gap("short_stint", `short_stint:${job.id}`, job.id));

    const impliesPeople =
      PEOPLE_ROLE.test(job.role.value) ||
      (MANAGEMENT_OBJECTIVE.test(objective) && !JUNIOR_ROLE.test(job.role.value) && jobIsRelevant(job, objective));
    const knowsPeople = job.facts.some((fact) => fact.kind === "scope") || content.some((fact) => TEAM_MENTION.test(fact.text));
    if (impliesPeople && !knowsPeople) gaps.push(gap("scope_unknown", `scope_unknown:${job.id}`, job.id));

    // A year with no month, close enough to now that the month is still remembered.
    for (const which of ["start", "end"] as const) {
      const field = which === "start" ? job.start : job.end;
      const value = field.value;
      if (value.year === undefined || value.month !== undefined || (which === "end" && job.end.value.current)) continue;
      // A year the person entered themselves, with the month selector in front of them and "Mes (no sé)" to choose, is a
      // month they do not have to hand: it was already answered, there, and asking is asking them to say it again. Only
      // what a document said by year is asked — the document did not know either, but the person might.
      if (field.source?.kind === "manual") continue;
      if (now.getFullYear() - value.year <= ENGINE.impreciseWithinYears) {
        gaps.push(gap("imprecise_date", `imprecise_date:${job.id}:${which}`, job.id, { which, year: value.year, label: jobLabel }));
      }
    }
  }

  // Two jobs at once.
  for (let i = 0; i < jobs.length; i++) {
    for (let j = i + 1; j < jobs.length; j++) {
      const a = jobs[i]!;
      const b = jobs[j]!;
      const spanA = spanOf(a.start.value, a.end.value, now);
      const spanB = spanOf(b.start.value, b.end.value, now);
      if (!spanA || !spanB) continue;
      // A bare year is read as the middle of it: years that only meet do not overlap, years that share a stretch do.
      const overlap = Math.min(middle(spanA.end), middle(spanB.end)) - Math.max(middle(spanA.start), middle(spanB.start));
      if (overlap > ENGINE.overlapToleranceMonths) {
        const [first, second] = [a.id, b.id].sort();
        gaps.push(gap("overlap", `overlap:${first}:${second}`, undefined, { a: a.id, b: b.id, months: overlap }));
      }
    }
  }

  // Tools named in the person's own words that their skills do not list.
  const named: string[] = [];
  for (const job of jobs) {
    for (const fact of job.facts) {
      const tools = fact.kind === "tool" ? [fact.text.trim()] : toolsIn(fact.text);
      for (const tool of tools) if (tool) named.push(tool);
    }
  }
  const declined = declinedToolKeys(profile.pending);
  const seen = new Set<string>();
  const loose = named.filter((tool) => {
    const key = skillKey(tool);
    if (skillNames.has(key) || declined.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (loose.length > 0) gaps.push(gap("loose_tool", "loose_tool:all", undefined, { tools: loose.slice(0, 8) }));

  // A skill nobody has said where it was used — and no job's own lines name
  // either: "¿Dónde usaste PostgreSQL?" under "Optimicé consultas en PostgreSQL"
  // would be asking what the profile already says.
  if (jobs.length > 0) {
    const jobIds = new Set(jobs.map((job) => job.id));
    const lines = jobs.flatMap((job) => job.facts.map((fact) => fact.text));
    for (const skill of profile.skills) {
      if (!skill.name.value.trim()) continue;
      if (skill.experienceIds.some((id) => jobIds.has(id))) continue;
      if (mentionsSkill(lines, skill.name.value)) continue;
      gaps.push(gap("skill_unused", `skill_unused:${skill.id}`, undefined, { skillId: skill.id, name: skill.name.value }));
    }
  }

  // A skill written as its initials: whether it is the whole name, asked once. Not where the person lists the whole name as well.
  for (const skill of profile.skills) {
    const abbreviation = ABBREVIATED_SKILLS[skillKey(skill.name.value)];
    if (!abbreviation || skillNames.has(skillKey(abbreviation.means))) continue;
    gaps.push(gap("abbreviated_skill", `abbreviated_skill:${skill.id}`, undefined, { skillId: skill.id, short: skill.name.value.trim(), ...abbreviation }));
  }

  // How well they know their skills: asked once, for all of them, and only while none is marked.
  const listed = profile.skills.filter((skill) => skill.name.value.trim());
  if (listed.length >= ENGINE.skillLevelsMinSkills && !listed.some((skill) => skill.level)) {
    gaps.push(gap("skill_levels", "skill_levels:all", undefined, { skills: listed.map((skill) => ({ id: skill.id, name: skill.name.value.trim() })) }));
  }

  for (const language of profile.languages) {
    const level = language.level.value;
    if (language.name.value.trim() && !level.cefr && !level.raw) {
      gaps.push(gap("language_no_level", `language_no_level:${language.id}`, undefined, { languageId: language.id, name: language.name.value }));
    }
  }

  gaps.push(...careerGaps(profile, jobs, now));
  const sinceThen = sinceLast(profile, jobs, now);
  if (sinceThen) gaps.push(sinceThen);

  // What kind of job they are after: printed nowhere, and it only decides which job to ask about
  // first. So it is worth a question only when there is something to decide between — two jobs
  // that are both still missing something and are recent enough to be asked about; one that only
  // has more to add is not competing for anything — or when they are changing sector, for whom
  // it is what the whole session leads with. Otherwise it would be a question whose answer
  // changes nothing, asked for its own sake.
  if (!objective && jobs.length > 0) {
    const competing = new Set(
      gaps
        .filter((found) => found.experienceId && found.priority !== "blocking" && DEEPENING.has(found.rule) && !ADDS_ONLY.has(found.rule))
        .filter((found) => {
          const job = jobs.find((entry) => entry.id === found.experienceId);
          return Boolean(job) && (yearsSinceEnd(job!, now) ?? 0) <= ENGINE.skeletonOnlyAfterYears;
        })
        .map((found) => found.experienceId),
    );
    if (profile.onboarding.situation === "switch" || competing.size >= 2) gaps.push(gap("objective", "objective", undefined));
  }

  // Someone with no work yet, asked once whether there is anything else worth listing — and whoever has a job, when a CV came out short for lack of anything to put on it.
  const situation = profile.onboarding.situation;
  if (signals.thin || (jobs.length === 0 && profile.projects.length === 0 && (situation === "student" || profile.onboarding.route === "scratch"))) {
    gaps.push(gap("no_work_experience", "no_work_experience:all", undefined));
  }

  // The same person, once, about a course or a license: for someone with no work, what they learned is what there is to say.
  // Not for whoever has a job, whose CV has other things to lean on, and not once one is listed.
  if (jobs.length === 0 && profile.certifications.length === 0 && (situation === "student" || profile.onboarding.route === "scratch")) {
    gaps.push(gap("no_certifications", "no_certifications:all", undefined));
  }

  // Someone changing sector, who said what they are after, asked once which of their latest job's lines carry over to it.
  const bridge = bridgeJob(profile, jobs, now);
  if (bridge) gaps.push(gap("transferable", `transferable:${bridge.id}`, bridge.id));

  // Someone whose CV is more studies than work, asked once what stands out of the latest of them.
  const study = studyToAsk(profile, jobs, now);
  if (study) gaps.push(gap("study_highlights", `study_highlights:${study.id}`, undefined, { educationId: study.id }));

  // A project nobody has said anything about: its name is all there is.
  for (const project of profile.projects) {
    if (project.name.value.trim() && !project.description.value.trim()) {
      gaps.push(gap("project_no_description", `project_no_description:${project.id}`, undefined, { projectId: project.id }));
    }
  }

  // The practical facts, once there is something to attach them to, and only while none has been given.
  // Never a reason to hold up the rest: it is the lowest of the one-tap questions, and always optional.
  if ((jobs.length > 0 || profile.education.length > 0 || profile.projects.length > 0) && isPracticalEmpty(profile.legacy.practical.value)) {
    gaps.push(gap("practical", "practical:all", undefined));
  }

  // What has a date on it, once the date is near or past, and what was said about how they can work, said long enough ago to
  // ask again. Both come from `lib/profile/currency.ts`, which says what a date means; neither is asked of what has none.
  for (const review of credentialReviews(profile, now)) gaps.push(credentialGap(review));
  const conditions = conditionsReview(profile, now);
  if (conditions) gaps.push(gap("conditions_review", conditionsGapId(conditions), undefined, { since: conditions.since, line: conditions.line }));

  // A job that is going on, and was last looked at long ago. After everything that decides what to ask about the jobs, so that it
  // does not count as a job that is missing something (`objective`): it is a job that is only old.
  for (const review of currentJobReviews(profile, now)) {
    gaps.push(gap("current_job_review", currentJobGapId(review.job.id, review.since), review.job.id, { since: review.since }));
  }

  // What came up in several of the offers they analysed: one thing, asked as a count of what they saw. Only when a caller that has the offers says so.
  if (signals.repeated) gaps.push(gap("repeated_requirement", repeatedGapId(signals.repeated), undefined, { ask: signals.repeated }));

  // What they wrote down, offered to the one job it names — a note that names none, or two, is not guessed at. Only when «Anotá algo» is on.
  if (signals.capture) {
    for (const placeable of placeableNotes(profile)) {
      gaps.push(gap("note_to_place", notePlaceGapId(placeable.note.id), placeable.jobId, { noteId: placeable.note.id, label: placeable.label }));
    }
  }

  // A skill that nothing has backed for years, asked once — the year it counts from is in its id. Only when it is on, and never taken out by itself.
  if (signals.stale) {
    for (const stale of staleSkills(profile, now)) {
      gaps.push(gap("skill_stale", staleGapId(stale), undefined, { skillId: stale.skill.id, name: stale.name, since: stale.since.getFullYear(), segment: stale.segment }));
    }
  }

  return gaps;
}

/** The lines of a job a person can say carry over: what was done, not the tools listed beside it, and not what they left out of their CVs. */
export const bridgeLines = (job: StoredExperience): Fact[] => contentFacts(job).filter((fact) => !fact.excluded);

/**
 * The job to ask what carries over from: the most recent one that says enough to choose among — two lines at least — of someone
 * who is changing sector and said what to. One job and one question: asked of every job it would be a form, and the latest is the
 * one a reader looks at first. Not once any line of it was marked, or the question was put aside for good.
 */
function bridgeJob(profile: StoredProfile, jobs: readonly StoredExperience[], now: Date): StoredExperience | null {
  if (profile.onboarding.situation !== "switch" || !profile.objective.value.trim()) return null;
  const latest = jobsByRecency(jobs.filter((job) => !job.excluded && bridgeLines(job).length >= 2))[0];
  if (!latest || (yearsSinceEnd(latest, now) ?? 0) > ENGINE.skeletonOnlyAfterYears) return null;
  return latest.facts.some((fact) => fact.transferable) ? null : latest;
}

/** Whether a study has points of its own — what the person said stands out of it. */
export const hasHighlights = (study: StoredEducation): boolean => study.highlights.value.some((point) => point.trim() !== "");

/**
 * The study to ask what stands out of: the most recent one — going on, or ended `ENGINE.studyHighlights.withinYears` years ago or
 * fewer — of someone with `maxJobs` jobs or fewer, whose CV leans on what they studied. Not of a career: for someone with one, a
 * study is a line. One that was left unfinished is not asked after, and neither is one that already has points. A study with no
 * end that can be read counts as recent: not knowing is no reason to ask less.
 */
function studyToAsk(profile: StoredProfile, jobs: readonly StoredExperience[], now: Date): StoredEducation | null {
  if (jobs.length > ENGINE.studyHighlights.maxJobs) return null;
  const recent = profile.education.filter((entry) => {
    if (!entry.degree.value.trim() && !entry.institution.value.trim()) return false;
    if (entry.status.value === "incomplete") return false;
    if (entry.status.value === "in_progress") return true;
    const end = boundsOf(entry.end.value);
    return end === null || (monthNow(now) - end.max) / 12 <= ENGINE.studyHighlights.withinYears;
  });
  const latest = studiesByRecency(recent)[0];
  return latest && !hasHighlights(latest) ? latest : null;
}

function jobIsRelevant(job: StoredExperience, objective: string): boolean {
  const wanted = new Set(contentWords(objective));
  if (wanted.size === 0) return false;
  const haystack = contentWords(`${job.role.value} ${contentFacts(job).map((fact) => fact.text).join(" ")}`);
  return haystack.some((word) => wanted.has(word));
}

/**
 * Stretches with nothing in them: between the end of one thing and the start of the
 * next. A gap is only one when it is under every reading of the dates — a year is
 * not a December, and a question that named one would be inventing it — and it says
 * the dates as they were written.
 */
function careerGaps(profile: StoredProfile, jobs: readonly StoredExperience[], now: Date): Gap[] {
  const entries: Span[] = [];
  for (const job of jobs) {
    const span = spanOf(job.start.value, job.end.value, now);
    if (span) entries.push({ ...span, jobId: job.id });
  }
  for (const entry of profile.education) {
    const span = spanOf(entry.start.value, entry.end.value, now);
    if (span) entries.push(span);
    // A degree with only an end year is a point, not a stretch: nothing to measure a gap from.
  }
  if (entries.length < ENGINE.gapMinEntries) return [];

  entries.sort((a, b) => a.start.min - b.start.min);
  const out: Gap[] = [];
  let covered = entries[0]!;
  const oldest = monthNow(now) - 10 * 12;
  for (const entry of entries.slice(1)) {
    const months = entry.start.min - covered.end.max;
    if (months > ENGINE.gapMonths && entry.start.min >= oldest) {
      out.push(
        gap("career_gap", `career_gap:${covered.end.max}:${entry.start.min}`, undefined, {
          from: { year: covered.to.year, ...(covered.to.month ? { month: covered.to.month } : {}) },
          to: { year: entry.from.year, ...(entry.from.month ? { month: entry.from.month } : {}) },
          months,
          // The job that begins after the pause, when it is one and has no reason yet: where a reason for the pause would be written.
          ...(entry.jobId && !jobs.find((job) => job.id === entry.jobId)?.note?.value.trim() ? { reasonJobId: entry.jobId } : {}),
        }),
      );
    }
    if (entry.end.max > covered.end.max) covered = entry;
  }
  return out;
}

/**
 * The stretch from the last thing that ended to today, when nothing says there is
 * something going on now. A CV that stops in 2023 may not have been touched since,
 * and the one thing worth asking is whether anything after that belongs on it — a
 * course, a project, a job the CV never got to.
 *
 * Asked only when nothing points to the person being somewhere right now: a job that
 * is current, a job or a study with a start and no end that can be read, a study in
 * progress. Asking "¿desde cuándo no hay nada?" of someone in the middle of one would
 * tell them the app did not read what they wrote. Like `careerGaps`, it is measured
 * against the latest the end could be — a bare year is not a January — and it names
 * the date as it was written.
 */
function sinceLast(profile: StoredProfile, jobs: readonly StoredExperience[], now: Date): Gap | null {
  const ends: Array<{ date: EndDateValue; bounds: Bounds }> = [];

  for (const job of jobs) {
    if (job.end.value.current) return null;
    const bounds = boundsOf(job.end.value);
    // No end that can be read is no proof that it ended.
    if (!bounds) return null;
    ends.push({ date: job.end.value, bounds });
  }
  for (const entry of profile.education) {
    if (entry.status.value === "in_progress") return null;
    const bounds = boundsOf(entry.end.value);
    if (bounds) ends.push({ date: entry.end.value, bounds });
    // Begun, and nothing says it stopped: it may be going on. One left unfinished is different.
    else if (boundsOf(entry.start.value) && entry.status.value !== "incomplete") return null;
  }
  if (ends.length === 0) return null;

  const latest = ends.reduce((best, entry) => (entry.bounds.max > best.bounds.max ? entry : best));
  const months = monthNow(now) - latest.bounds.max;
  if (months <= ENGINE.gapMonths) return null;
  return gap("since_last", `since_last:${latest.bounds.max}`, undefined, {
    from: { year: latest.date.year, ...(latest.date.month ? { month: latest.date.month } : {}) },
    months,
  });
}

// --- How much each one matters ---------------------------------------------------------------------

/**
 * Rules whose control is a tap or a short pick: chips, a level, a month from a
 * short list, a Sí/No. Cheap to answer on a phone, unlike a rule this set
 * leaves out — a narrative one needs a paragraph typed with thumbs regardless
 * of screen size, so boosting it on `compact` would not buy anything real.
 *
 * Not «¿Seguís en…?» (`current_job_review`): it is one tap to say «Sí, sigo», and two or three screens and a box of text to say anything else —
 * the date it ended, where they went, what happened — which is not what a phone is for, so it is not put first on one.
 */
const ONE_TAP: ReadonlySet<RuleId> = new Set(["loose_tool", "language_no_level", "imprecise_date", "skill_unused", "scope_unknown", "credential_expiry", "conditions_review", "skill_stale", "abbreviated_skill"]);

export function priorityOf(found: Gap, profile: StoredProfile, now: Date = new Date(), options: { compact?: boolean } = {}): number {
  const weight = WEIGHT[found.rule];
  const job = found.experienceId ? profile.experience.find((entry) => entry.id === found.experienceId) : undefined;

  const recency = job ? recencyOf(job, now) : 1;

  const objective = profile.objective.value.trim();
  let relevance = 1;
  if (objective && job && jobIsRelevant(job, objective)) relevance = ENGINE.relevance.match;
  if (found.rule === "scope_unknown" && MANAGEMENT_OBJECTIVE.test(objective)) relevance = ENGINE.relevance.scopeForManagement;
  // With no job to show, a project is what the CV is made of.
  if (found.rule === "project_no_description" && !profile.experience.some(isMeaningfulExperience)) relevance = ENGINE.relevance.projectIsTheWork;

  const skipped = profile.fatigue[found.rule]?.skipped ?? 0;
  const fatigue = Math.max(ENGINE.fatigue.floor, 1 - ENGINE.fatigue.perSkip * skipped);
  const wasSkipped = profile.pending.some((entry) => entry.questionId === found.id && entry.state === "skipped");
  const compact = options.compact && ONE_TAP.has(found.rule) ? ENGINE.compactBoost : 1;

  return weight * recency * relevance * fatigue * compact * (wasSkipped ? ENGINE.skippedFactor : 1);
}

// --- What can be asked now --------------------------------------------------------------------------

/**
 * Whether the answer is already in the profile, in words the person gave: a figure
 * in the text of an achievement, a team named in a duty, a result a line already
 * reports, every kind of change a job's results already tell. Asked again, the
 * question tells them the app did not read what they wrote.
 */
export function alreadyKnown(found: Gap, profile: StoredProfile): boolean {
  if (found.rule === "study_highlights") {
    const study = profile.education.find((entry) => entry.id === found.payload.educationId);
    return !study || hasHighlights(study);
  }
  const job = found.experienceId ? profile.experience.find((entry) => entry.id === found.experienceId) : undefined;
  if (!job) return false;
  if (found.rule === "transferable") return job.facts.some((fact) => fact.transferable);
  if (found.rule === "no_achievements") return contentFacts(job).some(isResultFact);
  if (found.rule === "more_achievements") return moreToTell(job, profile, contentFacts(job).filter(isResultFact)) === null;
  if (found.rule === "achievement_no_figure" || found.rule === "vague_scale") {
    const fact = job.facts.find((entry) => entry.id === found.payload.factId);
    return Boolean(fact && (fact.metric || statesQuantity(fact.text)));
  }
  if (found.rule === "scope_unknown") {
    return job.facts.some((fact) => fact.kind === "scope") || contentFacts(job).some((fact) => TEAM_MENTION.test(fact.text));
  }
  return false;
}

/**
 * The jobs worth deepening in a session: the current one (or ones, first,
 * whatever its score) and then the one or two most relevant of whichever
 * jobs in `openJobIds` still have something to ask — never a job that only
 * scores higher on paper while everything about it has already been
 * answered, skipped for good, or is already known, which would otherwise
 * crowd out a less recent or less relevant job that still has an open
 * question. Of those, a job still missing something (`missingJobIds`) goes
 * before one that only has more to add (`ADDS_ONLY`): a job with nothing
 * under it is worth more of a session than a second result for one that
 * already tells some. Both sets are the caller's (`eligibleGaps`), since it
 * is the one place that already knows what "still open" means.
 */
function focusJobs(profile: StoredProfile, now: Date, openJobIds: ReadonlySet<string>, missingJobIds: ReadonlySet<string>): Set<string> {
  const objective = profile.objective.value.trim();
  return new Set(
    profile.experience
      .filter(isMeaningfulExperience)
      .filter((job) => openJobIds.has(job.id))
      .map((job) => ({
        id: job.id,
        current: Boolean(job.end.value.current),
        missing: missingJobIds.has(job.id),
        score: recencyOf(job, now) * (objective && jobIsRelevant(job, objective) ? ENGINE.relevance.match : 1),
      }))
      .sort((a, b) => Number(b.current) - Number(a.current) || Number(b.missing) - Number(a.missing) || b.score - a.score)
      .slice(0, ENGINE.session.deepenJobs)
      .map((entry) => entry.id),
  );
}

/** Rules that go deep into a job, and so are held to a job's budget and to its recency. */
const DEEPENING: ReadonlySet<RuleId> = new Set([
  "no_content",
  "no_achievements",
  "achievement_no_figure",
  "vague_scale",
  "thin_content",
  "transferable",
  "scope_unknown",
  "imprecise_date",
  "more_achievements",
]);

/** Deepening rules that only add to what a job already tells, rather than fill in what it is missing. */
const ADDS_ONLY: ReadonlySet<RuleId> = new Set(["more_achievements", "vague_scale", "thin_content", "transferable"]);

/** The rules that ask for a figure: what «En mi trabajo no se miden cifras» and two «no lo sé» stop, wherever the line came from. */
const FIGURE_RULES: ReadonlySet<RuleId> = new Set(["achievement_no_figure", "vague_scale"]);

/**
 * Whether figures are not asked about this job: two "no lo sé" stop them for jobs that ended a while ago, and
 * "En mi trabajo no se miden cifras" stops them for all of them, however recent — the person said it, and one more
 * "¿tenés una cifra?" is the app not having listened.
 */
function figuresStopped(profile: StoredProfile, job: StoredExperience, now: Date): boolean {
  if (profile.fatigue.achievement_no_figure?.off) return true;
  const unknown = profile.fatigue.achievement_no_figure?.unknown ?? 0;
  return unknown >= ENGINE.figureUnknownStopAfter && (yearsSinceEnd(job, now) ?? 0) >= ENGINE.oldJobYears;
}

/** Whether the person has just, in this session, told this job's lines in answer to «¿De qué te encargabas?» — and so has just said what they had to say. */
function toldThisSession(job: StoredExperience, session: Session): boolean {
  if (session.startedAt === "") return false;
  return job.facts.some((fact) => fact.source.kind === "answer" && fact.source.questionId?.startsWith(`no_content:${job.id}`) && fact.source.at >= session.startedAt);
}

export type EligibleOptions = {
  /** Narrows to one job — asked for by name, from its card in the profile — and lifts the limits that decide which jobs are worth deepening: the person chose this one, however old it is. */
  only?: string;
  /** The device asking is a phone: boosts `ONE_TAP` rules in `priorityOf`. Resolved on the client (`QuestionLoop`), never guessed here. */
  compact?: boolean;
  /** Asks only these kinds of question: the review of what changed since the last time asks about time, and about nothing else. */
  rules?: ReadonlySet<RuleId>;
  /** At most this many questions in all, whatever their kind — `nextQuestion` and `remainingThisSession` stop there: a review is a few questions and not a session. */
  limit?: number;
  /** What the person's search says, for the rules that are about it and not about the profile. */
  signals?: Signals;
};

/**
 * What the review of «qué cambió desde entonces» asks about: whether a job that is going on still is, what lapses, what was said of how
 * they can work, and — for someone with nothing going on — what there has been since the last thing that ended. About time, and about
 * nothing that makes a CV better.
 */
export const RETURN_RULES: ReadonlySet<RuleId> = new Set<RuleId>(["current_job_review", "credential_expiry", "conditions_review", "since_last"]);

/**
 * What time brings, and so what the profile lists in one place, «Para revisar», and not among the questions that make a CV better: the review of what changed
 * (`RETURN_RULES`) and the skill that nothing has backed for years (O17, off until it is switched on). The engine still asks them, in a session or by name; what
 * they are not is a second door to the same question from the list of what is left.
 */
export const REVIEW_RULES: ReadonlySet<RuleId> = new Set<RuleId>([...RETURN_RULES, "skill_stale"]);
export const isReviewRule = (rule: RuleId): boolean => REVIEW_RULES.has(rule);

/** What can be asked now, best first. */
export function eligibleGaps(profile: StoredProfile, session: Session, now: Date = new Date(), options: EligibleOptions = {}): Gap[] {
  const { only, compact, rules } = options;
  const gaps = detectGaps(profile, now, options.signals);

  // "No aplica" is for good. "Más tarde" and "Saltar" both wait, but only
  // until the *next* session — neither comes back within the one it was put
  // off in; `priorityOf`'s `skippedFactor` is what still tells the two apart
  // once a new session does bring one back. `only` is the one exception:
  // arriving at this job's own gaps from "Falta un logro" on its card is the
  // person choosing to answer this now, so a skip or a "más tarde" earlier in
  // the very same session that sent them here does not stand in the way —
  // "no aplica" still does, since that one is not a wait at all.
  const isDeferred = (found: Gap): boolean => {
    const entry = profile.pending.find((pending) => pending.questionId === found.id);
    if (entry?.state === "na") return true;
    if (only) return false;
    return Boolean(entry?.state === "later" || entry?.state === "skipped") && entry!.at >= session.startedAt && session.startedAt !== "";
  };
  /** A deepening gap still worth asking at all, apart from whose turn it is this session. */
  const stillOpen = (found: Gap): boolean => {
    if (isDeferred(found) || alreadyKnown(found, profile)) return false;
    const job = profile.experience.find((candidate) => candidate.id === found.experienceId);
    if (!job || (yearsSinceEnd(job, now) ?? 0) > ENGINE.skeletonOnlyAfterYears) return false;
    return !(FIGURE_RULES.has(found.rule) && figuresStopped(profile, job, now));
  };

  // Which jobs have something left to ask, decided before picking which of
  // them get a focus slot — so a job whose own questions are all answered,
  // skipped for good, or already known never occupies a slot a less recent
  // or less relevant job (a fourth one, say) still needs.
  const open = only ? [] : gaps.filter((found) => found.priority !== "blocking" && found.experienceId && DEEPENING.has(found.rule) && stillOpen(found));
  const openJobIds = new Set(open.map((found) => found.experienceId!));
  const missingJobIds = new Set(open.filter((found) => !ADDS_ONLY.has(found.rule)).map((found) => found.experienceId!));
  const focus = only ? new Set([only]) : focusJobs(profile, now, openJobIds, missingJobIds);

  return gaps
    .filter((found) => {
      if (rules && !rules.has(found.rule)) return false;
      if (only && found.experienceId !== only) return false;
      if (isDeferred(found)) return false;

      if (found.priority !== "blocking" && found.experienceId && DEEPENING.has(found.rule)) {
        const job = profile.experience.find((candidate) => candidate.id === found.experienceId);
        if (!job) return false;
        // Old jobs stay a skeleton, and only a few jobs are deepened in one session.
        if (!only && (yearsSinceEnd(job, now) ?? 0) > ENGINE.skeletonOnlyAfterYears) return false;
        if (!focus.has(job.id)) return false;
        if ((session.askedByExperience[job.id] ?? 0) >= ENGINE.session.maxPerExperience) return false;
        if (FIGURE_RULES.has(found.rule) && figuresStopped(profile, job, now)) return false;
        // Not straight after the answer that gave it one line: what the person had to say about the job was just said.
        if (found.rule === "thin_content" && toldThisSession(job, session)) return false;
      }
      return !alreadyKnown(found, profile);
    })
    .map((found) => ({ found, score: priorityOf(found, profile, now, { compact }) }))
    .sort((a, b) => {
      // The skeleton first, whatever anything else scores; then by score; ties by id, so the same profile always asks in the same order.
      const blockingA = a.found.priority === "blocking";
      const blockingB = b.found.priority === "blocking";
      if (blockingA !== blockingB) return blockingA ? -1 : 1;
      return b.score - a.score || tieKey(a.found).localeCompare(tieKey(b.found));
    })
    .map(({ found }) => found);
}

/**
 * Where a gap stands among those that score the same: by its id, so the same profile always asks in the same order —
 * except that one job's skeleton goes when, where, what, as it is asked, and not in the order the words sort in.
 */
function tieKey(found: Gap): string {
  if (found.rule !== "incomplete_skeleton") return found.id;
  const field = (found.payload.missing as SkeletonField[])[0] ?? "role";
  return `${found.id.slice(0, found.id.lastIndexOf(":"))}:${SKELETON_FIELDS.indexOf(field)}`;
}

export type NextQuestion =
  | { kind: "gap"; gap: Gap }
  /** The session's budget is spent; there is more to ask, next time. */
  | { kind: "budget"; remaining: number }
  /** There is nothing left worth asking. */
  | { kind: "none" };

/**
 * The next thing to ask, or why there is nothing to ask.
 *
 * The skeleton's questions come first and are not counted against the session:
 * they are what makes a job a job. Deepening questions are held to the budget, and
 * one-tap questions to a smaller limit of their own — so a session can run out of
 * the one and still finish on a quick question or two. Running out is a way for
 * the session to end well, not a failure.
 */
export function nextQuestion(profile: StoredProfile, session: Session, now: Date = new Date(), options: EligibleOptions = {}): NextQuestion {
  const eligible = eligibleGaps(profile, session, now, options);
  if (eligible.length === 0) return { kind: "none" };
  // A review of a few questions has said what it had to say once it has asked them.
  if (options.limit !== undefined && session.askedThisSession + session.askedQuick >= options.limit) return { kind: "budget", remaining: eligible.length };

  const allowed = eligible.find((found) => {
    if (found.priority === "blocking") return true;
    if (found.priority === "low") return session.askedQuick < ENGINE.session.maxQuick;
    return session.askedThisSession < ENGINE.session.maxQuestions;
  });
  return allowed ? { kind: "gap", gap: allowed } : { kind: "budget", remaining: eligible.length };
}

/**
 * How many more questions this session would ask, at most: what "Quedan unas N"
 * says. The same limits `nextQuestion` holds to, summed over everything eligible
 * instead of stopping at the first — the skeleton's are counted against nothing, the
 * deepening ones stop at the session's budget and at each job's, the one-tap ones at
 * theirs. An estimate: an answer can bring a follow-up, and a follow-up is not in it,
 * which is why the screen says "unas".
 */
export function remainingThisSession(profile: StoredProfile, session: Session, now: Date = new Date(), options: EligibleOptions = {}): number {
  let blocking = 0;
  let quick = 0;
  let deep = 0;
  const byJob = new Map<string, number>();
  for (const found of eligibleGaps(profile, session, now, options)) {
    if (found.priority === "blocking") blocking += 1;
    else if (found.priority === "low") quick += 1;
    else if (found.experienceId) byJob.set(found.experienceId, (byJob.get(found.experienceId) ?? 0) + 1);
    else deep += 1;
  }
  for (const [jobId, count] of byJob) {
    deep += Math.min(count, Math.max(0, ENGINE.session.maxPerExperience - (session.askedByExperience[jobId] ?? 0)));
  }
  const left =
    blocking +
    Math.min(deep, Math.max(0, ENGINE.session.maxQuestions - session.askedThisSession)) +
    Math.min(quick, Math.max(0, ENGINE.session.maxQuick - session.askedQuick));
  return options.limit === undefined ? left : Math.min(left, Math.max(0, options.limit - session.askedThisSession - session.askedQuick));
}

/**
 * Whether one question can be put to the person now, by name: it is still a gap, its
 * answer is not already in their words, and they did not say it does not apply.
 * "Más tarde" and "Ahora no" do not stand in the way — asking for it by name is
 * choosing to answer it now — and neither does the session's budget, which is for what
 * the engine picks on its own.
 */
export function isAskable(profile: StoredProfile, gapId: string, now: Date = new Date(), signals: Signals = {}): boolean {
  const found = detectGaps(profile, now, signals).find((entry) => entry.id === gapId);
  if (!found || alreadyKnown(found, profile)) return false;
  return !profile.pending.some((entry) => entry.questionId === gapId && entry.state === "na");
}

/**
 * What to ask right after an answer, before anything else.
 *
 * A figure is asked about the achievement just told, not whenever it happens to
 * rank; and tools the person just named are offered while their words are still on
 * screen. Both are follow-ups on what was just said, which is why they jump the
 * queue — but not over "Más tarde" or "Saltar" from earlier in *this* session:
 * a figure question put off a moment ago should not immediately reappear as
 * someone else's follow-up. `session` defaults to `NO_SESSION` for callers
 * (mostly tests) that have no session of their own to give it.
 */
export function followUpGaps(profile: StoredProfile, created: readonly Fact[], now: Date = new Date(), session: Session = NO_SESSION): Gap[] {
  if (created.length === 0) return [];
  // An achievement just told gets its figure right away, each one. A duty that happens to report a result ("reduje los
  // tiempos de entrega", typed as what the job is about) gets it too, but only the first of them: queued here, several such
  // lines would each jump every limit, and it is that first one, the person's own sign of what a job did, that is worth
  // asking while it is on screen. The others wait their turn, through `nextQuestion` and the job's budget.
  const firstResultDuty = created.find((fact) => fact.kind !== "achievement" && fact.kind !== "tool" && isResultFact(fact));
  const toldAchievements = new Set([...created.filter((fact) => fact.kind === "achievement"), ...(firstResultDuty ? [firstResultDuty] : [])].map((fact) => fact.id));
  const named = new Set(created.flatMap((fact) => (fact.kind === "tool" ? [skillKey(fact.text)] : toolsIn(fact.text).map(skillKey))));
  const turnedDown = new Set(profile.pending.filter((entry) => entry.state === "na").map((entry) => entry.questionId));
  const deferredThisSession = new Set(
    profile.pending
      .filter((entry) => (entry.state === "later" || entry.state === "skipped") && entry.at >= session.startedAt && session.startedAt !== "")
      .map((entry) => entry.questionId),
  );

  return detectGaps(profile, now).filter((found) => {
    if (turnedDown.has(found.id) || deferredThisSession.has(found.id)) return false;
    if (found.rule === "achievement_no_figure") {
      const job = profile.experience.find((entry) => entry.id === found.experienceId);
      return toldAchievements.has(String(found.payload.factId)) && Boolean(job) && !figuresStopped(profile, job!, now);
    }
    if (found.rule === "loose_tool") return (found.payload.tools as string[]).some((tool) => named.has(skillKey(tool)));
    return false;
  });
}

/**
 * The figure question for the one fact just told, if it still needs one: what
 * the achievements cycle asks right after each achievement. Picked by rule and
 * by fact, never as "the first follow-up" — `followUpGaps` also offers the
 * tools a fact names, and a figure card built from that offer would ask for a
 * number no answer could ever save, with no way out of it but closing the loop.
 */
export function figureFollowUp(profile: StoredProfile, fact: Fact, now: Date = new Date(), session: Session = NO_SESSION): Gap | undefined {
  return followUpGaps(profile, [fact], now, session).find((found) => found.rule === "achievement_no_figure" && found.payload.factId === fact.id);
}

export type { RuleId, Priority };
