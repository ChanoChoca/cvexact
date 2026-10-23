"use client";

import { useSession } from "@/lib/auth-client";
import { accountSyncFrom, type AccountSync } from "@/lib/profile/account-sync";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { useSyncState } from "@/lib/storage/sync-state";

/**
 * `accountSyncFrom` (`./account-sync`) read from the session and from what this browser remembers of its meetings with the account, for the
 * screens that say where the profile lives: the profile, the card of Ajustes and the end of a session of questions.
 */
export function useAccountSync(profile: Pick<StoredProfile, "rev">): AccountSync {
  const { data: session, isPending } = useSession();
  const state = useSyncState();
  return accountSyncFrom({ user: session?.user, isPending, profile, state });
}
