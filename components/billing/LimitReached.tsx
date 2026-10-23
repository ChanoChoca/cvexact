"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, ButtonLink, Card, cx } from "@/components/ui";
import { TransferConsent } from "@/components/legal/TransferConsent";
import { ByokSetup } from "./ByokSetup";
import { PayButtons } from "./PayButtons";
import { PurchaseTerms } from "./PurchaseTerms";
import { useBillingStatus } from "@/lib/api/billing";
import type { ApiError, DenialReason } from "@/lib/api/client";

/**
 * What someone sees when the server has refused them over quota.
 *
 * The free path is offered first and given the most room, in every case that
 * has one. That ordering is the product's position, not a growth tactic
 * reversed: BYOK costs the user nothing and gives them everything, so leading
 * with the paid option would be selling them something they may not need. A
 * paywall that hides a free door is just a worse description of the truth.
 */

/*
 * `transfer_consent` no tiene entrada acá ni en `BLURB` porque no llega a
 * usarlas: `LimitReached` lo deriva entero a `TransferConsent` antes de leer
 * ninguno de los dos mapas. Se excluye del tipo en vez de darle un texto que
 * nadie muestra — un título muerto es lo que después alguien mueve a un lugar
 * donde sí se ve, y ahí diría lo que no corresponde.
 */
type QuotaReason = Exclude<DenialReason, "transfer_consent">;

const HEADLINE: Record<QuotaReason, string> = {
  no_credits: "Te quedaste sin créditos",
  daily_limit: "Llegaste al tope de hoy",
  monthly_limit: "Llegaste al tope del mes",
  byok_required: "Te falta configurar tu key",
};

const BLURB: Record<QuotaReason, string> = {
  no_credits:
    "Se acabaron los créditos del pack. Podés comprar más, o pasarte a tu propia key y no " +
    "volver a quedarte sin.",
  daily_limit:
    "Es un tope antiabuso, no un límite del plan. Se libera a la medianoche UTC; si " +
    "necesitás seguir ahora, tu propia key no tiene tope.",
  monthly_limit:
    "Es lo que trae la suscripción este mes. Se libera al empezar el próximo; si necesitás " +
    "seguir ahora, tu propia key no tiene tope.",
  byok_required:
    "Este producto no corre con nuestra key. Armá la tuya —son dos minutos— y " +
    "seguí sin tope.",
};

/**
 * Reads a refusal, or returns null when this was not one.
 *
 * Dos códigos y no uno: la cuota rechaza con 429 («ahora no») y el
 * consentimiento pendiente con 403 («falta un paso»). Son respuestas distintas
 * y merecen códigos distintos, pero del lado del cliente terminan en el mismo
 * lugar — un pedido que no se hizo y una salida concreta que ofrecer.
 */
export function denialOf(error: unknown): DenialReason | null {
  const api = error as ApiError | undefined;
  if (!api?.reason) return null;
  return api.status === 429 || api.status === 403 ? api.reason : null;
}

export function LimitReached({
  reason,
  onResolved,
}: {
  reason: DenialReason;
  onResolved?: () => void;
}) {
  // Cuando el motivo es que directamente falta la key, no tiene sentido
  // esconder el asistente detrás de un botón: es lo único que este usuario
  // puede hacer acá, así que arranca abierto.
  const [showSetup, setShowSetup] = useState(reason === "byok_required");
  const { status } = useBillingStatus();

  /*
   * Nada de lo que sigue sirve para este caso: quien tiene que consentir la
   * transferencia ya pagó, así que ofrecerle comprar créditos sería contestarle
   * una pregunta que no hizo. Derivar acá arriba es también lo que hace que los
   * tres lugares que renderizan `LimitReached` —el wizard, el panel de extras y
   * el asistente de perfil— hereden el consentimiento sin tocar ninguno.
   */
  if (reason === "transfer_consent") return <TransferConsent onAccepted={onResolved} />;

  return (
    <Card>
      <h2 className="text-[19px] leading-snug font-normal tracking-[-0.01em] text-ink">
        {HEADLINE[reason]}
      </h2>
      <p className="mt-2 max-w-prose text-[14.5px] leading-relaxed text-pretty text-ink-2">
        {BLURB[reason]}
      </p>

      <div className="mt-7 border-t border-rule pt-6">
        <h3 className="text-[15px] text-ink">Seguir con tu propia key</h3>
        <p className="mt-1.5 max-w-prose text-[13.5px] leading-relaxed text-ink-2">
          Con una key tuya no hay tope de nuestro lado. La de Google se arma en dos minutos con la
          misma cuenta que usás para Gmail, y su nivel gratuito tiene condiciones: te las mostramos
          antes de que la armes.
        </p>

        {showSetup ? (
          <div className="mt-5">
            <ByokSetup onDone={onResolved} onCancel={() => setShowSetup(false)} />
          </div>
        ) : (
          <Button className="mt-4" onClick={() => setShowSetup(true)}>
            Armar mi key
          </Button>
        )}
      </div>

      {/*
        * Second, and deliberately quieter than the block above it. The free
        * path is genuinely the better offer for most people here, so leading
        * with the paid one would be selling them something they may not need.
        *
        * Todo el bloque queda detrás de `gateways.length > 0`: sin ninguna
        * pasarela configurada no hay nada pago que ofrecer, y mostrar el
        * título, el copy y el link a `/precios` de todos modos sería anunciar
        * una opción que no existe.
        */}
      {status && status.gateways.length > 0 ? (
        <div className="mt-6 border-t border-rule pt-6">
          <h3 className="text-[15px] text-ink">O que sigamos poniéndola nosotros</h3>
          <p className="mt-1.5 max-w-prose text-[13.5px] leading-relaxed text-ink-2">
            {/* Decía «más grande que el de la prueba», y después «más grande que
                el del resto del producto». Las dos comparaciones murieron: no hay
                prueba (`free` no corre nada), y con el tier de servicio corriendo
                un único modelo, `SERVICE_MODEL` y `SERVICE_PRO_MODEL` son el
                mismo. Esta es la pantalla que alguien lee justo antes de pagar,
                así que es la que menos puede prometer de más. */}
            Sin keys ni configuración.

            {status.packApplications
              ? ` El pack son ${status.packApplications} postulaciones y no se renueva.`
              : null}
          </p>

          <div className="mt-4">
            {/* Signing in is what a purchase needs: a balance belongs to an
                account, not to a browser. */}
            {status.signedIn ? (
              <>
                <PurchaseTerms terms={status.terms} />
                <PayButtons gateways={status.gateways} />
              </>
            ) : (
              <ButtonLink href="/cuenta">Iniciar sesión para comprar</ButtonLink>
            )}
          </div>

          <Link
            href="/precios"
            className={cx(
              "mt-4 inline-block text-[14px] text-ink-2 underline decoration-oro-soft",
              "underline-offset-4 transition-colors hover:text-ink",
            )}
          >
            Ver precios ↗
          </Link>
        </div>
      ) : null}
    </Card>
  );
}
