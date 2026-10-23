"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Checkbox, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

type InboxState = { configured: boolean; active: boolean; alias: string | null; verified: boolean };

async function fetchInbox(): Promise<InboxState | null> {
  const response = await fetch("/api/tracker/email-inbox");
  return response.ok ? ((await response.json()) as InboxState) : null;
}

/**
 * El primer correo real es quien marca `verified_at`, del lado del servidor
 * (`lib/tracker/email-ingest.ts`) — nada empuja ese cambio hasta esta
 * pestaña. Mientras la casilla esté activa y sin verificar, la card consulta
 * cada tanto para que el «Verificada» aparezca solo, sin refrescar. Con
 * tope: quien todavía no armó el filtro de reenvío no debería dejar la
 * pestaña pidiendo por tiempo indefinido — la ventana se reabre al recargar.
 */
const POLL_INTERVAL_MS = 10_000;
const POLL_MAX_TICKS = 60;

/**
 * Activar/apagar la detección de estados por email (Fase 3) — mismo patrón
 * que `JobAlertCard.tsx`: opcional, apagada por defecto, el consentimiento
 * empieza destildado y el botón queda inhabilitado hasta que se tilda a
 * mano. `configured: false` (sin `TRACKER_EMAIL_DOMAIN`) esconde el botón
 * de activar en vez de mostrar un error — esta instalación en particular
 * todavía no tiene esto disponible, no es que algo haya fallado.
 */
export function EmailInboxCard({ userId }: { userId: string | undefined }) {
  const [state, setState] = useState<InboxState | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void fetchInbox().then((next) => {
      if (!cancelled && next) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!state?.active || state.verified) return;
    let cancelled = false;
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      if (ticks > POLL_MAX_TICKS) {
        clearInterval(timer);
        return;
      }
      void fetchInbox().then((next) => {
        if (!cancelled && next) setState(next);
      });
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state?.active, state?.verified]);

  if (!userId || !state || !state.configured) return null;

  const activate = async () => {
    if (!consentChecked) return;
    setBusy(true);
    try {
      const response = await fetch("/api/tracker/email-inbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        toast({ tone: "bad", message: body.error ?? "No se pudo activar." });
        return;
      }
      const next = (await response.json()) as { active: boolean; alias: string; verified: boolean };
      setState({ ...state, active: next.active, alias: next.alias, verified: next.verified });
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/tracker/email-inbox", { method: "DELETE" });
      if (!response.ok) {
        toast({ tone: "bad", message: "No se pudo desactivar." });
        return;
      }
      setState({ ...state, active: false, alias: null, verified: false });
      setConsentChecked(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionTitle>Detección de estados por email</SectionTitle>
      <p className="max-w-prose text-[13.5px] leading-relaxed text-ink-2">
        Reenviá los correos de las plataformas de postulación a una dirección propia y
        actualizamos el estado solos cuando podamos — nunca leemos tu casilla. Opcional, y
        apagado por defecto — el detalle está en la{" "}
        <Link href="/legales/privacidad#c17" className="underline underline-offset-4 hover:text-ink">
          cláusula 17
        </Link>{" "}
        de privacidad.
      </p>

      {!state.active ? (
        <div className="mt-4 border-t border-rule pt-4">
          <Checkbox
            checked={consentChecked}
            onChange={(e) => setConsentChecked(e.target.checked)}
            label="Entiendo que voy a reenviar correos de terceros a una dirección de cvexact, y que el resultado de leerlos queda en mi seguimiento."
          />
          <Button className="mt-3" disabled={!consentChecked || busy} onClick={() => void activate()}>
            Activar
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3 border-t border-rule pt-4">
          <div>
            <p className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">Tu dirección</p>
            <p className="mt-1 font-mono text-sm text-ink">{state.alias}</p>
          </div>

          {!state.verified ? (
            <Alert tone="info">
              Todavía no nos llegó ningún correo reenviado. Configurá el filtro en tu proveedor
              (Gmail: Configuración → Filtros y direcciones bloqueadas → Crear filtro, con el
              remitente del ATS que uses, y reenviar a la dirección de arriba; Outlook:
              Configuración → Correo → Reglas). En cuanto llegue el primero, esta dirección
              queda marcada como verificada — esta tarjeta se actualiza sola, sin refrescar
              la página.
            </Alert>
          ) : (
            <Alert tone="good">Verificada — ya nos llegó al menos un correo reenviado.</Alert>
          )}

          <Button variant="danger" disabled={busy} onClick={() => void deactivate()}>
            Desactivar y borrar lo detectado por email
          </Button>
        </div>
      )}
    </Card>
  );
}
