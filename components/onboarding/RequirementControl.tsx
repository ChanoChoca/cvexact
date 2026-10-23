"use client";

import { useState } from "react";
import { RequirementAnswers } from "@/components/wizard/RequirementAsk";
import type { RepeatedRequirement } from "@/lib/jobs/repeated";
import type { DateValue } from "@/lib/profile/dates";
import type { Practical } from "@/lib/schemas/profile";

/**
 * The control of the question about a thing that comes up in several of the offers a person analysed (O10): the line one of those offers wrote,
 * and yes, no and not now with the same weight and the same words as the question of a single offer — they are the same answers, and they go to
 * the same places. What the question says, and the count of what they saw, are the card's title and hint (`questionFor`): this is the line and the answers.
 */

export type RequirementHandlers = {
  claim: (where: string, jobId: string | null) => void;
  credential: (values: { name: string; expires?: DateValue }) => void;
  conditions: (answer: Partial<Practical>) => void;
  decline: () => void;
  keep: () => void;
  later: () => void;
};

export function RequirementControl({
  ask,
  jobs,
  handlers,
}: {
  ask: RepeatedRequirement;
  /** The person's own roles, to ask which one a tool or a task belongs to — never guessed. */
  jobs: ReadonlyArray<{ id: string; label: string }>;
  handlers: RequirementHandlers;
}) {
  const [now] = useState(() => new Date());
  // A quote that was cut at the length of a line says so.
  const quoted = ask.fragment.length >= 238 ? `${ask.fragment}…` : ask.fragment;
  return (
    // The second asking is the card's own title (`questionFor`): one question, and not another under it.
    <div className="space-y-4" data-requirement-ask={ask.kind} data-repeated-ask {...(ask.again ? { "data-declined-again": "" } : {})}>
      <blockquote className="border-l-2 border-oro-soft pl-3 text-[15px] leading-snug wrap-break-word text-ink-2" data-requirement-quote>
        {quoted}
      </blockquote>
      <RequirementAnswers
        ask={ask}
        jobs={jobs}
        now={now}
        onClaim={handlers.claim}
        onCredential={handlers.credential}
        onConditions={handlers.conditions}
        onDecline={handlers.decline}
        onKeep={handlers.keep}
        onLater={handlers.later}
      />
    </div>
  );
}
