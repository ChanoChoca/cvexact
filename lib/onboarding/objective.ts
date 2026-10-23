import { jobsByRecency } from "@/lib/profile/timeline";
import { fold } from "@/lib/parse/dictionaries";
import { isMeaningfulExperience, type StoredProfile } from "@/lib/schemas/profile-v2";

/**
 * The roles the person has held, newest first, once each: what the objective question
 * offers as a starting point. They are the person's own titles, as they wrote them —
 * choosing one says "algo así", and the field stays theirs to change.
 */
export function objectiveSuggestions(profile: StoredProfile, max = 4): string[] {
  const seen = new Set<string>();
  const roles: string[] = [];
  for (const job of jobsByRecency(profile.experience.filter(isMeaningfulExperience))) {
    const role = job.role.value.trim();
    if (!role || seen.has(fold(role))) continue;
    seen.add(fold(role));
    roles.push(role);
  }
  return roles.slice(0, max);
}
