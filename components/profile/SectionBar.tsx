"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { jumpTo } from "@/components/profile/jumpTo";

export type SectionLink = { id: string; label: string; count?: number | undefined };

/**
 * Ajustes' sections, as a bar that stays in view while the page is read — for a phone, where the page is a long
 * column and the only way to a section further down was to scroll to it. Each says how much is in it, and the one
 * being read is marked. It is not on a computer, where the page is a click away from anywhere in it. (The profile
 * had one too, until its sections folded: shut, they are the index, and a bar that follows the scroll has nothing to follow in a sheet.)
 */
export function SectionBar({ sections, label }: { sections: readonly SectionLink[]; /** What the bar is a list of, for whoever reads it aloud. */ label: string }) {
  const [active, setActive] = useState<string | null>(null);
  const bar = useRef<HTMLElement>(null);
  const ids = sections.map((section) => section.id).join(",");

  useEffect(() => {
    // The section being read is the last one whose top has gone up under the bar. Worked out from where the sections are
    // each time the page moves — not from which of them came into view, which says nothing of the ones that did not change.
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = (bar.current?.getBoundingClientRect().bottom ?? 0) + 24;
      const atTheEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      let current: string | null = null;
      for (const id of ids.split(",")) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= line) current = id;
      }
      // A last section too short to ever reach the line is the one being read once the page can go no further.
      if (atTheEnd) current = ids.split(",").filter((id) => document.getElementById(id)).pop() ?? current;
      setActive(current);
    };
    const onMove = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onMove, { passive: true });
    window.addEventListener("resize", onMove);
    onMove();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onMove);
      window.removeEventListener("resize", onMove);
    };
  }, [ids]);

  return (
    <nav
      ref={bar}
      aria-label={label}
      className="sticky top-[var(--nav-h)] z-30 -mx-6 border-b border-rule bg-[rgba(1,2,12,0.88)] backdrop-blur-[18px] sm:hidden"
    >
      <ul className="flex snap-x gap-1 overflow-x-auto px-3">
        {sections.map((section) => (
          <li key={section.id} className="shrink-0 snap-start">
            <a
              href={`#${section.id}`}
              aria-current={active === section.id ? "location" : undefined}
              onClick={(event) => jumpTo(event, section.id)}
              className={cx(
                "relative flex min-h-11 items-center px-3 font-solar text-[12px] font-bold tracking-[0.14em] whitespace-nowrap uppercase transition-colors motion-reduce:transition-none",
                active === section.id ? "text-ink" : "text-ink-3 hover:text-ink",
              )}
            >
              {section.label}
              {section.count !== undefined ? <span className="ml-1.5 font-normal text-ink-3">({section.count})</span> : null}
              {active === section.id ? <span aria-hidden className="absolute inset-x-3 bottom-0 h-0.5 bg-(image:--gradient-solar-text)" /> : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
