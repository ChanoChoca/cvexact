"use client";

import { VideoScriptDocument } from "@/components/video/VideoScriptDocument";
import { useApplication, useApplicationsReady } from "@/lib/storage/hooks";

export function StoredVideoScript({ id }: { id: string }) {
  // Ready, not merely hydrated: the applications come from the browser
  // database after hydration, and until then a missing one is not loaded yet.
  const hydrated = useApplicationsReady();
  const application = useApplication(id);

  if (!hydrated) {
    return <p className="cv-print-hidden p-8 text-neutral-400">Cargando…</p>;
  }

  if (!application?.video) {
    return (
      <div className="cv-print-hidden p-8 text-neutral-300">
        <p className="font-medium">Todavía no generaste el guion del video.</p>
        <p className="mt-2 text-sm text-neutral-400">
          Volvé a la postulación y generalo desde ahí.
        </p>
      </div>
    );
  }

  return (
    <div className="video-page-frame">
      <VideoScriptDocument data={application.video} />
    </div>
  );
}
