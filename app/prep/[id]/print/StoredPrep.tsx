"use client";

import { PrepDocument } from "@/components/prep/PrepDocument";
import { useApplication, useApplicationsReady } from "@/lib/storage/hooks";

export function StoredPrep({ id }: { id: string }) {
  // Ready, not merely hydrated: the applications come from the browser
  // database after hydration, and until then a missing one is not loaded yet.
  const hydrated = useApplicationsReady();
  const application = useApplication(id);

  if (!hydrated) {
    return <p className="cv-print-hidden p-8 text-neutral-400">Cargando…</p>;
  }

  if (!application?.interview) {
    return (
      <div className="cv-print-hidden p-8 text-neutral-300">
        <p className="font-medium">Todavía no generaste la preparación de entrevista.</p>
        <p className="mt-2 text-sm text-neutral-400">
          Volvé a la postulación y generala desde ahí.
        </p>
      </div>
    );
  }

  return (
    <div className="prep-page-frame">
      <PrepDocument data={application.interview} />
    </div>
  );
}
