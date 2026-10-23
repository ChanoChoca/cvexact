import { mergedMonths, monthsBetween, parseProfileDate, roleSpans } from "@/lib/ai/evidence";
import type { JobAnalysis } from "@/lib/schemas/job";
import { meaningfulExperience, type Profile } from "@/lib/schemas/profile";
import type { CVDocument, CVSection } from "@/lib/schemas/cv";

/**
 * Where the person is in a career, for what it decides about a CV: what a reader should meet first.
 *
 * «early» is a student or someone with little work behind them, whose studies, projects and activities are most of the evidence;
 * «established» is everyone else, whose work history is.
 */
export type CareerStage = "early" | "established";

/** Under this many months of dated work, a career is just starting. */
const EARLY_MONTHS = 24;
/** A study finished this recently still counts as the person's present. */
const RECENT_STUDY_MONTHS = 24;

/** Whether the person is studying now or finished not long ago. A study with no readable end is not known to be recent. */
function studiesRecently(profile: Profile, now: Date): boolean {
  return profile.education.some((study) => {
    if (study.status === "in_progress") return true;
    const end = parseProfileDate(study.end);
    return study.status === "completed" && end !== null && monthsBetween(end, now) <= RECENT_STUDY_MONTHS;
  });
}

/**
 * The stage, from what the person said and then from what the profile shows.
 *
 * What they declared when they began wins: «student» is early and «experienced» is established. «break» and «switch» say they have
 * worked, not how much, so they fall through to the dates, as does a profile that declared nothing — which is every profile made
 * since the screen that asked was taken out.
 *
 * Derived, a career is early when it has under two years of work (`mergedMonths`, overlap counted once) and either studies now or
 * finished within two, or the posting is for an intern or a junior. A job whose dates cannot be read puts the months out of reach:
 * 0 months is not what the profile says there, and a long career must not be shown as a first one for want of a date.
 */
export function careerStage(profile: Profile, analysis: Pick<JobAnalysis, "seniority">, now: Date = new Date()): CareerStage {
  if (profile.situation === "student") return "early";
  if (profile.situation === "experienced") return "established";

  const spans = roleSpans({ ...profile, experience: meaningfulExperience(profile) }, now);
  if (spans.some((span) => span.start === null) || mergedMonths(spans) >= EARLY_MONTHS) return "established";

  return studiesRecently(profile, now) || analysis.seniority === "intern" || analysis.seniority === "junior" ? "early" : "established";
}

/**
 * The order of sections each stage reads in. Experience goes first for everyone who has a career; for the one who is starting, the
 * studies and the projects do, and the activities follow the work. The skills and the labelled facts close the page, as in the
 * template.
 */
const SECTION_RANK: Record<CareerStage, Record<CVSection["kind"], number>> = {
  early: { education: 0, projects: 1, experience: 2, activities: 3, bullets: 4, pairs: 5 },
  established: { experience: 0, education: 1, projects: 2, activities: 3, bullets: 4, pairs: 5 },
};

/**
 * The CV with its sections in the stage's order. The prompt says what the order is and a model follows it some of the time; this is
 * the part that does not depend on that, with the same standing as `pairsLast`. Two sections of one kind keep the order they had.
 *
 * Not for a posting outside the candidate's field: there the model reorders on purpose, and the caller leaves it to it.
 */
export function stageOrder(cv: CVDocument, stage: CareerStage): CVDocument {
  const rank = SECTION_RANK[stage];
  const sections = [...cv.sections].sort((a, b) => rank[a.kind] - rank[b.kind]);
  return sections.every((section, at) => section === cv.sections[at]) ? cv : { ...cv, sections };
}
