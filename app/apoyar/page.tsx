import type { Metadata } from "next";
import Link from "next/link";
import { Footer, Nav, Section } from "@/components/landing/parts";
import { DonationWallet } from "@/components/billing/DonationWallet";
import {
  cryptoDonationConfigured,
  donationWalletAddress,
  donationWalletQrDataUrl,
} from "@/lib/payments/crypto-donation";

/**
 * Dinámica, no revalidada por hora — mismo motivo que `/precios`:
 * `DONATION_WALLET_ADDRESS` y el pie (`lib/legal/operator.ts`) son variables
 * de entorno, y `revalidate` no las recogía de forma confiable en este
 * despliegue. Ver `app/page.tsx` para el detalle completo.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Apoyar el proyecto",
  description:
    "cvexact es gratis con tu propia API key. Las donaciones en crypto ayudan a bancar " +
    "el hosting de forma independiente.",
};

/**
 * La página de donaciones.
 *
 * Tiene que decir la verdad de frente, en el mismo lugar donde pide plata: el
 * producto ya es gratis y sin tope con tu propia key (`app/precios/page.tsx`),
 * así que esto no compra nada, no da créditos y no desbloquea nada. Una
 * donación que prometiera algo a cambio dejaría de ser una donación y volvería
 * a traer las obligaciones de venta que este producto no tiene hoy.
 *
 * Las donaciones se reciben directamente en una wallet (Polygon, USDC/USDT),
 * que evita quedar sujeto a regímenes de reporte local por un procesador de
 * pagos. Sin `DONATION_WALLET_ADDRESS` configurado, la página igual existe
 * —el link vive en el footer de todas partes— pero sin dirección: explica el
 * proyecto y nada más, en vez de 404.
 */
export default async function ApoyarPage() {
  let address: string | null = null;
  let qrDataUrl: string | null = null;

  if (cryptoDonationConfigured) {
    try {
      address = donationWalletAddress();
      qrDataUrl = await donationWalletQrDataUrl(address);
    } catch {
      // If generating the QR fails, fall through to the disabled state.
    }
  }

  return (
    <div className="[--nav-h:4.5rem] font-podio font-normal text-ink">
      <Nav />

      <main>
        <Section className="pt-[calc(var(--nav-h)+4rem)]">
          <h1 className="max-w-[16ch] text-[clamp(2.5rem,7vw,5rem)] leading-[0.98] font-normal tracking-[-0.03em] text-balance">
            Apoyar el proyecto
          </h1>
          <p className="mt-8 max-w-[46ch] text-[clamp(1.05rem,1.7vw,1.35rem)] leading-snug text-pretty text-ink-2">
            cvexact ya es gratis y sin tope con tu propia API key — nada de esto lo cambia. Una
            donación no compra créditos, no da acceso a nada nuevo y no te mueve de lugar en
            ninguna cola. Sirve para una sola cosa: bancar el hosting.
          </p>

          <div className="mt-12">
            {address && qrDataUrl ? (
              <DonationWallet address={address} qrDataUrl={qrDataUrl} />
            ) : (
              <p className="max-w-[46ch] text-[14px] leading-relaxed text-ink-3">
                Las donaciones no están habilitadas en esta instalación por ahora. Si igual
                querés usar el producto, andá a{" "}
                <Link
                  href="/ajustes"
                  className="underline decoration-oro-soft underline-offset-4 hover:text-ink"
                >
                  Ajustes
                </Link>{" "}
                y armá tu propia key — es gratis.
              </p>
            )}
          </div>
        </Section>
      </main>

      <Footer />
    </div>
  );
}
