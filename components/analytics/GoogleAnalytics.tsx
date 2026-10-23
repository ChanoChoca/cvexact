"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect } from "react";
import { Button } from "@/components/ui";
import { analyticsMode, gtagInitScript, gtagSrc } from "@/lib/analytics";
import { clearGaCookies, setAnalyticsChoice, useAnalyticsChoice } from "./consent";

/**
 * Google Analytics 4, sólo con consentimiento. El layout raíz lo monta si
 * `gaMeasurementId()` da un ID — ver `lib/analytics.ts` para por qué está
 * apagado por defecto y para la lista de rutas donde no se carga.
 *
 * Tres estados (`analyticsMode`): sin elección muestra el aviso y no carga nada;
 * con «Aceptar» carga `gtag.js`; con «Rechazar» no hace nada y no vuelve a
 * preguntar. Hasta que la persona acepta no sale ningún pedido a Google ni se
 * pone ninguna cookie `_ga`, que es lo que sostiene la cláusula 21.
 *
 * Es de cliente para poder leer la ruta y la elección. Un layout de servidor no
 * conoce ninguna de las dos, y averiguar la ruta con `headers()` volvería
 * dinámica cada ruta, incluidas las que hoy se prerenderizan.
 *
 * Límite: esto impide *cargar* GA desde una ruta excluida, no lo descarga. Si ya
 * cargó en una página pública y la persona navega a una excluida sin recargar,
 * sigue corriendo. Está bien para las dos razones de la lista: el token de
 * recuperación llega por un enlace de correo, y Chromium abre `/…/render` siempre
 * con una carga completa.
 *
 * `next/script` inyecta el snippet después de la hidratación y garantiza que
 * cada bloque cargue una sola vez aunque se navegue. GA4 detecta solo los
 * cambios de historial del App Router (medición mejorada), así que no hace falta
 * mandar un `page_view` por navegación.
 */
export function GoogleAnalytics({ measurementId }: { measurementId: string }) {
  const pathname = usePathname();
  const choice = useAnalyticsChoice();
  const mode = analyticsMode(choice, pathname);

  // Con «Rechazar» hay que dejar sin cookies de GA también a quien las tenía de
  // antes, y no alcanza con borrarlas al rechazar: al descargarse la página,
  // `gtag.js` reescribe `_ga_<ID>` (medido: sobrevive a la recarga). Barrerlas en
  // cada carga con la elección en «rechazado» cierra ese hueco, y cuesta una
  // lectura de `document.cookie`.
  useEffect(() => {
    if (choice === "denied") clearGaCookies();
  }, [choice]);

  if (mode === "ask") return <ConsentNotice />;
  if (mode !== "load") return null;

  return (
    <>
      <Script
        id="ga-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: gtagInitScript(measurementId) }}
      />
      <Script id="ga-src" src={gtagSrc(measurementId)} strategy="afterInteractive" />
    </>
  );
}

/**
 * El aviso. No bloquea nada y no es un diálogo: se puede seguir usando la app
 * sin contestar, y mientras tanto GA no carga. Los dos botones pesan lo mismo a
 * propósito (mismo estilo, misma altura): que rechazar cueste más clics o se vea
 * más chico es justo lo que invalida un consentimiento.
 *
 * Dice qué se mide, qué se manda y adónde, en tres renglones, y enlaza la
 * cláusula que lo detalla. El texto tiene que seguir en línea con la cláusula 21
 * de `app/legales/privacidad/page.tsx`: si una cambia, cambia la otra.
 */
function ConsentNotice() {
  return (
    <section
      aria-label="Aviso sobre analítica"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-white/15 bg-solar-bg px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-ink-2 shadow-[0_-8px_24px_rgba(0,0,0,0.4)] sm:px-8"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13.5px] leading-relaxed sm:max-w-[68ch]">
          Medimos qué páginas se visitan con Google Analytics. Si aceptás, se guardan dos
          cookies y Google (EE. UU.) recibe la dirección y el título de cada página que abrís y
          datos de tu navegador. No recibe tu perfil ni tus CVs. Si no aceptás, el sitio
          funciona igual.{" "}
          <Link
            href="/legales/privacidad#c21"
            className="underline underline-offset-4 hover:text-ink"
          >
            Más detalle
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-3">
          <Button variant="secondary" onClick={() => setAnalyticsChoice("denied")}>
            Rechazar
          </Button>
          <Button variant="secondary" onClick={() => setAnalyticsChoice("granted")}>
            Aceptar
          </Button>
        </div>
      </div>
    </section>
  );
}
