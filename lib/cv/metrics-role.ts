import { monthsBetween, normalize, parseProfileDate } from "@/lib/ai/evidence";
import type { CVDocument } from "@/lib/schemas/cv";
import type { Profile } from "@/lib/schemas/profile";

/**
 * Which profile role to ask about numbers for, when the generated CV came out
 * with none.
 *
 * Neither "the role the CV leaned on hardest" nor "the most recent role" is
 * right on its own. Weight alone can point at a role from years ago, asking
 * the user to remember figures for something that is no longer what they'd
 * lead with — and worse, it can bury the present: a candidate's current job is
 * what a recruiter reads first, and a purely weight-based pick can skip it
 * entirely if an old role happens to have more bullets. Recency alone has the
 * opposite failure: a role started two months ago may have one thin bullet,
 * and interrupting the user to ask it for numbers before an older, richer role
 * gets a turn is friction for no reason.
 *
 * So the score is weight discounted by age, not one or the other. A role's
 * weight is how many of the CV's own bullets came from it — the model already
 * read the posting and decided what mattered, so this is the best relevance
 * signal available without re-deriving it. That weight is then multiplied by
 * how fresh the role is, so a thin-but-current role beats a heavy-but-ancient
 * one only when the gap in weight is small enough for recency to make up the
 * difference, and a heavy old role still wins when the gap is large.
 *
 * `profile.experience` is not guaranteed to be sorted by date — nothing in
 * this codebase sorts it, it is whatever order the user left it in (or the
 * import produced) — so recency is read from the role's own `current`/`end`
 * fields via `parseProfileDate`, never from array position.
 */

/**
 * A percentage or any two-plus-digit figure, matching `hasMetric` in
 * tests/eval/score.ts so this counts exactly the CVs that harness treats as
 * having no number. Single digits are usually a team size or a year fragment,
 * not an achievement.
 */
const METRIC = /\d+\s*%|\b\d{2,}\b/;

export function cvHasMetric(cv: CVDocument): boolean {
  return cv.sections.some((section) =>
    section.kind === "experience"
      ? section.items.some((item) => item.bullets.some((b) => METRIC.test(b)))
      : section.kind === "bullets"
        ? section.bullets.some((b) => METRIC.test(b))
        : false,
  );
}

/**
 * How much a role's age discounts its weight. A current role is never
 * discounted; an unreadable end date is treated as neutral rather than old —
 * a hand-typed profile with no parseable date must not always lose to an
 * imported one just for lacking one.
 */
function recencyFactor(role: Profile["experience"][number], now: Date): number {
  if (role.current) return 1;
  const end = parseProfileDate(role.end);
  if (!end) return 0.85;
  const years = monthsBetween(end, now) / 12;
  if (years <= 2) return 0.9;
  if (years <= 5) return 0.7;
  return 0.5;
}

/**
 * The best-scoring role for the wizard to ask about — whether there is
 * actually anything left to ask it is not this function's question any more.
 * That used to be `hasPendingBullets`, checking a bullet against the role's
 * own `metrics` records; the gaps engine (`lib/onboarding/gaps.ts`) now owns
 * that check globally, the same way it does for the onboarding, so the
 * caller filters on `achievement_no_figure` (or whatever else is eligible)
 * for the id this returns, rather than this module re-deriving it from a
 * plain `Profile`'s own fields.
 */
export function pickMetricsRole(
  cv: CVDocument,
  profile: Profile,
  now: Date = new Date(),
): number | null {
  // How many of the CV's own bullets came from each company. A `Map` keyed by
  // normalised name, summed rather than overwritten, so two profile roles at
  // the same company (a promotion) share one weight and are then told apart
  // by recency — which is the right tiebreaker for that case.
  const weightByCompany = new Map<string, number>();
  for (const section of cv.sections) {
    if (section.kind !== "experience") continue;
    for (const item of section.items) {
      const key = normalize(item.company);
      weightByCompany.set(key, (weightByCompany.get(key) ?? 0) + item.bullets.length);
    }
  }

  const candidates = profile.experience
    .map((role, index) => ({
      index,
      role,
      weight: weightByCompany.get(normalize(role.company)) ?? 0,
    }))
    // A role the CV never drew from is not worth interrupting for.
    .filter(({ weight }) => weight > 0);

  if (candidates.length === 0) {
    // A profile with exactly one role is the case this panel exists for, and
    // the model translating the company name must not cost the user the ask.
    if (profile.experience.length === 1 && cv.sections.some((s) => s.kind === "experience")) {
      return profile.experience[0] ? 0 : null;
    }
    return null;
  }

  const best = candidates.reduce((current, next) => {
    const currentScore = current.weight * recencyFactor(current.role, now);
    const nextScore = next.weight * recencyFactor(next.role, now);
    // Ties keep the incumbent: candidates are walked in profile order, and
    // under the import convention ("most recent role first") that order
    // already favours the fresher role on a tie.
    return nextScore > currentScore ? next : current;
  });

  return best.index;
}
