import { NextResponse } from "next/server";
import { z } from "zod";

import { enforceRateLimit } from "@/lib/api/guards";
import { cvFilename, cvRole, documentFilename } from "@/lib/export/filename";
import { PdfUnavailableError, renderDocumentPdf } from "@/lib/export/pdf";
import { cvDocumentSchema } from "@/lib/schemas/cv";
import { interviewPrepSchema, videoScriptSchema } from "@/lib/schemas/outputs";

export const runtime = "nodejs";

/**
 * Prints an already-generated document. Deliberately *not* wrapped in
 * `openRequest()`: this calls no model, so it must not spend the day's
 * generation quota — a user who cannot download the CV they already paid a
 * generation for would be the worst possible reading of the meter.
 *
 * It is still expensive (a browser tab per call), so it is capped by
 * concurrency instead.
 */

const bodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cv"), data: cvDocumentSchema, label: z.string().max(200).default("") }),
  z.object({
    kind: z.literal("prep"),
    data: interviewPrepSchema,
    label: z.string().max(200).default(""),
  }),
  z.object({
    kind: z.literal("video"),
    data: videoScriptSchema,
    label: z.string().max(200).default(""),
  }),
]);

/** The parts each kind of document is named after. */
function filenameFor(parsed: z.infer<typeof bodySchema>): string {
  switch (parsed.kind) {
    case "cv":
      return cvFilename(parsed.data.header.fullName, parsed.label, "pdf");
    case "prep":
      return documentFilename(["Entrevista", parsed.data.jobTitle, parsed.data.company], "pdf");
    case "video":
      return documentFilename(["Guion video", parsed.data.jobTitle, parsed.data.company], "pdf");
  }
}

/**
 * How many renders may be in flight in this process. Two is enough to keep one
 * slow render from blocking a second user, and low enough that a burst queues
 * rather than exhausting the sidecar's memory. Anything past it is turned away
 * with a retry hint rather than left to time out.
 */
const MAX_CONCURRENT_RENDERS = 2;
let inFlight = 0;

export async function POST(request: Request) {
  /**
   * A volume ceiling, which is a different question from the concurrency cap
   * below: that one keeps two slow renders from becoming twelve, this one keeps
   * one caller from holding both slots all day. Unauthenticated and free, so
   * without it a trivial script pins `inFlight` at 2 and every real user gets a
   * 429 that has nothing to do with their own usage.
   */
  const limited = await enforceRateLimit("export-pdf", request.headers, {
    window: 600,
    max: 20,
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "El documento que mandaste no tiene un formato válido." },
      { status: 400 },
    );
  }

  // 429, not 503: "estoy ocupado" and "no tengo navegador" are different
  // answers, and the client turns only the second one into a link to the print
  // view. Sharing a status made a busy server look like a broken one.
  if (inFlight >= MAX_CONCURRENT_RENDERS) {
    return NextResponse.json(
      { error: "Hay demasiados PDFs generándose ahora mismo. Probá de nuevo en unos segundos." },
      { status: 429, headers: { "retry-after": "5" } },
    );
  }

  inFlight += 1;
  try {
    const { kind, data } = parsed.data;
    // The origin this request arrived on: when the renderer is a browser we
    // launched on this same machine, that is the address that reaches us.
    // The title the PDF carries in its properties, which a recruiter sees in the tab and a reader reads out: «Ana Ejemplo — Rol», not «cvexact».
    const title = kind === "cv" ? [data.header.fullName, cvRole(parsed.data.label)].filter(Boolean).join(" — ") : undefined;
    const { pdf, checks } = await renderDocumentPdf(kind, data, new URL(request.url).origin, title);
    const name = filenameFor(parsed.data);

    if (checks && checks.pdfFonts === "unverifiable") {
      // Accepted, and said out loud: this PDF was not written the way Chromium
      // writes one, so the fonts could not be read back. The guarantee then
      // rests on the page's own check and on the staging verification (§6.7).
      console.warn("[export/pdf] font descriptors could not be read; accepting the file", {
        pages: checks.pages,
      });
    }

    if (checks && (!checks.fontsLoaded || checks.pdfFonts === "substituted")) {
      // The client turns this into «no pudimos verificar la tipografía»; which of
      // the two it was is the first thing anyone asks.
      console.warn("[export/pdf] typography not verified", checks);
    }

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        // `encodeURIComponent` because the name carries accents, and a raw
        // header must be latin-1.
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "cache-control": "no-store",
        // What was verified about the document, for the client to accept or
        // refuse the download. Only a CV carries one: the interview sheet and
        // the video script are not subject to the one-page promise.
        // Escaped to ASCII: `missing` can carry any character, and a header value
        // must be latin-1 (`JSON.parse` reads the escapes back).
        ...(checks
          ? {
              "x-cv-check": JSON.stringify(checks).replace(
                /[\u0080-\uffff]/g,
                (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
              ),
            }
          : {}),
      },
    });
  } catch (error) {
    // No sidecar and no browser on the machine either. The client turns this
    // status into an offer to open the print view, rather than acting on it.
    if (error instanceof PdfUnavailableError) {
      console.error("[export/pdf] unavailable:", error.cause ?? error);
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    console.error("[export/pdf] render failed:", error);
    return NextResponse.json(
      { error: "No pudimos generar el PDF. Probá de nuevo." },
      { status: 500 },
    );
  } finally {
    inFlight -= 1;
  }
}
