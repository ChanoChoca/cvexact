import type { StoredProfile } from "@/lib/schemas/profile-v2";

/**
 * What of the stored profile goes to an account.
 *
 * The profile carries things that exist to make the browser pleasant and do not
 * belong on a server: the history of edits and the archive of what was removed,
 * so that "deshacer" and "restaurar" work, and the names of the files the person
 * imported. Someone who deletes a job from their profile and then finds it still
 * sitting in the account's copy has been told "borrado" and given something
 * else. So what is synced is the profile itself — every value with its origin —
 * and not the trail behind it.
 *
 * Applied where the profile leaves the browser and again where it arrives at the
 * server, so an old client, or a hand-made request, cannot put the trail there.
 * A profile pulled back to another device arrives without it, which is what the
 * pull already warns: it replaces what that browser had.
 */
export function forSync(profile: StoredProfile): StoredProfile {
  return {
    ...profile,
    history: [],
    archive: [],
    sources: profile.sources.map((source) => ({ ...source, name: "" })),
  };
}
