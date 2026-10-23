import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer, Nav } from "@/components/landing/parts";
import { RequestForm } from "@/components/legal/RequestForm";
import { salesEnabled } from "@/lib/payments/sales";

export const metadata: Metadata = {
  title: "Dar de baja",
  description:
    "Cancelá tu suscripción en línea, sin llamar a nadie y sin iniciar sesión.",
};

/**
 * Dinámica, no prerenderizada. El motivo original del `revalidate = 3600` era el
 * bloque de identificación del `Footer`: esos datos salen de variables de
 * entorno (`lib/legal/operator.ts`), y una página prerenderizada se queda con el
 * valor que había en el build.
 *
 * Revalidar no lo arregla —verificado contra producción, ver el comentario de
 * `app/precios/page.tsx`— y acá encima hacía algo peor. Con `revalidate`, Next
 * prerenderiza en el build, donde no existe ninguna variable de entorno
 * (`.dockerignore` excluye `.env` a propósito): `salesEnabled` daba `false`,
 * disparaba el `notFound()` de más abajo, y ese 404 quedaba congelado para
 * siempre. Cargar el token de Mercado Pago en el Secret no lo revivía, porque no
 * hay render nuevo que lo lea. Se verificó en `.next/server/app/baja.meta`, que
 * traía `"status": 404` con `x-nextjs-prerender: 1`.
 *
 * `scripts/verify-build-legal.mjs` no atrapa este caso: una página 404 nunca
 * llega a renderizar el pie, así que nunca imprime «[pendiente de carga]».
 */
export const dynamic = "force-dynamic";

/**
 * La baja de la suscripción, en línea y sin sesión.
 *
 * Ya existe un botón de cancelar dentro de la cuenta
 * (`components/account/AccountPanel.tsx`), que es el camino directo y el que
 * conviene usar: cancela contra Mercado Pago en el acto. Esta página existe para
 * el caso que ese botón no cubre — alguien que se suscribió hace meses y no
 * puede entrar a su cuenta — porque la Res. SCI 424/2020 pide que dar de baja
 * sea al menos tan fácil como contratar, y contratar no exige recordar una
 * contraseña.
 */
export default function BajaPage() {
  // Sin venta no hay suscripción que dar de baja. El código —incluida
  // `/api/legales/solicitud`— queda intacto para cuando vuelva a haberla.
  if (!salesEnabled) notFound();

  return (
    <div className="[--nav-h:4.5rem] font-podio font-normal text-ink">
      <Nav />
      <main className="px-6 pt-[calc(var(--nav-h)+4rem)] pb-24 sm:px-10">
        <div className="mx-auto w-full max-w-[58ch]">
          <h1 className="text-[clamp(2rem,5vw,3.25rem)] leading-[1.02] font-normal tracking-[-0.025em] text-balance">
            Dar de baja
          </h1>

          <div className="mt-8 space-y-4 text-[15px] leading-relaxed text-ink-2">
            <p>
              Podés cancelar la suscripción cuando quieras, sin explicar por qué y sin hablar
              con nadie. La baja corta la renovación: conservás el acceso hasta el final del
              período que ya pagaste.
            </p>
            <p>
              Si podés entrar a tu cuenta, lo más rápido es hacerlo{" "}
              <Link href="/cuenta" className="underline underline-offset-4 hover:text-ink">
                desde ahí
              </Link>
              : se cancela en el acto. Este formulario es para cuando no podés.
            </p>
          </div>

          <div className="mt-12">
            <RequestForm kind="baja" />
          </div>

          <p className="mt-12 border-t border-rule pt-6 text-[13px] leading-relaxed text-ink-3">
            Si además compraste hace diez días o menos y querés el reintegro, lo que
            corresponde es el{" "}
            <Link
              href="/arrepentimiento"
              className="underline underline-offset-4 hover:text-ink"
            >
              botón de arrepentimiento
            </Link>
            .
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
