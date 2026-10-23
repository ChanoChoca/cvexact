"use client";

/**
 * Measuring the CV on screen: faces loaded, natural height, and how each bullet
 * wraps.
 *
 * Client-only — it touches `document`, `createRoot` and a `Range`, none of which
 * exist on the server. The PDF Chromium prints (`lib/export/pdf.ts`) is the final
 * authority; this measurement anticipates and diagnoses, which is why it lives
 * beside the preview rather than in the generator.
 *
 * Two distinctions this module exists to hold:
 *
 *  - **Natural height, not floored height.** `.cv-document` declares a
 *    `min-height` of one sheet, so its `scrollHeight` never drops below ~1122px
 *    and a short CV looks like a full page. Measuring with `min-height` anulled
 *    inline returns the content's real height — what the fitting engine compares
 *    against `FIT_LIMIT_PX`.
 *  - **Faces loaded ≠ glyphs guaranteed.** `cvFontsReady` confirms the three
 *    expected STIX faces answered for *this* text; it does not prove every glyph
 *    of the CV came from STIX (a glyph outside the woff2 `unicode-range`s falls
 *    back to the system font even while `check()` says true). That check is
 *    `inspectPdfFonts` (`lib/export/pdf.ts`) over the finished PDF — a different
 *    question, at a different moment.
 */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { CV_FONT_FACES } from "@/lib/cv/fonts";
import { breakWaste, withHeadingsGlued } from "@/lib/cv/pagination";
import type { Sheets } from "@/lib/cv/sheets";
import { projectLinkLabel, type CVDocument } from "@/lib/schemas/cv";
import { CVDocument as CVDocumentView } from "./CVDocument";

/** A4 in CSS pixels — the pt the stylesheet draws, converted (1pt = 96/72 px). */
export const PAGE_WIDTH_PX = (595.28 * 96) / 72;
/** A4 height in CSS pixels: 1122.52… — what a full sheet measures. */
export const PAGE_HEIGHT_PX = (841.89 * 96) / 72;
/**
 * How many pixels of the sheet the engine refuses to call "fits".
 *
 * The print pipeline is not this browser: Chromium in production measures the
 * same DOM under its own font shims, DPI and rounding, and a CV that lands
 * exactly on `PAGE_HEIGHT_PX` here can spill there. Six pixels — a hairline of
 * padding — is the margin that keeps «entra en una hoja» from being a near-miss.
 * Calibration knob (see to-do §11): raise it if staging ever reports a spill this
 * measurement called a fit.
 */
export const FIT_SLACK_PX = 6;
/** The engine's limit: a CV whose natural height exceeds this does not fit. */
export const FIT_LIMIT_PX = PAGE_HEIGHT_PX - FIT_SLACK_PX;

/**
 * Top and bottom padding of the document, in px. A CV of two sheets prints with them on each (`box-decoration-break: clone` in the print
 * stylesheet), so the second sheet takes this much less than a whole one: what a document can hold is the sheets, less the padding it has once.
 */
const SHEET_TOP_PX = (28.4 * 96) / 72;
const SHEET_PADS_PX = ((28.4 + 14.2) * 96) / 72;

/** The height of the sheets themselves, for how far a printed CV ran past them. */
export const sheetsHeightPx = (sheets: Sheets): number => (sheets === 1 ? PAGE_HEIGHT_PX : sheets * PAGE_HEIGHT_PX - SHEET_PADS_PX);

/**
 * The limit for a CV of this many sheets, against what `CvMeasurer.measure` returns for that many: `FIT_LIMIT_PX` for one, and for two
 * what the sheets hold less the slack — the measure of two sheets already counts what the page breaks waste (`lib/cv/pagination.ts`).
 */
export const sheetLimitPx = (sheets: Sheets): number => (sheets === 1 ? FIT_LIMIT_PX : sheetsHeightPx(sheets) - FIT_SLACK_PX);

/** Every string the CV shows, in reading order — what the faces must cover. */
function cvText(cv: CVDocument): string {
  const parts: string[] = [
    cv.header.fullName,
    cv.header.location,
    cv.header.phone,
    cv.header.email,
    ...cv.header.links.flatMap((link) => [link.label, link.url]),
    cv.summary,
  ];

  for (const section of cv.sections) {
    parts.push(section.title);
    if (section.kind === "bullets") {
      parts.push(...section.bullets);
      continue;
    }
    if (section.kind === "pairs") {
      for (const item of section.items) parts.push(item.label, item.value);
      continue;
    }
    if (section.kind === "projects") {
      for (const item of section.items) parts.push(item.name, item.description, projectLinkLabel(item.url));
      continue;
    }
    if (section.kind === "activities") {
      for (const item of section.items) parts.push(item.text);
      continue;
    }
    if (section.kind === "experience") {
      for (const item of section.items) {
        parts.push(item.company, item.role, item.location, item.dateRange, item.note ?? "", ...item.bullets);
      }
      continue;
    }
    for (const item of section.items) {
      parts.push(item.institution, item.degree, item.location, item.date, item.honors);
    }
  }

  return parts.filter(Boolean).join(" ");
}

/**
 * Waits for the three STIX faces to be loaded for *this* CV.
 *
 * Deliberately not `document.fonts.ready`: that resolves even when a face
 * failed, so "ready" would not mean "loaded". It loads the three faces
 * explicitly against the CV's text (so both subsets are requested if the text
 * needs them), with a cap — a slow network cannot wedge the measurement — and
 * then requires `check` to be true for all three.
 *
 * `check` here confirms the faces answered for this text; it does **not**
 * certify that every glyph of the CV belongs to STIX (see this file's header).
 * Glyph coverage is decided over the PDF, by `inspectPdfFonts`.
 *
 * Returns false if anything failed or the cap elapsed: the caller decides
 * whether to measure anyway (against the fallback face) or to report that it
 * could not verify.
 */
export async function cvFontsReady(cv: CVDocument, timeoutMs = 4_000): Promise<boolean> {
  if (typeof document === "undefined" || !document.fonts) return false;
  const text = cvText(cv);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const loaded = await Promise.race([
      Promise.all(CV_FONT_FACES.map((face) => document.fonts.load(face, text))),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    if (!loaded) return false;
    return CV_FONT_FACES.every((face) => document.fonts.check(face, text));
  } catch {
    // A face that rejects is a face that did not load — not ready.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** How a bullet wrapped: how many lines it takes, and how full its last line is. */
export type BulletLayout = {
  /** Line boxes the bullet's text occupies (its `::before` marker is not DOM, so not counted). */
  lines: number;
  /**
   * Width of the last line over the widest line of the same bullet, 0–1.
   *
   * A short tail (well under 1) means cutting a few words pulls a whole line up —
   * exactly the trade the condense stage (Etapa 2) prices.
   */
  tailRatio: number;
};

/**
 * Every `<li>` of the document, in reading order.
 *
 * Only two things render an `<li>`: an experience entry's bullets and a
 * `bullets` section's lines (see `CVDocument.tsx` — honors and pairs are `<p>`),
 * which is the same set of lines the engine can shorten.
 */
export type CvLayout = { bullets: BulletLayout[] };

export type CvMeasurer = {
  /**
   * Natural height in px of the rendered CV, with `min-height` anulled. For two sheets, that height plus what the page breaks waste: the
   * height the CV will take once it is printed, which is what `sheetLimitPx` is compared with.
   */
  measure(cv: CVDocument, sheets?: Sheets): number;
  /** How each bullet wraps, for deciding what is cheap to shorten. */
  layout(cv: CVDocument): CvLayout;
  /** Unmount and remove the off-screen container. Idempotent. */
  dispose(): void;
};

/** What the page breaks of a printed CV add to the height of the rendered document: the blocks the print stylesheet keeps whole, walked as a printer would. */
function pageBreakWaste(doc: HTMLElement): number {
  const origin = doc.getBoundingClientRect().top;
  const blocks = [...doc.querySelectorAll<HTMLElement>(".cv-section-heading, .cv-entry, .cv-project")].map((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top - origin, height: rect.height, heading: element.classList.contains("cv-section-heading") };
  });
  // One line of text, for a heading whose next thing is a list and not a block of its own.
  return breakWaste(withHeadingsGlued(blocks, (11 * 96) / 72 * 1.4), SHEET_TOP_PX, PAGE_HEIGHT_PX - SHEET_PADS_PX);
}

/**
 * Renders the CV off-screen — same width as the sheet, out of the flow, hidden —
 * and measures the real layout the preview and the printer both use.
 *
 * One React root for the whole measuring loop (the engine calls `measure` dozens
 * of times per fit), so nothing is mounted or unmounted between candidates: only
 * the props change, flushed synchronously so the DOM is readable before this
 * returns.
 *
 * Natural height: `min-height` is overridden **inline** on the document node
 * (inline wins over the stylesheet) before reading
 * `getBoundingClientRect().height` — fractional, and unaffected by any
 * `transform` on ancestors, unlike `scrollHeight`, which the sheet's
 * `min-height` floors at one page.
 */
export function createCvMeasurer(): CvMeasurer {
  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  container.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    "visibility:hidden",
    "pointer-events:none",
    // The sheet's own width in pt: the document is 595.28pt wide and
    // `margin: 0 auto`, so at this container width it lays out exactly as in the
    // print frame — no narrower column, no different wrapping.
    "width:595.28pt",
  ].join(";");
  document.body.appendChild(container);

  const root: Root = createRoot(container);

  const render = (cv: CVDocument): HTMLElement | null => {
    // `createElement` rather than JSX: this module is a `.ts` file.
    flushSync(() => root.render(createElement(CVDocumentView, { data: cv })));
    const doc = container.querySelector<HTMLElement>(".cv-document");
    if (doc) doc.style.minHeight = "0px";
    return doc;
  };

  let disposed = false;

  return {
    measure(cv: CVDocument, sheets: Sheets = 1): number {
      const doc = render(cv);
      if (!doc) return 0;
      const natural = doc.getBoundingClientRect().height;
      return sheets === 1 ? natural : natural + pageBreakWaste(doc);
    },

    layout(cv: CVDocument): CvLayout {
      const doc = render(cv);
      if (!doc) return { bullets: [] };

      const bullets: BulletLayout[] = [];
      for (const li of doc.querySelectorAll<HTMLLIElement>("li")) {
        const range = document.createRange();
        range.selectNodeContents(li);
        const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);

        // Group rects into lines by their vertical position: one text run can
        // produce several rects on the same line.
        const lines = new Map<number, number>();
        for (const rect of rects) {
          const top = Math.round(rect.top);
          lines.set(top, Math.max(lines.get(top) ?? 0, rect.width));
        }
        const widths = [...lines.values()];
        const widest = widths.length > 0 ? Math.max(...widths) : 0;
        const lastTop = rects.length > 0 ? Math.max(...rects.map((rect) => Math.round(rect.top))) : null;
        const lastWidth = lastTop !== null ? (lines.get(lastTop) ?? 0) : 0;

        bullets.push({
          lines: widths.length,
          tailRatio: widths.length === 0 ? 1 : widest > 0 ? lastWidth / widest : 1,
        });
      }

      return { bullets };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      root.unmount();
      container.remove();
    },
  };
}

/**
 * One shot: wait for the faces, measure, tear down.
 *
 * The return says both things the caller may need to distinguish: the height,
 * and whether the fonts were actually ready when it was taken — a height
 * measured against the fallback font is a diagnosis, not a verdict.
 */
export async function measureCvHeight(
  cv: CVDocument,
): Promise<{ height: number; fontsReady: boolean }> {
  const fontsReady = await cvFontsReady(cv);
  const measurer = createCvMeasurer();
  try {
    return { height: measurer.measure(cv), fontsReady };
  } finally {
    measurer.dispose();
  }
}
