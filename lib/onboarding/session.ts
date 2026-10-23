import { ENGINE } from "./config";
import { statesQuantity } from "./figure";
import { alreadyKnown, contentFacts, detectGaps, isReviewRule, yearsSinceEnd, type Gap, type Session, type Signals } from "./gaps";
import { figureLabel, jobName, labelFor, questionFor, type Question } from "./questions";
import { isResultFact } from "./results";
import { isMeaningfulExperience, type StoredProfile } from "@/lib/schemas/profile-v2";

/**
 * A session: the stretch in which someone is asked things, with its own budget.
 *
 * A visit soon after the last is the same session; one after a long gap is a new
 * one, and a new one starts the counters over. "Más tarde" waits for exactly this:
 * the question that was put off comes back when the next session begins.
 */

export const sessionOf = (profile: StoredProfile): Session => ({
  askedThisSession: profile.onboarding.askedThisSession,
  askedQuick: profile.onboarding.askedQuick,
  askedByExperience: profile.onboarding.askedByExperience,
  startedAt: profile.onboarding.sessionStartedAt,
});

/** Whether a session is in progress: the last one began recently enough to be this visit's. */
export function isSessionFresh(profile: Pick<StoredProfile, "onboarding">, now: Date = new Date()): boolean {
  const last = profile.onboarding.sessionStartedAt ? Date.parse(profile.onboarding.sessionStartedAt) : NaN;
  return Number.isFinite(last) && now.getTime() - last < ENGINE.session.staleAfterHours * 3_600_000;
}

/** Starts a session if there is none in progress. Returns whether it started one. */
export function beginSession(draft: StoredProfile, now: Date = new Date()): boolean {
  if (isSessionFresh(draft, now)) return false;
  const { onboarding } = draft;
  onboarding.sessionCount += 1;
  onboarding.askedThisSession = 0;
  onboarding.askedQuick = 0;
  onboarding.askedByExperience = {};
  onboarding.sessionStartedAt = now.toISOString();
  return true;
}

/**
 * "Seguir un rato": the person asked for more, so the budget starts again. It is the
 * same session — what was put off with "más tarde" stays put off, and the count of
 * sessions does not move — only the limits do.
 */
export function extendSession(draft: StoredProfile): void {
  draft.onboarding.askedThisSession = 0;
  draft.onboarding.askedQuick = 0;
  draft.onboarding.askedByExperience = {};
}

// --- What the close of a session says --------------------------------------------------------------------

export type ExperienceProgress = {
  id: string;
  label: string;
  facts: number;
  hasAchievement: boolean;
  hasFigure: boolean;
  /** Things still worth asking about this job. */
  open: number;
};

/** Per job, not overall: a single percentage for the whole profile is the one number that pushes people to fill in everything. */
export function progressByExperience(profile: StoredProfile, now: Date = new Date()): ExperienceProgress[] {
  const gaps = detectGaps(profile, now);
  const jobs = profile.experience.filter(isMeaningfulExperience);
  return jobs.map((job) => {
    const content = contentFacts(job);
    // The same reading `detectGaps` asks by: a CV line that already reports a
    // result, with its number in the words, is "con logros · con cifra" here too.
    const results = content.filter(isResultFact);
    return {
      id: job.id,
      label: jobName(job, jobs),
      facts: content.length,
      hasAchievement: results.length > 0,
      hasFigure: content.some((fact) => Boolean(fact.metric && "value" in fact.metric)) || results.some((fact) => statesQuantity(fact.text)),
      open: gaps.filter((gap) => gap.experienceId === job.id && gap.priority !== "blocking").length,
    };
  });
}

export type SessionSummary = {
  /** Facts added by answering, this session. */
  facts: number;
  /** Achievements that now have a figure, from this session. */
  figures: number;
};

export function summaryOfSession(profile: StoredProfile): SessionSummary {
  const since = profile.onboarding.sessionStartedAt;
  const fresh = (at: string) => since !== "" && at >= since;
  let facts = 0;
  let figures = 0;
  for (const job of profile.experience) {
    for (const fact of job.facts) {
      if (fact.source.kind === "answer" && fresh(fact.source.at)) facts += 1;
    }
  }
  for (const entry of profile.history) {
    if (entry.op !== "set" || !fresh(entry.at) || entry.path[entry.path.length - 2] !== "facts") continue;
    const after = entry.after as { metric?: { value?: string } } | undefined;
    const before = entry.before as { metric?: unknown } | undefined;
    if (after?.metric?.value && !before?.metric) figures += 1;
  }
  return { facts, figures };
}

/**
 * "Falta un logro" / "Falta una cifra": the marks a job's own card shows in
 * its summary (§3 — never in the preview, which stays clean, and never a
 * percentage). Only these two rules, of the thirteen `detectGaps` knows: they
 * are the ones a single visit to that job's own questions can actually
 * resolve, one tap away, unlike `no_content`/`incomplete_skeleton`, which
 * need real information typed in first — and `more_achievements` is not
 * missing anything: a job it asks about already tells a result, so "Falta un
 * logro" would be false. A gap the person marked "no
 * aplica", or one the profile already knows the answer to from the words
 * already there, is not shown — that would be asking again for what was
 * already declined or already said.
 */
export function gapMarks(profile: StoredProfile, experienceId: string, now: Date = new Date()): string[] {
  const isOpen = (found: Gap): boolean => {
    const entry = profile.pending.find((pending) => pending.questionId === found.id);
    return entry?.state !== "na" && !alreadyKnown(found, profile);
  };
  const gaps = detectGaps(profile, now).filter((found) => found.experienceId === experienceId);
  const marks: string[] = [];
  if (gaps.some((found) => found.rule === "no_achievements" && isOpen(found))) marks.push("Falta un logro");
  // Not once the person has said there are no figures in their work: the mark would ask for what they said does not exist.
  const figuresOff = Boolean(profile.fatigue.achievement_no_figure?.off);
  if (!figuresOff && gaps.some((found) => found.rule === "achievement_no_figure" && isOpen(found))) marks.push("Falta una cifra");
  return marks;
}

export type PendingItem = {
  id: string;
  /**
   * `later` and `skipped` are questions the person put off; `figure` is an achievement whose number they did not know, to add if they find it; `optional` is a
   * job old enough that the profile does not ask about it, and can do without. What time brings —a date to settle, a job that may have ended— is not here: it is
   * listed in «Para revisar» (`lib/profile/to-review.ts`).
   */
  kind: "later" | "skipped" | "figure" | "optional";
  label: string;
  experienceId?: string;
  /** The line a `figure` item is about, to find it again in the profile. */
  factId?: string;
  /** The question itself, when it can be asked as one. */
  question?: Question;
};

/**
 * Where an item of what is left is picked up: its question, asked by name — or, for a
 * figure nobody had, the line it belongs to in the profile, since there is no
 * question to ask, only a number to add if it turns up.
 */
export function pendingHref(item: PendingItem): string {
  if (item.kind === "figure" && item.factId) return `/perfil?tarea=${encodeURIComponent(item.factId)}`;
  return `/perfil/preguntas?pregunta=${encodeURIComponent(item.id)}`;
}

/**
 * What is left, for the close of a session and for the profile: what was put off,
 * the figures nobody had, and the old jobs left as a skeleton. Nothing in it is
 * required; it is the list of what would make the profile better, in the order it
 * would matter.
 */
export function pendingItems(profile: StoredProfile, now: Date = new Date(), signals: Signals = {}): PendingItem[] {
  const items: PendingItem[] = [];
  const gaps = detectGaps(profile, now, signals);
  const byId = new Map(gaps.map((found) => [found.id, found]));

  for (const entry of profile.pending) {
    if (entry.state === "na") continue;
    const found = byId.get(entry.questionId);
    if (!found) continue;
    // What time brings is listed in «Para revisar», put off or not: here it would be said twice.
    if (isReviewRule(found.rule)) continue;
    // A note somebody wrote down is theirs, and putting off where it goes is not a thing they left undone: nothing piles up from writing something down.
    if (found.rule === "note_to_place") continue;
    items.push({
      id: found.id,
      kind: entry.state,
      label: labelFor(found, profile),
      ...(found.experienceId ? { experienceId: found.experienceId } : {}),
      question: questionFor(found, profile),
    });
  }

  for (const job of profile.experience.filter(isMeaningfulExperience)) {
    for (const fact of job.facts) {
      // Any line whose figure was asked and not known — a result, or a duty that said «muchos» — is a number to add if it turns up.
      if (fact.metric && "unknown" in fact.metric) {
        items.push({ id: `figure:${fact.id}`, kind: "figure", label: figureLabel(fact.text), experienceId: job.id, factId: fact.id });
      }
    }
  }

  const queued = new Set(items.map((item) => item.id));
  for (const found of gaps) {
    if (found.rule !== "no_content" || queued.has(found.id) || !found.experienceId) continue;
    const job = profile.experience.find((entry) => entry.id === found.experienceId);
    if (job && (yearsSinceEnd(job, now) ?? 0) > ENGINE.skeletonOnlyAfterYears) {
      items.push({ id: found.id, kind: "optional", label: `${labelFor(found, profile)} (opcional)`, experienceId: job.id });
    }
  }

  return items;
}
