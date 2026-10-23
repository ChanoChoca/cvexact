"use client";

import { VideoScriptDocument } from "@/components/video/VideoScriptDocument";
import { useHandoffPayload } from "@/components/export/useHandoffPayload";
import type { VideoScript } from "@/lib/schemas/outputs";

/** The video script's print target. Sibling of app/prep/render/page.tsx. */
export default function VideoRenderPage() {
  const data = useHandoffPayload<VideoScript>();
  if (!data) return null;

  return (
    <div className="video-page-frame">
      <VideoScriptDocument data={data} />
    </div>
  );
}
