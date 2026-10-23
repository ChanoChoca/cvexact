import type { VideoBlock } from "@/lib/schemas/outputs";

/**
 * Turning a list of block durations into a timeline.
 *
 * Computed here rather than asked of the model: the ranges are what the
 * candidate watches while recording, and a model that adds up slightly wrong
 * produces a script whose last block ends after the video was supposed to. It
 * is also the one thing on the sheet that must match between the panel and the
 * printed PDF, so both import this.
 */

/** Where each block starts: the running sum of the ones before it. */
export function startTimes(blocks: VideoBlock[]): number[] {
  const starts: number[] = [];
  let elapsed = 0;
  for (const block of blocks) {
    starts.push(elapsed);
    elapsed += block.seconds;
  }
  return starts;
}

/** mm:ss, zero-padded, for a duration in seconds. */
export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
