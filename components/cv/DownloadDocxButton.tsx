"use client";

import { useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { cvFilename } from "@/lib/export/filename";
import { recordMetric } from "@/lib/metrics/store";
import { offerInstallOnce } from "@/lib/pwa/install";
import type { CVDocument } from "@/lib/schemas/cv";

/**
 * Downloads the CV as a .docx, for the portals and ATS that reject a PDF.
 *
 * The builder pulls in the whole `docx` package (~1.1 MB), so it is imported
 * on click rather than at module scope: nobody pays for it until they ask for
 * a Word file. Everything runs in the browser, which is where the CV already
 * lives — see lib/storage/local.ts.
 */

export function DownloadDocxButton({
  data,
  label,
  variant = "secondary",
  compact,
  children = "Descargar Word",
  confirm,
}: {
  data: CVDocument;
  label?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  compact?: boolean;
  children?: React.ReactNode;
  /**
   * Presente cuando esta versión del CV todavía no fue confirmada
   * (`components/cv/ReviewGate.tsx`): el primer click hace de una vez lo que
   * antes eran dos pasos (tildar ReviewGate y después descargar). `onConfirm`
   * corre antes de armar el Word, y el botón muestra `confirm.label` en lugar
   * de `children` mientras tanto, para que el click sea inequívocamente el
   * acto de confirmación y no una descarga cualquiera. `undefined` una vez
   * confirmada la versión: vuelve a ser un botón de descarga común. Opcional,
   * así que los seis lugares que exportan otra cosa —la hoja de entrevista, el
   * guion de video, la plantilla— siguen sin gate, que es lo que corresponde.
   */
  confirm?: { label: React.ReactNode; onConfirm: () => void };
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const download = async () => {
    confirm?.onConfirm();
    // The tap is the one the browser's install dialog needs, so before any `await`.
    offerInstallOnce();
    setBusy(true);
    try {
      const { cvToBlob } = await import("@/lib/docx/cv-docx");
      const blob = await cvToBlob(data);
      // Same pattern as the profile backup in components/profile/BackupControls.tsx.
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = cvFilename(data.header.fullName, label ?? "", "docx");
      anchor.click();
      URL.revokeObjectURL(url);
      recordMetric("cv_downloaded");
    } catch {
      toast({ tone: "bad", message: "No pudimos generar el Word. Probá de nuevo." });
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
