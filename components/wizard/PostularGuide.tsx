"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { Button } from "@/components/ui";
import { TOUR, TOUR_PARAM, loadStep, revealDelta, saveStep, settleStep, stopOf, type TourStop } from "./postular-tour";

/** What the card says, and whether there is a step to go on to yet. */
type View = { step: number; stop: TourStop; next: boolean };

const here = (target: string) => document.querySelector(`[data-tour="${target}"]`) !== null;

/** How long the person has to stop writing, once a step's work is done, for the card to go on: a pasted posting is gone on from at once, one being typed is not left under the hand. */
const ADVANCE_AFTER_MS = 600;

/** The card at the foot of the screen, over the bar of tabs. Its words are `TOUR`'s; this only lays them out. */
export function TourCard({ view, onNext, onExit, ref }: { view: View; onNext: () => void; onExit: () => void; ref?: Ref<HTMLElement> }) {
  const { step, stop, next } = view;
  const last = step === TOUR.length;

  return (
    <section
      ref={ref}
      aria-label="Recorrido de Postular"
      data-postular-guide=""
      className="fixed inset-x-3 bottom-[calc(var(--tab-h)+0.75rem)] z-40 border border-white/15 bg-paper-2 px-4 py-3 shadow-lg shadow-black/40 chrome:right-auto chrome:bottom-6 chrome:left-1/2 chrome:w-md chrome:-translate-x-1/2"
    >
      <div aria-live="polite">
        <p className="font-mono text-[11px] tracking-[0.14em] text-ink-3">
          Recorrido · Paso {step} de {TOUR.length}
        </p>
        <p className="mt-1.5 text-[16px] text-ink">{stop.title}</p>
        <p className="mt-1 text-sm text-ink-2">{stop.text}</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {last ? (
          <Button onClick={onExit}>Listo</Button>
        ) : (
          <>
            {next ? <Button onClick={onNext}>Siguiente</Button> : stop.then ? <p className="text-sm text-ink-3">{stop.then}</p> : null}
            {/* Quiet, so that it fits beside «Siguiente» on a phone: the buttons of the app are wide, and two of them took two rows. Still 44 px to the touch. */}
            <button type="button" aria-keyshortcuts="Escape" onClick={onExit} className="text-sm text-ink-3 underline underline-offset-4 hover:text-ink pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">
              Salir del recorrido
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * «Guiame»: a card that goes through the four steps of getting a CV for a posting —paste it, generate, review, download— on the page where they are done,
 * outlining the part of it each one is about. It is switched on by `?guia=1` and followed by the tab (`postular-tour.ts`), because the wizard changes the
 * address when it saves the CV.
 *
 * It does not drive anything: the person does each step, and the card moves on when the page shows the next one (the CV was written) or when «Siguiente» is
 * pressed. A step with work of its own —the posting to paste— goes on by itself once that is done and the person stops writing, with no «Siguiente» to press.
 * It watches the page for that, since what it points at comes and goes with the wizard's own state.
 */
export function PostularGuide({ start }: { start: boolean }) {
  const [view, setView] = useState<View | null>(null);
  const card = useRef<HTMLElement>(null);
  /** What the effect below offers to the card and to the `start` that comes with the address. */
  const tour = useRef<{ go: (step: number) => void; next: () => void; exit: () => void } | null>(null);

  useEffect(() => {
    let step = 0;
    let marked: Element | null = null;
    let frame = 0;
    let advance = 0;
    let watcher: MutationObserver | null = null;

    // The outline is a rule of the stylesheet on whatever carries this mark (`app/globals.css`), so it follows the part wherever the wizard puts it.
    function mark(element: Element | null) {
      if (element === marked) return;
      marked?.removeAttribute("data-tour-on");
      element?.setAttribute("data-tour-on", "");
      marked = element;
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(sync);
    }

    // Only while the tour is on, which is not the case in most visits to Postular: the page is watched, since what the tour points at comes and goes with the wizard's
    // own state, and Escape ends it — unless a dialog or a menu is open, which takes it for itself (the CV editor and the extras menu listen for it on the page too).
    function attach() {
      if (watcher) return;
      watcher = new MutationObserver(schedule);
      watcher.observe(document.body, { childList: true, subtree: true });
      // Typing in the paste box changes no node, and the first step is done when enough is in it.
      document.addEventListener("input", schedule);
      document.addEventListener("keydown", onKey);
    }

    function detach() {
      watcher?.disconnect();
      watcher = null;
      document.removeEventListener("input", schedule);
      document.removeEventListener("keydown", onKey);
      cancelAnimationFrame(frame);
      frame = 0;
      clearTimeout(advance);
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector('dialog[open], [role="dialog"], [role="menu"]')) exit();
    }

    function exit() {
      step = 0;
      saveStep(null);
      detach();
      mark(null);
      setView(null);
      // Left before the wizard changed the address, `guia` is still in it, and a reload would start the tour again.
      const url = new URL(window.location.href);
      if (url.searchParams.has(TOUR_PARAM)) {
        url.searchParams.delete(TOUR_PARAM);
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      }
    }

    function sync() {
      frame = 0;
      if (!step) return;
      const settled = settleStep(step, here);
      if (settled === null) return exit();
      if (settled !== step) {
        step = settled;
        saveStep(step);
      }
      const now = step;
      const stop = stopOf(now, here);
      // Nothing of the wizard on the page yet (it is loading, or being replaced): the card stays as it was.
      if (!stop) return;
      const part = document.querySelector(`[data-tour="${stop.target}"]`);
      mark(part);
      const nextHere = now < TOUR.length && stopOf(now + 1, here) !== null;
      // Each change starts the pause again, so that a posting still being typed is not left behind the moment it is long enough.
      clearTimeout(advance);
      if (nextHere && part !== null && stop.ready?.(part)) {
        advance = window.setTimeout(() => {
          if (step === now) go(now + 1);
        }, ADVANCE_AFTER_MS);
      }
      // «Siguiente» is for the steps that wait on the page; one with work of its own goes on when that is done.
      const next = nextHere && !stop.ready;
      setView((current) => (current?.step === now && current.stop === stop && current.next === next ? current : { step: now, stop, next }));
    }

    function go(to: number) {
      step = to;
      saveStep(to);
      attach();
      sync();
    }

    tour.current = { go, next: () => go(step + 1), exit };
    const kept = loadStep();
    if (kept) go(kept);

    return () => {
      tour.current = null;
      detach();
      mark(null);
    };
  }, []);

  // «Guiame» starts it from the first step, whatever the tab had kept.
  useEffect(() => {
    if (start) tour.current?.go(1);
  }, [start]);

  // Each step brings its part into sight once, between the bar of the app and this card: not again while the person scrolls elsewhere.
  const target = view?.stop.target;
  useEffect(() => {
    const element = document.querySelector("[data-tour-on]");
    const bar = card.current;
    if (!element || !bar) return;
    const nav = parseFloat(getComputedStyle(bar).getPropertyValue("--nav-h")) || 0;
    const delta = revealDelta(element.getBoundingClientRect(), nav + 12, bar.getBoundingClientRect().top - 12);
    // Always, and to a place and not by an amount: a part that is in sight where the page stands now would not be where it stands when the previous step's smooth
    // scroll, still on its way, ends — so even «here» replaces that one.
    window.scrollTo({ top: window.scrollY + delta });
  }, [target]);

  // What floats at the foot of the screen —a notice, the button to take a note— stands above the card and not over it, as it does above the profile's sheet.
  const shown = view !== null;
  useEffect(() => {
    const bar = card.current;
    if (!bar) return;
    const page = document.documentElement;
    const lift = () => page.style.setProperty("--sheet-lift", `${bar.offsetHeight + 8}px`);
    lift();
    const watcher = new ResizeObserver(lift);
    watcher.observe(bar);
    return () => {
      watcher.disconnect();
      page.style.removeProperty("--sheet-lift");
    };
  }, [shown]);

  if (!view) return null;
  return <TourCard ref={card} view={view} onNext={() => tour.current?.next()} onExit={() => tour.current?.exit()} />;
}
