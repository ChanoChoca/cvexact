"use client";

import { Button } from "@/components/ui";
import { jobName } from "@/lib/onboarding/questions";
import { unassignedAbout } from "@/lib/onboarding/notes";
import { isMeaningfulExperience, type ImportedSource, type StoredProfile } from "@/lib/schemas/profile-v2";

/** Where a line the app could not place was written, in the words the offer uses. */
const WHERE: Record<ImportedSource["kind"], string> = {
  cv: "tu CV",
  linkedin_pdf: "tu LinkedIn",
  linkedin_csv: "tu LinkedIn",
  dump: "lo que contaste",
};

/**
 * "Esto estaba en tu CV": what a document had that fit nowhere and names the job being asked about, offered under the
 * question it would answer — «Logré reducir costos…» under "¿Hubo algo que mejorara…?" — to be taken, with a tap, as
 * what the question asks for. Offered, never taken: a line is not made one of the job's by being shown, and a match on a
 * company's name can be a line about something else.
 */
export function TrayOffer({ profile, jobId, as, onTake }: { profile: StoredProfile; jobId: string; as: "task" | "achievement"; onTake: (unassignedId: string) => void }) {
  const lines = unassignedAbout(profile, jobId);
  const job = profile.experience.find((entry) => entry.id === jobId);
  if (lines.length === 0 || !job) return null;
  const label = jobName(job, profile.experience.filter(isMeaningfulExperience));
  return (
    <section aria-label="Lo que ya estaba en tus documentos" className="space-y-4 border-t border-rule pt-4">
      {lines.map((line) => {
        const source = profile.sources.find((entry) => entry.id === line.sourceId);
        return (
          <div key={line.id} className="space-y-2">
            <p className="text-xs text-ink-3">Esto estaba en {source ? WHERE[source.kind] : "un documento que subiste"}:</p>
            <p className="line-clamp-3 border-l-2 border-solar-g4 pl-3 text-sm wrap-break-word text-ink-2">«{line.text}»</p>
            <Button type="button" variant="secondary" onClick={() => onTake(line.id)}>
              {as === "achievement" ? `Agregar como logro de ${label}` : `Agregar como tarea de ${label}`}
            </Button>
          </div>
        );
      })}
    </section>
  );
}
