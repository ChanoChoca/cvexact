"use client";

import type { ReactNode } from "react";

/**
 * Screen-only chrome for the print routes. `cv-print-hidden` keeps it off the
 * paper — see the @media print block in cv-document.css.
 *
 * These routes are the on-screen preview now that the PDF is built on the
 * server (lib/export/pdf.ts). Printing from here still works and is the
 * fallback when no headless browser is configured, but it is no longer how the
 * deliverable is normally produced — which is why the margins-and-headers
 * warning below is a caveat rather than an instruction.
 *
 * `actions` is where the other ways of taking the document away go (the .docx
 * download).
 */
export function PrintToolbar({
  title,
  backHref,
  actions,
}: {
  title: string;
  backHref?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="cv-print-hidden sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-100">
      <div className="flex items-center gap-3">
        {backHref ? (
          <a
            href={backHref}
            className="rounded px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          >
            ← Volver
          </a>
        ) : null}
        <span className="font-medium">{title}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden text-xs text-neutral-400 sm:inline">
          Si imprimís desde acá, desactivá los márgenes y los encabezados.
        </span>
        {actions}
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded bg-white px-3 py-1.5 font-medium text-neutral-900 hover:bg-neutral-200"
        >
          Imprimir
        </button>
      </div>
    </div>
  );
}
