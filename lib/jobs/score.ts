import {
  buildEvidenceIndex,
  hardTermsIn,
  matchKeywords,
  normalize,
  statedYearsOfExperience,
  type KeywordPartition,
} from "@/lib/ai/evidence";
import { blockingExclusions, type BlockingExclusion } from "@/lib/ai/preflight";
import type { JobAnalysis, Requirement } from "@/lib/schemas/job";
import type { Profile } from "@/lib/schemas/profile";
import type { JobPosting } from "@/lib/jobs/feed-query";
import { objectiveFit, objectiveOverlap, type ObjectiveFit } from "@/lib/jobs/objective";

/**
 * Deterministic "does this posting fit this profile?" score. Zero model calls
 * — everything here is the same lexical machinery `lib/ai/preflight.ts` and
 * `lib/ai/prompts/shared.ts` already use to decide what a CV may honestly
 * claim, pointed at a different question.
 *
 * That reuse is the point, not a shortcut: there is no free AI tier
 * (`resolveModel` refuses `free` outright — see `lib/quota.ts`), so a job
 * discovery feed that scored every posting through the model would either
 * cost the user credits just to *browse* or cost the operator money it does
 * not have. This runs in the browser, for free, on any number of postings.
 *
 * `scoreMatch` takes a `MatchInput` rather than a `JobAnalysis` directly so
 * the same scoring logic covers two very different callers: a posting the
 * user pasted and paid one `analyzeJob` call to structure (full
 * `requirements[]`, `keywords[]` mirrored from the ad's own vocabulary), and
 * a raw listing pulled from an aggregated feed that nobody has analyzed yet
 * (just a title, tags and a description — see `scoreJobAnalysis` and, once
 * the feed exists, its raw-listing counterpart).
 */

export type SeniorityFit = "under" | "match" | "over" | "unknown";
export type LocationFit = "remote" | "same_place" | "relocatable" | "mismatch" | "unknown";

export type JobMatch = {
  /** 0–100. A relative ranking signal, not a probability of getting hired. */
  score: number;
  /** Named technologies the posting asks for, split by whether the profile backs them. */
  keywords: KeywordPartition;
  seniorityFit: SeniorityFit;
  locationFit: LocationFit;
  /** `null` when the posting's language cannot be resolved to a language the profile states or omits. */
  languageFit: boolean | null;
  /**
   * Excluding requirements the profile does not answer — empty unless
   * `MatchInput.requirements` was supplied, which only ever happens once
   * `analyzeJob` has actually run. A raw feed listing never has these: the
   * whole point of scoring it first is deciding whether that AI call is
   * worth spending.
   */
  blocking: BlockingExclusion[];
  /** Whether the posting's title says what the profile's objective says: `unknown` with no objective, or no title to read. */
  objectiveFit: ObjectiveFit;
};

export type MatchInput = {
  /**
   * Named terms drawn from the posting. For an analyzed job this is
   * `analysis.keywords`; for a raw feed listing it is whatever
   * `lib/ai/evidence.ts#hardTermsIn` finds in the title, tags and
   * description — the same function `findUnsupportedTerms` already runs
   * against CV prose, pointed at the posting instead.
   */
  keywords: readonly string[];
  seniority: JobAnalysis["seniority"];
  workMode: JobAnalysis["workMode"];
  location: string;
  /** BCP-47-ish, e.g. "es", "en" — same shape as `JobAnalysis.language`. */
  language: string;
  /** Present only once `analyzeJob` has run. See `JobMatch.blocking`. */
  requirements?: readonly Requirement[];
  /** What the objective is compared to: the posting's title, and the terms it names. */
  title?: string;
  tags?: readonly string[];
};

/**
 * Expected years of experience for each seniority band, as the postings that
 * use these words actually mean them — not a formal levelling framework.
 * `[min, max]`; `max: null` means "and up".
 */
const SENIORITY_YEARS: Record<
  Exclude<JobAnalysis["seniority"], "unknown" | "not_applicable">,
  readonly [number, number | null]
> = {
  intern: [0, 1],
  junior: [0, 3],
  mid: [2, 6],
  senior: [5, 12],
  lead: [8, null],
};

function seniorityFit(
  seniority: JobAnalysis["seniority"],
  profile: Profile,
  now: Date,
): SeniorityFit {
  if (seniority === "unknown" || seniority === "not_applicable") return "unknown";

  const spans = profile.experience;
  if (spans.length === 0) return "unknown";
  const years = statedYearsOfExperience(profile, now);
  // `statedYearsOfExperience` returns 0 both when nothing is dated and when the
  // candidate genuinely has under a year — the two cases this cannot tell apart
  // read identically here, which is the same tradeoff the function documents at
  // its own definition.
  const [min, max] = SENIORITY_YEARS[seniority];
  if (years < min) return "under";
  if (max !== null && years > max) return "over";
  return "match";
}

/** Lowercased, accent-stripped city/country tokens shared between two places. */
function placesOverlap(a: string, b: string): boolean {
  const tokensA = new Set(normalize(a).split(" ").filter((t) => t.length > 2));
  const tokensB = normalize(b).split(" ").filter((t) => t.length > 2);
  return tokensB.some((t) => tokensA.has(t));
}

function locationFit(input: Pick<MatchInput, "workMode" | "location">, profile: Profile): LocationFit {
  if (input.workMode === "remote") return "remote";
  if (!input.location.trim()) return "unknown";

  const here = [profile.city, profile.country].filter(Boolean).join(" ");
  if (here && placesOverlap(here, input.location)) return "same_place";
  if (profile.practical.willingToRelocate) return "relocatable";
  if (!here) return "unknown";
  return "mismatch";
}

/**
 * Language names in the two languages a CV comes out in, keyed by the BCP-47
 * tag `JobAnalysis.language` and `matchKeywords` deal in. Short on purpose —
 * these are the two languages the product's own output ever uses; a posting
 * in a third language still gets a score, just with `languageFit: null`.
 */
const LANGUAGE_NAMES: Record<string, readonly string[]> = {
  es: ["español", "espanol", "spanish", "castellano"],
  en: ["inglés", "ingles", "english"],
  pt: ["portugués", "portugues", "portuguese"],
};

function languageFit(language: string, profile: Profile): boolean | null {
  const tag = language.trim().toLowerCase().slice(0, 2);
  const names = LANGUAGE_NAMES[tag];
  if (!names) return null;
  // A posting in Spanish does not ask for Spanish: it is written in the language of whoever reads it, and the product and its people are
  // Spanish. Few profiles list their own language, so counting «Español» as missing took ten points off nearly every posting in the
  // country and told the person it «pide un idioma que tu perfil no declara» — of an ad they read without a dictionary.
  if (tag === "es") return true;
  return profile.languages.some((entry) => names.includes(normalize(entry.name)));
}

/** One scored component: its 0–1 value, and whether the posting had enough signal to compute it at all. */
type Component = { value: number; available: boolean; weight: number };

function weightedScore(components: readonly Component[]): number {
  const usable = components.filter((c) => c.available);
  const totalWeight = usable.reduce((sum, c) => sum + c.weight, 0);
  // Nothing about the posting was legible enough to score — e.g. a raw feed
  // listing with no named technologies, no seniority, no location and no
  // recognisable language. Silence would be more honest than a number, but a
  // feed needs some order; a neutral midpoint. Real evidence to either side
  // pulls it away from here immediately.
  if (totalWeight === 0) return 50;

  const sum = usable.reduce((acc, c) => acc + c.value * c.weight, 0);
  return Math.round((sum / totalWeight) * 100);
}

/**
 * Scores any posting the app has enough structure for, from a bare feed
 * listing up to a fully `analyzeJob`-ed one. See `scoreJobAnalysis` for the
 * common case of scoring an already-analyzed posting.
 */
export function scoreMatch(profile: Profile, input: MatchInput, now: Date = new Date()): JobMatch {
  const index = buildEvidenceIndex(profile);
  const keywords = matchKeywords(index, [...input.keywords]);
  const namedTermCount = keywords.supported.length + keywords.fabricable.length;

  const seniority = seniorityFit(input.seniority, profile, now);
  const location = locationFit(input, profile);
  const language = languageFit(input.language, profile);

  const objective = profile.objective.trim();
  const title = input.title ?? "";
  const overlap = objective && title ? objectiveOverlap(objective, title, input.tags ?? []) : 0;

  const score = weightedScore([
    {
      // Neutral phrasing the posting shares with everyone ("trabajo en
      // equipo") says nothing about fit; only the named technologies do, and
      // only once there is at least one to judge by.
      value: namedTermCount > 0 ? keywords.supported.length / namedTermCount : 0,
      available: namedTermCount > 0,
      weight: 50,
    },
    {
      value: seniority === "match" ? 1 : seniority === "over" ? 0.7 : seniority === "under" ? 0.3 : 0,
      available: seniority !== "unknown",
      weight: 20,
    },
    {
      value:
        location === "remote" || location === "same_place"
          ? 1
          : location === "relocatable"
            ? 0.6
            : location === "mismatch"
              ? 0
              : 0,
      available: location !== "unknown",
      weight: 20,
    },
    {
      value: language === true ? 1 : 0,
      available: language !== null,
      weight: 10,
    },
    {
      // What the person said they are after, found in the posting's own title. Only ever adds: a title that shares no
      // word with the objective may be in another language, or say it differently, and is not held against the
      // posting (the component is simply not there); one that does share words moves up, which is what puts the
      // postings for a new field above those for the one being left. Nothing for a profile with no objective.
      value: overlap,
      available: overlap > 0,
      weight: 15,
    },
  ]);

  const blocking =
    input.requirements && input.requirements.length > 0
      ? blockingExclusions(profile, { requirements: [...input.requirements] })
      : [];

  return {
    score,
    keywords,
    seniorityFit: seniority,
    locationFit: location,
    languageFit: language,
    blocking,
    objectiveFit: objectiveFit(objective, title, input.tags ?? []),
  };
}

/** Scores a posting that has already been through `analyzeJob` — the common case in `/postular`. */
export function scoreJobAnalysis(profile: Profile, analysis: JobAnalysis, now: Date = new Date()): JobMatch {
  return scoreMatch(
    profile,
    {
      keywords: analysis.keywords,
      seniority: analysis.seniority,
      workMode: analysis.workMode,
      location: analysis.location,
      language: analysis.language,
      requirements: analysis.requirements,
      title: analysis.title,
      tags: analysis.keywords,
    },
    now,
  );
}

const WORK_MODES = new Set<JobAnalysis["workMode"]>(["onsite", "hybrid", "remote", "unknown"]);
const SENIORITIES = new Set<JobAnalysis["seniority"]>([
  "intern",
  "junior",
  "mid",
  "senior",
  "lead",
  "not_applicable",
  "unknown",
]);

/** `"unknown"` for anything a raw `job_posting` row states that is not one of
 *  the enum's own values — a hand-edited row, a future source with a bug —
 *  rather than trusting a column Zod never validated on the way in. */
function asWorkMode(value: string): JobAnalysis["workMode"] {
  return (WORK_MODES as Set<string>).has(value) ? (value as JobAnalysis["workMode"]) : "unknown";
}
function asSeniority(value: string): JobAnalysis["seniority"] {
  return (SENIORITIES as Set<string>).has(value) ? (value as JobAnalysis["seniority"]) : "unknown";
}

/**
 * Only the `JobPosting` fields scoring actually reads. Deliberately narrower
 * than the full type: `/empleos` calls this with rows straight out of
 * `/api/jobs/feed`'s JSON, where `publishedAt`/`fetchedAt` are strings, and
 * `app/api/jobs/alerts/send/route.ts` calls it with rows straight out of
 * Drizzle, where those same two columns are `Date`. Neither shape is a
 * `JobPosting`, and neither needs to be — this is.
 */
export type ScorableJobPosting = Pick<
  JobPosting,
  "title" | "tags" | "description" | "seniority" | "workMode" | "location" | "language"
>;

/**
 * Turns a raw feed listing into the same `MatchInput` shape an analyzed
 * posting produces, so `scoreMatch` cannot tell the two apart — the feed and
 * `/postular` share one definition of "match".
 *
 * No `requirements` here, and so no `blocking` in the result: that field only
 * exists once `analyzeJob` has actually read the posting, which costs a
 * model call this stage exists to avoid paying before the user has even
 * decided the posting is worth it. `keywords` comes from `hardTermsIn` — the
 * same glossary walk `findUnsupportedTerms` runs against CV prose — over the
 * title, the source's own tags and the description together.
 */
export function matchInputFromPosting(job: ScorableJobPosting): MatchInput {
  return {
    keywords: hardTermsIn([job.title, ...job.tags, job.description].join(" ")),
    seniority: asSeniority(job.seniority),
    workMode: asWorkMode(job.workMode),
    location: job.location,
    language: job.language,
    title: job.title,
    tags: job.tags,
  };
}

/** Scores a raw feed listing — the job board feed's own case, before anyone
 *  has paid for `analyzeJob` to read it. */
export function scoreJobPosting(
  profile: Profile,
  job: ScorableJobPosting,
  now: Date = new Date(),
): JobMatch {
  return scoreMatch(profile, matchInputFromPosting(job), now);
}
