import "server-only";

import { existsSync } from "node:fs";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { CV_FONT_FACES } from "@/lib/cv/fonts";
import {
  DOCUMENT_SELECTOR,
  handoffScript,
  RENDER_PATH,
  type RenderKind,
} from "./handoff";

/**
 * Server-side PDF, so the deliverable does not depend on the user finding the
 * right checkboxes in their browser's print dialog.
 *
 * In production Chromium is not in this image: it runs as its own container
 * (see the `chromium` service in docker-compose.yml) and we drive it over CDP.
 * That is what keeps the app image a minimal node:24-alpine — a browser inside
 * it costs ~400 MB and turns a fast build into a slow one — and it means
 * `playwright-core` is the only dependency here, without the browser download
 * `playwright` runs on install.
 *
 * Without `BROWSER_WS_URL` — the `pnpm dev` case — we launch whatever Chrome or
 * Chromium the machine already has instead of refusing. Downloading the CV must
 * be one click in development too, and the image has no browser to find, so
 * this path simply never applies there.
 */

export class PdfUnavailableError extends Error {}

/* --- What came out (§6.7) --------------------------------------------------- */

// The verdicts and the two readers live in `./pdf-check`, which is pure: the
// client judges the file it is holding with the same `acceptedCvPdf` the server
// checked it with, and `server-only` has no business in that bundle.

export {
  acceptedCvPdf,
  countPdfPages,
  inspectPdfFonts,
  substitutedFontNames,
  type CvPdfCheck,
  type PdfFontInspection,
} from "./pdf-check";
import { countPdfPages, inspectPdfFonts, substitutedFontNames, type CvPdfCheck } from "./pdf-check";



/** Milliseconds. A render that has not finished by now is not going to. */
const RENDER_TIMEOUT = 20_000;

/**
 * Where a system Chrome usually lives. `CHROME_PATH` wins over all of them, for
 * the machine that keeps its browser somewhere else.
 */
const CHROME_CANDIDATES = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/google/chrome/chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

function localChromePath(): string | null {
  const configured = process.env.CHROME_PATH?.trim();
  if (configured) return existsSync(configured) ? configured : null;
  return CHROME_CANDIDATES.find((path) => existsSync(path)) ?? null;
}

/**
 * The browser we launched ourselves, kept across requests: starting Chromium
 * costs about a second, and a download should not pay it twice. The sidecar
 * needs no equivalent — it is already long-lived.
 */
let localBrowser: Promise<Browser> | null = null;

async function launchLocalBrowser(executablePath: string): Promise<Browser> {
  const existing = localBrowser;
  if (existing) {
    const browser = await existing.catch(() => null);
    if (browser?.isConnected()) return browser;
    // It died — a crash, or the dev server outlived it. Start over.
    localBrowser = null;
  }

  const started = chromium.launch({
    executablePath,
    // Same reasoning as the sidecar's flags in docker-compose.yml: this browser
    // only ever loads pages this app serves it, so the sandbox buys nothing and
    // costs us the machines whose kernel restricts user namespaces.
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  localBrowser = started;

  try {
    return await started;
  } catch (cause) {
    localBrowser = null;
    throw new PdfUnavailableError("No pudimos abrir el navegador que genera el PDF.", { cause });
  }
}

type Renderer = {
  browser: Browser;
  /** True when the browser is ours, and therefore on this same machine. */
  local: boolean;
};

async function acquireBrowser(): Promise<Renderer> {
  const endpoint = process.env.BROWSER_WS_URL?.trim();
  if (endpoint) {
    try {
      return {
        browser: await chromium.connectOverCDP(endpoint, { timeout: RENDER_TIMEOUT }),
        local: false,
      };
    } catch (cause) {
      throw new PdfUnavailableError("No pudimos conectarnos al navegador que genera el PDF.", {
        cause,
      });
    }
  }

  const executablePath = localChromePath();
  if (!executablePath) {
    throw new PdfUnavailableError(
      "No hay un navegador para generar el PDF: configurá BROWSER_WS_URL o instalá Chrome.",
    );
  }

  return { browser: await launchLocalBrowser(executablePath), local: true };
}

/**
 * Where the browser reaches this app. Inside compose that is the service name,
 * not the public domain: the sidecar is on the internal network and the public
 * name may not even resolve from there. A browser we launched ourselves is on
 * this machine, so the address the request came in on is the one that works —
 * including when the dev server is not on port 3000.
 */
function appOrigin(renderer: Renderer, requestOrigin?: string): string {
  const configured = process.env.INTERNAL_APP_URL?.trim();
  if (configured) return configured;
  if (renderer.local && requestOrigin) return requestOrigin;
  return "http://127.0.0.1:3000";
}

/**
 * The perimeter check of `proxy.ts` rejects with 403 every request lacking
 * `X-Origin-Auth`, trusting only Cloudflare to add it — and a render navigates
 * `localhost:3000` *inside* the pod, which never touches Cloudflare. Without
 * this header the sidecar gets back the Forbidden page instead of the document,
 * `waitForSelector` burns its whole timeout, and every download dies. The
 * context-level header covers those pages *and* anything they fetch while
 * hydrating. Same pod, same Secret (`envFrom: cvexact-secrets`): this is the
 * origin speaking to itself, not a hole in the perimeter.
 */
export function renderContextOptions(): { extraHTTPHeaders: Record<string, string> } | undefined {
  const secret = process.env.ORIGIN_AUTH_SECRET?.trim();
  if (!secret) return undefined;
  return { extraHTTPHeaders: { "x-origin-auth": secret } };
}

/**
 * What the printer measured and inspected about the CV it just printed.
 *
 * The measurement runs in `screen` media, the same media the client measures in,
 * so the two numbers are comparable: `heightPx` is the natural height of
 * `.cv-document` (with `min-height` anulled inline, exactly as
 * `components/cv/measure.ts` does it) and `overflowX` is the content running
 * past the sheet's own width.
 */
type PrintProbe = {
  heightPx: number | null;
  overflowX: boolean;
  fontsLoaded: boolean;
};

async function probeCv(page: Page): Promise<PrintProbe> {
  return await page.evaluate(async (faces: string[]) => {
    const element = document.querySelector<HTMLElement>(".cv-document");
    if (!element) return { heightPx: null, overflowX: false, fontsLoaded: false };

    // Loaded first, as `cvFontsReady` does in the browser: `check` alone says
    // false for a face the page never drew with (a CV with no italic text) and
    // for one still in flight when the layout below kicks it off, and the height
    // would be read against the fallback face.
    const text = element.textContent ?? "";
    let loaded = true;
    try {
      await Promise.all(faces.map((face) => document.fonts.load(face, text)));
    } catch {
      loaded = false;
    }

    const previous = element.style.minHeight;
    element.style.minHeight = "0px";
    const height = element.getBoundingClientRect().height;
    element.style.minHeight = previous;

    return {
      heightPx: height,
      overflowX: element.scrollWidth > element.clientWidth,
      // `check`, not `ready`: ready resolves for a face that failed. What this
      // answers is «the expected faces were in use for this text», which is the
      // question `fontsLoaded` is named after.
      fontsLoaded: loaded && faces.every((face) => document.fonts.check(face, text)),
    };
  }, CV_FONT_FACES as unknown as string[]);
}

/**
 * Which characters of the CV the typography does not carry, asked of the printer
 * itself: one probe span per distinct non-ASCII character, and Chromium says
 * which font drew it. Only worth the round trips once the file came back
 * `substituted`, and only to name the culprit — a failure here is an empty list.
 */
async function uncoveredGlyphs(context: BrowserContext, page: Page): Promise<string[]> {
  try {
    const chars = await page.evaluate(() => {
      const document_ = document.querySelector<HTMLElement>(".cv-document");
      if (!document_) return [];
      const distinct = [...new Set(document_.textContent ?? "")].filter((char) => char.codePointAt(0)! > 0x7f && /\S/.test(char));

      const probe = document.createElement("div");
      probe.id = "glyph-probe";
      probe.style.cssText = `position:absolute;left:-9999px;font-family:${getComputedStyle(document_).fontFamily}`;
      for (const char of distinct) {
        const span = document.createElement("span");
        span.textContent = char;
        probe.append(span);
      }
      document.body.append(probe);
      return distinct;
    }, undefined);

    const cdp = await context.newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: "#glyph-probe span",
    });

    const missing: string[] = [];
    for (const [index, nodeId] of nodeIds.entries()) {
      const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
      if (fonts.some((font) => !font.isCustomFont)) missing.push(chars[index]!);
    }
    return missing;
  } catch {
    return [];
  }
}

export type RenderedPdf = {
  pdf: Buffer;
  /** Present for `kind: "cv"`: what was verified about the file, to be judged by the client (§6.7). */
  checks: CvPdfCheck | null;
};

export async function renderDocumentPdf(
  kind: RenderKind,
  data: unknown,
  requestOrigin?: string,
  title?: string,
): Promise<RenderedPdf> {
  const renderer = await acquireBrowser();

  // A context, not the browser: it outlives this request either way — the
  // sidecar's belongs to the sidecar, and ours is cached for the next download.
  // Closing it would take the next request's renderer with it. The options carry
  // the origin secret when one is configured (see renderContextOptions).
  const context = await renderer.browser.newContext(renderContextOptions());
  try {
    context.setDefaultTimeout(RENDER_TIMEOUT);
    const page = await context.newPage();

    // Before navigation, so it is in place before the page's own scripts run.
    await page.addInitScript({ content: handoffScript(data) });
    await page.goto(`${appOrigin(renderer, requestOrigin)}${RENDER_PATH[kind]}`, {
      waitUntil: "networkidle",
      timeout: RENDER_TIMEOUT,
    });

    // The document mounts on hydration, after the server pass renders nothing.
    await page.waitForSelector(DOCUMENT_SELECTOR[kind]);

    // cv-document.css sets `font-display: block` on purpose — a flash of the
    // fallback face would print. Waiting here is what honours that; whether the
    // faces really answered is `fontsLoaded`, below.
    await page.evaluate(() => document.fonts.ready);
    // The PDF takes its title from the page's, which is the app's name until it is told what this document is.
    if (title) await page.evaluate((text) => { document.title = text; }, title);

    const probe = kind === "cv" ? await probeCv(page) : null;

    // `preferCSSPageSize` is the point of the whole exercise: it hands the page
    // geometry to the stylesheet's `@page { size: A4; margin: 0 }` instead of
    // Chromium's default margins — the very thing the print dialog used to ask
    // the user to turn off.
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });

    if (probe === null) return { pdf, checks: null };

    const pdfFonts = inspectPdfFonts(pdf);
    return {
      pdf,
      checks: {
        pages: countPdfPages(pdf),
        heightPx: probe.heightPx,
        overflowX: probe.overflowX,
        fontsLoaded: probe.fontsLoaded,
        pdfFonts,
        ...(pdfFonts === "substituted"
          ? { missing: await uncoveredGlyphs(context, page), substitutedBy: substitutedFontNames(pdf) }
          : {}),
      },
    };
  } finally {
    await context.close().catch(() => {});
  }
}
