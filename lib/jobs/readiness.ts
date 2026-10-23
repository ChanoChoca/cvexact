import { previewEntryCount } from "@/lib/cv/from-profile";
import type { StoredProfile } from "@/lib/schemas/profile-v2";

/**
 * Whether the profile has anything for a job's fit to be worked out against: a job, a study, a project, a
 * certification or a skill. An empty profile produces a score, just not a meaningful one, and "40 % compatible" against
 * nothing typed in is a verdict nobody should be given.
 *
 * The name is not part of it. The fit is worked out from the career — none of `scoreJobPosting`, nor the semantic
 * text, reads the name — and a person who has loaded theirs and not yet typed their name has a profile; what they are
 * missing is the one blank a CV needs, which is asked for where it is missed (`MissingName`), not a reason to hide the
 * fit of every posting from them behind "Completá tu perfil".
 */
export function hasSomethingToScore(stored: StoredProfile): boolean {
  return previewEntryCount(stored) > 0 || stored.skills.length > 0;
}
