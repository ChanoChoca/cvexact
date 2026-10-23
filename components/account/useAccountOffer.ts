"use client";

import { useEffect, useState } from "react";
import { fetchAccountProfile } from "@/lib/api/account-profile";
import { useSession } from "@/lib/auth-client";
import { accountOffer, type AccountOffer } from "@/lib/profile/account-offer";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { useHydrated, useStoredProfile } from "@/lib/storage/hooks";
import { useSyncState } from "@/lib/storage/sync-state";

/**
 * Whether the account signed in has a profile worth bringing to this browser — see `accountOffer` for when, and for what
 * is said. It asks the account once for each account that shows up on this page (`?only=profile`: not the history behind
 * it), and never on its own initiative about anything else: an address not confirmed yet cannot sync, so it is not asked.
 *
 * `userId` is the account the offer is for, so whoever acts on it acts on that one.
 */
export function useAccountOffer(): { offer: AccountOffer | null; userId: string | null } {
  const { data: session } = useSession();
  const user = session?.user;
  const userId = user && user.emailVerified !== false ? user.id : null;
  const hydrated = useHydrated();
  const profile = useStoredProfile();
  const state = useSyncState();
  const [now] = useState(() => new Date());
  // Which account's profile this is: one asked about another account says nothing about this one.
  const [found, setFound] = useState<{ userId: string; account: StoredProfile | null } | null>(null);

  useEffect(() => {
    if (!hydrated || !userId) return;
    let cancelled = false;
    void fetchAccountProfile().then((account) => {
      if (!cancelled) setFound({ userId, account });
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated, userId]);

  const account = found && found.userId === userId ? found.account : null;
  return { offer: userId ? accountOffer({ local: profile, account, state, now }) : null, userId };
}
