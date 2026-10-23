import type { MouseEvent } from "react";
import { focusHeading } from "@/components/ui/focusHeading";

/**
 * Takes the page to one of its own sections: scrolled into view, easing unless the person asked for less motion,
 * and with focus on its heading, so whoever cannot see the page move is told where they landed. Not a plain
 * `#hash` link, which would scroll and leave focus on the link that was pressed.
 */
export function jumpTo(event: MouseEvent, id: string): void {
  if (goTo(id)) event.preventDefault();
}

/** The same, for what is asked from a part of the page that has no link to press: false when the section is not on the page. */
export function goTo(id: string, focus: string = "h2, summary"): boolean {
  const target = document.getElementById(id);
  if (!target) return false;
  // A section that is shut, or inside one that is, is opened first: a link to a fold that stays shut is a link to nothing.
  for (let fold = target.closest("details"); fold; fold = fold.parentElement?.closest("details") ?? null) fold.open = true;
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  focusHeading(target.querySelector<HTMLElement>(focus));
  return true;
}
