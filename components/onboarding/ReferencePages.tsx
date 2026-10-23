"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A document that could not be read, shown as it is: each page drawn on a canvas.
 *
 * Not a frame. The page's Content-Security-Policy allows no frame but the app's
 * own and the captcha's, and it is not going to be loosened for a preview — a
 * canvas needs nothing from it, and `pdf.js` is already here to read the file.
 */
export function ReferencePages({ file }: { file: File }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const container = host.current;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
        try {
          const doc = await task.promise;
          for (let number = 1; number <= doc.numPages && !cancelled; number += 1) {
            const page = await doc.getPage(number);
            const viewport = page.getViewport({ scale: 1.4 });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.className = "mb-2 h-auto w-full border border-rule bg-white";
            canvas.setAttribute("role", "img");
            canvas.setAttribute("aria-label", `Página ${number} de tu documento`);
            await page.render({ canvas, viewport }).promise;
            if (!cancelled) container?.appendChild(canvas);
          }
        } finally {
          await task.destroy();
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      container?.replaceChildren();
    };
  }, [file]);

  return (
    <div>
      <div ref={host} className="max-h-[60vh] overflow-auto" />
      {failed ? <p className="text-sm text-ink-3">No pudimos mostrar el documento. Tenelo abierto en otra pestaña para copiar de ahí.</p> : null}
    </div>
  );
}

export const isPdf = (file: File | undefined): file is File =>
  Boolean(file) && (file!.type === "application/pdf" || file!.name.toLowerCase().endsWith(".pdf"));
