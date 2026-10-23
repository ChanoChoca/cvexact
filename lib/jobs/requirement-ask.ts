import { CLAIM_SUPPORT_THRESHOLD, buildEvidenceIndex, contentWords, supports, type EvidenceIndex } from "@/lib/ai/evidence";
import type { MetricName } from "@/lib/metrics/counters";
import { ENGINE } from "@/lib/onboarding/config";
import { askedAgain, declinedBy } from "@/lib/profile/declined";
import { whenWords } from "@/lib/profile/sync-status";
import type { Profile } from "@/lib/schemas/profile";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { skillKey } from "@/lib/text/normalize";
import { ASKABLE_TYPES, isAskable, type ConditionKind, type Obligation, type Requirement } from "./requirements";

/**
 * The one question a posting puts to the person (e5, O5): of what the offer asks and the profile says nothing about, the thing most worth
 * knowing — a credential, a condition, a tool, a task, in that order — put in fixed words, with the offer's own line beside it.
 *
 * It is the reading (`readRequirements`) turned into a question, and every restraint of the product is here. One question for each posting, and
 * only if the session still has room. Only what the offer says is a must or does not say (a nicety is not asked), and only what a person can have
 * done, hold or say yes or no to (a trait never is; a zone has no place in a profile and is not asked). Nothing the profile already says, in other
 * words, and nothing the person already said no to. And the wording names the thing and nothing about what the market wants or what they lack:
 * `lib/voice.ts` keeps those out.
 */

/** What is asked: the five conditions the profile has a place for are asked as what they are, since each is answered in a different way. */
export type AskKind = "credential" | "license" | "vehicle" | "availability" | "documents" | "tool" | "task";

/** The four kinds of requirement a person is asked about; what is counted by (I5). */
export type AskType = "tool" | "task" | "condition" | "credential";

export const askTypeOf = (kind: AskKind): AskType => (kind === "tool" || kind === "task" || kind === "credential" ? kind : "condition");

/** The counter of what was asked and what was said to it (I5): `ask_tool_done`, `ask_condition_no`, `ask_credential_later`. */
export const askMetric = (type: AskType, outcome: "done" | "no" | "later"): MetricName => `ask_${type}_${outcome}`;

export type RequirementAsk = {
  kind: AskKind;
  type: AskType;
  /** The offer's own line, as it says it: shown above the question, always. */
  fragment: string;
  /** What the question names, and what a «no» is kept under. */
  thing: string;
  question: string;
  /** The day they said no to this, when this is the second time it is asked (a year later, once). */
  again?: string;
  obligation: Obligation;
};

/** In the order they are worth knowing: what a person holds, then how they can work, then what they have used, then what they have done. */
const RANK: Record<AskKind, number> = { credential: 0, license: 1, vehicle: 2, availability: 3, documents: 4, tool: 5, task: 6 };

/** How much a kind is worth asking before the others: lower is first. */
export const askRank = (kind: AskKind): number => RANK[kind];

/** The conditions the profile has a place for, and the kind of question each is. The rest (zone, travel, one's own tools) are read and left alone. */
const CONDITIONS: ReadonlyArray<readonly [ConditionKind, AskKind]> = [
  ["license", "license"],
  ["vehicle", "vehicle"],
  ["availability", "availability"],
  ["documents", "documents"],
];

/**
 * What is asked when a «no» is asked again, a year after, as the one question it is: the day it was said, and whether it still is so. It is not said under
 * the question of the first time, which would be two on one card; wherever it is asked — the posting's card, the panel beside the CV, the engine's own,
 * the interview's — it is these words.
 */
export const askedAgainQuestion = (again: string, now: Date): string => `Anotaste ${whenWords(again, now)} que no lo tenías. ¿Sigue siendo así?`;

/** What a question says for each kind: fixed, the same for everyone, with no example in it (an example is what gets copied). */
export function questionFor(kind: AskKind, thing: string): string {
  switch (kind) {
    case "tool":
      return `¿Usaste ${thing} en algún trabajo, curso o proyecto?`;
    case "task":
      return "¿Lo hiciste en algún trabajo, curso o proyecto?";
    case "credential":
      // The thing is named: «lo» and «la» are for a noun the product does not know the gender of, and a matrícula, a carnet and a habilitación are not the same.
      return "¿Tenés esa credencial?";
    case "license":
      return "¿Tenés licencia de conducir?";
    case "vehicle":
      return "¿Tenés vehículo propio?";
    case "availability":
      return "¿Tenés esa disponibilidad?";
    case "documents":
      return "¿Tenés la documentación al día?";
  }
}

/** The name a «no» to a condition is kept under, when the offer does not give one that holds for every offer. */
const CONDITION_NAME: Partial<Record<AskKind, string>> = { license: "Licencia de conducir", vehicle: "Vehículo propio" };

export type Candidate = { kind: AskKind; thing: string; requirement: Requirement; order: number };

function candidatesOf(requirement: Requirement, order: number): Candidate[] {
  switch (requirement.type) {
    case "tool":
      return requirement.subjects.map((thing) => ({ kind: "tool" as const, thing, requirement, order }));
    case "task":
    case "credential": {
      const thing = requirement.subjects[0];
      return thing ? [{ kind: requirement.type, thing, requirement, order }] : [];
    }
    case "condition":
      return CONDITIONS.filter(([condition]) => requirement.conditions.includes(condition)).map(([, kind]) => ({
        kind,
        thing: CONDITION_NAME[kind] ?? requirement.subjects[0] ?? requirement.fragment,
        requirement,
        order,
      }));
    default:
      return [];
  }
}

// --- What the profile already says --------------------------------------------------------------------------------------

/** The first letters of a word: «repartidor» and «reparto» are one, «atención» and «atendí» are not, and a profile that says it in other words is read as saying it. */
const stemOf = (word: string): string => word.slice(0, word.length >= 6 ? 5 : 4);

/** Of the words that carry the claim in `text`, the share the profile mentions — by their first letters, since nobody writes a profile in the posting's words. */
function mentionedShare(index: EvidenceIndex, text: string): number | null {
  const words = contentWords(text);
  if (words.length === 0) return null;
  return words.filter((word) => index.haystack.includes(` ${stemOf(word)}`)).length / words.length;
}

/**
 * Whether the profile already says what the offer asks. Generous on purpose: asking what the profile plainly answers is the one way this goes wrong
 * that a person notices. A thing with no word to compare is read as said (there is nothing to ask), except a short name, which is a tool by its name.
 */
function saysAlready(kind: AskKind, thing: string, profile: Profile, index: EvidenceIndex): boolean {
  switch (kind) {
    case "license":
      return profile.practical.driverLicense.trim() !== "";
    case "vehicle":
      return profile.practical.ownVehicle;
    case "availability":
      return profile.practical.availability.trim() !== "";
    case "documents":
      return profile.practical.workEligibility.trim() !== "";
    case "tool": {
      if (supports(index, thing)) return true;
      const share = mentionedShare(index, thing);
      return share !== null && share >= 0.5;
    }
    case "task":
      return (mentionedShare(index, thing) ?? 1) >= CLAIM_SUPPORT_THRESHOLD;
    case "credential":
      return (mentionedShare(index, thing) ?? 1) >= 0.5;
  }
}

// --- The one that is asked -------------------------------------------------------------------------------------------------------

/** Whether the session has room for one more question: this one counts like any other, and the budget is the person's. */
export const hasRoom = (stored: Pick<StoredProfile, "onboarding">): boolean => stored.onboarding.askedThisSession < ENGINE.session.maxQuestions;

/** Everything an offer asks that a person could be asked about, in the order the offer says it: nothing taken out yet. */
export function askCandidates(requirements: readonly Requirement[]): Candidate[] {
  return requirements.flatMap((requirement, order) => (isAskable(requirement) ? candidatesOf(requirement, order) : []));
}

/**
 * Everything an offer mentions that a person could be asked about, niceties too: what is counted when someone counts what the offers say (O10),
 * which is not what is asked of them — a nicety is not asked, and it is still something the offer said.
 */
export function mentionedCandidates(requirements: readonly Requirement[]): Candidate[] {
  return requirements.flatMap((requirement, order) => (ASKABLE_TYPES.includes(requirement.type) ? candidatesOf(requirement, order) : []));
}

/**
 * Whether a candidate is still worth asking of this person: the profile does not already say it, and no «no» of theirs stands in the way — until a
 * year has gone by, and then once, which is what `again` carries. The two checks every question about what an offer asks makes, whoever asks it.
 */
export function openness(
  candidate: Pick<Candidate, "kind" | "thing">,
  where: { profile: Profile; index: EvidenceIndex; stored: Pick<StoredProfile, "declined">; now: Date },
): { open: false } | { open: true; again?: string } {
  if (saysAlready(candidate.kind, candidate.thing, where.profile, where.index)) return { open: false };
  const said = declinedBy(where.stored, "requirement", candidate.thing);
  if (said && !askedAgain(said, where.now)) return { open: false };
  return said ? { open: true, again: said.at } : { open: true };
}

/**
 * The question to put for these requirements, or `null`. `offered` are the terms the coverage panel is already offering for this posting: a tool
 * is not asked in two places.
 */
export function chooseRequirementAsk(input: {
  requirements: readonly Requirement[];
  /** The profile as the generators read it: what is said there is said. */
  profile: Profile;
  stored: Pick<StoredProfile, "declined" | "onboarding">;
  offered?: readonly string[];
  now: Date;
}): RequirementAsk | null {
  const { requirements, profile, stored, now } = input;
  if (!hasRoom(stored)) return null;
  const index = buildEvidenceIndex(profile);
  const offered = new Set((input.offered ?? []).map(skillKey));

  const candidates = askCandidates(requirements);
  candidates.sort(
    (a, b) => RANK[a.kind] - RANK[b.kind] || Number(b.requirement.obligation === "required") - Number(a.requirement.obligation === "required") || a.order - b.order,
  );

  for (const candidate of candidates) {
    if (candidate.kind === "tool" && offered.has(skillKey(candidate.thing))) continue;
    // Nothing the profile already says, and a «no» is not asked again — until a year has gone by, and then once.
    const state = openness(candidate, { profile, index, stored, now });
    if (!state.open) continue;
    return {
      kind: candidate.kind,
      type: askTypeOf(candidate.kind),
      fragment: candidate.requirement.fragment,
      thing: candidate.thing,
      question: questionFor(candidate.kind, candidate.thing),
      ...(state.again ? { again: state.again } : {}),
      obligation: candidate.requirement.obligation,
    };
  }
  return null;
}
