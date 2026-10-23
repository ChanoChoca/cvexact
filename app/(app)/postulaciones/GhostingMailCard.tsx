"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, Checkbox, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { GHOSTING_DAYS } from "@/lib/tracker/constants";

type ConsentState = { active: boolean };

/**
 * Activar/apagar el aviso por correo cuando una postulación pasa a
 * `sin_respuesta` — mismo patrón que `EmailInboxCard.tsx`: opcional, apagado
 * por defecto, el consentimiento empieza destildado y el botón queda
 * inhabilitado hasta que se tilda a mano. Un checkbox que arrancara tildado
 * no sería consentimiento.
 *
 * Apagarlo NO apaga la detección de abandono en sí: `markGhostedApplications`
 * sigue corriendo todos los días y el estado se sigue viendo en el tablero y
 * en el detalle de cada postulación. Lo único que cambia es si además llega
 * un correo — por eso el copy lo aclara en vez de dejarlo implícito.
 */
export function GhostingMailCard({ userId }: { userId: string | undefined }) {
  const [state, setState] = useState<ConsentState | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void fetch("/api/tracker/mail-consent")
      .then((r) => (r.ok ? (r.json() as Promise<ConsentState>) : null))
      .then((next) => {
        if (!cancelled && next) setState(next);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!userId || !state) return null;

  const activate = async () => {
    if (!consentChecked) return;
    setBusy(true);
    try {
      const response = await fetch("/api/tracker/mail-consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        toast({ tone: "bad", message: body.error ?? "No se pudo activar." });
        return;
      }
      setState({ active: true });
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/tracker/mail-consent", { method: "DELETE" });
      if (!response.ok) {
        toast({ tone: "bad", message: "No se pudo desactivar." });
        return;
      }
      setState({ active: false });
      setConsentChecked(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionTitle>Aviso por correo de postulaciones sin respuesta</SectionTitle>
      <p className="max-w-prose text-[13.5px] leading-relaxed text-ink-2">
        Todos los días marcamos como «sin respuesta» a las postulaciones activas que llevan
        más de {GHOSTING_DAYS} días sin novedades — eso pasa siempre, se vea en el tablero. Lo
        que es opcional y está apagado por defecto es que además te mandemos un correo
        avisándote, como mucho uno por día agrupando todo lo que se marcó esa jornada. El
        detalle está en la{" "}
        <Link href="/legales/privacidad#c16" className="underline underline-offset-4 hover:text-ink">
          cláusula 16
        </Link>{" "}
        de privacidad.
      </p>

      {!state.active ? (
        <div className="mt-4 border-t border-rule pt-4">
          <Checkbox
            checked={consentChecked}
            onChange={(e) => setConsentChecked(e.target.checked)}
            label="Quiero recibir un correo cuando una postulación pase a «sin respuesta»."
          />
          <Button className="mt-3" disabled={!consentChecked || busy} onClick={() => void activate()}>
            Activar
          </Button>
        </div>
      ) : (
        <div className="mt-4 border-t border-rule pt-4">
          <Button variant="danger" disabled={busy} onClick={() => void deactivate()}>
            Desactivar el aviso por correo
          </Button>
        </div>
      )}
    </Card>
  );
}
