"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { PEEK_REM, settle, sheetHeights, stepStop, tapStop, type SheetHeights, type SheetStop } from "./sheet-heights";

/** A finger has to travel this far (px) on the handle before the press is a drag and not a tap. */
const SLOP = 6;

type Gesture = { from: number; start: number; limits: SheetHeights; moved: boolean; samples: Array<{ y: number; at: number }> };

/**
 * A panel over the foot of the page that is pulled up to be used and pushed down to see the page again: for a phone, where the profile's view
 * is the page and what edits it does not fit beside it. It stands on the bar of tabs (on the keyboard, when there is one), rests at three
 * heights —it peeks, it takes half the screen, it opens up to the bar at the top— and is moved by its handle, which is also a button: a tap
 * and the arrow keys step through the heights, so nothing here needs a finger to drag.
 *
 * Whatever inside takes focus opens it whole, so that a field or a jump is never left under it. While it only peeks its content is for looking
 * at, and a press anywhere on it opens it halfway: the first thing seen under a finger is not tapped by accident.
 */
export function BottomSheet({ label, startAt = "peek", children }: { label: string; /** Where it stands when it first shows: peeking, unless what is inside is what the page was opened for. */ startAt?: SheetStop; children: ReactNode }) {
  const contentId = useId();
  const root = useRef<HTMLElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const gesture = useRef<Gesture | null>(null);
  /** When a drag last let go: the click that comes after it is the end of the drag and not a tap. */
  const draggedAt = useRef(0);
  const [stop, setStop] = useState<SheetStop>(startAt);
  const [heights, setHeights] = useState<SheetHeights | null>(null);
  /** The height while a finger is moving the handle: the sheet follows it, with no easing. */
  const [dragging, setDragging] = useState<number | null>(null);
  /** How far the keyboard rises into the page, if it does: the sheet then stands on it and not on the bar of tabs, which it covers. */
  const [lift, setLift] = useState(0);
  /** Whether a change of height is eased. Not when what is inside took focus: it scrolls to what it names right after, and has to find the sheet at its height. */
  const [eased, setEased] = useState(true);
  const moveTo = (next: SheetStop | ((current: SheetStop) => SheetStop)) => {
    setEased(true);
    setStop(next);
  };

  const measure = useCallback((): SheetHeights | null => {
    const element = root.current;
    if (!element) return null;
    const visual = window.visualViewport;
    // The keyboard shortens the visual viewport and not the layout one —so what stands on the foot of the page has to be raised by hand—, and a pinch-zoom
    // shortens it too, for another reason.
    const raised = visual && visual.scale <= 1.01 ? Math.max(0, Math.round(window.innerHeight - visual.height - visual.offsetTop)) : 0;
    const next = sheetHeights({
      viewport: visual?.height ?? window.innerHeight,
      below: raised > 0 ? 0 : (document.querySelector("[data-tab-bar]")?.getBoundingClientRect().height ?? 0),
      above: parseFloat(getComputedStyle(element).getPropertyValue("--nav-h")) || 0,
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
    });
    setLift(raised);
    setHeights((current) => (current && current.peek === next.peek && current.half === next.half && current.full === next.full ? current : next));
    return next;
  }, []);

  useEffect(() => {
    measure();
    const visual = window.visualViewport;
    window.addEventListener("resize", measure);
    visual?.addEventListener("resize", measure);
    visual?.addEventListener("scroll", measure);
    return () => {
      window.removeEventListener("resize", measure);
      visual?.removeEventListener("resize", measure);
      visual?.removeEventListener("scroll", measure);
    };
  }, [measure]);

  // What floats over the page —a notice, the button to take a note— stands above the sheet while it only peeks, and not over its handle.
  useEffect(() => {
    const page = document.documentElement;
    page.style.setProperty("--sheet-lift", stop === "peek" && dragging === null && heights ? `${heights.peek}px` : "0px");
    return () => {
      page.style.removeProperty("--sheet-lift");
    };
  }, [stop, dragging, heights]);

  const heightAt = (g: Gesture, y: number) => Math.min(Math.max(g.start + g.from - y, g.limits.peek), g.limits.full);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const limits = measure();
    if (!limits || !root.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { from: event.clientY, start: root.current.getBoundingClientRect().height, limits, moved: false, samples: [{ y: event.clientY, at: event.timeStamp }] };
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || (!g.moved && Math.abs(g.from - event.clientY) < SLOP)) return;
    g.moved = true;
    // Only the last tenth of a second says how fast the finger was going when it let go.
    g.samples = [...g.samples.filter((sample) => event.timeStamp - sample.at < 100), { y: event.clientY, at: event.timeStamp }];
    setDragging(heightAt(g, event.clientY));
  };

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    gesture.current = null;
    // A press that did not move is a tap, and the click that follows it does the rest.
    if (!g?.moved) return;
    draggedAt.current = performance.now();
    const first = g.samples[0]!;
    const last = g.samples[g.samples.length - 1]!;
    const velocity = last.at > first.at ? (first.y - last.y) / (last.at - first.at) : 0;
    moveTo(settle(heightAt(g, event.clientY), g.limits, velocity));
    setDragging(null);
  };

  const onPointerCancel = () => {
    gesture.current = null;
    setDragging(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const direction = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    moveTo((current) => stepStop(current, direction));
  };

  const height = dragging ?? (heights ? heights[stop] : null);

  return (
    <section
      ref={root}
      aria-label={label}
      data-bottom-sheet=""
      data-stop={stop}
      onFocus={(event) => {
        if (handle.current?.contains(event.target as Node)) return;
        setEased(false);
        setStop("full");
      }}
      onClick={(event) => {
        // The content does not take presses while the sheet peeks, so a press on it lands here.
        if (stop === "peek" && event.target === event.currentTarget) moveTo("half");
      }}
      style={{ height: height ?? `${PEEK_REM}rem`, ...(lift > 0 ? { bottom: lift } : {}) }}
      className={cx(
        "fixed inset-x-0 bottom-[var(--tab-h)] z-40 flex flex-col border-t border-white/15 bg-paper shadow-[0_-8px_24px_rgba(0,0,0,0.5)] chrome:bottom-0",
        dragging === null && eased && "transition-[height] duration-200 ease-out motion-reduce:transition-none",
      )}
    >
      <button
        ref={handle}
        type="button"
        aria-expanded={stop !== "peek"}
        aria-controls={contentId}
        onClick={() => {
          if (performance.now() - draggedAt.current > 50) moveTo(tapStop);
        }}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className="flex w-full shrink-0 cursor-grab touch-none flex-col items-center gap-1.5 px-6 pt-2.5 pb-2 select-none active:cursor-grabbing pointer-coarse:min-h-11"
      >
        <span aria-hidden className="h-1 w-10 bg-white/30" />
        <span className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">{label}</span>
      </button>
      {/* Brought into view inside the sheet, a section stops a little under its top and not under the bars of the page, which it does not go under. */}
      <div id={contentId} className={cx("min-h-0 flex-1 overflow-y-auto overscroll-contain [&_[id]]:scroll-mt-3", stop === "peek" && "pointer-events-none")}>
        {/* Room under the last thing for the buttons that float over a phone's corner (to take a note): at the end of the content nothing is under them. */}
        <div className="mx-auto w-full max-w-[760px] px-6 pb-24 sm:px-10">{children}</div>
      </div>
    </section>
  );
}
