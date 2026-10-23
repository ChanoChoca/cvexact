import { afterEach, describe, expect, it } from "vitest";
import { cvFilename, cvRole, documentFilename, sanitizeFilenamePart } from "@/lib/export/filename";
import {
  DOCUMENT_SELECTOR,
  handoffScript,
  HANDOFF_GLOBAL,
  RENDER_PATH,
} from "@/lib/export/handoff";
import { PdfUnavailableError, renderContextOptions, renderDocumentPdf } from "@/lib/export/pdf";

describe("documentFilename", () => {
  it("joins the parts that have something in them", () => {
    expect(documentFilename(["CV", "Ana Pérez", "Cajera"], "pdf")).toBe(
      "CV - Ana Pérez - Cajera.pdf",
    );
    expect(documentFilename(["CV", "Ana Pérez", ""], "docx")).toBe("CV - Ana Pérez.docx");
  });

  it("strips what a filesystem would refuse", () => {
    // A job label like "Cajero/a · Turno noche" reaches this straight from the
    // posting, and a slash in it would look like a directory.
    expect(sanitizeFilenamePart('Cajero/a: "noche" <x>')).toBe("Cajero a noche x");
    expect(documentFilename(["CV", "Ana", "Cajero/a"], "pdf")).toBe("CV - Ana - Cajero a.pdf");
  });

  it("leaves room for the extension under every filesystem's limit", () => {
    const name = documentFilename(["CV", "a".repeat(300)], "pdf");

    expect(name.length).toBeLessThanOrEqual(124);
    expect(name.endsWith(".pdf")).toBe(true);
  });
});

describe("cvFilename", () => {
  it("names a CV after the person and the role, without the employer", () => {
    expect(cvFilename("Ana Ejemplo", "Desarrollador/a Mobile React Native (Junior / Semi Senior) · Finamo", "pdf")).toBe(
      "AnaEjemplo-DesarrolladorMobileReactNative.pdf",
    );
  });

  it("drops accents, symbols and gender endings", () => {
    expect(cvFilename("Raúl Peña", "Ingeniero/a de Soporte: Nivel 2 · Ñandú SA", "docx")).toBe("RaulPena-IngenieroDeSoporteNivel2.docx");
    expect(cvFilename("Ana Pérez", "Cajero(a)", "pdf")).toBe("AnaPerez-Cajero.pdf");
  });

  it("falls back to the person, or to «CV», and stays under 60 characters", () => {
    expect(cvFilename("Ana Pérez", "", "pdf")).toBe("AnaPerez.pdf");
    expect(cvFilename("", "", "pdf")).toBe("CV.pdf");
    expect(cvFilename("Ana Pérez", "a".repeat(200), "pdf").length).toBeLessThanOrEqual(64);
  });

  it("reads the role from a label that is «título · empresa»", () => {
    expect(cvRole("Cajero · Coto")).toBe("Cajero");
    expect(cvRole("Cajero")).toBe("Cajero");
  });
});

describe("handoffScript", () => {
  // Built rather than typed. Both characters are invisible in an editor, and a
  // source line that looks like it holds a plain space is the last place
  // anyone should have to debug this.
  const LINE_SEPARATOR = String.fromCharCode(0x2028);
  const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

  it("assigns the payload to the global the render routes read", () => {
    expect(handoffScript({ ok: true })).toBe(`window.${HANDOFF_GLOBAL} = {"ok":true};`);
  });

  it("escapes the separators JSON allows raw and JavaScript does not", () => {
    // Both are legal inside a JSON string and both terminate a line to a
    // JavaScript parser — and this script is evaluated as JavaScript.
    const script = handoffScript({
      summary: `uno${LINE_SEPARATOR}dos${PARAGRAPH_SEPARATOR}tres`,
    });

    // Not raw in the output...
    expect(script).not.toContain(LINE_SEPARATOR);
    expect(script).not.toContain(PARAGRAPH_SEPARATOR);
    // ...but present as the six characters that spell them.
    expect(script).toContain("\\u2028");
    expect(script).toContain("\\u2029");
  });

  it("round-trips through a JavaScript evaluation", () => {
    const data = {
      summary: `línea${LINE_SEPARATOR}cortada`,
      n: 3,
      list: ["a", "b"],
    };
    const script = handoffScript(data);

    const globals: Record<string, unknown> = {};
    new Function("window", script)(globals);

    expect(globals[HANDOFF_GLOBAL]).toEqual(data);
  });

  it("knows where each kind of document is rendered", () => {
    expect(RENDER_PATH.cv).toBe("/cv/render");
    expect(RENDER_PATH.prep).toBe("/prep/render");
    expect(RENDER_PATH.video).toBe("/video/render");
  });

  // The printer waits on these before asking for the PDF, so a selector that
  // does not match anything on its page is a render that times out rather than
  // one that comes back wrong — and every kind needs one.
  it("knows what to wait for on each of those pages", () => {
    expect(Object.keys(DOCUMENT_SELECTOR).sort()).toEqual(Object.keys(RENDER_PATH).sort());
    expect(DOCUMENT_SELECTOR.video).toBe(".video-document");
  });
});

describe("renderDocumentPdf without a browser", () => {
  const saved = { ws: process.env.BROWSER_WS_URL, chrome: process.env.CHROME_PATH };

  afterEach(() => {
    process.env.BROWSER_WS_URL = saved.ws;
    process.env.CHROME_PATH = saved.chrome;
  });

  // The route turns this error into a 503, and only a 503 makes the button
  // offer the print view. Any other failure would look like "no PDF for you".
  it("says so instead of failing some other way", async () => {
    delete process.env.BROWSER_WS_URL;
    // Set rather than unset: the machine running the tests may well have a real
    // Chrome in one of the default locations, and this must not launch it.
    process.env.CHROME_PATH = "/nowhere/chrome";

    await expect(renderDocumentPdf("cv", {})).rejects.toBeInstanceOf(PdfUnavailableError);
  });
});

describe("renderContextOptions", () => {
  const saved = process.env.ORIGIN_AUTH_SECRET;

  afterEach(() => {
    process.env.ORIGIN_AUTH_SECRET = saved;
  });

  // Dev, tests and compose run with the secret unset, and there the context is
  // created bare — exactly as before this existed.
  it("adds nothing when no origin secret is configured", () => {
    delete process.env.ORIGIN_AUTH_SECRET;
    expect(renderContextOptions()).toBeUndefined();

    process.env.ORIGIN_AUTH_SECRET = "   ";
    expect(renderContextOptions()).toBeUndefined();
  });

  // Without this header the render navigation to INTERNAL_APP_URL hits the 403
  // of proxy.ts — that traffic never passes through Cloudflare, which is the
  // only thing that adds the header on the way in.
  it("sends the secret as x-origin-auth when one is configured", () => {
    process.env.ORIGIN_AUTH_SECRET = "secreto-compartido";

    const options = renderContextOptions();
    expect(options).toEqual({
      extraHTTPHeaders: { "x-origin-auth": "secreto-compartido" },
    });
  });
});
