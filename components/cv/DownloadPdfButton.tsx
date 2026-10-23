"use client";

import { useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { acceptedCvPdf, type CvPdfCheck, type PdfFontInspection } from "@/lib/export/pdf-check";
import { recordMetric } from "@/lib/metrics/store";
import { offerInstallOnce } from "@/lib/pwa/install";
import type { Sheets } from "@/lib/cv/sheets";
import type { CVDocument } from "@/lib/schemas/cv";
import type { InterviewPrep, VideoScript } from "@/lib/schemas/outputs";

/**
 * Downloads the document as a PDF built on the server, so the file does not
 * depend on the user unticking margins and headers in their own print dialog.
 *
 * The sibling of DownloadDocxButton, and it works the same way: post the
 * document, get bytes back, hand them to an anchor.
 *
 * The route answers 503 only when the machine has no browser at all to print
 * with. That is rare now that lib/export/pdf.ts launches a local Chrome when no
 * sidecar is configured, and when it happens this offers a link to the print
 * route instead of opening a tab on its own: a click on «Descargar PDF» should
 * either produce the file or say why, never hand the user a second page to
 * click through.
 */

type Payload =
  | { kind: "cv"; data: CVDocument; label?: string; sheets?: Sheets }
  | { kind: "prep"; data: InterviewPrep }
  | { kind: "video"; data: VideoScript };

export function DownloadPdfButton({
  payload,
  fallbackHref,
  unavailableHint,
  variant = "primary",
  compact,
  children = "Descargar PDF",
  confirm,
  onUnverified,
}: {
  payload: Payload;
  /**
   * The print route we offer when the server has no way to produce the PDF. Missing for a CV that is not saved
   * anywhere — the base CV the profile makes — which has no page of its own to print.
   */
  fallbackHref?: string;
  /** What to say after the server's own message when it cannot produce the PDF and there is no print route to offer. */
  unavailableHint?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  compact?: boolean;
  children?: React.ReactNode;
  /**
   * Presente cuando esta versión del CV todavía no fue confirmada
   * (`components/cv/ReviewGate.tsx`): el primer click hace de una vez lo que
   * antes eran dos pasos (tildar ReviewGate y después descargar). `onConfirm`
   * corre antes de pedir el PDF, y el botón muestra `confirm.label` en lugar
   * de `children` mientras tanto, para que el click sea inequívocamente el
   * acto de confirmación y no una descarga cualquiera. `undefined` una vez
   * confirmada la versión: vuelve a ser un botón de descarga común. Opcional,
   * así que los seis lugares que exportan otra cosa —la hoja de entrevista, el
   * guion de video, la plantilla— siguen sin gate, que es lo que corresponde.
   */
  confirm?: { label: React.ReactNode; onConfirm: () => void };
  /**
   * What to do when the server hands back a CV that is not the file the product
   * promises: more than one sheet, content clipped at the page edge, or a
   * substituted typography.
   *
   * Called **before** anything is saved, and only for `kind: "cv"`; the bytes
   * stay where they are until it answers. `"download-anyway"` saves them,
   * `"stop"` ends the click with nothing downloaded. The Wizard uses it to fit
   * the CV again and ask the person to download the new version — never to hand
   * over a file nobody confirmed. Without it — the print route, the base CV —
   * the file is saved and the person is warned with a toast instead.
   */
  onUnverified?: (info: CvPdfCheck) => Promise<"download-anyway" | "stop">;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const download = async () => {
    confirm?.onConfirm();
    // A CV, not the interview sheet or the script: the tap is the one the browser's install dialog needs, so before any `await`.
    if (payload.kind === "cv") offerInstallOnce();
    setBusy(true);
    try {
      const response = await fetch("/api/export/pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          payload.kind === "cv"
            ? { kind: "cv", data: payload.data, label: payload.label ?? "" }
            : { kind: payload.kind, data: payload.data },
        ),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        // Set when the failure is "no browser here", the one a print tab
        // can solve — offered as the toast's action instead of a second
        // link, so there is exactly one way out of this error.
        const offerPrint = response.status === 503 && fallbackHref !== undefined;
        const message = body.error ?? "No pudimos generar el PDF.";
        toast({
          tone: "bad",
          message: response.status === 503 && !offerPrint && unavailableHint ? `${message} ${unavailableHint}` : message,
          action: offerPrint
            ? {
                label: "Abrí la vista para imprimir",
                onClick: () => window.open(fallbackHref, "_blank", "noopener"),
              }
            : undefined,
        });
        return;
      }

      // Same pattern as DownloadDocxButton and the profile backup.
      const blob = await response.blob();

      /**
       * The server says whether the file it just printed is the one the product
       * promises. Judged here rather than there for the reason the whole feature
       * exists: only the person can accept a document that misses the promise,
       * and only with the consequences in front.
       */
      const check = payload.kind === "cv" ? readCvCheck(response) : null;
      const sheets = payload.kind === "cv" ? (payload.sheets ?? 1) : 1;
      if (check && !acceptedCvPdf(check, sheets)) {
        if (onUnverified) {
          const verdict = await onUnverified(check);
          if (verdict === "stop") return;
        } else {
          toast({ tone: "warn", message: describeCheck(check, sheets) });
        }
      }

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filenameFrom(response) || "documento.pdf";
      anchor.click();
      URL.revokeObjectURL(url);
      // A CV: the interview sheet and the video script are not what is counted.
      if (payload.kind === "cv") recordMetric("cv_downloaded");
    } catch (err) {
      toast({
        tone: "bad",
        message: err instanceof Error ? err.message : "No pudimos generar el PDF.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant={variant} compact={compact} type="button" disabled={busy} onClick={download}>
      {busy ? <Spinner /> : null}
      {busy ? "Generando…" : confirm ? confirm.label : children}
    </Button>
  );
}

/**
 * The verification header the PDF route sends with a CV, or `null` when there is
 * none — the interview sheet, the video script, or a server older than the
 * header. Nothing to judge means nothing to stop: the file is downloaded.
 *
 * Read field by field rather than trusted: a header is text, and a missing one
 * fed straight into `acceptedCvPdf` would read as a failure of everything.
 */
function readCvCheck(response: Response): CvPdfCheck | null {
  const header = response.headers.get("x-cv-check");
  if (!header) return null;
  try {
    const parsed: unknown = JSON.parse(header);
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = parsed as Partial<CvPdfCheck>;
    return {
      pages: typeof value.pages === "number" ? value.pages : null,
      heightPx: typeof value.heightPx === "number" ? value.heightPx : null,
      overflowX: value.overflowX === true,
      fontsLoaded: value.fontsLoaded === true,
      pdfFonts: isFontInspection(value.pdfFonts) ? value.pdfFonts : "unverifiable",
      missing: Array.isArray(value.missing) ? value.missing.filter((char) => typeof char === "string") : undefined,
      substitutedBy: Array.isArray(value.substitutedBy) ? value.substitutedBy.filter((name) => typeof name === "string") : undefined,
    };
  } catch {
    return null;
  }
}

function isFontInspection(value: unknown): value is PdfFontInspection {
  return value === "ok" || value === "substituted" || value === "unverifiable";
}

/** What is wrong with the file, for the screens that have no way to fix it. */
function describeCheck(check: CvPdfCheck, sheets: Sheets): string {
  if (!check.fontsLoaded || check.pdfFonts === "substituted") {
    return "El PDF salió con otra tipografía de la esperada. Probá de nuevo.";
  }
  if (check.overflowX) return "El contenido se sale de la hoja. Probá de nuevo.";
  const pages = check.pages ?? 1;
  return `El PDF salió en ${pages} ${pages === 1 ? "hoja" : "hojas"}. Todavía se puede ajustar a ${sheets === 1 ? "una" : "dos"}.`;
}

/** The server already worked the name out; reading it back beats recomputing it. */
function filenameFrom(response: Response): string {
  const header = response.headers.get("content-disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}
