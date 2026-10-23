import type { Metadata } from "next";
import Link from "next/link";
import { Cta, Footer, Nav, Section } from "@/components/landing/parts";
import { packCredits } from "@/lib/billing/pack";
import {
  mercadoPagoConfigured,
  mercadoPagoSubscriptionConfigured,
  packPriceArs,
  subscriptionPriceArs,
} from "@/lib/payments/mercadopago";
import {
  APPLICATION_COST,
  CREDIT_EXPIRY_MONTHS,
  INTAKE_MONTHLY_CAP,
  PAID_DAILY_CAP,
  PAID_MONTHLY_CAP,
} from "@/lib/quota";

/**
 * Dinámica, no reconstruida por hora. La razón original de `revalidate =
 * 3600` era que el precio y el CUIT del pie —`salesEnabled`,
 * `lib/legal/operator.ts`— son variables de entorno, no datos por request, y
 * la hipótesis era que la regeneración en segundo plano las releyera cada
 * hora. Verificado contra producción: no es lo que pasa en este despliegue —
 * `/legales/privacidad` sirvió «[pendiente de carga]» con `x-nextjs-cache:
 * HIT` mucho después de vencido ese plazo. `force-dynamic` saca la duda,
 * mismo criterio que `app/page.tsx`.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Precios",
  description: "Con tu propia API key el producto es gratis, entero y sin límite.",
};

/**
 * The page the product did not have, which is why nobody could decide whether
 * to pay: the price lived only in Stripe, the landing never mentioned it, and
 * the subscription was reachable from one button inside the settings screen.
 *
 * Written to say the true thing first. BYOK is the widest column and comes
 * first because it is genuinely the best offer here for most people — the whole
 * product, no limit, no cost — and burying that to make the paid column look
 * necessary would be selling against our own users. There is no server-funded
 * trial: `free` is BYOK's other name, not a third option, so it does not get a
 * column of its own.
 *
 * A server component, so the numbers below come from the same constants the
 * server meters with. A pricing page that drifts from what the code enforces is
 * worse than none.
 */

const money = (amount: number, currency: string, locale = "es-AR") =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);

/**
 * The subscription in pesos — the same `MP_SUB_PRICE_ARS` that actually
 * creates the preapproval, so this page cannot advertise a number nobody is
 * charged.
 */
function subscriptionPrice(): string | null {
  if (!mercadoPagoSubscriptionConfigured) return null;
  try {
    return money(subscriptionPriceArs(), "ARS");
  } catch {
    return null;
  }
}

/** The pack in pesos. Ours, so it comes from the environment. */
function packPrice(): string | null {
  if (!mercadoPagoConfigured) return null;
  try {
    return money(packPriceArs(), "ARS");
  } catch {
    return null;
  }
}

function Plan({
  name,
  price,
  note,
  features,
  action,
  featured,
}: {
  name: string;
  price: string;
  note: string;
  features: string[];
  action?: React.ReactNode;
  featured?: boolean;
}) {
  return (
    <div
      className={`flex flex-col border-t p-7 ${featured ? "border-oro bg-paper-2" : "border-rule"}`}
    >
      <h2 className="text-[17px] text-ink">{name}</h2>
      <p className="mt-4 text-[clamp(1.75rem,3vw,2.25rem)] leading-none tracking-[-0.02em] text-ink">
        {price}
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-3">{note}</p>

      <ul className="mt-6 flex-1 space-y-2.5">
        {features.map((feature) => (
          <li key={feature} className="flex gap-2.5 text-[14px] leading-relaxed text-ink-2">
            <span aria-hidden className="mt-[0.45em] size-1 shrink-0 bg-oro-soft" />
            {feature}
          </li>
        ))}
      </ul>

      {action ? <div className="mt-7">{action}</div> : null}
    </div>
  );
}

export default function PricingPage() {
  const [subscription, pack] = [subscriptionPrice(), packPrice()];

  return (
    <div className="[--nav-h:4.5rem] font-podio font-normal text-ink">
      <Nav />

      <main>
        <Section className="pt-[calc(var(--nav-h)+4rem)]">
          <h1 className="max-w-[16ch] text-[clamp(2.5rem,7vw,5rem)] leading-[0.98] font-normal tracking-[-0.03em] text-balance">
            Gratis de verdad.
          </h1>
          <p className="mt-8 max-w-[46ch] text-[clamp(1.05rem,1.7vw,1.35rem)] leading-snug text-pretty text-ink-2">
            Las APIs de los modelos tienen nivel gratuito. Si usás el tuyo, esto no te cuesta
            nada y no tiene tope.
            {mercadoPagoConfigured ? " Pagar sirve para no tener que ocuparte de eso." : null}
          </p>

          <div className="mt-16 grid gap-px sm:grid-cols-2">
            <Plan
              featured
              name="Con tu propia key"
              price="$0"
              note="Para siempre. Sin tarjeta, sin cuenta."
              features={[
                "El producto entero: CV, respuestas, email, entrevista y video",
                "Sin límite de uso",
                "Dos minutos de configuración, una sola vez",
                "La key se guarda en tu navegador; viaja en cada generación para llamar al "
                + "proveedor, pero no la guardamos ni la registramos",
              ]}
              action={<Cta href="/ajustes">Armar mi key</Cta>}
            />

            {mercadoPagoConfigured ? (
              <Plan
                name="Que la pongamos nosotros"
                // The pack leads: a one-off matches a search, which ends.
                price={pack ?? subscription ?? "Pack o mensual"}
                note={
                  pack
                    ? `El pack, pago único. Son ${Math.floor(packCredits() / APPLICATION_COST)} postulaciones y no se renueva` +
                      `${subscription ? `. La suscripción, ${subscription} por mes (hasta ${Math.floor(PAID_MONTHLY_CAP / APPLICATION_COST)} postulaciones)` : ""}.`
                    : subscription
                      ? `Por mes, cancelable cuando quieras. Hasta ${Math.floor(PAID_MONTHLY_CAP / APPLICATION_COST)} postulaciones.`
                      : "Suscripción mensual, cancelable cuando quieras."
                }
                features={[
                  /*
                   * Acá decía "El CV y las respuestas los escribe un modelo más
                   * grande". Era cierto mientras `SERVICE_PRO_MODEL` fue
                   * `deepseek-v4-pro`; con el tier de servicio corriendo
                   * `deepseek-v4-flash` en todo, `SERVICE_MODEL` y
                   * `SERVICE_PRO_MODEL` son el mismo modelo y la frase pasó a
                   * ser falsa — el que paga corre exactamente lo que podría
                   * correr gratis con su propia key. La publicidad integra el
                   * contrato (LDC art. 8), así que no puede quedar.
                   *
                   * Lo que se vende ahora es lo que efectivamente se entrega, y
                   * es lo que el README ya decía en su primera mitad: no
                   * configurar nada, y el saldo.
                   */
                  // La sincronización del perfil no está acá a propósito: es de cualquier cuenta, se pague o no, y `/api/sync`
                  // no mira ningún plan. Venderla como parte del pago es publicidad de algo que no se compra (LDC art. 8).
                  "Sin keys ni configuración",
                  ...(pack
                    ? [
                        `El pack no se renueva solo, y los créditos valen ${CREDIT_EXPIRY_MONTHS} meses`,
                        // True only for the pack: a purchased balance has no
                        // separate lane for profile help, unlike the
                        // subscription's own `SEPARATE_BUDGET` allowance.
                        "Leer un documento o separar una respuesta con tu IA también sale de ese mismo saldo",
                      ]
                    : []),
                  ...(subscription
                    ? [
                        `Leer documentos o separar respuestas con tu IA tiene su propio tope aparte, de ` +
                          `${INTAKE_MONTHLY_CAP} créditos por mes: no te saca postulaciones`,
                        /*
                         * `PAID_DAILY_CAP` cortaba el servicio sin figurar en
                         * ningún lado. Un tope que no se publica y que frena la
                         * prestación es el reclamo que un consumidor gana (LDC
                         * art. 4 y 19), y publicarlo no le cuesta nada a nadie:
                         * son más del doble de lo que usa un suscriptor
                         * intensivo, según la nota de `PAID_DAILY_CAP`.
                         */
                        `Hasta ${PAID_DAILY_CAP} créditos por día (${Math.floor(PAID_DAILY_CAP / APPLICATION_COST)} postulaciones), ` +
                          "un freno contra el uso automatizado que se repone al otro día",
                        "Se renueva sola todos los meses hasta que la des de baja, desde tu cuenta o desde /baja",
                      ]
                    : []),
                ]}
                action={<Cta href="/cuenta">Ver opciones</Cta>}
              />
            ) : null}
          </div>

          <p className="mt-10 text-[14px] text-ink-2">
            ¿Te sirvió?{" "}
            <Link
              href="/apoyar"
              className="underline decoration-oro-soft underline-offset-4 hover:text-ink"
            >
              Podés apoyar el proyecto ↗
            </Link>
          </p>
        </Section>
      </main>

      <Footer />
    </div>
  );
}
