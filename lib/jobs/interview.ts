import { buildEvidenceIndex } from "@/lib/ai/evidence";
import { ENGINE } from "@/lib/onboarding/config";
import type { Profile } from "@/lib/schemas/profile";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { splitSentences } from "@/lib/text/sentences";
import { keyOf } from "./repeated";
import { askRank, askTypeOf, mentionedCandidates, openness, questionFor, type RequirementAsk } from "./requirement-ask";
import { readRequirements } from "./requirements";

/**
 * What they were asked at the interview that the profile does not say (e5, O12; e3, A4).
 *
 * An interview is the one result of a search that says something about what to ask: the person was asked about something. So, when an application
 * reaches it, one fixed question — optional, in a few words of their own — and what they say is read as the lines of an offer are read
 * (`readRequirements`: no model, nothing that leaves the browser) and becomes **a question for each thing it names**, in the words of the question
 * of an offer, with the same three answers. It is never a fact and never goes to the CV: what was said is what was asked, and whether they have it is
 * theirs to say. Nothing is written about an application that went badly, and nothing is asked of one that has no interview.
 */

/** Whether a change of status is an application reaching the interview: it was not there, and now it is. Back and forth is not twice. */
export const reachedInterview = (from: string | undefined, to: string): boolean => to === "entrevista" && from !== "entrevista";

export const INTERVIEW_QUESTION = "¿Te preguntaron por algo que no está en tu perfil?";
export const INTERVIEW_HINT = "Contalo en una frase. Es opcional.";
export const INTERVIEW_TEXT_MAX = 600;

/** The questions that what they said makes: at most `ENGINE.interview.maxAsks`, one for each thing, in the order that is worth knowing first. */
export function interviewAsks(input: {
  said: string;
  /** The profile as the generators read it: what is said there is said. */
  profile: Profile;
  stored: Pick<StoredProfile, "declined">;
  now: Date;
}): RequirementAsk[] {
  const said = input.said.replace(/\s+/g, " ").trim().slice(0, INTERVIEW_TEXT_MAX);
  if (!said) return [];
  const sentences = splitSentences(said);
  // Read as the lines of an offer, each sentence its own line: what a person was asked is not written the way an offer is, but it names the same things.
  const found = mentionedCandidates(readRequirements(["Oferta", "", "Requisitos:", ...(sentences.length > 0 ? sentences : [said]).map((line) => `- ${line}`)].join("\n")));

  const index = buildEvidenceIndex(input.profile);
  const seen = new Set<string>();
  const asks: Array<{ ask: RequirementAsk; order: number; rank: number }> = [];
  for (const candidate of found) {
    const key = keyOf(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    const state = openness(candidate, { profile: input.profile, index, stored: input.stored, now: input.now });
    if (!state.open) continue;
    asks.push({
      order: candidate.order,
      rank: askRank(candidate.kind),
      ask: {
        kind: candidate.kind,
        type: askTypeOf(candidate.kind),
        fragment: candidate.requirement.fragment,
        thing: candidate.thing,
        question: questionFor(candidate.kind, candidate.thing),
        ...(state.again ? { again: state.again } : {}),
        obligation: "unstated",
      },
    });
  }
  return asks.sort((a, b) => a.rank - b.rank || a.order - b.order).slice(0, ENGINE.interview.maxAsks).map(({ ask }) => ask);
}
