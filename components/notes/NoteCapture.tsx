"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/toast";
import { registerShareWorker } from "@/lib/notes/share";
import { useStoredProfile } from "@/lib/storage/hooks";
import { useExperiment } from "@/lib/use-experiment";
import { NoteForm } from "./NoteForm";

/**
 * «Anotá algo», from any screen of the app (e5, O15): a button that is always in reach and a box that opens over whatever the person was doing, so
 * that writing something down never means leaving it. It is not there while the profile is still being started — a note about nothing —, nor on the page
 * that already is the box, and not at all unless it is switched on (`lib/experiments.ts`): off, nothing is drawn and nothing is registered.
 *
 * Switched on, it also registers the worker that lets Android share to the app without it passing through any server (`public/share-sw.js`).
 *
 * On a phone the corner it floats in is where the buttons of a card are (the «Quitar» of a row, the last button of a form), and it sat on top of them. It goes out of the way
 * when the page is being read downwards and comes back as soon as it goes up, or stops at the top (`useHiddenWhileReading`): nobody reaching for a button below it has to
 * find the way around it, and it is there when someone goes back up. Not on a computer, where the corner is clear of the page.
 */

/** How far a page has to go, in a direction, before it counts as going that way: a finger resting on the screen moves it a little without meaning it. */
const SCROLL_STEP = 8;
/** Not hidden in the first screen: there is nothing under it yet to be in the way of. */
const SCROLL_FROM = 120;

/** Whether the page is being read downwards — the button hides — and not up, nor at the top. The page, or the sheet that holds the profile on a phone: each is read by its own position. */
function useHiddenWhileReading(active: boolean): boolean {
  const [hidden, setHidden] = useState(false);
  const last = useRef(new WeakMap<object, number>());
  useEffect(() => {
    if (!active) return;
    // The phone is the only place it is in the way (`max-chrome` in its classes): on a computer it is never hidden, and nothing here re-draws it.
    const phone = window.matchMedia("(width < 46rem)");
    last.current.set(window, window.scrollY);
    let frame = 0;
    const onScroll = (event: Event) => {
      // A scroll of an element does not bubble, so it is caught on the way down; only the content of a sheet counts, and not every box of the page that scrolls.
      const sheet = event.target instanceof HTMLElement && event.target.parentElement?.hasAttribute("data-bottom-sheet") ? event.target : null;
      if (!sheet && event.target !== document) return;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const source = sheet ?? window;
        const at = sheet ? sheet.scrollTop : window.scrollY;
        const moved = at - (last.current.get(source) ?? 0);
        if (Math.abs(moved) < SCROLL_STEP) return;
        last.current.set(source, at);
        setHidden(phone.matches && moved > 0 && at > SCROLL_FROM);
      });
    };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      cancelAnimationFrame(frame);
    };
  }, [active]);
  return hidden;
}

export function NoteCapture() {
  const on = useExperiment("note_capture");
  const pathname = usePathname();
  const profile = useStoredProfile();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const away = useHiddenWhileReading(on);

  useEffect(() => {
    if (on) void registerShareWorker();
  }, [on]);

  if (!on || !profile.onboarding.done || pathname.startsWith("/perfil/empezar") || pathname.startsWith("/anotar")) return null;

  return (
    <>
      {/* The button floats over the corner of a phone, above the tab bar, and the page ends 2rem above that bar: without this room the last thing on a page, scrolled all
          the way down, would sit under it. Not on a computer, where the corner is clear of the page. */}
      <div aria-hidden className="h-8 chrome:hidden" />
      {/* Out of the way while the page goes down, and still there for the keyboard: focusing it brings it back. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-note-capture
        className={`fixed right-4 bottom-[calc(var(--tab-h,3.75rem)+0.75rem)] z-40 mb-[var(--sheet-lift,0px)] border border-white/15 bg-paper-2 px-3.5 py-2 font-solar text-[14.5px] font-bold tracking-[0.18em] text-ink-2 uppercase shadow-lg shadow-black/40 transition-[color,border-color,opacity,translate] hover:border-solar-g4 hover:text-ink pointer-coarse:min-h-11 motion-reduce:transition-none chrome:right-8 chrome:bottom-8 ${
          away ? "max-chrome:pointer-events-none max-chrome:translate-y-20 max-chrome:opacity-0 max-chrome:focus-visible:pointer-events-auto max-chrome:focus-visible:translate-y-0 max-chrome:focus-visible:opacity-100" : ""
        }`}
        data-note-capture-away={away ? "" : undefined}
      >
        + Anotá algo
      </button>
      <Modal open={open} onClose={() => setOpen(false)} labelledBy="note-capture-title" className="max-w-xl p-6">
        <div className="space-y-2">
          <h2 id="note-capture-title" className="sr-only">
            Anotá algo
          </h2>
          <NoteForm
            via="capture"
            onSaved={() => {
              setOpen(false);
              toast({ tone: "good", message: "Anotado: queda en tus notas, con la fecha de hoy." });
            }}
            onClose={() => setOpen(false)}
          />
        </div>
      </Modal>
    </>
  );
}
