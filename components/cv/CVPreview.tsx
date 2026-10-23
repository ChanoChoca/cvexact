"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CVDocument } from "./CVDocument";
import { PAGE_WIDTH_PX, PAGE_HEIGHT_PX, cvFontsReady, createCvMeasurer, sheetLimitPx, type CvMeasurer } from "./measure";
import type { Sheets } from "@/lib/cv/sheets";
import type { CVDocument as CVDocumentData } from "@/lib/schemas/cv";
import type { PreviewFactRef } from "@/lib/cv/from-profile";

/**
 * Where the preview stands against the one-page limit.
 *
 * `"under"` is gone: a CV short of a full page is not a problem to flag — the
 * blank space belongs to the user, and the fitting flow (when asked) is what
 * fills it. The threshold is `FIT_LIMIT_PX`, the *engine's* limit with its
 * safety slack, not `PAGE_HEIGHT_PX` plus tolerance: whenever the engine would
 * refuse to call this CV a fit, the UI must offer "Ajustar a una hoja", or the
 * two halves of the feature disagree about what fits.
 */
export type PageFit = "ok" | "over";


/**
 * Scaled preview of the printable document.
 *
 * Scaling with a transform rather than `zoom` keeps the document's own layout
 * arithmetic in pt, untouched — the preview must not be able to disagree with
 * what the printer produces.
 */
export function CVPreview({
  data,
  onFitChange,
  fullSizeHref,
  factRefs,
  onFactClick,
  sheets = 1,
}: {
  data: CVDocumentData;
  onFitChange?: (fit: PageFit) => void;
  /** How many sheets the person allowed (`Application.sheets`): the CV is judged against that many, and with two the page where the second begins is marked. */
  sheets?: Sheets;
  /**
   * The print route this CV opens at full size, when there is one: a preview
   * of something not saved anywhere has no page of its own to open. Rendered
   * two ways: a small pill over the page's corner from `sm` up, where the scale still leaves
   * text legible, and a full-width primary link below the page under `sm`,
   * where the page renders at under half size and a corner pill is both hard
   * to read and hard to land a thumb on.
   */
  fullSizeHref?: string;
  /** `previewFactRefs(profile)` — required alongside `onFactClick` to make a line clickable; omitted, the page stays exactly as inert as it always was. */
  factRefs?: ReadonlyMap<string, PreviewFactRef>;
  /** A line of the "experience" section was clicked: which fact, in which job. */
  onFactClick?: (ref: PreviewFactRef) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    /**
     * Measured on the box the page has to fit in — the bordered, scrollable
     * one — and with `clientWidth`, which leaves out both that 1px border and
     * whatever width a scrollbar is holding. Measuring the `w-full` wrapper
     * around it, which has neither, counted 2px of border as free space: the
     * scaled page came out 2px too wide on every screen (12px on a real
     * Chrome, where the vertical scrollbar is a classic one), which is the
     * short horizontal scroll this box was showing.
     *
     * One pixel under, so a scaled edge landing exactly on the box's edge
     * cannot round back up into a scrollbar of its own — white on white, the
     * sliver is invisible.
     *
     * No cap at 1: the sheet fills the column it is given. On the profile's
     * half of a wide screen that column is wider than the page's own ~794 px,
     * and stopping at its real size left the CV the same while its column grew.
     * It is drawn, not photographed —scaling above 1 keeps the text crisp— and
     * "Ver a tamaño real" still opens the page at its own size.
     */
    const fit = () => setScale((box.clientWidth - 1) / PAGE_WIDTH_PX);
    fit();
    // The observer also fires when a scrollbar appears or goes: the fit is
    // against the width that is left, never against the width before it.
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // The one-page constraint is a real product limit, so measure it rather than
  // trusting the model's length budget. The measurement is off-screen (see
  // `measure.ts`): the visible container's `scrollHeight` would be floored by
  // the sheet's `min-height` and never report a short CV honestly — the
  // off-screen render anulls that floor inline and returns the content's
  // natural height, compared against the same `FIT_LIMIT_PX` the fitting
  // engine uses.
  useEffect(() => {
    if (!onFitChange) return;

    let cancelled = false;
    let measurer: CvMeasurer | null = null;

    const measure = async () => {
      // Faces first: a height taken while STIX is still swapping in against a
      // fallback can differ from the height the printer produces. The wait has
      // a timeout inside, so a stalled font never wedges the preview.
      await cvFontsReady(data);
      if (cancelled) return;
      measurer ??= createCvMeasurer();
      const height = measurer.measure(data, sheets);
      if (cancelled) return;
      onFitChange(height > sheetLimitPx(sheets) ? "over" : "ok");
    };

    // Kick the first measurement; everything below happens off the effect's
    // synchronous body (the repo's lint rule rejects a setState called there).
    void measure();

    // Fonts finish loading after first paint — every completed load can change
    // metrics (a fallback face giving way to STIX), so re-measure each time.
    const fonts = document.fonts;
    fonts.addEventListener("loadingdone", measure);

    return () => {
      cancelled = true;
      fonts.removeEventListener("loadingdone", measure);
      // After this commit, not during it: React refuses to unmount a root while another is rendering, and an effect's cleanup runs inside the commit.
      const done = measurer;
      queueMicrotask(() => done?.dispose());
    };
  }, [data, onFitChange, sheets]);


  return (
    // The wrapper is only here to be the positioned ancestor of the corner
    // action; what the fit is measured on is the box inside it — see the
    // effect above.
    <div className="w-full">
      <div className="relative w-full">
        <div
          ref={boxRef}
          // Reserve the scaled footprint; a transform does not affect layout.
          // `box-content` so the reserved height is the area the page gets,
          // not that area minus the border the frame draws around it: at
          // `border-box` (the app's own default) a CV that fitted a page
          // exactly overflowed by the frame's 2px.
          style={{ height: PAGE_HEIGHT_PX * scale }}
          // `touch-action: pinch-zoom` on top of the browser's own overflow
          // scrolling: a page scaled under half size still has real text
          // under it, and a phone should be able to pinch in on it instead
          // of being stuck at whatever the container width happened to be.
          className="box-content overflow-auto border border-rule bg-white [touch-action:pinch-zoom]"
        >
          {/* The footprint the box scrolls: the sheet at the size it is drawn, untransformed. A transform does not exist for layout — the
              page's own height is the sheet's *unscaled* one (1122.5px), and that is what a scrollbar would measure, scrolling a whole empty
              page past a CV that fitted in one. With it, the content is exactly the frame; only a CV that really spills past a page extends
              the area, by the spill's own scaled height. */}
          <div style={{ height: PAGE_HEIGHT_PX * scale }}>
            <div
              ref={pageRef}
              // The page's own size, not the box's: the document centres itself with `margin: 0 auto`, and at a scale above 1 a wrapper as
              // wide as the box would scale that centring offset too, pushing the sheet past the right edge. At its own size, the sheet's
              // top-left corner is the wrapper's, which is where `transform-origin` scales from.
              style={{ width: PAGE_WIDTH_PX, height: PAGE_HEIGHT_PX, transform: `scale(${scale})`, transformOrigin: "top left" }}
              className="relative"
            >
              {/* Where the first sheet ends, for a CV that is allowed two: a line over the page at its height, with its words above it so that a CV that fits one sheet is not made to scroll. */}
              {sheets === 2 ? (
                <div aria-hidden className="pointer-events-none absolute right-0 left-0 z-10 border-t border-dashed border-black/40" style={{ top: PAGE_HEIGHT_PX - 1 }}>
                  <span className="absolute right-2 bottom-0 bg-white px-1 text-[10px] text-black/50">Fin de la hoja 1</span>
                </div>
              ) : null}
              <CVDocument
                data={data}
                onExperienceBulletClick={
                  factRefs && onFactClick
                    ? (itemIndex, bulletIndex) => {
                        const ref = factRefs.get(`${itemIndex}:${bulletIndex}`);
                        if (ref) onFactClick(ref);
                      }
                    : undefined
                }
              />
            </div>
          </div>
        </div>
        {fullSizeHref ? (
          <Link
            href={fullSizeHref}
            target="_blank"
            // Over the page, so it stays with the thing it magnifies — and
            // translucent, because the corner it sits on belongs to the
            // document. Hidden under `sm`, where the full-width link below
            // takes over.
            className="absolute top-2 right-2 z-10 hidden border border-rule bg-paper/85 px-2 py-0.5 text-[11px] text-ink-2 opacity-80 backdrop-blur-md transition hover:border-ink hover:text-ink hover:opacity-100 sm:block motion-reduce:transition-none"
          >
            Ver a tamaño real ↗
          </Link>
        ) : null}
      </div>
      {fullSizeHref ? (
        <Link
          href={fullSizeHref}
          target="_blank"
          className="mt-2 flex items-center justify-center border border-rule px-4 py-3 text-sm text-ink-2 transition-colors hover:border-ink hover:text-ink sm:hidden motion-reduce:transition-none"
        >
          Ver a tamaño real ↗
        </Link>
      ) : null}
    </div>
  );
}
