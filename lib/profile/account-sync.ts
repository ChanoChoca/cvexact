import { syncStatus, type SyncStatus } from "@/lib/profile/sync-status";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import type { SyncState } from "@/lib/storage/sync-state";

/**
 * How the account stands with the profile on screen, for the screens that say something about where the profile lives.
 *
 * Four screens each read the session and the browser's memory of its meetings with the account the same way, and the ones that did not
 * said opposite things on the same page: the list of what is left asked for a copy in a file («vive solo en este navegador») while the card of
 * the account said it had everything. `userId` is the account that is signed in and able to sync — a confirmed address — and `null` for
 * anything else.
 *
 * Pure, so what each screen says is tested without a session: the hook that reads one is `useAccountSync` (`./use-account-sync`).
 */
export type AccountSync = {
  /** The account that is signed in and able to sync, or `null`. */
  userId: string | null;
  /** The address it is signed in with, for what says whose account it is. */
  email: string | undefined;
  /** Signed in with an address not confirmed yet: it cannot keep the profile, and says so. */
  unconfirmed: boolean;
  /** What this browser remembers of its meetings with the account. */
  state: SyncState;
  status: SyncStatus;
  /**
   * The profile is, or may be, kept in an account: one signed in and able to sync, or — while the session is still being read — a browser
   * that has met one before. A copy in a file is not asked for then: the account is the copy, and what it lacks is its own notice.
   */
  hasAccount: boolean;
  /** The account has the profile, as it was at the last meeting or as it is now: there is a copy outside this browser. */
  accountHasIt: boolean;
};

/** The part of a session's user that matters here. An address with nothing said about it counts as confirmed, as it does everywhere else. */
export type AccountUser = { id: string; email?: string | undefined; emailVerified?: boolean | undefined };

export function accountSyncFrom({
  user,
  isPending,
  profile,
  state,
}: {
  user: AccountUser | null | undefined;
  /** The session is still being read. */
  isPending: boolean;
  profile: Pick<StoredProfile, "rev">;
  state: SyncState;
}): AccountSync {
  const userId = user && user.emailVerified !== false ? user.id : null;
  const status = syncStatus(profile, state, userId);
  // Not known yet, and this browser has met an account: it is likely signed in, and saying «vive solo en este navegador» to it for the
  // moment it takes to find out would be said to someone it is not true of. A browser that never met one is not waited for.
  const unknown = isPending && state.userId !== undefined;
  return {
    userId,
    email: user?.email,
    unconfirmed: Boolean(user) && user?.emailVerified === false,
    state,
    status,
    hasAccount: status !== "off" || unknown,
    accountHasIt: status === "synced" || status === "pending",
  };
}
