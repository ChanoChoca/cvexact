"use client";

import { PrepDocument } from "@/components/prep/PrepDocument";
import { useHandoffPayload } from "@/components/export/useHandoffPayload";
import type { InterviewPrep } from "@/lib/schemas/outputs";

/** The interview sheet's print target. Sibling of app/cv/render/page.tsx. */
export default function PrepRenderPage() {
  const data = useHandoffPayload<InterviewPrep>();
  if (!data) return null;

  return (
    <div className="prep-page-frame">
      <PrepDocument data={data} />
    </div>
  );
}
