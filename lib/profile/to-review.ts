import type { RuleId } from "@/lib/onboarding/config";
import { alreadyKnown, detectGaps, isReviewRule, type Gap, type Signals } from "@/lib/onboarding/gaps";
import { jobName, labelFor } from "@/lib/onboarding/questions";
import { activeDeclined, declinedStanding } from "@/lib/profile/declined";
import { monthOf } from "@/lib/profile/currency";
import { spelledDate, type DateValue } from "@/lib/profile/dates";
import { isMeaningfulExperience, type DeclinedKind, type StoredProfile } from "@/lib/schemas/profile-v2";

/**
 * «Para revisar»: what time brings to a profile, in one list, at the top of it.
 *
 * Time asks five things of whoever has a profile, and it used to ask them in three places —the offer to tell what changed, «Fechas para revisar», and the questions
 * that make a CV better— and left one out: the job that goes on. A job that may have ended, a credential near or past its date, what they said of how they can work
 * said long ago, the stretch with nothing since the last thing that ended, and — when it is switched on — a skill nothing has backed for years; and a «no» that a line
 * written afterwards names (`profile.declined`), which used to wait in «Sobre vos» for someone to look.
 *
 * Each is a thing to settle and not a score: nothing here is required, and what is put off with «Ahora no» stays in the list, apart, until the next visit. The engine
 * asks them the way it always did (`QuestionLoop`, by the id of the question); what this adds is that they are listed once.
 */
export type ReviewKind = "job" | "credential" | "conditions" | "since" | "stale" | "declined";

export type ReviewItem = {
  /** The id of the question that settles it — or, for a «no», `declined:<id>`, which is answered on its own row. */
  id: string;
  kind: ReviewKind;
  /** The row: what there is to settle, in a line. */
  label: string;
  /** Under it, in small type: the date that makes it a thing to review. */
  note?: string;
  /** What it is called in the line that says what was reviewed: «tu puesto en Logística Sur», «lo práctico para trabajar». */
  short: string;
  /** The job it is about, for «¿Seguís en…?»: its card says so too. */
  experienceId?: string;
  /** Put off in this visit: listed apart, and not asked again until the next one. */
  later: boolean;
  /** For `declined`: the «no» and the line that now names it. */
  declined?: { id: string; kind: DeclinedKind; text: string; line: string };
};

const KIND_OF: Partial<Record<RuleId, ReviewKind>> = {
  credential_expiry: "credential",
  current_job_review: "job",
  conditions_review: "conditions",
  since_last: "since",
  skill_stale: "stale",
};

/** In the order they are listed: what lapses first, then what may have ended, then what was said, then the «no» that a line names, then what is nobody's fault. */
const ORDER: readonly ReviewKind[] = ["credential", "job", "conditions", "declined", "since", "stale"];

export const DECLINED_PREFIX = "declined:";
export const declinedItemId = (id: string): string => `${DECLINED_PREFIX}${id}`;
export const isDeclinedItemId = (id: string): boolean => id.startsWith(DECLINED_PREFIX);

/** Whether a question was put off in this visit: after the last session began, which is the engine's own reading of «until the next time». */
export function putOffThisVisit(profile: StoredProfile, id: string): boolean {
  const started = profile.onboarding.sessionStartedAt;
  if (started === "") return false;
  const entry = profile.pending.find((pending) => pending.questionId === id);
  return Boolean(entry && (entry.state === "later" || entry.state === "skipped") && entry.at >= started);
}

function describe(found: Gap, profile: StoredProfile): Pick<ReviewItem, "note" | "short"> {
  const jobs = profile.experience.filter(isMeaningfulExperience);
  switch (found.rule) {
    case "current_job_review": {
      const job = jobs.find((entry) => entry.id === found.experienceId);
      const since = monthOf(String(found.payload.since ?? ""));
      return { short: `tu puesto en ${job ? jobName(job, jobs) : "este lugar"}`, ...(since ? { note: `Lo último que anotaste de este puesto es de ${since}.` } : {}) };
    }
    case "credential_expiry":
      return { short: `la renovación de «${String(found.payload.name ?? "una credencial")}»` };
    case "conditions_review": {
      const since = monthOf(String(found.payload.since ?? ""));
      const line = String(found.payload.line ?? "").trim();
      return { short: "lo práctico para trabajar", ...(since ? { note: `Lo anotaste en ${since}${line ? `: ${line}` : ""}.` } : {}) };
    }
    case "since_last":
      return { short: `lo que hiciste desde ${spelledDate(found.payload.from as DateValue)}` };
    default:
      return { short: String(found.payload.name ?? "una habilidad") };
  }
}

/**
 * What there is to review, in order. `putOff` is what this browser remembers of the «no»s put off with «Ahora no» (`lib/storage/return-review.ts`): the questions of the
 * engine remember that in the profile, and these are not questions of the engine. Pure, with the clock as an argument.
 */
export function reviewItems(profile: StoredProfile, now: Date, options: { signals?: Signals | undefined; putOff?: Readonly<Record<string, string>> | undefined } = {}): ReviewItem[] {
  const items: ReviewItem[] = [];

  for (const found of detectGaps(profile, now, options.signals ?? {})) {
    const kind = KIND_OF[found.rule];
    if (!kind || !isReviewRule(found.rule)) continue;
    // Turned down for this one, or answered in the words the profile already has: not a thing to review.
    if (profile.pending.some((entry) => entry.questionId === found.id && entry.state === "na") || alreadyKnown(found, profile)) continue;
    items.push({
      id: found.id,
      kind,
      label: labelFor(found, profile),
      ...(found.experienceId ? { experienceId: found.experienceId } : {}),
      later: putOffThisVisit(profile, found.id),
      ...describe(found, profile),
    });
  }

  for (const entry of activeDeclined(profile)) {
    const standing = declinedStanding(profile, entry, now);
    if (standing.state !== "named") continue;
    const id = declinedItemId(entry.id);
    const until = options.putOff?.[id];
    items.push({
      id,
      kind: "declined",
      label: entry.kind === "inferred_skill" ? `Sacaste «${entry.text}» de tus habilidades` : `Dijiste que no tenés «${entry.text}»`,
      note: `Hay una línea nueva que nombra «${entry.text}»: «${standing.line}». ¿Sigue siendo así?`,
      short: `«${entry.text}»`,
      later: until !== undefined && until > now.toISOString(),
      declined: { id: entry.id, kind: entry.kind, text: entry.text, line: standing.line },
    });
  }

  // A stable sort: inside each kind the order is the engine's — the stalest job first, the credential that lapsed longest ago first.
  return items.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

/** What is still to settle now: not what was put off for later. */
export const openReviewItems = (items: readonly ReviewItem[]): ReviewItem[] => items.filter((item) => !item.later);

const sentence = (parts: readonly string[]): string => (parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`);

/**
 * What the block says of a visit when there is nothing left to settle now: what was reviewed, and what stayed for later — «Revisado hoy: tu puesto en Logística Sur y lo
 * práctico para trabajar. Para después: la renovación de «Habilitación».» Names what it was about and not what was said, which each answer already said when it was given,
 * with its «Deshacer». `settled` and `left` are the names of the things (`ReviewItem.short`); nothing at all when there are neither.
 */
export function recapLine(settled: readonly string[], left: readonly string[]): string {
  return [settled.length > 0 ? `Revisado hoy: ${sentence(settled)}.` : "", left.length > 0 ? `Para después: ${sentence(left)}.` : ""].filter(Boolean).join(" ");
}

/** «Lo último que revisaste es de febrero de 2026.»: the date, and never how long it has been (CT6). */
export const pauseLine = (since: string): string => `Lo último que revisaste es de ${monthOf(since)}.`;
