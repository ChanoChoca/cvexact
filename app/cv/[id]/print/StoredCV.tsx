"use client";

import { CVDocument } from "@/components/cv/CVDocument";
import { useApplication, useApplicationsReady } from "@/lib/storage/hooks";

/**
 * Applications live in the browser, so the document has to be read client-side.
 * The server pass renders the loading state.
 */
export function StoredCV({ id }: { id: string }) {
  // Ready, not merely hydrated: the applications come from the browser
  // database after hydration, and until then a missing one is not loaded yet.
  const hydrated = useApplicationsReady();
  const application = useApplication(id);

  if (!hydrated) {
    return <p className="cv-print-hidden p-8 text-neutral-400">Cargando…</p>;
  }

  if (!application?.cv) {
    return (
      <div className="cv-print-hidden p-8 text-neutral-300">
        <p className="font-medium">No encontramos este CV.</p>
        <p className="mt-2 text-sm text-neutral-400">
          Las postulaciones se guardan en este navegador. Si generaste el CV en otro
          celular o computadora, o borraste los datos del sitio, va a haber que generarlo de nuevo.
        </p>
      </div>
    );
  }

  return (
    <div className="cv-page-frame">
      <CVDocument data={application.cv} />
    </div>
  );
}
