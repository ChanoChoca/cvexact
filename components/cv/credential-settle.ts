import type { CredentialSettle } from "@/components/cv/ExpiredCredentialsAlert";
import { putOffRenewal, renewCredential, renewalPutOffAt, setCredentialAside } from "@/lib/onboarding/renewal";
import { recordMetric } from "@/lib/metrics/store";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { updateStoredProfile } from "@/lib/storage/local";

/**
 * The answers to «¿Hiciste la renovación?» for a screen that has the credential in front of it —the page of an application, the card of the credential in the
 * profile— kept in the stored profile the way the question keeps them, and counted the same. What the person said before —«Todavía no»— is read from the profile
 * given, so that it is said back and not asked as if it had not been.
 */
export function credentialSettleFor(profile: StoredProfile, now: Date): CredentialSettle {
  return {
    now,
    putOffAt: (review) => renewalPutOffAt(profile, review),
    onRenewed: (review, expires) => {
      updateStoredProfile((draft) => void renewCredential(draft, review, expires));
      recordMetric("question_answered");
    },
    onNoLonger: (review) => {
      updateStoredProfile((draft) => void setCredentialAside(draft, review));
      recordMetric("question_answered");
    },
    onLater: (review) => {
      updateStoredProfile((draft) => void putOffRenewal(draft, review));
      recordMetric("question_put_off");
    },
  };
}
