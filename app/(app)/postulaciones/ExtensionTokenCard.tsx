"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/toast";

/**
 * El token que conecta la extensión de navegador (Fase 4) con la cuenta —
 * se genera una vez, se muestra una sola vez, y de ahí en más sólo se sabe
 * que existe, no cuál es. Mismo trato que cualquier API key: perderlo
 * significa generar uno nuevo, no recuperarlo.
 */
export function ExtensionTokenCard({ userId }: { userId: string | undefined }) {
  const [active, setActive] = useState<boolean | null>(null);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void fetch("/api/tracker/extension-token")
      .then((r) => (r.ok ? (r.json() as Promise<{ active: boolean }>) : null))
      .then((next) => {
        if (!cancelled && next) setActive(next.active);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!userId || active === null) return null;

  const generate = async () => {
    if (active) {
      const confirmed = await confirm(
        "Ya tenías uno generado. Uno nuevo va a dejar de funcionar en cualquier extensión donde hayas pegado el anterior.",
        { title: "Generar un token nuevo", confirmLabel: "Generar de todos modos" },
      );
      if (!confirmed) return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/tracker/extension-token", { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        toast({ tone: "bad", message: body.error ?? "No se pudo generar el token." });
        return;
      }
      const body = (await response.json()) as { token: string };
      setFreshToken(body.token);
      setActive(true);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    const confirmed = await confirm("La extensión deja de poder capturar avisos hasta que generes uno nuevo.", {
      title: "Revocar el token",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await fetch("/api/tracker/extension-token", { method: "DELETE" });
      setActive(false);
      setFreshToken(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionTitle>Extensión de navegador</SectionTitle>
      <p className="max-w-prose text-[13.5px] leading-relaxed text-ink-2">
        Capturá el aviso que estés mirando —en cualquier sitio, incluidos LinkedIn e Indeed—
        con un click, desde donde sea que estés navegando. La extensión nunca lee ni recorre
        avisos por su cuenta: sólo actúa cuando vos apretás el botón, sobre la página que ya
        tenés abierta.
      </p>

      {freshToken ? (
        <Alert tone="good" title="Copiá este código ahora">
          No lo vamos a volver a mostrar. Pegalo en la extensión, en &ldquo;Conectar cuenta&rdquo;.
          <div className="mt-2 border border-rule bg-paper px-3 py-2 font-mono text-xs break-all text-ink">
            {freshToken}
          </div>
        </Alert>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-rule pt-4">
        <Button disabled={busy} onClick={() => void generate()}>
          {active ? "Generar uno nuevo" : "Generar token"}
        </Button>
        {active ? (
          <Button variant="danger" disabled={busy} onClick={() => void revoke()}>
            Revocar
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
