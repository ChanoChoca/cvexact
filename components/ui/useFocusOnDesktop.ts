import { useCallback } from "react";

/**
 * A ref for the field a screen is *about*: focused when it appears, but only where
 * there is a mouse. On a phone, focusing opens the keyboard and scrolls the page
 * under it — before the person has read the question — so there it waits to be
 * tapped.
 */
export function useFocusOnDesktop<T extends HTMLElement>() {
  return useCallback((node: T | null) => {
    if (node && window.matchMedia("(pointer: fine)").matches) node.focus({ preventScroll: true });
  }, []);
}
