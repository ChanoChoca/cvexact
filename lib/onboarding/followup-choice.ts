import type { StoredProfile } from "@/lib/schemas/profile-v2";
import type { RuleId } from "./config";
import { eligibleGaps, type Gap, type Session } from "./gaps";

/**
 * The questions a model may choose among, after an answer about a job: a few of the engine's own, written once.
 *
 * Only the kinds a person's own words can already have answered, or left open — how much, how many people, what changed, what else
 * was done — and only for the job the answer was about, and only what the engine itself would be allowed to ask about it now
 * (`eligibleGaps`: the session's budget, what was turned down or put off, the figures that were said not to exist). So the choice is
 * of *order*, never of *whether*: it cannot make a question appear that the engine would not have asked.
 *
 * What the model is told of each is what asking it would draw out, in a line of ours — not the sentence the person would be asked,
 * which names their company and quotes their words. It needs to know which kind of question is which to judge from an answer which
 * one is missing; it has no use for anything else of their profile, and none of it goes. One of each kind: two figures to ask for
 * are the same choice, and the first, by the engine's own order, is the one that is asked.
 */

const ABOUT: Partial<Record<RuleId, string>> = {
  achievement_no_figure: "Ask for a figure — an amount, a percentage, a time — for an achievement the person already told.",
  vague_scale: "Ask how many, when the person said something vague such as «muchos clientes» or «a diario».",
  scope_unknown: "Ask whether they had people in their charge, and how many.",
  no_achievements: "Ask whether anything improved, got faster or grew thanks to their work in this job: no result has been told yet.",
  more_achievements: "Ask whether anything else improved thanks to their work in this job.",
  thin_content: "Ask what else they did in this job, because what they said of it so far is little.",
};

/** With fewer kinds there is nothing to choose between, and nothing to spend a call on. */
export const MIN_CHOICES = 2;

export type FollowUpChoice = { id: string; about: string; gap: Gap };

export function followUpChoices(profile: StoredProfile, jobId: string, session: Session, now: Date, skip: ReadonlySet<string> = new Set(), options: { compact?: boolean } = {}): FollowUpChoice[] {
  const seen = new Set<RuleId>();
  const choices: FollowUpChoice[] = [];
  for (const gap of eligibleGaps(profile, session, now, options)) {
    const about = ABOUT[gap.rule];
    if (!about || gap.experienceId !== jobId || skip.has(gap.id) || seen.has(gap.rule)) continue;
    seen.add(gap.rule);
    choices.push({ id: gap.id, about, gap });
  }
  return choices;
}
