import { emailProblem } from "@/lib/profile/email";
import type { StoredProfile } from "@/lib/schemas/profile-v2";

/**
 * What the profile already knows of the account, so it is not typed twice.
 *
 * A person who loaded a CV has their name and email in the profile; asked to sign up, or to be sent a link, they
 * are shown empty boxes for what the app has in front of it. It is only a start for the box, never automatic: the
 * address a person keeps their account under is not always the one they put on a CV.
 *
 * Pure, so the rules are tested apart from the screens.
 */

/** The email in the profile, when it looks like one: what a box for an address can start with. */
export function profileEmail(stored: StoredProfile): string {
  const email = stored.contact.email.value.trim();
  return email && emailProblem(email) === null ? email : "";
}

/** What the sign-up form starts with: the name and the email already in the profile. */
export function accountPrefill(stored: StoredProfile): { name: string; email: string } {
  return { name: stored.contact.fullName.value.trim(), email: profileEmail(stored) };
}
