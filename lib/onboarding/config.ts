/**
 * The numbers the question engine runs on, in one place.
 *
 * They are starting values to be tested against people, not conclusions: how many
 * questions a first session can hold, how quickly old jobs stop mattering, how
 * much a skipped kind of question costs the next one of its kind. Changing one
 * should be a one-line edit here and a change in a test's expectation, nowhere
 * else.
 */

export const ENGINE = {
  session: {
    /** Deepening questions in one session. The skeleton's own questions do not count. */
    maxQuestions: 6,
    /**
     * One-tap questions (a level, a list of tools, a month) are not the deepening
     * the budget above is for, and are not counted in it — but a session that ended
     * in a run of them would feel like a quiz, so they have a limit of their own.
     * Two is the spec's own first session: the tools she named, and the level of a
     * language.
     */
    maxQuick: 2,
    /** Questions about one job in one session: what you did, what improved, the figure. */
    maxPerExperience: 3,
    /** How many jobs get deepened in a session, current first. */
    deepenJobs: 3,
    /** A visit this long after the last one is a new session. */
    staleAfterHours: 6,
  },

  /** How much less a job matters the longer ago it ended. Years since its end. */
  recency: [
    { upToYears: 0, factor: 1 }, // still going
    { upToYears: 3, factor: 0.8 },
    { upToYears: 7, factor: 0.5 },
    { upToYears: Infinity, factor: 0.2 },
  ],
  /** Past this, a job stays a skeleton: it is not deepened at all. */
  skeletonOnlyAfterYears: 7,

  /**
   * What a match with the person's objective is worth, and what a project is worth to someone
   * with no job to show: their projects are then what the CV is made of, not an extra.
   */
  relevance: { match: 1.5, scopeForManagement: 2, projectIsTheWork: 2 },

  /**
   * What being on a small screen is worth to a rule whose control is a tap or
   * a short pick (`ONE_TAP` in `gaps.ts`) — strong enough to routinely put one
   * ahead of a narrative question it would otherwise lose to, on the premise
   * that a chip costs a phone much less than a paragraph does. Never raises
   * how many of them a session allows: `maxQuick` counts by kind, not by
   * score, so a boosted rule still gives way once its own two are spent.
   */
  compactBoost: 3,

  /** Each skipped question of a kind makes the next of that kind this much less likely, to a floor. */
  fatigue: { perSkip: 0.15, floor: 0.4 },
  /** A question the person has skipped comes back at this fraction of its priority. */
  skippedFactor: 0.4,
  /** After this many "no lo sé" to a figure, figures stop being asked about old jobs. */
  figureUnknownStopAfter: 2,
  /** "Old" for that purpose: a job that ended this many years ago or more. */
  oldJobYears: 3,

  /**
   * A job whose lines say little: one line, or lines of fewer words than this (`thin_content`). Asked only of a job that
   * is going on or ended this many years ago or fewer — an old job is a skeleton, and a recent one is what a CV is read for.
   */
  thinContent: { shortWords: 5, withinYears: 3 },

  /**
   * What stands out of a study (`study_highlights`): asked of the most recent one — going on, or ended this many years ago or
   * fewer — and only of someone with this many jobs or fewer, whose CV is made more of studies than of work.
   */
  studyHighlights: { withinYears: 3, maxJobs: 1 },

  /**
   * Whether a block of a document read with a model is given as good when the app's own patterns read the same block the same way
   * (`lib/parse/agree.ts`). Off: it would mark fewer blocks for review on the strength of two readers that can share a mistake, and
   * nothing says yet that they rarely do — there is no count of how often a person has to correct what a model read. Typed as a
   * boolean so that turning it on is this one edit.
   */
  aiReading: { trustAgreement: false as boolean },

  /**
   * What the profile asks about once a date it holds has stopped being true, or is about to (`lib/profile/currency.ts`): a credential
   * is asked after from this many days before it lapses, and what the person said about how they can work — availability, a
   * licence, a vehicle — is asked after when it has gone this many days without being said to still hold. Starting values, like
   * every number here: the 60 and the 90 are the ones the report that proposed this suggested (E4 of the study of the profile over
   * time), and only the people who use it can say whether they are right. Nothing expires on its own — a lapsed date is a question —
   * and none of it is asked more than the session's quick questions allow.
   *
   * - `currentJobDays`: a job that is going on is asked about — «¿Seguís en…?» — when nothing was said of it for this long, about
   *   six months. A job that is going on never grows old on its own, and it is where what the person forgets piles up.
   * - `returnDays`: a profile nobody stood behind for this long is offered a short review of what changed, at most
   *   `returnQuestions` questions, and «Ahora no» silences the offer for `returnSnoozeDays`. The offer says the date of the last
   *   review and never how long it has been (CT6).
   * - `declinedDays`: a «no tengo X» said to an offer — «No lo tengo» — is asked once more after this many days, a year, if no line
   *   has named it before. A skill the person vetoed does not expire by time: the same lines would deduce it again.
   */
  currency: {
    credentialSoonDays: 60,
    conditionsDays: 90,
    currentJobDays: 180,
    returnDays: 60,
    returnQuestions: 3,
    returnSnoozeDays: 14,
    declinedDays: 365,
    /**
     * A skill that nothing backs for this many years is asked about once — «¿La seguís usando?» (`lib/profile/staleness.ts`, O17) —, by the kind of
     * skill: three for a tool or a way of working, five for a trade, which is forgotten more slowly. E4 says so on the strength of how slowly physical tasks
     * decay (Arthur and others, 1998) and says plainly that the exact numbers are design: «a calibrar», by segment, with the people who use it.
     */
    unusedSkillYears: { technical: 3, manual: 5 },
  },

  /**
   * What a thing that comes up in the offers a person analysed has to do to be asked once (`lib/jobs/repeated.ts`, O10): to be in at least
   * `minOffers` of the last `lastOffers` offers analysed, inside `withinDays`, and from `minEmployers` different employers. The numbers are the
   * ones the report that proposed it gave (E3, A2), with its reasoning — three in ten is the least that tells apart a thing that repeats from
   * one that happened to — and they are starting values, like every number here: the question is built and off until people have tried it
   * (`lib/experiments.ts`).
   */
  repeated: { lastOffers: 10, withinDays: 90, minOffers: 3, minEmployers: 2 },

  /**
   * What a person says they were asked at an interview, read as the lines of an offer are read, becomes at most this many questions, one after
   * another (`lib/jobs/interview.ts`, O12): what they remember being asked is a few things, and the answer is a question for each — never a list.
   */
  interview: { maxAsks: 3 },

  /**
   * A job that ended after fewer than `months` (`short_stint`) is asked, once, whether the person wants a reason on the CV: it is the one thing
   * a recruiter reads a short stay for. Only of a job that ended `withinYears` years ago or fewer — the reason for one from long ago is not what a
   * CV is read for — and never of an internship, a freelance, a contract or an activity, which are short by nature.
   */
  shortStint: { months: 12, withinYears: 7 },
  /** Skills a person has before they are asked how well they know them (`skill_levels`): with fewer, there is nothing to tell apart. */
  skillLevelsMinSkills: 3,

  /** Facts about dates. */
  overlapToleranceMonths: 1,
  gapMonths: 6,
  impreciseWithinYears: 5,
  /** Below this many entries a career has no "gaps" worth asking about. */
  gapMinEntries: 2,

  /**
   * How sure the cross-source merge (`lib/onboarding/merge.ts`) has to be before
   * treating two roles, or two facts, from different documents as the same one.
   */
  merge: {
    /** Below this two job titles are different jobs, not two readings of one — unless `spanOverlap` says otherwise. */
    roleSimilarity: 0.5,
    /**
     * Two titles that read nothing alike are still one job when, at one company,
     * this share of the longer of the two spans is common to both — and neither
     * side has another such partner (see `sameSlot`).
     */
    spanOverlap: 0.5,
    /** Above this two facts are the same statement, kept once. */
    factSimilarity: 0.8,
    /**
     * Between this and `factSimilarity`, two tasks of one job that two documents word differently might
     * be one: not alike enough for the merge to join them on its own, too alike to say nothing. The
     * person is asked — a paraphrase scores 0.6–0.7 here, and so do two tasks that only share a verb.
     */
    possibleRepeat: 0.55,
  },
} as const;

/**
 * How much each kind of question weighs before recency, relevance and fatigue.
 * `blocking` is above everything: without a company, a role and a start, a job is
 * not yet something to ask more about.
 */
export const WEIGHT = {
  incomplete_skeleton: 1000,
  no_content: 8,
  no_work_experience: 8,
  /**
   * A course or a license, for someone with no work yet: asked once, after the question about work, and as something
   * that costs nothing to say no to. A person with no job has little else to show, and nobody asked.
   */
  no_certifications: 3,
  /**
   * What stands out of the latest study — subjects or papers, a thesis, a grade — for someone whose CV is made more of studies
   * than of work. Behind the question about work, which is what a CV is read for, and ahead of the course or the license:
   * for a person with no job, a study is the one thing there is to say something about.
   */
  study_highlights: 6,
  no_achievements: 8,
  achievement_no_figure: 5,
  /**
   * A line that says «muchos clientes» and no number. Behind the figure of a result, which is what a CV leans on most, and
   * level with a project: it is worth asking after what a job is missing, not before.
   */
  vague_scale: 4,
  /** A job told in one line, or in lines too short to say what was done: «Además de eso, ¿qué más hacías?». */
  thin_content: 5,
  /**
   * For someone changing sector who said what they are after: which of the lines of their latest job carry over to it. Once,
   * and after what the job is missing — it adds to what is told, as «¿algo más?» does — but ahead of the tools and the levels.
   */
  transferable: 4,
  scope_unknown: 5,
  overlap: 5,
  /** "¿Algo más?" about a job that already tells results: worth asking, after what the job is missing. */
  more_achievements: 3,
  loose_tool: 2,
  skill_unused: 2,
  language_no_level: 3,
  imprecise_date: 2,
  career_gap: 2,
  /**
   * Nothing at all since the last thing that ended: a CV that stops in 2023 may
   * not have been touched since. Only ever asked when nothing is going on now, so
   * there is no current job to compete with; it is worth more than an old job's
   * own missing detail (`no_content` is 8, halved for a job that ended years ago).
   */
  since_last: 6,
  /**
   * What kind of job they are after. Not printed on any CV and changing no generator: it only
   * orders the questions that follow, so it goes before them — and is asked only when there is
   * something for it to order (see `detectGaps`).
   */
  objective: 10,
  /**
   * A project with a name and nothing about what the person did in it. Behind what a job is
   * missing, since a job is what most CVs lean on; `relevance.projectIsTheWork` puts it level with
   * them for someone who has no job.
   */
  project_no_description: 4,
  /**
   * Availability, a driving licence, a vehicle, a permit, moving for work: asked once, last, and
   * only ever as something to leave out. Below every other one-tap question, since none of it is
   * needed to make a CV — it decides a search more than it decides a page.
   */
  practical: 1,
  /**
   * A credential that lapses — a licence, a carnet, a registration — and whose date is near or past: «¿Hiciste la renovación?». Above
   * the other one-tap questions, because it is the one with a day on it, and below everything that goes deep into a job: it is a
   * thing to settle, not a thing to tell.
   */
  credential_expiry: 5,
  /** What the person said about how they can work, long enough ago that it may have changed: «¿Sigue igual?», one tap. Behind the rest. */
  conditions_review: 2,
  /**
   * A job that is going on and was not looked at for months: «¿Seguís en…?». Behind what a job is missing — a job with nothing in it
   * comes first — and ahead of its figures and of everything that adds to what it already tells: a job that is still going is
   * where the news piles up, and the one thing nobody asks about.
   */
  current_job_review: 7,
  /**
   * A thing that comes up in several of the offers the person analysed, asked once (`lib/jobs/repeated.ts`). Behind what a job is missing and
   * level with a project: it is about the search and not about what the CV says, and it is one question in a session that has a budget.
   */
  repeated_requirement: 4,
  /**
   * A note the person wrote down that names one of their jobs, offered to it once (`lib/profile/capture.ts`, O15): «¿Esto va en…?». They wrote it
   * themselves, a short time ago, thinking of that job, so it is the cheapest thing to settle — behind what a job is missing, level with what asks
   * a figure, and ahead of the questions that add to what a job already tells.
   */
  note_to_place: 5,
  /**
   * A skill that nothing has backed for years (`lib/profile/staleness.ts`, O17): «¿La seguís usando?». One tap, and the last of them — it is a
   * question about what the CV says of the past, never a reason to hold up what it says of the present.
   */
  skill_stale: 2,
  /**
   * A skill written as its initials — «RN», «TS», «Go» —, asked once whether it is the whole name. One tap, and above the other questions about skills: an
   * offer that asks for React Native is answered by a profile that says «RN» only if the person says so, and until they do the CV the model writes
   * for it carries an error the person cannot clear.
   */
  abbreviated_skill: 4,
  /** A stay of under a year, asked whether it deserves a line on the CV: one of the few things a recruiter reads it for, behind what a job is missing. */
  short_stint: 3,
  /** How well they know each skill, asked once for all of them: last, since no CV is worse for lacking it, only less clear about where to start. */
  skill_levels: 2,
} as const;

export type RuleId = keyof typeof WEIGHT;
export type Priority = "blocking" | "high" | "medium" | "low";

export const PRIORITY: Record<RuleId, Priority> = {
  incomplete_skeleton: "blocking",
  no_content: "high",
  no_work_experience: "high",
  no_certifications: "medium",
  study_highlights: "medium",
  no_achievements: "high",
  achievement_no_figure: "medium",
  vague_scale: "medium",
  thin_content: "medium",
  transferable: "medium",
  scope_unknown: "medium",
  overlap: "medium",
  more_achievements: "medium",
  loose_tool: "low",
  skill_unused: "low",
  language_no_level: "low",
  imprecise_date: "low",
  career_gap: "low",
  since_last: "medium",
  objective: "medium",
  project_no_description: "medium",
  practical: "low",
  credential_expiry: "low",
  conditions_review: "low",
  current_job_review: "medium",
  repeated_requirement: "medium",
  note_to_place: "medium",
  skill_stale: "low",
  abbreviated_skill: "low",
  short_stint: "low",
  skill_levels: "low",
};
