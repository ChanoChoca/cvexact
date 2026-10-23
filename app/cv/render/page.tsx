"use client";

import { CVDocument } from "@/components/cv/CVDocument";
import { useHandoffPayload } from "@/components/export/useHandoffPayload";
import type { CVDocument as CVDocumentData } from "@/lib/schemas/cv";

/**
 * The page the headless browser prints. Nothing but the document — no toolbar,
 * no back link, no loading copy that could land on the paper.
 *
 * It is the sibling of /cv/[id]/print, which stays: that one is the on-screen
 * preview and the browser-print fallback, and /cv/demo/print is the template
 * fidelity check. This one exists because the printer is not the user's browser
 * and cannot read the user's localStorage.
 *
 * Opened by hand it renders blank, which is the whole of what it should show.
 */
export default function CVRenderPage() {
  const data = useHandoffPayload<CVDocumentData>();
  if (!data) return null;

  return (
    <div className="cv-page-frame">
      <CVDocument data={data} />
    </div>
  );
}
