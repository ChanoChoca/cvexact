/**
 * How a document reaches the headless browser that prints it.
 *
 * The obvious route — point Chromium at `/cv/[id]/print` — cannot work: an
 * application lives in the user's browser (see lib/storage/local.ts), so that
 * page reads localStorage and a headless visitor would render "no encontramos
 * este CV". The document has to travel *with* the request.
 *
 * So the browser is given the JSON as a global before the page's own scripts
 * run (Playwright's `addInitScript`), and the render routes below read it. No
 * server-side store, no token to expire, nothing to clean up when a render
 * fails — and, because it is a real route served by the app, the PDF goes
 * through the same CSS bundle and the same self-hosted fonts as the preview.
 * Fidelity to public/plantilla-cv.html is not re-verified; it is the same page.
 */

export const HANDOFF_GLOBAL = "__CVP_RENDER__";

export const RENDER_PATH = {
  cv: "/cv/render",
  prep: "/prep/render",
  video: "/video/render",
} as const;

export type RenderKind = keyof typeof RENDER_PATH;

/**
 * What the printer waits for on each of those pages. The documents mount on
 * hydration — the server pass renders nothing — so there is no useful load
 * event to wait on; the root element appearing is the signal.
 *
 * Keyed by kind rather than branched at the call site so adding a document
 * cannot compile while forgetting to say what to wait for.
 */
export const DOCUMENT_SELECTOR: Record<RenderKind, string> = {
  cv: ".cv-document",
  prep: ".prep-document",
  video: ".video-document",
};

/**
 * The script that plants the payload. Evaluated as JavaScript, not injected
 * into HTML, so `</script>` in the data is harmless — but U+2028 and U+2029 are
 * still worth escaping: JSON allows them raw inside a string and a JavaScript
 * parser reads them as line terminators.
 */
export function handoffScript(data: unknown): string {
  const json = JSON.stringify(data).replace(
    /[\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16)}`,
  );

  return `window.${HANDOFF_GLOBAL} = ${json};`;
}
