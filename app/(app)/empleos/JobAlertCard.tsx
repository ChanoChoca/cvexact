"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Checkbox, Field, Input, SectionTitle, Select } from "@/components/ui";
import { useSession } from "@/lib/auth-client";

/**
 * The opt-in card for `/empleos`: activate, tune or turn off email alerts.
 *
 * Signed out, this renders nothing — the feature needs an account and a
 * synced profile (`app/api/jobs/alerts/route.ts`), and there is no useful
 * half-state to show someone who has neither. Signed in, it loads the
 * current configuration once and lets the user replace or clear it; there is
 * no separate "edit" mode because the form already always shows what is
 * saved.
 *
 * The consent checkbox follows `TransferConsent.tsx`'s rule: starts
 * unchecked, and the save button stays disabled until it is checked by hand
 * — a checkbox this component pre-checked for the user would not be consent.
 */

type AlertConfig = {
  query: string;
  workMode: string;
  minScore: number;
  frequency: string;
};

type AlertState = { active: boolean; consent: boolean; config: AlertConfig | null };

const WORK_MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Cualquier modalidad" },
  { value: "remote", label: "Remoto" },
  { value: "hybrid", label: "Híbrido" },
  { value: "onsite", label: "Presencial" },
];

export function JobAlertCard() {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const [state, setState] = useState<AlertState | null>(null);
  const [query, setQuery] = useState("");
  const [workMode, setWorkMode] = useState("");
  const [minScore, setMinScore] = useState(60);
  const [frequency, setFrequency] = useState("daily");
  const [consentChecked, setConsentChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void fetch("/api/jobs/alerts")
      .then((r) => (r.ok ? (r.json() as Promise<AlertState>) : null))
      .then((next) => {
        if (cancelled || !next) return;
        setState(next);
        if (next.config) {
          setQuery(next.config.query);
          setWorkMode(next.config.workMode);
          setMinScore(next.config.minScore);
          setFrequency(next.config.frequency);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!userId || !state) return null;

  // Sin consentimiento vigente hay que tildarlo a mano, y "hay una alerta" no lo
  // prueba: tras un cambio de `LEGAL_VERSION` la fila sigue existiendo (`active`)
  // pero el consentimiento quedó atado a la versión anterior, y el cron ya no manda
  // nada (`app/api/jobs/alerts/send/route.ts`). Sin esto, "Actualizar alerta"
  // registraba el consentimiento de la versión nueva sin que nadie lo tildara.
  const needsConsent = !state.active || !state.consent;

  const save = async () => {
    if (needsConsent && !consentChecked) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/jobs/alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, workMode, minScore, frequency, consent: true }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          typeof payload.error === "string" ? payload.error : "No pudimos guardar la alerta.",
        );
      }
      setState({ active: true, consent: true, config: { query, workMode, minScore, frequency } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar la alerta.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/jobs/alerts", { method: "DELETE" });
      if (!response.ok) throw new Error("No pudimos apagar la alerta.");
      setState({ active: false, consent: false, config: null });
      setConsentChecked(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos apagar la alerta.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionTitle>Alertas por email</SectionTitle>
      <p className="max-w-prose text-[13.5px] leading-relaxed text-ink-2">
        Te avisamos cuando aparezca un aviso nuevo que encaje con tu perfil. Opcional, y
        apagado por defecto — el detalle está en la{" "}
        <Link href="/legales/privacidad#c14" className="underline underline-offset-4 hover:text-ink">
          cláusula 14
        </Link>{" "}
        de privacidad.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Palabras clave (opcional)">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ej. react, ventas" />
        </Field>
        <Field label="Modalidad">
          <Select value={workMode} onChange={(e) => setWorkMode(e.target.value)}>
            {WORK_MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Compatibilidad mínima">
          <Select value={String(minScore)} onChange={(e) => setMinScore(Number(e.target.value))}>
            {[40, 50, 60, 70, 80].map((n) => (
              <option key={n} value={n}>
                {n}%
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Frecuencia">
          <Select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            <option value="daily">Diaria</option>
            <option value="weekly">Semanal</option>
          </Select>
        </Field>
      </div>

      {needsConsent ? (
        <div className="mt-4 border-t border-rule pt-4">
          {state.active ? (
            <p className="mb-3 max-w-prose text-[13.5px] leading-relaxed text-ink-2">
              Actualizamos la política de privacidad, así que tus alertas están en pausa hasta que
              vuelvas a aceptar.
            </p>
          ) : null}
          <Checkbox
            checked={consentChecked}
            onChange={(e) => setConsentChecked(e.target.checked)}
            className="items-start gap-3 text-[13.5px] leading-relaxed"
            label="Acepto que este puntaje se calcule en el servidor con mi perfil sincronizado, y sé que puedo apagar la alerta cuando quiera."
          />
        </div>
      ) : null}

      {error ? (
        <div className="mt-4">
          <Alert tone="bad" title="No pudimos guardarlo">
            {error}
          </Alert>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled={busy || (needsConsent && !consentChecked)} onClick={save}>
          {state.active ? "Actualizar alerta" : "Activar alerta"}
        </Button>
        {state.active ? (
          <Button variant="danger" disabled={busy} onClick={disable}>
            Apagar
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
