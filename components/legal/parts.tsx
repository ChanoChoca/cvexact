import Link from "next/link";
import type { ReactNode } from "react";
import { AnalyticsPreferences } from "@/components/analytics/AnalyticsPreferences";
import { Footer, Nav } from "@/components/landing/parts";
import { gaMeasurementId } from "@/lib/analytics";
import { LEGAL_EFFECTIVE_DATE, LEGAL_VERSION, operator } from "@/lib/legal/operator";
import { salesEnabled } from "@/lib/payments/sales";
import { sourceUrl } from "@/lib/site";
import { Pending } from "./Pending";

export { Pending };

/**
 * El armazón de un documento legal.
 *
 * Comparte `Nav` y `Footer` con la landing —es el mismo sitio y sería raro que
 * no lo pareciera— pero no usa `Section`, que es `min-h-dvh`: una cláusula de
 * dos líneas no ocupa una pantalla, y un texto legal se lee de corrido, no se
 * scrollea de a saltos.
 *
 * El ancho es `65ch` y no el `1180px` de la landing. Un párrafo de términos y
 * condiciones a lo ancho de la pantalla es ilegible, y "lo escribieron para que
 * no se lea" es una acusación que un texto de adhesión no se puede permitir:
 * el art. 985 del CCyC exige que las cláusulas generales sean comprensibles y
 * autosuficientes, y la legibilidad es parte de eso.
 */
export function LegalDoc({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="[--nav-h:4.5rem] font-podio font-normal text-ink">
      <Nav />
      <main className="px-6 pt-[calc(var(--nav-h)+4rem)] pb-24 sm:px-10">
        <article className="mx-auto w-full max-w-[65ch]">
          <h1 className="text-[clamp(2rem,5vw,3.25rem)] leading-[1.02] font-normal tracking-[-0.025em] text-balance">
            {title}
          </h1>

          <p className="mt-6 font-mono text-[11px] tracking-[0.18em] text-ink-3 uppercase">
            Vigente desde el {LEGAL_EFFECTIVE_DATE} · versión {LEGAL_VERSION}
          </p>

          {intro ? (
            <div className="mt-8 border-l-2 border-oro-soft pl-5 text-[15px] leading-relaxed text-ink-2">
              {intro}
            </div>
          ) : null}

          <div className="mt-12 space-y-10">{children}</div>
        </article>
      </main>
      <Footer />
    </div>
  );
}

/**
 * Una cláusula numerada.
 *
 * El número es parte del contenido y no una lista automática, porque estos
 * textos se citan: "la cláusula 7" tiene que seguir siendo la cláusula 7 después
 * de que alguien intercale una nueva, y por eso conviene que renumerar sea un
 * acto deliberado y no un efecto de haber movido un bloque.
 */
export function Clause({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={`c${n}`} className="scroll-mt-[calc(var(--nav-h)+1rem)]">
      <h2 className="text-[17px] leading-snug text-ink">
        <span className="mr-2.5 font-mono text-[13px] text-ink-3">{n}.</span>
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

/** Una lista dentro de una cláusula. */
export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2.5">
          <span aria-hidden className="mt-[0.55em] size-1 shrink-0 bg-oro-soft" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * El pie legal del área logueada.
 *
 * `AppShell` es un componente de cliente que persiste entre navegaciones, y
 * `operator()` lee `process.env` a propósito sin `server-only` — ver el
 * comentario de cabecera en `lib/legal/operator.ts`. Renderizar este bloque
 * DENTRO de `AppShell` reejecutaría `operator()` en el navegador en cada
 * hidratación, donde las variables leen `undefined`, y produciría un
 * mismatch: el HTML del servidor mostraría el CUIT real y React lo
 * reemplazaría por «[pendiente de carga]» apenas hidrata.
 *
 * Por eso este componente vive afuera, se resuelve en `AppLayout` —un
 * Server Component— y entra a `AppShell` ya renderizado, como children: React
 * no vuelve a ejecutar un árbol de servidor ya resuelto, así que el valor que
 * ve alguien logueado es el mismo que ve alguien en `/legales`.
 *
 * Antes de esto, `/perfil`, `/postular`, `/ajustes` y `/postulaciones` no
 * tenían ningún camino a la política de privacidad ni a los términos desde la
 * interfaz: sólo estaban en el `Footer` de las páginas públicas.
 */
/** A link of the footer, under a finger as tall as a button: the line it is on is 21px, which is too little to hit. */
const FOOTER_LINK = "underline underline-offset-4 hover:text-ink pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center";

export function AppFooter() {
  const o = operator();
  const source = sourceUrl();
  // Lo que `AppShell` deja fuera de la pestaña principal (`data-main-tab-only`; el pie no sabe de rutas, y no debe): los tres
  // enlaces y la línea del operador. Si no queda nada más —ni la analítica, ni la baja, ni el código fuente—, el pie entero,
  // para no dejar la raya sola.
  const nothingElse = !gaMeasurementId() && !salesEnabled && !source;
  return (
    <footer className="mt-16 border-t border-rule pt-6 text-[13px] leading-relaxed text-ink-3" data-main-tab-only={nothingElse ? true : undefined}>
      <nav className="flex flex-wrap gap-x-5 gap-y-2">
        <Link href="/legales/terminos" className={FOOTER_LINK} data-main-tab-only>
          Términos y condiciones
        </Link>
        <Link href="/legales/privacidad" className={FOOTER_LINK} data-main-tab-only>
          Política de privacidad
        </Link>
        {source ? (
          <a href={source} target="_blank" rel="noopener noreferrer" className={FOOTER_LINK} data-main-tab-only>
            Código fuente
          </a>
        ) : null}
        {gaMeasurementId() ? (
          <AnalyticsPreferences className={FOOTER_LINK} />
        ) : null}
        <Link href="/apoyar" className={FOOTER_LINK} data-main-tab-only>
          Apoyar el proyecto
        </Link>
        {/* La baja y el botón de arrepentimiento son obligaciones que nacen de
            vender (Res. SCI 424/2020, LDC art. 34); sin venta no hay nada que
            dar de baja ni de qué arrepentirse. */}
        {salesEnabled ? (
          <>
            <Link href="/baja" className={FOOTER_LINK}>
              Dar de baja
            </Link>
            <Link href="/arrepentimiento" className={FOOTER_LINK}>
              Botón de arrepentimiento
            </Link>
          </>
        ) : null}
      </nav>
      <p className="mt-3" data-main-tab-only>
        <Pending>{o.name}</Pending>
        {salesEnabled ? (
          <>
            {" "}
            · CUIT <Pending>{o.taxId}</Pending>
          </>
        ) : null}
      </p>
    </footer>
  );
}
