/**
 * The three heights a bottom sheet rests at, and where a gesture on its handle leaves it. In px and with no DOM, so that
 * the rule —a drag ends on the nearest height, or on the next one in the direction of a flick— is a test and not
 * something to look at on a phone.
 */
export const SHEET_STOPS = ["peek", "half", "full"] as const;
export type SheetStop = (typeof SHEET_STOPS)[number];
export type SheetHeights = Record<SheetStop, number>;

/** How much of the sheet shows when it only peeks over the page: its handle and the first line under it. */
export const PEEK_REM = 7.5;

/** px per ms: a release faster than this is a flick, which goes on to the next height; slower is a drag let go where it stopped. */
const FLICK = 0.4;

/**
 * The heights for a screen `viewport` px tall, with `below` px taken at the foot (the bar of tabs, or the keyboard) and `above` px at
 * the top (the bar the sheet opens up to, and not over). The half is half the screen, and neither can be taller than the whole.
 */
export function sheetHeights({ viewport, below, above, rem = 16 }: { viewport: number; below: number; above: number; rem?: number }): SheetHeights {
  const full = Math.max(viewport - below - above, 0);
  const peek = Math.min(PEEK_REM * rem, full);
  return { peek, half: Math.min(Math.max(viewport / 2, peek), full), full };
}

/**
 * Where a drag let go at `height` comes to rest. `velocity` is px per ms, positive when the finger was going up: a flick goes to the next
 * height in its direction from where it let go, however short the drag was; anything slower goes to the nearest.
 */
export function settle(height: number, heights: SheetHeights, velocity = 0): SheetStop {
  if (Math.abs(velocity) >= FLICK) {
    const ahead = velocity > 0 ? SHEET_STOPS.filter((stop) => heights[stop] > height + 1) : SHEET_STOPS.filter((stop) => heights[stop] < height - 1).reverse();
    return ahead[0] ?? (velocity > 0 ? "full" : "peek");
  }
  return SHEET_STOPS.reduce((best, stop) => (Math.abs(heights[stop] - height) < Math.abs(heights[best] - height) ? stop : best));
}

/** One height up (`1`) or down (`-1`) from this one, and no further than the ends: what the arrow keys do. */
export function stepStop(stop: SheetStop, direction: 1 | -1): SheetStop {
  const index = SHEET_STOPS.indexOf(stop) + direction;
  return SHEET_STOPS[Math.min(Math.max(index, 0), SHEET_STOPS.length - 1)]!;
}

/** A tap on the handle: up one height, and from the top back down to the peek, so that a single button reaches all three. */
export const tapStop = (stop: SheetStop): SheetStop => (stop === "full" ? "peek" : stepStop(stop, 1));
