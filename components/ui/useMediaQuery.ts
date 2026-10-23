import { useSyncExternalStore } from "react";

/**
 * Whether a media query matches now, and again whenever that changes — for what has to know which layout
 * it is in (to not build the half that is hidden), not just to look different in each. Nothing matches
 * before the page is in the browser.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
