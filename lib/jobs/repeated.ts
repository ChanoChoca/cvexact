import { buildEvidenceIndex, contentWords } from "@/lib/ai/evidence";
import { ENGINE } from "@/lib/onboarding/config";
import { companyMatchKey } from "@/lib/onboarding/merge";
import type { Profile } from "@/lib/schemas/profile";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { normalizeForComparison, skillKey } from "@/lib/text/normalize";
import { askRank, askTypeOf, mentionedCandidates, openness, questionFor, type AskKind, type AskType, type Candidate } from "./requirement-ask";
import { readRequirements, type Obligation } from "./requirements";

/**
 * What several of the offers a person analysed ask for, asked once (e5, O10; e3, A2).
 *
 * The question of an offer (`requirement-ask.ts`) is about one offer. This one is about the person's own search: the offers they chose to
 * analyse — an explicit act, so never the ones they only looked at — read as the question of an offer reads them, and a thing that comes up
 * again and again put as a question, in the engine, within the session's one budget. It is said as a **count of what they saw** —
 * «Aparece en 3 de las últimas 10 ofertas que analizaste» — and never as what the market wants or what they lack: that is a forecast, and the
 * product has none to give (P11). `lib/voice.ts` keeps those phrases out of everything that is said.
 *
 * What lets it ask, all of it, so that a single posting republished does not count as three and a thing that is nobody's requirement does not
 * interrupt anyone:
 *  - it appears in at least `ENGINE.repeated.minOffers` of the last `ENGINE.repeated.lastOffers` offers analysed, within `withinDays`;
 *  - from at least `minEmployers` different employers (an offer that names none counts as one more employer, never as several);
 *  - in at least one of them without the mark of a nicety («deseable», «valorable»);
 *  - and it is a kind of thing a person can say yes or no to (the reading never makes a question of a trait), the profile does not already say
 *    it, and no «no» of theirs stands in the way: the same two checks as the question of one offer.
 *
 * Pure. The offers come in, the question — or nothing — goes out.
 */

/** What of an offer this needs: the posting, when it was analysed, and who posted it. An `Application` has all three. */
export type SeenOffer = {
  id: string;
  createdAt: string;
  jobText: string;
  analysis?: { company?: string | undefined } | undefined;
};

export type RepeatedRequirement = {
  kind: AskKind;
  type: AskType;
  /** What the question names, and what a «no» is kept under. */
  thing: string;
  /** What the offers are counted by: «tool:excel». It is in the id of the question, so that one thing is one question however many offers say it. */
  key: string;
  /** The offer's own line, as the most recent of the offers that say it wrote it. */
  fragment: string;
  question: string;
  /** In how many of the `of` offers looked at it appears. */
  count: number;
  of: number;
  obligation: Obligation;
  /** The day they said no to this, when this is the second time it is asked (a year later, once). */
  again?: string;
};

const DAY_MS = 86_400_000;

const stemOf = (word: string): string => word.slice(0, word.length >= 6 ? 5 : 4);

/**
 * What a thing is counted by, so that two offers that say it in other words count as one: a tool by its name (`skillKey` folds «MS Excel» into
 * «Excel»), a task or a credential by the first letters of the words that carry it — «atención al público» and «atender al público» are not
 * one, «carnet de manipulación de alimentos» and «carnet de manipulador de alimentos» are —, and the conditions by what they are: every
 * mention of a licence is the licence, every availability is the availability.
 */
export function keyOf(candidate: Pick<Candidate, "kind" | "thing">): string {
  switch (candidate.kind) {
    case "license":
    case "vehicle":
    case "availability":
    case "documents":
      return candidate.kind;
    case "task":
    case "credential": {
      const stems = [...stemsOf(candidate.thing)].sort();
      if (stems.length > 0) return `${candidate.kind}:${stems.join(" ")}`;
      return `${candidate.kind}:${skillKey(candidate.thing)}`;
    }
    case "tool":
      return `tool:${skillKey(candidate.thing)}`;
  }
}

/** The words that carry a task or a credential, by their first letters. */
const stemsOf = (thing: string): Set<string> => new Set(contentWords(thing).map(stemOf));

/**
 * Whether two tasks, or two credentials, are one thing said with more or fewer words: all of the words of the shorter one are in the longer one
 * («libreta sanitaria» in «libreta sanitaria vigente»), and it is not a single word shared by two things that only start the same way
 * («experiencia en ventas» and «experiencia en atención» share one of their two).
 */
const sameWords = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
  if (a.size === 0 || b.size === 0) return false;
  const shared = [...a].filter((stem) => b.has(stem)).length;
  return shared >= Math.min(a.size, b.size);
};

type Tally = {
  key: string;
  stems: ReadonlySet<string>;
  candidate: Candidate;
  fragment: string;
  /** How many of the offers say it, each counted once. */
  offers: number;
  employers: Set<string>;
  someNotNicety: boolean;
  obligation: Obligation;
  latest: number;
};

/** «Aparece en 3 de las últimas 10 ofertas que analizaste.» A count of what they saw: no percentage, no ranking, nothing about what it would do for them. */
export const countLine = (found: Pick<RepeatedRequirement, "count" | "of">): string =>
  `Aparece en ${found.count} de las últimas ${found.of} ofertas que analizaste.`;

/**
 * The one thing worth asking, or `null`: the one in the most of the offers, and of those the one that is worth knowing first
 * (`askRank`: what a person holds, then how they can work, then what they have used, then what they have done).
 */
export function repeatedRequirement(input: {
  offers: readonly SeenOffer[];
  /** The profile as the generators read it: what is said there is said. */
  profile: Profile;
  stored: Pick<StoredProfile, "declined">;
  now: Date;
}): RepeatedRequirement | null {
  const { profile, stored, now } = input;
  const { lastOffers, withinDays, minOffers, minEmployers } = ENGINE.repeated;

  // The last ones analysed, inside the window, each posting once however many times it was analysed.
  const seen = new Set<string>();
  const recent = input.offers
    .map((offer) => ({ offer, at: Date.parse(offer.createdAt) }))
    .filter(({ at }) => Number.isFinite(at) && now.getTime() - at <= withinDays * DAY_MS && at - now.getTime() <= DAY_MS)
    .sort((a, b) => b.at - a.at)
    .filter(({ offer }) => {
      const text = normalizeForComparison(offer.jobText).slice(0, 400);
      if (text === "" || seen.has(text)) return false;
      seen.add(text);
      return true;
    })
    .slice(0, lastOffers);
  if (recent.length < minOffers) return null;

  const tallies: Tally[] = [];
  for (const { offer, at } of recent) {
    const employer = companyMatchKey(offer.analysis?.company ?? "") || "?";
    // One offer says a thing once: a posting that names Excel in two lines is not two offers.
    const touched = new Set<Tally>();
    for (const candidate of mentionedCandidates(readRequirements(offer.jobText))) {
      const key = keyOf(candidate);
      const stems = candidate.kind === "task" || candidate.kind === "credential" ? stemsOf(candidate.thing) : new Set<string>();
      const nicety = candidate.requirement.obligation === "preferred";
      const known = tallies.find((tally) => tally.candidate.kind === candidate.kind && (tally.key === key || sameWords(tally.stems, stems)));
      if (!known) {
        const created: Tally = { key, stems, candidate, fragment: candidate.requirement.fragment, offers: 1, employers: new Set([employer]), someNotNicety: !nicety, obligation: candidate.requirement.obligation, latest: at };
        tallies.push(created);
        touched.add(created);
        continue;
      }
      if (!touched.has(known)) {
        known.offers += 1;
        known.employers.add(employer);
        touched.add(known);
      }
      // Of two lines for one thing in one offer, one that is not a nicety is what the offer asks.
      if (!nicety) known.someNotNicety = true;
      // The offers come newest first: the first one that said it is the one whose line is shown.
    }
  }

  const index = buildEvidenceIndex(profile);
  const worth = tallies
    .filter((tally) => tally.offers >= minOffers && tally.employers.size >= minEmployers && tally.someNotNicety)
    .flatMap((tally) => {
      const state = openness(tally.candidate, { profile, index, stored, now });
      return state.open ? [{ key: tally.key, tally, ...(state.again ? { again: state.again } : {}) }] : [];
    })
    .sort((a, b) => b.tally.offers - a.tally.offers || askRank(a.tally.candidate.kind) - askRank(b.tally.candidate.kind) || b.tally.latest - a.tally.latest || a.key.localeCompare(b.key));

  const best = worth[0];
  if (!best) return null;
  const { candidate } = best.tally;
  return {
    kind: candidate.kind,
    type: askTypeOf(candidate.kind),
    thing: candidate.thing,
    key: best.key,
    fragment: best.tally.fragment,
    question: questionFor(candidate.kind, candidate.thing),
    count: best.tally.offers,
    of: recent.length,
    obligation: best.tally.obligation,
    ...(best.again ? { again: best.again } : {}),
  };
}
