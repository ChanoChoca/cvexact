"use client";

import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

/**
 * Browser-side auth. The base URL is same-origin, so nothing needs configuring.
 *
 * Every call site must tolerate auth being disabled: an installation without a
 * database answers /api/auth/* with 503, and the UI treats that as "accounts
 * are not available here" rather than as an error. The same holds for
 * `magicLinkClient`, whose one job is typing `signIn.magicLink` from the
 * server plugin's shape — with no server plugin (no mail configured), the
 * call itself 404s the same way any other disabled endpoint does.
 */
export const authClient = createAuthClient({
  plugins: [magicLinkClient()],
});

/**
 * `changePassword`, `deleteUser` and `revokeOtherSessions` are the self-service
 * half of account security: without them the only way to retire a leaked
 * password, close an account, or evict a session left open on a shared machine
 * is to ask us. `requestPasswordReset` and `resetPassword` are the way back in when
 * the password is gone — before they were wired up, forgetting it meant losing
 * the synced profile for good.
 */
export const {
  signIn,
  signUp,
  signOut,
  useSession,
  requestPasswordReset,
  resetPassword,
  changePassword,
  deleteUser,
  revokeOtherSessions,
  sendVerificationEmail,
} = authClient;
