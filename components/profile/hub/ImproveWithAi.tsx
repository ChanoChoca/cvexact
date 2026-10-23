"use client";

import { useRef } from "react";
import { AiAction } from "@/components/onboarding/AiAction";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/toast";
import { IMPROVE_LIMIT, type ImproveKind } from "@/lib/ai/prompts/improve";
import { improveWithAi } from "@/lib/onboarding/ai";

/**
 * «Mejorar con IA», on a line of a job and on the description of a project: the two texts a base CV prints as they stand.
 *
 * What the model says is a proposal, and one that has already been checked against what was written (`checkImprovement`: a figure the text
 * did not state and it never gets here). It is shown next to the original; nothing changes until the person says «Usar», and then a notice
 * offers the way back — which puts the text back as it was, and says so if it was changed again in the meantime. Where there is no AI nothing
 * is drawn, and a key is never asked for here: the box beside it is the way to say it better, as it always was.
 *
 * Not drawn for a text the field could not hold once rewritten, or an empty one.
 */
export function ImproveWithAi({
  kind,
  text,
  label = "Mejorar con IA",
  onUse,
}: {
  kind: ImproveKind;
  /** What is stored now, not what is being typed: a text not yet left is not yet the profile's. */
  text: string;
  label?: string;
  /** Makes the change and gives back the way to undo it, which says whether it could. */
  onUse: (improved: string) => () => boolean;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  /** What `run` found, for `onDone`: `AiAction` hands over only that it worked. */
  const proposal = useRef<string | null>(null);
  if (!text.trim() || text.length > IMPROVE_LIMIT[kind]) return null;

  const decide = async () => {
    const improved = proposal.current;
    proposal.current = null;
    if (!improved) {
      toast({ message: "Tu IA no le cambió nada: ya se lee bien." });
      return;
    }
    const use = await confirm(`Antes:\n${text}\n\nDespués:\n${improved}`, { title: "Tu IA propone", confirmLabel: "Usar", cancelLabel: "Dejar como estaba", confirmTone: "primary" });
    if (!use) return;
    const undo = onUse(improved);
    toast({
      tone: "good",
      message: "Usamos la versión de tu IA.",
      duration: 8000,
      action: { label: "Deshacer", onClick: () => void (undo() || toast({ tone: "warn", message: "Lo cambiaste después, así que lo dejamos como está." })) },
    });
  };

  return (
    <AiAction
      label={label}
      busyLabel="Mejorando…"
      whenUnavailable="hide"
      run={async (signal) => {
        const outcome = await improveWithAi(text, kind, signal);
        if (!outcome.ok) return outcome;
        proposal.current = outcome.result.same ? null : outcome.result.text;
        return { ok: true };
      }}
      onDone={() => void decide()}
    />
  );
}
