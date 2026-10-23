"use client";

import { useMemo, useState } from "react";
import { receiptOf } from "@/components/cv/ExpiredCredentialsAlert";
import { credentialSettleFor } from "@/components/cv/credential-settle";
import { RenewalControl } from "@/components/onboarding/QuestionControls";
import { useToast } from "@/components/ui/toast";
import { restoreProfile } from "@/lib/onboarding/last-answer";
import type { CredentialReview } from "@/lib/profile/currency";
import type { DateValue } from "@/lib/profile/dates";
import { whenWords } from "@/lib/profile/sync-status";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { loadStoredProfile } from "@/lib/storage/local";

/**
 * «¿Hiciste la renovación?», in the card of the credential whose date is near or past: the question that «Para revisar» asks, with its three answers of the same weight
 * (`RenewalControl`), asked where the date is written and not on another page. Kept the way the question keeps it, and told in a notice with its «Deshacer», because the
 * card stops saying it the moment it is answered. What was said before —«Todavía no»— is said back and not asked as if it had not been.
 */
export function CredentialRenewal({ profile, review, now }: { profile: StoredProfile; review: CredentialReview; now: Date }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const settle = useMemo(() => credentialSettleFor(profile, now), [profile, now]);
  const putOff = settle.putOffAt(review);

  const answer = (how: "renewed" | "no-longer" | "later", expires: DateValue | null = null) => {
    const before = loadStoredProfile();
    if (how === "renewed") settle.onRenewed(review, expires);
    else if (how === "no-longer") settle.onNoLonger(review);
    else settle.onLater(review);
    toast({ tone: "good", message: receiptOf(review, how, expires), duration: 8000, action: { label: "Deshacer", onClick: () => restoreProfile(before) } });
    if (how === "later") setOpen(false);
  };

  if (!open) {
    return (
      <p className="mt-1 text-xs text-ink-2" data-renewal-in-card>
        {putOff ? `Dijiste ${whenWords(putOff, now)} que todavía no. ` : ""}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="underline decoration-oro-soft underline-offset-4 hover:text-ink pointer-coarse:inline-block pointer-coarse:-my-3 pointer-coarse:py-3.5"
        >
          {putOff ? "Ya hice la renovación" : "¿Hiciste la renovación?"}
        </button>
      </p>
    );
  }
  return (
    <div className="mt-2 space-y-3 border-l-2 border-oro-soft pl-3" data-renewal data-renewal-in-card>
      <RenewalControl onRenewed={(expires) => answer("renewed", expires)} onNoLonger={() => answer("no-longer")} onLater={() => answer("later")} />
    </div>
  );
}
