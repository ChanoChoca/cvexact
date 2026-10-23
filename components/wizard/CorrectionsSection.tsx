"use client";

import { useMemo, useState } from "react";
import { CorrectionsCard } from "@/components/wizard/CorrectionsCard";
import { correctionsOf, originOf, revertCorrection, saveCorrection, unsettled, type Correction } from "@/lib/cv/corrections";
import { roleForField } from "@/lib/cv/invented";
import { recordMetric } from "@/lib/metrics/store";
import type { CVDocument } from "@/lib/schemas/cv";
import type { Profile } from "@/lib/schemas/profile";
import { settleCorrection, useSettledCorrections } from "@/lib/storage/corrections-settled";
import type { Application } from "@/lib/storage/application";
import { updateStoredProfile } from "@/lib/storage/local";
import { useExperiment } from "@/lib/use-experiment";

/**
 * What the person changed by hand in the CV of this application, offered to the profile once (O11): the page's side of `lib/cv/corrections.ts`. Not
 * while the editor is open — the card is for after the editing, never an interruption of it —, only for a CV that was edited, and only while its switch is
 * on (`lib/experiments.ts`): switched off, this renders nothing and reads nothing.
 */
export function CorrectionsSection({
  application,
  cv,
  profile,
  editorOpen,
  canAsk,
  onAsk,
  onEdit,
}: {
  application: Pick<Application, "id" | "label" | "cvOriginal" | "cvEdited" | "analysis">;
  /** The CV as it stands. */
  cv: CVDocument;
  /** The profile as the generators read it. */
  profile: Profile;
  editorOpen: boolean;
  /** Whether a job of the profile can be asked about now: a number is saved by asking where it comes from. */
  canAsk: (roleId: string) => boolean;
  onAsk: (roleId: string) => void;
  /** Writes the CV, as an edit: what «Era un error» does. */
  onEdit: (next: CVDocument) => void;
}) {
  const on = useExperiment("corrected_cv");
  const settled = useSettledCorrections(application.id);
  const [problem, setProblem] = useState<{ key: string; message: string } | null>(null);
  const original = application.cvOriginal;
  const analysis = application.analysis;
  const pending = useMemo(
    () => (on && application.cvEdited && original && !editorOpen ? unsettled(correctionsOf({ original, edited: cv, profile, analysis }), settled) : []),
    [on, application.cvEdited, original, editorOpen, cv, profile, analysis, settled],
  );
  if (pending.length === 0 || !original) return null;

  const roleOf = (correction: Correction): string | null => roleForField(cv, profile, correction.field);
  const canSave = (correction: Correction): boolean => {
    if (correction.kind === "figure") {
      const roleId = roleOf(correction);
      return roleId !== null && canAsk(roleId);
    }
    return true;
  };

  const save = (correction: Correction) => {
    setProblem(null);
    if (correction.kind === "figure") {
      // A number is saved by being asked where it comes from, the way the numbers the CV made up always are: the question is not settled until the profile has it.
      const roleId = roleOf(correction);
      if (roleId) onAsk(roleId);
      return;
    }
    const origin = originOf(application.label, new Date().toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" }));
    const result = { kept: false };
    updateStoredProfile((draft) => void (result.kept = saveCorrection(draft, correction, origin)));
    if (!result.kept) {
      setProblem({ key: correction.key, message: "No pudimos guardarlo en tu perfil. Si ya está ahí, dejalo solo en este CV." });
      return;
    }
    recordMetric("correction_saved");
    settleCorrection(application.id, correction.key);
  };

  const here = (correction: Correction) => {
    setProblem(null);
    recordMetric("correction_only_here");
    settleCorrection(application.id, correction.key);
  };

  const mistake = (correction: Correction) => {
    const back = revertCorrection(cv, original, correction);
    if (!back) {
      setProblem({ key: correction.key, message: "Cambió la forma del CV y no sabemos qué línea era la generada: sacalo editando el CV a mano." });
      return;
    }
    setProblem(null);
    recordMetric("correction_mistake");
    settleCorrection(application.id, correction.key);
    onEdit(back);
  };

  return <CorrectionsCard corrections={pending} canSave={canSave} onSave={save} onHere={here} onMistake={mistake} problem={problem} />;
}
