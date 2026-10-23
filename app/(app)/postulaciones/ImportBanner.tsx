"use client";

import { useEffect, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { useApplications, useHydrated } from "@/lib/storage/hooks";
import { cvVersionFingerprint, suggestCvVersionLabel } from "@/lib/tracker/cv-version";
import type { TrackerApplication } from "@/lib/tracker/client-types";
import { pendingLocalApplications } from "./pending-local";

/** El descarte vive en sessionStorage: vale hasta que se cierra la pestaña,
 * no "para siempre" como el localStorage que usaba la v1 de esta clave. */
const DISMISS_KEY = "cvexact.tracker.importBannerDismissed.v1";

/**
 * "Ahora no" descarta el banner por sesión, no para siempre: `sessionStorage`
 * se vacía al cerrar la pestaña, así que en la próxima sesión el banner vuelve
 * a ofrecerse mientras queden postulaciones sin importar. La regla de fondo no
 * cambia — un click, nunca automático (misma regla que `app/api/sync`: el
 * usuario decide cuándo una copia local pasa al servidor). Vincula el CV
 * cuando lo tiene, vía el fingerprint de `lib/tracker/cv-version.ts` — nunca
 * sube el documento en sí.
 */
export function ImportBanner({
  tracked,
  onImported,
  forceOpen = false,
  onDismiss,
  onVisibleChange,
}: {
  tracked: TrackerApplication[];
  onImported: () => void;
  /** El estado vacío y el chip de `/postulaciones` pueden pedir ver el banner
   * aunque "Ahora no" lo haya descartado en esta sesión: reabrirlo es ofrecer,
   * no ejecutar — importar sigue necesitando su click propio. */
  forceOpen?: boolean;
  /** El usuario volvió a descartar dentro de una apertura forzada: el padre
   * limpia su `forceOpen` o el banner quedaría pegado. */
  onDismiss?: () => void;
  /** Reporta si el banner está realmente a la vista, para que el estado
   * vacío no repita el conteo de locales que el banner ya está mostrando. */
  onVisibleChange?: (visible: boolean) => void;
}) {
  const hydrated = useHydrated();
  const local = useApplications();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(DISMISS_KEY) === "true";
  });
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const pending = pendingLocalApplications(local, tracked);
  const visible = (forceOpen || !dismissed) && pending.length > 0;

  useEffect(() => {
    onVisibleChange?.(hydrated && visible);
  }, [hydrated, visible, onVisibleChange]);

  if (!hydrated || !visible) return null;

  const dismiss = () => {
    window.sessionStorage.setItem(DISMISS_KEY, "true");
    // Las versiones viejas descartaban en localStorage, para siempre: si
    // quedó esa clave de un descarte anterior, se limpia — el banner vuelve
    // a ofrecerse en la próxima sesión.
    window.localStorage.removeItem(DISMISS_KEY);
    onDismiss?.();
    setDismissed(true);
  };

  const importAll = async () => {
    setImporting(true);
    let imported = 0;
    try {
      for (const app of pending) {
        let cvVersionId: string | null = null;
        if (app.cv) {
          const fingerprint = cvVersionFingerprint(app.cv);
          const versionResponse = await fetch("/api/tracker/cv-versions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ fingerprint, label: suggestCvVersionLabel(app.cv) }),
          });
          if (versionResponse.ok) {
            const body = (await versionResponse.json()) as { version: { id: string } };
            cvVersionId = body.version.id;
          }
        }

        const created = await fetch("/api/tracker/applications", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: app.id,
            jobTitle: app.analysis?.title || app.label,
            company: app.analysis?.company || "",
            status: app.status ?? "guardado",
            source: "manual",
          }),
        });
        if (!created.ok) continue;
        imported += 1;

        if (cvVersionId) {
          await fetch(`/api/tracker/applications/${app.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cvVersionId }),
          });
        }
      }
      setResult(`Se importaron ${imported} de ${pending.length}.`);
      onImported();
    } finally {
      setImporting(false);
    }
  };

  return (
    <Alert tone="info" title="Postulaciones sin seguimiento">
      <p>
        Tenés {pending.length} postulación{pending.length === 1 ? "" : "es"} generada
        {pending.length === 1 ? "" : "s"} en este navegador que todavía no están en tu seguimiento.
        {result ? ` ${result}` : ""}
      </p>
      <div className="mt-3 flex gap-3">
        <Button variant="secondary" disabled={importing} onClick={() => void importAll()}>
          {importing ? "Importando…" : "Importar ahora"}
        </Button>
        <Button variant="ghost" onClick={dismiss}>
          Ahora no
        </Button>
      </div>
    </Alert>
  );
}
