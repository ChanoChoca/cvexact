/**
 * Moves focus to a heading, so that what a screen changed to is said to whoever
 * cannot see it change. A step or a question that replaces the last one leaves focus
 * on nothing — the button that was pressed is gone with it — and a screen reader then
 * announces nothing about the new one.
 *
 * Not while a field has focus: one that took it on its own a moment ago (the first
 * box of a form, on a computer) is where the person means to be, and a heading is not.
 */
export function focusHeading(heading: HTMLElement | null | undefined): void {
  if (!heading) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches("input, textarea, select, [contenteditable]")) return;
  // A place to land, not something to stop at: reachable by a script and not by Tab, and with no ring of its own.
  heading.tabIndex = -1;
  heading.style.outline = "none";
  heading.focus({ preventScroll: true });
}
