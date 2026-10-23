"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { useExperiment } from "@/lib/use-experiment";
import { ReminderForm } from "./ReminderForm";

/**
 * «¿Querés que tu calendario te lo recuerde?», where a review of what changed ends (e5 UX, U45): the moment it is worth most, since what was just looked at is what
 * will need looking at again, and not only in the menu of the profile, where whoever never opened it never found it. The two answers weigh the same, and a «no» ends it: the
 * offer is not made again until the next review, which is months away.
 *
 * It is the person's calendar's reminder and not ours (`ReminderForm`): the file is made here and handed over, and cvexact sends nothing. Switched off, it draws nothing
 * (`lib/experiments.ts`), and the menu's entry is the one place it was.
 */
export function ReminderOffer() {
  const on = useExperiment("calendar_reminder");
  const [step, setStep] = useState<"offer" | "form" | "no">("offer");
  if (!on || step === "no") return null;

  if (step === "form") {
    return (
      <div className="border-t border-rule pt-4" data-reminder-offer="form">
        <ReminderForm onClose={() => setStep("no")} />
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-rule pt-4" data-reminder-offer="ask">
      <p className="text-sm text-ink">¿Querés que tu calendario te lo recuerde?</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => setStep("form")}>
          Sí, recordármelo
        </Button>
        <Button type="button" variant="secondary" onClick={() => setStep("no")}>
          No, gracias
        </Button>
      </div>
      <p className="text-xs text-ink-3">Bajás un archivo para tu calendario, que es quien te avisa: cvexact no manda avisos.</p>
    </div>
  );
}
