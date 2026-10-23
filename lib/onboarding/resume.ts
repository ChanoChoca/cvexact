import { isMeaningfulExperience, type StoredCycle, type StoredProfile } from "@/lib/schemas/profile-v2";
import { PRIORITY } from "./config";
import { alreadyKnown, type Gap } from "./gaps";
import { ACHIEVEMENT_TYPES, type AchievementType } from "./questions";

/**
 * What the person had half done: the achievements they were telling, the answer they were typing and the step
 * of the guided profile they were on.
 *
 * Each is kept in the profile's own `onboarding` — beside the step the flow is on, which is kept the same
 * way — so that a reload, a phone that put the tab to sleep or a link opened on another device lands exactly
 * where they were. None of it is career data: it is dropped the moment what it was for is done, and read
 * leniently, because a stale one must cost nothing worse than starting that one thing over.
 */

// --- The achievements cycle ----------------------------------------------------------------------

/** Choosing the kinds, telling each, giving its figure: where one question about achievements has got to. */
export type Cycle = {
  gap: Gap;
  experienceId: string;
  /** Achievements still to tell, in the order they were chosen. */
  remaining: AchievementType[];
  created: number;
  /** An achievement just told, waiting for its figure. */
  figure?: { gap: Gap; factId: string; quote: string };
};

const ACHIEVEMENT_VALUES: ReadonlySet<string> = new Set(ACHIEVEMENT_TYPES.map((type) => type.value));
const isAchievementType = (value: string): value is AchievementType => ACHIEVEMENT_VALUES.has(value);

/** Whether the cycle has anything left to do: a kind to tell, or a figure to give. */
export const cycleHasMore = (cycle: Cycle): boolean => cycle.remaining.length > 0 || Boolean(cycle.figure);

export function storeCycle(cycle: Cycle): StoredCycle {
  return {
    gapId: cycle.gap.id,
    rule: cycle.gap.rule === "more_achievements" ? "more_achievements" : "no_achievements",
    experienceId: cycle.experienceId,
    remaining: [...cycle.remaining],
    created: cycle.created,
    ...(cycle.figure ? { figure: { gapId: cycle.figure.gap.id, factId: cycle.figure.factId } } : {}),
  };
}

/**
 * The cycle the profile was left in, to carry on with — or `null` when there is none worth going back to:
 * none was left, it was about a job that is gone or one the caller is not asking about (`only`), or there
 * is nothing left in it to do. A figure whose fact is gone, or that has been given since, is not waited for.
 */
export function resumeCycle(profile: StoredProfile, only?: string): Cycle | null {
  const stored = profile.onboarding.cycle;
  if (!stored) return null;
  const job = profile.experience.filter(isMeaningfulExperience).find((entry) => entry.id === stored.experienceId);
  if (!job || (only !== undefined && only !== job.id)) return null;

  const gap: Gap = { id: stored.gapId, rule: stored.rule, priority: PRIORITY[stored.rule], experienceId: job.id, payload: {} };
  const fact = stored.figure ? job.facts.find((entry) => entry.id === stored.figure!.factId) : undefined;
  const figureGap: Gap | undefined =
    stored.figure && fact
      ? { id: stored.figure.gapId, rule: "achievement_no_figure", priority: PRIORITY.achievement_no_figure, experienceId: job.id, payload: { factId: fact.id } }
      : undefined;
  const waiting = figureGap && fact && !alreadyKnown(figureGap, profile) ? { gap: figureGap, factId: fact.id, quote: fact.text } : undefined;

  const cycle: Cycle = {
    gap,
    experienceId: job.id,
    remaining: stored.remaining.filter(isAchievementType),
    created: stored.created,
    ...(waiting ? { figure: waiting } : {}),
  };
  return cycleHasMore(cycle) ? cycle : null;
}

/** Keeps where the cycle has got to; `null` when it is over. */
export function saveCycle(draft: StoredProfile, cycle: Cycle | null): void {
  if (cycle && cycleHasMore(cycle)) draft.onboarding.cycle = storeCycle(cycle);
  else delete draft.onboarding.cycle;
}

// --- An answer being typed ------------------------------------------------------------------------

/** The most a draft holds: what a box takes (`NarrativeControl`), no more. */
export const DRAFT_MAX = 1500;

/** What was typed for the question `key` and not yet answered — `undefined` when the draft is for another. */
export function draftFor(profile: Pick<StoredProfile, "onboarding">, key: string): string | undefined {
  const stored = profile.onboarding.draft;
  return stored && stored.key === key && stored.text.trim() ? stored.text : undefined;
}

/** One draft at a time: the one being typed. An empty text is no draft. */
export function saveDraft(draft: StoredProfile, key: string, text: string): void {
  if (text.trim()) draft.onboarding.draft = { key, text: text.slice(0, DRAFT_MAX) };
  else delete draft.onboarding.draft;
}

export function clearDraft(draft: StoredProfile): void {
  delete draft.onboarding.draft;
}

// --- The guided profile's steps --------------------------------------------------------------------

/** The step of the guided profile the person was on (the first is 0), fitted to the steps there are today. */
export function resumeBuilder(profile: Pick<StoredProfile, "onboarding">, steps: number): number {
  return Math.min(profile.onboarding.builder?.index ?? 0, Math.max(0, steps - 1));
}

/** Keeps the step the person is on. The first is where everyone begins and keeps nothing; what the lists this replaced kept (an entry half written) is dropped with it. */
export function saveBuilder(draft: StoredProfile, index: number): void {
  if (index === 0) delete draft.onboarding.builder;
  else draft.onboarding.builder = { index };
}
