"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ByokSetup } from "@/components/billing/ByokSetup";
import { Alert, Button, Spinner } from "@/components/ui";
import { useAiAvailability } from "@/lib/ai/availability";
import type { DenialReason } from "@/lib/api/client";
import { TransferConsent } from "@/components/legal/TransferConsent";
import { readFooter } from "@/lib/legal/data-flow";

/**
 * What the action is, for a sentence: «Armar mi recorrido con tu IA» is «armar mi recorrido». The label says which text or which document it is about —«Mejorar la lectura de
 * «cv.pdf» con tu IA»—, and there can be one for each on a screen: that has to survive when the button is not there, and «con tu IA» does not, in a sentence that says there is none.
 */
export const purposeOf = (label: string): string => {
  const bare = label.trim().replace(/\s+con tu IA$/i, "");
  return bare.charAt(0).toLowerCase() + bare.slice(1);
};

/**
 * The one control every AI extraction point in the onboarding uses: the
 * button, the line that says it uses an IA, the non-blocking failure (S SE), and what shows
 * instead when there is no IA to use. One place, so a person sees the same
 * three states — offered, failed, unavailable — wherever this asks to use
 * their key, and the actions that spend it never run except from a tap here.
 *
 * Waiting is a state with a way out. The server may take a few minutes over a
 * long document, and a disabled button with a spinner is no way to spend them:
 * while it runs this says how long it has been, and offers to stop waiting —
 * "Cancelar", or the same and go on without the IA where the screen has
 * somewhere to go on to. A request that was cancelled is not applied: `run`
 * is given the signal and stops what it can.
 */
export function AiAction({
  label,
  busyLabel = "Usando tu IA…",
  run,
  onDone,
  onSkip,
  skipLabel = "Continuar sin IA",
  whenUnavailable = "offer",
  footer,
}: {
  label: string;
  busyLabel?: string;
  /**
   * Does the work and says whether it landed. Never throws — a rejection here would skip past the SE state. It is
   * given a signal that is aborted when the person stops waiting, to pass on to the request.
   */
  run: (signal: AbortSignal) => Promise<{ ok: true } | { ok: false; message: string; reason?: DenialReason }>;
  /** Called once `run` succeeds. */
  onDone: () => void;
  /** Omitted where there is nothing to skip to — the action itself is already optional. */
  onSkip?: () => void;
  skipLabel?: string;
  /**
   * What to show when there is no IA to use at all. "offer" (the default)
   * makes the key in place — the two moments the spec allows asking for one:
   * a non-standard CV, or "Contámelo a mi manera". "hide" renders nothing, for a call site
   * that already has its own way past this (S7b's "Seguir", the hub's
   * "Agregar") and must never be the reason a key gets asked for outside
   * those two moments.
   */
  whenUnavailable?: "offer" | "hide";
  /** What goes to the model, said under the button, when it is not what `readFooter` says — a text with its name and contact marked out and its details struck out first. */
  footer?: string;
}) {
  const ai = useAiAvailability();
  const [state, setState] = useState<"idle" | "busy" | "error" | "consent">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [settingUp, setSettingUp] = useState(false);
  const request = useRef<AbortController | null>(null);

  // A wait the person has left behind is one nobody is waiting for: if this goes away while a request runs, it is stopped.
  useEffect(() => {
    const holder = request;
    return () => holder.current?.abort();
  }, []);

  // Seconds since the wait began. Reset by the tap that begins it, not here: setting state in an effect body is a
  // cascading render, and there is nothing to count until the wait is running.
  useEffect(() => {
    if (state !== "busy") return;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [state]);

  // Unknown for a few hundred milliseconds while the server answers — nothing
  // shown yet rather than a wrong guess that flips a beat later.
  if (!ai) return null;

  const attempt = async () => {
    const abort = new AbortController();
    request.current = abort;
    setElapsed(0);
    setState("busy");
    try {
      const outcome = await run(abort.signal);
      if (outcome.ok) {
        // Even if the tap to stop came in the same instant: what `run` did is done, and the screen says so.
        setState("idle");
        onDone();
      } else if (abort.signal.aborted) {
        // The person's own doing: `stop` already put the control back, and there is nothing to report.
      } else if (outcome.reason === "transfer_consent") {
        // "Reintentar" can never succeed against this specific refusal on
        // its own — it needs the consent screen, not another attempt.
        setState("consent");
      } else {
        setState("error");
        setMessage(outcome.message);
      }
    } catch (error) {
      if (abort.signal.aborted) return;
      // `run`'s own contract says it never throws, but a control this
      // central should not spin forever if some future call site's `run`
      // breaks that — a browser storage error, say, thrown outside its own
      // try — so this is the one place that still catches it.
      setState("error");
      setMessage(error instanceof Error ? error.message : "No pudimos usar tu IA en este momento.");
    }
  };

  const stop = () => {
    request.current?.abort();
    setState("idle");
  };

  if (ai.tone === "bad") {
    if (whenUnavailable === "hide") return null;
    return (
      <Alert tone="info">
        {/* What the button would have done, and not its name: «Armar mi recorrido con tu IA necesita una IA disponible» said «IA» twice and made the button the subject of the sentence. */}
        <p>Para {purposeOf(label)} hace falta una IA, y ahora no hay ninguna disponible.</p>
        {settingUp ? (
          <div className="mt-4">
            <ByokSetup onCancel={() => setSettingUp(false)} />
          </div>
        ) : (
          <p className="mt-1 text-xs text-ink-3">Hace falta una key. La de Google se arma acá, en dos minutos, y antes te mostramos qué condiciones tiene.</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {settingUp ? null : (
            <Button variant="secondary" onClick={() => setSettingUp(true)}>
              Armar mi key
            </Button>
          )}
          {onSkip ? (
            <Button variant="ghost" onClick={onSkip}>
              {skipLabel}
            </Button>
          ) : null}
          <Link href="/ajustes" className="text-xs text-ink-3 underline decoration-white/20 underline-offset-4 hover:text-ink pointer-coarse:py-3.5">
            ¿Tenés otro proveedor? Ponelo en Ajustes
          </Link>
        </div>
      </Alert>
    );
  }

  if (state === "consent") {
    return <TransferConsent kind="read" onAccepted={attempt} />;
  }

  if (state === "error") {
    return (
      <Alert tone="warn" role="status">
        <p>No se pudo usar tu IA; seguimos sin ella.</p>
        {message ? <p className="mt-1 text-xs text-ink-3">{message}</p> : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={attempt}>
            Reintentar
          </Button>
          {onSkip ? (
            <Button variant="ghost" onClick={onSkip}>
              {skipLabel}
            </Button>
          ) : null}
        </div>
      </Alert>
    );
  }

  if (state === "busy") {
    return (
      <div role="status" aria-live="polite" aria-busy="true" className="space-y-2">
        <div className="flex flex-wrap items-center gap-3.5">
          <Spinner />
          <span className="text-sm text-ink-2">{busyLabel}</span>
          {/* Only once the wait is long enough to wonder about: a count that starts at zero on every tap makes a quick answer look slow. */}
          {elapsed >= 5 ? <span className="font-mono text-[11px] tracking-[0.14em] text-ink-3 tabular-nums">{elapsed} s</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={stop}>
            Cancelar
          </Button>
          {onSkip ? (
            <Button
              variant="ghost"
              onClick={() => {
                stop();
                onSkip();
              }}
            >
              {skipLabel}
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-ink-3">
          Puede tardar un par de minutos. Cancelar deja de esperar; lo que ya llegó a {ai.byok ? "tu proveedor" : "el proveedor"} no se puede retirar.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Button variant="secondary" onClick={attempt}>
        {label}
      </Button>
      <p className="text-xs text-ink-3">
        {ai.byok ? "Esto usa tu IA." : "Esto usa una IA."} {footer ?? readFooter(ai.byok)}{" "}
        <Link href="/legales/privacidad#c7" className="underline decoration-white/20 underline-offset-4 hover:text-ink">
          Sobre datos sensibles
        </Link>
      </p>
    </div>
  );
}
