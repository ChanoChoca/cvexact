import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { AnalyticsPreferences } from "@/components/analytics/AnalyticsPreferences";
import { Pending } from "@/components/legal/Pending";
import { ProfileNavCta } from "@/components/landing/ProfileNavCta";
import { chamfer } from "@/components/ui/chamfer";
import { gaMeasurementId } from "@/lib/analytics";
import { operator } from "@/lib/legal/operator";
import { salesEnabled } from "@/lib/payments/sales";
import { sourceUrl } from "@/lib/site";

/**
 * The public pages' own primitives — `/precios`, `/apoyar`, `/baja`,
 * `/arrepentimiento`, `/legales/*`.
 *
 * Kept separate from `components/ui`, which now shares the same Solar tokens
 * but is shaped for form-heavy app screens (labelled fields, ruled rows) that
 * these pages have no use for. A server component with no client-side state,
 * so the two stay separate layers rather than one that has to serve both.
 */

/** The one micro-label style both identities share. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
      {children}
    </p>
  );
}

/**
 * A full-height section. `min-h-dvh` rather than `h-screen`: the brief asks for
 * 100vh, but on a phone three stacked cards are taller than the viewport and a
 * fixed height would crop them. `dvh` also absorbs the mobile browser bar.
 */
export function Section({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`flex min-h-dvh scroll-mt-[var(--nav-h)] flex-col justify-center px-6 py-24 sm:px-10 ${className ?? ""}`}
    >
      <div className="mx-auto w-full max-w-[1180px]">{children}</div>
    </section>
  );
}

const CTA_BASE =
  "inline-flex items-center justify-center font-solar font-bold uppercase transition-colors motion-reduce:transition-none";

/** The same white-fill, violet-on-hover button as `NavCta` — this is the
 *  moderate-prominence CTA that sits next to body copy (a plan, the footer's
 *  arrepentimiento button), not the big hero/final `Cta`
 *  (`components/landing/solar/Cta.tsx`), which is filled violet always and
 *  carries its own sliding marquee line. Chamfered like every other button in
 *  the system (`chamfer`, `components/ui`). */
export function Cta({
  href,
  children,
  size = "md",
}: {
  href: Route;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const scale =
    size === "lg"
      ? "px-9 py-4 text-base tracking-[0.2em]"
      : size === "sm"
        ? "px-4 py-2 text-[13px] tracking-[0.16em]"
        : "px-6 py-3 text-sm tracking-[0.18em]";
  return (
    <Link
      href={href}
      style={chamfer(size === "lg" ? 20 : 14)}
      className={`${CTA_BASE} ${scale} bg-ink text-paper hover:bg-oro`}
    >
      {children}
    </Link>
  );
}

/**
 * A card: one drawing, one sentence, nothing else. The drawing gets a fixed
 * aspect box so a row of three shares a baseline no matter how tall each
 * sentence wraps.
 */
export function Card({
  art,
  children,
}: {
  art: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-7" data-reveal>
      <div className="aspect-[10/7] w-full border border-rule bg-paper-2/60 p-6 text-ink">
        {art}
      </div>
      <p className="text-[clamp(1rem,1.55vw,1.375rem)] leading-snug text-pretty text-ink-2">
        {children}
      </p>
    </li>
  );
}

export function CardRow({ children }: { children: ReactNode }) {
  return (
    <ul className="grid gap-x-10 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </ul>
  );
}

// In-page anchors, hidden below `lg` along with the rest of the row — they
// only ever jump within the page someone is already scrolling.
const NAV_ANCHORS = [
  { href: "#como", label: "Cómo funciona" },
  { href: "#porque", label: "Por qué" },
];

/**
 * Fixed, and the only element on the page that overlaps another — unlike the
 * landing's own `sticky` nav (`components/landing/solar/parts.tsx`): these
 * pages compensate for a fixed header with `--nav-h`-based padding wherever
 * they need to (see each page's own `Section`/`pt-` call), and switching the
 * positioning scheme would mean redoing that math for no visible difference —
 * both read as "pinned while scrolling". The sweeping hairline
 * (`[data-solar-sweep]`) is a pure-CSS marquee (gradient + animation both in
 * `app/globals.css`), so this stays a server component with no JavaScript
 * shipped.
 */
export function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 h-[var(--nav-h)] border-b border-white/[0.07] bg-[rgba(1,2,12,0.72)] backdrop-blur-[22px] backdrop-saturate-[1.6]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "linear-gradient(180deg, rgba(127,102,240,0.10), rgba(1,2,12,0) 70%)",
        }}
      />
      <nav className="relative mx-auto flex h-full max-w-[1180px] items-center justify-between gap-2 px-6 sm:gap-6 sm:px-10">
        <Link href="/">
          <div className="flex h-7.5 items-center gap-[0.3em] text-[30px] leading-none sm:h-10.5 sm:text-[42px]">
            <span className="relative block h-[1em] w-[1em] shrink-0 text-[0.68em]">
              <span className="absolute left-1/2 top-1/2 h-[0.125em] w-[0.66em] -translate-x-[0.33em] -translate-y-1/2 rotate-45 bg-oro" />
              <span className="absolute left-1/2 top-1/2 h-[0.125em] w-[0.66em] -translate-x-[0.33em] -translate-y-1/2 -rotate-45 bg-oro" />

              <span className="absolute left-0 top-1/2 h-[0.05em] w-[0.15em] -translate-y-1/2 bg-oro-soft" />
              <span className="absolute right-0 top-1/2 h-[0.05em] w-[0.15em] -translate-y-1/2 bg-oro-soft" />
              <span className="absolute left-1/2 top-0 h-[0.15em] w-[0.05em] -translate-x-1/2 bg-oro-soft" />
              <span className="absolute bottom-0 left-1/2 h-[0.15em] w-[0.05em] -translate-x-1/2 bg-oro-soft" />
            </span>

            <span className="whitespace-nowrap font-semibold tracking-[-0.045em]">
              cve
              <span className="relative mx-[0.055em] inline-block h-[0.5em] w-[0.48em] align-baseline">
                <span className="absolute left-1/2 top-1/2 h-[0.086em] w-[0.63em] -translate-x-[0.315em] -translate-y-1/2 rotate-45 bg-oro" />
                <span className="absolute left-1/2 top-1/2 h-[0.086em] w-[0.63em] -translate-x-[0.315em] -translate-y-1/2 -rotate-45 bg-oro" />

                <span className="absolute left-1/2 top-[-0.15em] h-[0.1em] w-[0.038em] -translate-x-1/2 bg-oro-soft" />
                <span className="absolute bottom-[-0.15em] left-1/2 h-[0.1em] w-[0.038em] -translate-x-1/2 bg-oro-soft" />
              </span>
              act
            </span>
          </div>
        </Link>
        <div className="flex items-center gap-2 sm:gap-7">
          <div className="hidden items-center gap-7 lg:flex">
            {NAV_ANCHORS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="font-solar text-[14.5px] font-bold tracking-[0.16em] text-ink-2 uppercase transition-colors hover:text-ink motion-reduce:transition-none"
              >
                {link.label}
              </a>
            ))}
          </div>
          {/* The one destination below `sm` has to reach without the rest of
              the row: someone deciding whether to sign up needs the price
              reachable on a phone, not just from the footer. */}
          <Link
            href="/precios"
            className="font-solar text-[14.5px] font-bold tracking-[0.16em] text-ink-2 uppercase transition-colors hover:text-ink motion-reduce:transition-none"
          >
            Precios
          </Link>
          <ProfileNavCta />
        </div>
      </nav>
      <div
        aria-hidden
        className="absolute inset-x-0 -bottom-px h-px overflow-hidden"
      >
        <div
          data-solar-sweep
          className="h-full w-full"
          style={{
            background:
              "repeating-linear-gradient(90deg, transparent 0%, transparent 30%, var(--color-solar-g3) 50%, transparent 70%, transparent 100%)",
          }}
        />
      </div>
    </header>
  );
}

/**
 * Social links are left as `#` on purpose — the accounts are not defined yet,
 * and a logo pointing nowhere real is worse than one pointing at a placeholder
 * someone will grep for.
 */
type Social =
  | { label: string; href: string; path: string }
  | { label: string; href: string; src: string };

// Externo, por eso se agrega como `<a>` suelta junto al resto de la columna
// "Tu CV" en vez de sumarse a esos `<Link>` de rutas internas.
const CHROME_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/cvexact-%E2%80%94-seguimiento-de/jhpbeijafeffdechaplkdpjhfeankoak";

const SOCIALS: Social[] = [
  {
    label: "GitHub",
    href: "https://github.com/ChanoChoca",
    path: "M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .26.18.58.69.48A10 10 0 0 0 12 2Z",
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/juan-ignacio-caprioli-2a645422b",
    path: "M4.98 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM3 9h4v12H3V9Zm7 0h3.8v1.65h.05c.53-.95 1.83-1.95 3.77-1.95 4.03 0 4.78 2.5 4.78 5.76V21h-4v-5.7c0-1.36-.03-3.11-1.95-3.11-1.95 0-2.25 1.48-2.25 3.01V21h-4V9Z",
  },
  {
    label: "FlashPage",
    href: "https://flashpage.com.ar",
    src: "/website/flashpage.svg",
  },
];

/**
 * Quién presta el servicio, al pie de cada página que lleva el footer.
 *
 * Los datos salen de variables de entorno (`lib/legal/operator.ts`) y no del
 * código, así que un dato sin cargar se renderiza como «[pendiente de carga]» en
 * vez de desaparecer. Es feo a propósito: la falla que este bloque previene es
 * salir a producción sin CUIT, y un hueco silencioso no la previene.
 *
 * Por eso cada campo va envuelto en `<Pending>` en vez de interpolarse crudo:
 * antes de esto, un `[pendiente de carga]` (o el `"XXXXX"` que despliega el
 * Secret de producción sin completar) salía como el mismo texto gris que el
 * resto del pie — exactamente el hueco silencioso que este comentario dice
 * que no tiene que pasar. `Pending` vive en su propio archivo
 * (`@/components/legal/Pending`) y no en `@/components/legal/parts`, que
 * importa `Footer`/`Nav` DESDE este módulo — importarlo desde ahí habría
 * cerrado un ciclo.
 *
 * Exportada (antes privada) para que el `Footer` de
 * `components/landing/solar/parts.tsx` la reuse en vez de reimplementar qué
 * campos van, en qué orden y detrás de qué gate de `salesEnabled` — esa
 * decisión vive en un solo lugar. Ya no toma `tone`: con todo el producto en
 * un único tema no hay un pie "claro" cuyas clases distinguir de uno
 * "oscuro" — `operator()`/`salesEnabled` tampoco cambiaban con él.
 */
export function OperatorIdentity({
  containerClassName = "mx-auto max-w-[1180px]",
}: { containerClassName?: string } = {}) {
  const o = operator();
  return (
    <div className={`${containerClassName} mt-12 border-t border-rule pt-8`}>
      <p className="text-[13px] leading-relaxed text-ink-3">
        <Pending>{o.name}</Pending>
        {salesEnabled ? (
          <>
            {" · CUIT "}
            <Pending>{o.taxId}</Pending>
            {" · "}
            <Pending>{o.address}</Pending>
            {" · "}
            <Pending>{o.taxStatus}</Pending>
          </>
        ) : null}
        {" · "}
        <a
          href={`mailto:${o.email}`}
          className="underline underline-offset-4 transition-colors hover:text-ink motion-reduce:transition-none"
        >
          <Pending>{o.email}</Pending>
        </a>
      </p>
      {salesEnabled ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
          Los precios se expresan en pesos argentinos y son finales.
        </p>
      ) : null}
    </div>
  );
}

export function Footer() {
  const source = sourceUrl();
  return (
    // `bg-paper`, not `bg-paper-2` like this footer used to sit on: the
    // landing's own footer blends straight into the page (`bg-solar-bg`,
    // `components/landing/solar/parts.tsx`) rather than reading as a raised
    // panel, and is set apart only by the border and the wash below.
    <footer className="relative overflow-hidden border-t border-white/[0.07] bg-paper px-6 py-16 sm:px-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-px h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--color-solar-g4) 30%, var(--color-solar-g2) 55%, transparent)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-160px] h-[320px] w-[720px] -translate-x-1/2 opacity-40"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(127,102,240,0.16), rgba(1,2,12,0) 70%)",
        }}
      />
      <div className="relative mx-auto flex max-w-[1180px] flex-col gap-12 sm:flex-row sm:items-start sm:justify-between">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-[52px] items-center gap-[0.3em] text-[52px] leading-none">
            <span className="relative block h-[1em] w-[1em] shrink-0 text-[0.68em]">
              <span className="absolute left-1/2 top-1/2 h-[0.125em] w-[0.66em] -translate-x-[0.33em] -translate-y-1/2 rotate-45 bg-oro" />
              <span className="absolute left-1/2 top-1/2 h-[0.125em] w-[0.66em] -translate-x-[0.33em] -translate-y-1/2 -rotate-45 bg-oro" />

              <span className="absolute left-0 top-1/2 h-[0.05em] w-[0.15em] -translate-y-1/2 bg-oro-soft" />
              <span className="absolute right-0 top-1/2 h-[0.05em] w-[0.15em] -translate-y-1/2 bg-oro-soft" />
              <span className="absolute left-1/2 top-0 h-[0.15em] w-[0.05em] -translate-x-1/2 bg-oro-soft" />
              <span className="absolute bottom-0 left-1/2 h-[0.15em] w-[0.05em] -translate-x-1/2 bg-oro-soft" />
            </span>

            <span className="whitespace-nowrap font-semibold tracking-[-0.045em]">
              cve
              <span className="relative mx-[0.055em] inline-block h-[0.5em] w-[0.48em] align-baseline">
                <span className="absolute left-1/2 top-1/2 h-[0.086em] w-[0.63em] -translate-x-[0.315em] -translate-y-1/2 rotate-45 bg-oro" />
                <span className="absolute left-1/2 top-1/2 h-[0.086em] w-[0.63em] -translate-x-[0.315em] -translate-y-1/2 -rotate-45 bg-oro" />

                <span className="absolute left-1/2 top-[-0.15em] h-[0.1em] w-[0.038em] -translate-x-1/2 bg-oro-soft" />
                <span className="absolute bottom-[-0.15em] left-1/2 h-[0.1em] w-[0.038em] -translate-x-1/2 bg-oro-soft" />
              </span>
              act
            </span>
          </div>
        </Link>

        <nav className="flex flex-col gap-3">
          <Eyebrow>Tu CV</Eyebrow>
          <Link
            href="/perfil"
            className="text-sm text-ink-2 transition-colors hover:text-ink motion-reduce:transition-none"
          >
            Crear cuenta
          </Link>
          <Link
            href="/cv/demo/print"
            target="_blank"
            className="text-sm text-ink-2 transition-colors hover:text-ink motion-reduce:transition-none"
          >
            Ver un CV de ejemplo
          </Link>
          <Link
            href="/precios"
            className="text-sm text-ink-2 transition-colors hover:text-ink motion-reduce:transition-none"
          >
            Precios
          </Link>
          <Link
            href="/apoyar"
            className="text-sm text-ink-2 transition-colors hover:text-ink motion-reduce:transition-none"
          >
            Apoyar el proyecto
          </Link>
          <a
            href={CHROME_EXTENSION_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-ink-2 transition-colors hover:text-ink motion-reduce:transition-none"
          >
            Extensión de Chrome
          </a>
        </nav>

        {/*
         * La columna que faltaba, y que es la que convierte al sitio en algo que
         * puede cobrar. Sin identificación del proveedor (LDC art. 4, CCyC art.
         * 1100) ni política de privacidad (Ley 25.326 art. 6) no hay venta
         * legal posible, y hasta acá el footer linkeaba a un CV de ejemplo y a
         * tres redes sociales.
         */}
        <nav className="flex flex-col gap-3">
          <Eyebrow>Legales</Eyebrow>
          <Link
            href="/legales/terminos"
            className="text-sm text-ink-2 transition-colors hover:text-ink motion-reduce:transition-none"
          >
            Términos y condiciones
          </Link>
          <Link
            href="/legales/privacidad"
            className="text-sm text-ink-2 transition-colors hover:text-ink motion-reduce:transition-none"
          >
            Política de privacidad
          </Link>
          {source ? (
            <a
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-ink-2 transition-colors hover:text-ink motion-reduce:transition-none"
            >
              Código fuente
            </a>
          ) : null}
          {gaMeasurementId() ? (
            <AnalyticsPreferences className="text-left text-sm text-ink-2 transition-colors hover:text-ink motion-reduce:transition-none" />
          ) : null}
          {/* La baja y el botón de arrepentimiento son obligaciones que nacen
              de vender (Res. SCI 424/2020, LDC art. 34): sin venta no hay
              suscripción que dar de baja ni compra de la que arrepentirse. */}
          {salesEnabled ? (
            <>
              <Link
                href="/baja"
                className="text-sm text-ink-2 transition-colors hover:text-ink motion-reduce:transition-none"
              >
                Dar de baja
              </Link>
              {/*
               * Recuadrado y no un link más de la lista, a propósito. La Res. SCI
               * 424/2020 no pide un enlace: pide un BOTÓN, en la página de inicio,
               * «en un lugar visible y destacado». Un renglón indistinguible de los
               * otros tres cumple la letra y falla el examen.
               */}
              <Link
                href="/arrepentimiento"
                className="mt-1 inline-flex w-fit border border-oro px-3 py-2 text-sm text-ink transition-colors hover:bg-oro hover:text-paper motion-reduce:transition-none"
              >
                Botón de arrepentimiento
              </Link>
            </>
          ) : null}
        </nav>

        <div className="flex flex-col gap-3">
          <Eyebrow>Seguime</Eyebrow>
          <ul className="flex items-center gap-5">
            {SOCIALS.map((social) => (
              <li key={social.label}>
                <a
                  href={social.href}
                  aria-label={social.label}
                  className="block text-ink-3 transition-colors hover:text-ink motion-reduce:transition-none"
                >
                  {"path" in social ? (
                    <svg
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="size-5"
                      aria-hidden
                    >
                      <path d={social.path} />
                    </svg>
                  ) : (
                    /* Marca externa: archivo en `public/`, recortado con
                       `mask-image` para heredar `currentColor` (ver el comentario
                       en `SOCIALS`). */
                    <span
                      aria-hidden
                      className="block size-5 bg-current"
                      style={{
                        maskImage: `url(${social.src})`,
                        maskPosition: "center",
                        maskRepeat: "no-repeat",
                        maskSize: "contain",
                        WebkitMaskImage: `url(${social.src})`,
                        WebkitMaskPosition: "center",
                        WebkitMaskRepeat: "no-repeat",
                        WebkitMaskSize: "contain",
                      }}
                    />
                  )}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <OperatorIdentity />
    </footer>
  );
}
