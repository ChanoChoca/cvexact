"use client";

import Link from "next/link";
import type { BillingStatus } from "@/lib/api/billing";

/**
 * Qué estás contratando, antes de contratarlo.
 *
 * El art. 4 de la Ley 24.240 y el art. 1100 del CCyC piden que el consumidor
 * tenga la información esencial antes de obligarse, y hasta acá no la tenía: se
 * podía llegar a «Comprar créditos» y a «Suscribirme» desde Ajustes sin haber
 * pasado nunca por `/precios`, o sea sin haber visto el precio, sin saber que la
 * suscripción se renueva sola y sin que nadie mencionara los diez días de
 * arrepentimiento. El checkout de Mercado Pago muestra el importe, pero eso es
 * el final del camino: para entonces la decisión ya está tomada.
 *
 * Vive arriba de los botones y no adentro de `PayButtons` porque el botón de
 * suscribirse es otro componente, en `AccountPanel`, y las condiciones tienen
 * que cubrir a los dos. Los números vienen del servidor (`terms` en
 * `/api/billing/status`) y no de constantes del bundle, así que no pueden
 * anunciar algo distinto de lo que se cobra.
 */
export function PurchaseTerms({ terms }: { terms: BillingStatus["terms"] }) {
  const { pack, subscription } = terms;
  if (!pack && !subscription) return null;

  const money = (amount: number) =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    }).format(amount);

  return (
    <div className="mb-4 border-l-2 border-oro-soft pl-4 text-[13px] leading-relaxed text-ink-2">
      <p className="font-mono text-[11px] tracking-[0.22em] text-ink-3 uppercase">
        Qué estás contratando
      </p>

      <ul className="mt-2 space-y-1.5">
        {pack ? (
          <li>
            <strong className="text-ink">
              Pack{pack.priceArs ? ` — ${money(pack.priceArs)}` : ""}
            </strong>
            : pago único, {pack.credits} créditos ({pack.applications} postulaciones). No se
            renueva solo, y los créditos valen {pack.expiryMonths} meses desde la compra.
          </li>
        ) : null}

        {subscription ? (
          <li>
            <strong className="text-ink">
              Suscripción
              {subscription.priceArs ? ` — ${money(subscription.priceArs)} por mes` : ""}
            </strong>
            : hasta {subscription.monthlyApplications} postulaciones por mes, con un tope
            diario de {subscription.dailyApplications}.{" "}
            <strong className="text-ink">Se renueva automáticamente</strong> hasta que la des
            de baja.
          </li>
        ) : null}
      </ul>

      <p className="mt-2.5 text-ink-3">
        Precio final en pesos. Tenés diez días corridos para{" "}
        <Link
          href="/arrepentimiento"
          className="underline underline-offset-4 hover:text-ink"
        >
          arrepentirte
        </Link>{" "}
        sin costo, y podés{" "}
        <Link href="/baja" className="underline underline-offset-4 hover:text-ink">
          dar de baja
        </Link>{" "}
        cuando quieras. Ver los{" "}
        <Link
          href="/legales/terminos"
          className="underline underline-offset-4 hover:text-ink"
        >
          términos
        </Link>
        .
      </p>
    </div>
  );
}
