"use client";

import { DownloadDocxButton } from "@/components/cv/DownloadDocxButton";
import { useApplication, useApplicationsReady } from "@/lib/storage/hooks";

/**
 * The toolbar is rendered by the server page, which cannot reach the browser's
 * storage, so the .docx button reads the application itself — the same pair of
 * hooks StoredCV.tsx uses to render the document beneath it.
 */
export function StoredCVDocxButton({ id }: { id: string }) {
  // Ready, not merely hydrated: the applications come from the browser
  // database after hydration, and until then a missing one is not loaded yet.
  const hydrated = useApplicationsReady();
  const application = useApplication(id);

  if (!hydrated || !application?.cv) return null;

  return (
    <DownloadDocxButton data={application.cv} label={application.label}>
      Descargar Word
    </DownloadDocxButton>
  );
}
