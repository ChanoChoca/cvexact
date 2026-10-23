"use client";

import { useRef } from "react";
import { RunwayScene } from "./scenes/RunwayScene";

/**
 * The runway section's own small client component — it exists only because
 * the scroll driver needs a `ref` to the pinned track (`app/page.tsx` itself
 * stays a server component and can't call hooks). Structure and sizing are
 * the design reference's, verbatim: a 300vh (`(100svh - 77px) * 3`) track with a
 * `sticky` child pinned at `top: 77px` (the nav's height + hairline). No
 * heading here — the reference has none, just the visual.
 */
export function RunwayTrack() {
  const trackRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={trackRef} className="relative" style={{ height: "calc((100svh - 77px) * 3)" }}>
      <div className="sticky top-[77px] flex h-[calc(100svh-77px)] w-full items-center justify-center overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-55"
          style={{ background: "radial-gradient(ellipse 70% 55% at 50% 50%, rgba(127,102,240,0.16), rgba(1,2,12,0) 70%)" }}
        />
        <div className="relative z-1 block h-full w-full">
          <RunwayScene trackRef={trackRef} />
        </div>
      </div>
    </div>
  );
}
