"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { DoubtFixControl, FIX_LABEL, isFixable, type FixTarget } from "@/components/onboarding/DoubtFix";
import { DOUBT_TEXT, EDUCATION_DOUBT_TEXT } from "@/lib/onboarding/content";
import {
  confirmEducation,
  confirmExperience,
  needsAttention,
  resolveEducationDoubt,
  resolveExperienceDoubt,
  swapCompanyAndRole,
  type DoubtFix,
} from "@/lib/onboarding/review";
import { withoutCurrent } from "@/lib/profile/dates";
import type { StoredEducation, StoredExperience } from "@/lib/schemas/profile-v2";
import { updateStoredProfile } from "@/lib/storage/local";

/**
 * What a reading was not sure of in a job or a study, on its own card in the profile: each doubt in words, a blank with the control to fill it
 * right under it, and «Está bien» for the person saying they looked. It is what clears the «Para revisar» of the card. Only a doubtful reading
 * has it: a choice between two documents is made in the list of differences, not here.
 */

/** One doubt, and — when it is a blank that can be filled in — the button that opens the control for it. Folded until tapped: a card is not a screen of boxes. */
function DoubtLine({ text, label, children }: { text: string; label?: string | undefined; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-3">
        <span>{text}</span>
        {children ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="text-ink underline decoration-amber-300/60 underline-offset-4 hover:text-amber-200 pointer-coarse:-my-3 pointer-coarse:py-3"
          >
            {open ? "Cerrar" : label}
          </button>
        ) : null}
      </p>
      {children && open ? <div className="mt-2 border-l-2 border-amber-300/40 pl-3 text-ink-2">{children}</div> : null}
    </div>
  );
}

function Doubts({
  doubts,
  candidates,
  onSwap,
  entity,
  target,
  onFix,
}: {
  doubts: readonly string[];
  candidates?: readonly string[] | undefined;
  onSwap?: (() => void) | undefined;
  /** `company_or_role` is the one doubt both cards share, and it needs different words on each. */
  entity: FixTarget["entity"];
  target: FixTarget;
  onFix: (fix: DoubtFix) => void;
}) {
  const textOf = (doubt: string) => (doubt === "company_or_role" && entity === "education" ? EDUCATION_DOUBT_TEXT : (DOUBT_TEXT[doubt] ?? doubt));
  return (
    <div className="space-y-1 text-sm text-amber-300">
      {doubts.map((doubt) => (
        <DoubtLine key={doubt} text={textOf(doubt)} label={FIX_LABEL[doubt]}>
          {isFixable(entity, doubt) ? <DoubtFixControl doubt={doubt} target={target} onFix={onFix} /> : null}
        </DoubtLine>
      ))}
      {candidates && candidates.length > 0 ? (
        <ul className="list-inside list-disc text-ink-2">
          {candidates.map((line) => (
            <li key={line}>«{line}»</li>
          ))}
        </ul>
      ) : null}
      {onSwap && doubts.includes("company_or_role") ? (
        <Button variant="secondary" type="button" onClick={onSwap} className="mt-2">
          {entity === "education" ? "Intercambiar institución y título" : "Intercambiar empresa y puesto"}
        </Button>
      ) : null}
    </div>
  );
}

export function JobDoubts({ job }: { job: StoredExperience }) {
  if (!needsAttention(job)) return null;
  return (
    <div className="space-y-3" data-doubts>
      <Doubts
        doubts={job.review?.doubts ?? []}
        candidates={job.review?.candidates}
        entity="experience"
        onSwap={() => updateStoredProfile((draft) => void swapCompanyAndRole(draft, job.id))}
        target={{ entity: "experience", start: withoutCurrent(job.start.value), end: withoutCurrent(job.end.value), current: Boolean(job.end.value.current) }}
        onFix={(fix) => updateStoredProfile((draft) => void resolveExperienceDoubt(draft, job.id, fix))}
      />
      <Button type="button" onClick={() => updateStoredProfile((draft) => void confirmExperience(draft, job.id))}>
        Está bien
      </Button>
    </div>
  );
}

export function StudyDoubts({ entry }: { entry: StoredEducation }) {
  if (!needsAttention(entry)) return null;
  return (
    <div className="space-y-3" data-doubts>
      <Doubts
        doubts={entry.review?.doubts ?? []}
        candidates={entry.review?.candidates}
        entity="education"
        target={{ entity: "education", start: withoutCurrent(entry.start.value), end: withoutCurrent(entry.end.value), current: entry.status.value === "in_progress" }}
        onFix={(fix) => updateStoredProfile((draft) => void resolveEducationDoubt(draft, entry.id, fix))}
      />
      <Button type="button" onClick={() => updateStoredProfile((draft) => void confirmEducation(draft, entry.id))}>
        Está bien
      </Button>
    </div>
  );
}
