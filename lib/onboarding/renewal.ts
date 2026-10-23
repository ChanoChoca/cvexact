import type { DateValue } from "@/lib/profile/dates";
import type { CredentialReview } from "@/lib/profile/currency";
import { editContext, type EditContext } from "@/lib/profile/edit";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { answerNoLonger, answerRenewal, deferQuestion } from "./answer";
import { credentialGap, credentialGapId } from "./gaps";

/**
 * «¿Hiciste la renovación?», settled from a screen that has the credential in front of it and not the engine's turn (the page of an application, with
 * the CV that carries it). It is the question the engine asks — the same answers, kept the same way, in the same places — and these only give a screen
 * the way to say it without building the question by hand.
 */

/**
 * When «Todavía no» was said to the renewal of this credential, if it was and it has not been settled since: the day, so that the screen says it was
 * answered and does not ask the same thing again as if it had not been.
 */
export function renewalPutOffAt(profile: Pick<StoredProfile, "pending">, review: CredentialReview): string | null {
  const entry = profile.pending.find((found) => found.questionId === credentialGapId(review));
  return entry && (entry.state === "later" || entry.state === "skipped") && entry.at ? entry.at : null;
}

/** «Sí, la hice», with the date it holds until now — or without, when they do not know it: the date comes off, and a credential with no date is not asked after. */
export function renewCredential(draft: StoredProfile, review: CredentialReview, expires: DateValue | null, ctx: EditContext = editContext()): boolean {
  return answerRenewal(draft, credentialGap(review), expires, ctx);
}

/** «Ya no corresponde»: it stays in the profile and goes in no CV. */
export function setCredentialAside(draft: StoredProfile, review: CredentialReview, ctx: EditContext = editContext()): boolean {
  return answerNoLonger(draft, credentialGap(review), ctx);
}

/** «Todavía no»: nothing changes in the credential, and the question comes back another day. */
export function putOffRenewal(draft: StoredProfile, review: CredentialReview, ctx: EditContext = editContext()): void {
  deferQuestion(draft, credentialGap(review), "later", ctx);
}
