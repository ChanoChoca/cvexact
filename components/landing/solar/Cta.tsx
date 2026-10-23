"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRef } from "react";
import type { ReactNode } from "react";
import { chamfer } from "@/components/ui/chamfer";

/**
 * The big violet Cta (hero, final CTA section) — chamfered corners, a
 * two-line "marquee" that slides continuously behind the label once
 * hovered. Its own client file, separate from `./parts.tsx`, so that
 * server-only module (it renders the legal footer's `OperatorIdentity`,
 * which reads `process.env` at request time) never gets pulled into a
 * client bundle just because this one button needs refs and event
 * handlers.
 *
 * Ported behaviour, not approximated: `animation-play-state` starts
 * `paused` (see `[data-solar-marquee]` in globals.css); hovering sets it
 * `running`; leaving doesn't cut it — it arms a "stop wanted" flag that
 * `onAnimationIteration` only honours once the current 1.1s loop finishes,
 * so the line never cuts mid-slide. Same three handlers as the original's
 * `lineOn`/`lineOff`/`lineIteration`.
 */
export function Cta({ href, children }: { href: Route; children: ReactNode }) {
  const lineRef = useRef<HTMLSpanElement>(null);
  const hovering = useRef(false);
  const wantStop = useRef(false);

  const onEnter = () => {
    hovering.current = true;
    wantStop.current = false;
    const el = lineRef.current;
    if (el && el.style.animationPlayState !== "running") el.style.animationPlayState = "running";
  };
  const onLeave = () => {
    hovering.current = false;
    wantStop.current = true;
  };
  const onIteration = () => {
    if (!wantStop.current || hovering.current) return;
    wantStop.current = false;
    if (lineRef.current) lineRef.current.style.animationPlayState = "paused";
  };

  return (
    <Link
      href={href}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={chamfer(24)}
      className="inline-flex h-[66px] items-center gap-[26px] py-0 pr-9 pl-[38px] font-solar text-xl font-bold tracking-[0.24em] text-solar-ink uppercase transition-[filter] duration-250 bg-solar-g4 hover:brightness-110"
    >
      <span>{children}</span>
      <span className="block h-0.5 w-[52px] flex-none overflow-hidden">
        <span ref={lineRef} data-solar-marquee onAnimationIteration={onIteration} className="flex h-0.5 w-max items-center gap-4">
          <span className="block h-0.5 w-9 flex-none bg-white" />
          <span className="block h-0.5 w-9 flex-none bg-white" />
        </span>
      </span>
    </Link>
  );
}
