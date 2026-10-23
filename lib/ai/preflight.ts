import {
  buildEvidenceIndex,
  CLAIM_SUPPORT_THRESHOLD,
  findUnsupportedTerms,
  supports,
  supportShare,
  type EvidenceIndex,
} from "@/lib/ai/evidence";
import { PRACTICAL_FACTS, statedPractical } from "@/lib/ai/practical";
import type { JobAnalysis, Requirement } from "@/lib/schemas/job";
import type { Profile } from "@/lib/schemas/profile";

/**
 * Whether the posting has a requirement it says is disqualifying, that the
 * profile does not answer.
 *
 * This is the question the product could not ask until `requirementSchema` had
 * `excluding`, and the one the user actually has. The waiting job that motivated
 * it says "Experiencia previa en el puesto (excluyente)" against a profile with
 * no hospitality history at all: a generation was paid for, a CV was written, a
 * coverage report said 6 of 8, and the honest answer was that the one thing the
 * ad refused to negotiate was missing.
 *
 * Advisory, never a block. Postings overstate their requirements constantly and
 * people are hired past them; the point is that the applicant decides knowing,
 * before the call is spent rather than after.
 */

export type BlockingExclusion = {
  requirement: string;
  /** Why the profile does not answer it, in the user's language. */
  reason: string;
};

/**
 * Whether the profile answers `requirement`.
 *
 * Three ways of asking, because a requirement is written in three shapes and no
 * single one of them covers the others:
 *
 *   "Experiencia en Kubernetes"      → a named technology, for the glossary
 *   "Disponibilidad los fines de semana" → a practical fact, for the profile's own field
 *   "Experiencia previa en el puesto"    → ordinary words, for the lexical share
 *
 * Reuses the same functions the CV prompt and the verifier already run, so a
 * requirement this reads as answered is one they read as answered too.
 */
function answered(profile: Profile, index: EvidenceIndex, requirement: string): boolean {
  // A practical fact the posting asks about is answered exactly when the profile
  // fills that field — the licence, the schedule, the work permit.
  const fact = PRACTICAL_FACTS.find((candidate) => candidate.asks.test(requirement.toLowerCase()));
  if (fact) return statedPractical(profile, fact) !== null;

  // A named technology the profile never states is the clearest possible miss.
  if (findUnsupportedTerms(requirement, index).length > 0) return false;

  if (supports(index, requirement)) return true;

  const share = supportShare(index, requirement);
  // `null` means the requirement carries no claim-bearing words at all, which is
  // not evidence of a gap. Silence beats a wrong warning here: this one is shown
  // before any work is done and its whole value is being believed.
  return share === null || share >= CLAIM_SUPPORT_THRESHOLD;
}

export function blockingExclusions(
  profile: Profile,
  analysis: Pick<JobAnalysis, "requirements">,
): BlockingExclusion[] {
  const index = buildEvidenceIndex(profile);

  return analysis.requirements
    .filter((requirement: Requirement) => requirement.excluding)
    /**
     * Hard requirements only. A soft one is a trait — "ganas de trabajar",
     * "proactividad", "orientación al cliente" — and no profile states those in
     * a form anything here can check, so every soft row would come back
     * unanswered and the warning would fire on postings the applicant is a fine
     * fit for. Since the whole value of this message is being believed, it says
     * nothing rather than something it cannot stand behind.
     */
    .filter((requirement) => requirement.kind === "hard")
    .filter((requirement) => !answered(profile, index, requirement.text))
    .map((requirement) => ({
      requirement: requirement.text,
      reason: reasonFor(profile, index, requirement.text),
    }));
}

function reasonFor(profile: Profile, index: EvidenceIndex, requirement: string): string {
  const fact = PRACTICAL_FACTS.find((candidate) => candidate.asks.test(requirement.toLowerCase()));
  if (fact) return `Tu perfil no dice nada sobre ${fact.what}.`;

  const missing = findUnsupportedTerms(requirement, index);
  if (missing.length > 0) {
    return `Tu perfil no menciona ${missing.slice(0, 3).join(", ")}.`;
  }

  return "Tu perfil no tiene nada que lo respalde.";
}
