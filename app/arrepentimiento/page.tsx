import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer, Nav } from "@/components/landing/parts";
import { RequestForm } from "@/components/legal/RequestForm";
import { salesEnabled } from "@/lib/payments/sales";

export const metadata: Metadata = {
  title: "Botón de arrepentimiento",
  description:
    "Revocá tu compra dentro de los diez días corridos, sin expresar causa y sin costo, " +
    "conforme al artículo 34 de la Ley 24.240.",
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
 * El botón de arrepentimiento de la Res. SCI 424/2020.
 *
 * La resolución pide que esté en la página de inicio, en un lugar visible y
 * destacado, y que sea el primer paso de un trámite que termina en una
 * constancia. El enlace vive en el `Footer` (recuadrado, no como un renglón más
 * de la lista) y esta es la página a la que lleva.
 *
 * No pide iniciar sesión ni número de operación: ver el comentario del handler
 * en `app/api/legales/solicitud/route.ts` para por qué esa ausencia es el
 * requisito y no un descuido.
 */
export default function ArrepentimientoPage() {
  // El derecho de revocación es de quien compró algo. Sin venta habilitada no
  // hay ninguna compra de la que arrepentirse, y el código —incluido
  // `/api/legales/solicitud`— queda intacto para cuando vuelva a haberla.
  if (!salesEnabled) notFound();

  return (
    <div className="[--nav-h:4.5rem] font-podio font-normal text-ink">
      <Nav />
      <main className="px-6 pt-[calc(var(--nav-h)+4rem)] pb-24 sm:px-10">
        <div className="mx-auto w-full max-w-[58ch]">
          <h1 className="text-[clamp(2rem,5vw,3.25rem)] leading-[1.02] font-normal tracking-[-0.025em] text-balance">
            Botón de arrepentimiento
          </h1>

          <div className="mt-8 space-y-4 text-[15px] leading-relaxed text-ink-2">
            <p>
              Si compraste hace diez días corridos o menos, podés revocar la compra{" "}
              <strong>sin explicar por qué y sin ningún costo</strong>. Es un derecho que te
              da el artículo 34 de la Ley 24.240 y no hace falta que negocies nada con
              nosotros.
            </p>
            <p>
              Completá tu correo y listo. Te llega la constancia en el momento, y el reintegro
              sale por el mismo medio de pago que usaste dentro de los diez días hábiles.
            </p>
          </div>

          <div className="mt-12">
            <RequestForm kind="arrepentimiento" />
          </div>

          <p className="mt-12 border-t border-rule pt-6 text-[13px] leading-relaxed text-ink-3">
            ¿Solo querés que la suscripción no se renueve, sin pedir reintegro? Eso es la{" "}
            <Link href="/baja" className="underline underline-offset-4 hover:text-ink">
              baja
            </Link>
            .
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
