"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

/**
 * Displays a crypto wallet address as a copyable field and QR code.
 *
 * Renders the wallet address in monospace text with a copy-to-clipboard button,
 * plus a QR code that encodes the address for scanning from a wallet app.
 */
export function DonationWallet({
  address,
  qrDataUrl,
}: {
  address: string;
  qrDataUrl: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-ink-2 mb-2">Red: Polygon · Activos: USDC o USDT</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <img
            src={qrDataUrl}
            alt="Código QR de la dirección de la wallet"
            className="w-[240px] h-[240px] border border-ink-2"
          />
          <div className="flex-1">
            <p className="text-xs text-ink-3 mb-2">Dirección de transferencia:</p>
            <div className="bg-paper-2 p-3 border border-rule mb-3">
              <code className="text-xs break-all font-mono text-ink">{address}</code>
            </div>
            <Button variant="secondary" onClick={handleCopy}>
              {copied ? "Copiado" : "Copiar dirección"}
            </Button>
            <p className="text-xs text-ink-3 mt-3">
              ⚠️ Solo envía por la red Polygon. Las transferencias desde otras redes no llegan.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
