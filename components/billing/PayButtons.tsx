"use client";

import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import type { BillingStatus } from "@/lib/api/billing";

/**
 * One button per gateway that can actually take money.
 *
 * Driven by what the server reports rather than by what the code can imagine:
 * an installation with no Mercado Pago credentials must not show a Mercado Pago
 * button, because pressing it produces a 503 and the user has no way to know
 * that is our configuration and not their card.
 */

const ENDPOINT = {
  mercadopago: "/api/mercadopago/checkout",
} as const;

const LABEL = {
  mercadopago: "Comprar créditos con Mercado Pago",
} as const;

export function PayButtons({
  gateways,
  onError,
}: {
  gateways: BillingStatus["gateways"];
  onError?: (message: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (gateways.length === 0) return null;

  const open = async (gateway: keyof typeof ENDPOINT) => {
    setBusy(gateway);
    setError(null);
    try {
      const response = await fetch(ENDPOINT[gateway], { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "No pudimos abrir el pago.");
      }
      // `assign` rather than writing to `location.href`: the destination is the
      // gateway's own domain, so Next's router is not an option, and assigning to
      // a property of an object from outside the component is what the
      // immutability lint is there to catch.
      window.location.assign(payload.url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No pudimos abrir el pago.";
      setError(message);
      onError?.(message);
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {gateways.map((gateway, index) => (
          <Button
            key={gateway}
            variant={index === 0 ? "primary" : "secondary"}
            disabled={busy !== null}
            onClick={() => open(gateway)}
          >
            {busy === gateway ? "Abriendo…" : LABEL[gateway]}
          </Button>
        ))}
      </div>

      {error ? (
        <div className="mt-3">
          <Alert tone="bad">{error}</Alert>
        </div>
      ) : null}
    </div>
  );
}
