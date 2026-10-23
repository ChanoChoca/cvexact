import Link from "next/link";
import type { Route } from "next";
import { AnalyticsPreferences } from "@/components/analytics/AnalyticsPreferences";
import { OperatorIdentity } from "@/components/landing/parts";
import { ProfileNavCta } from "@/components/landing/ProfileNavCta";
import { MenuGlyph } from "@/components/ui";
import { gaMeasurementId } from "@/lib/analytics";
import { salesEnabled } from "@/lib/payments/sales";
import { sourceUrl } from "@/lib/site";

/**
 * The "Solar" landing's primitives — adapted from the project's own design
 * reference (`CVExact hero design/cvexact Landing.dc.html`), used only by
 * `app/page.tsx`. Separate from `@/components/landing/parts`, which
 * `/precios`, `/apoyar`, `/baja`, `/arrepentimiento` and `/legales/*` still
 * import — those pages keep their own (now equally Solar-styled, but
 * `fixed` rather than `sticky`) Nav/Footer, so this file's `Section`-driven,
 * anchor-scrolling layout stays specific to `/`.
 *
 * All Server Components (no `"use client"`): `Footer` renders
 * `OperatorIdentity`, which reads the operator's identity from
 * `process.env` at request time (`lib/legal/operator.ts`) — that has to
 * stay server-side, or the legal footer would render "[pendiente de
 * carga]" for every visitor, forever, including in production. The real
 * design's hover states (`style-hover`, a design-tool-only attribute)
 * become real `:hover` Tailwind classes below, which need no client JS.
 * The one thing that does — `Cta`'s sliding marquee line — lives in its own
 * client file, `./Cta.tsx`, for exactly that reason.
 */

/** The floor shadow under every floating visual — one shape, four sizings. */
export function FloorShadow({
  inset,
  bottom,
  height,
  blur,
}: {
  inset: number;
  bottom: number;
  height: number;
  blur: number;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute"
      style={{
        left: `${inset}%`,
        right: `${inset}%`,
        bottom: `${bottom}%`,
        height: `${height}%`,
        background:
          "radial-gradient(ellipse at center, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.45) 45%, rgba(0,0,0,0) 72%)",
        filter: `blur(${blur}px)`,
      }}
    />
  );
}

const NAV_LINK =
  "text-sm text-solar-muted transition-colors hover:text-solar-ink";

// "Plantillas" from the real nav has no page behind it in this app, so it's
// dropped rather than left as a dead link; "Por qué" (anchored to the
// verified-tiles section) takes its slot in the 3-item rhythm.
const NAV_ANCHORS = [
  { href: "#pasos", label: "Cómo funciona" },
  { href: "#verificado", label: "Por qué" },
];

/**
 * Sticky (not fixed, unlike Podio's Nav) — 76px, translucent + blurred, a
 * violet wash overlaid on top, and a sweeping hairline under it
 * (`[data-solar-sweep]` — gradient and animation both live in
 * `app/globals.css`). The mobile menu is this port's own addition — the
 * design reference has zero `@media` queries anywhere; built as a `<details>`
 * disclosure so it costs no JS, same as Podio's Nav.
 */
export function Nav() {
  return (
    <header className="sticky top-0 z-50 h-[76px] border-b border-white/[0.07] bg-[rgba(1,2,12,0.72)] backdrop-blur-[22px] backdrop-saturate-[1.6]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "linear-gradient(180deg, rgba(127,102,240,0.10), rgba(1,2,12,0) 70%)",
        }}
      />
      <nav className="relative mx-auto flex h-full max-w-[1340px] items-center justify-between gap-10 px-10">
        <Link href="/">
          <div className="flex h-[42px] items-center gap-[0.3em] text-[42px] leading-none">
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

        <div className="hidden items-center gap-[38px] lg:flex">
          {NAV_ANCHORS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`font-solar text-[14.5px] font-bold tracking-[0.16em] uppercase ${NAV_LINK}`}
            >
              {link.label}
            </a>
          ))}
          <Link
            href="/precios"
            className={`font-solar text-[14.5px] font-bold tracking-[0.16em] uppercase ${NAV_LINK}`}
          >
            Precios
          </Link>
        </div>

        <div className="hidden items-center gap-[22px] lg:flex">
          <ProfileNavCta />
        </div>

        <details className="lg:hidden">
          <summary
            aria-label="Abrir menú"
            className="flex cursor-pointer list-none items-center p-2 text-solar-ink marker:hidden [&::-webkit-details-marker]:hidden"
          >
            <MenuGlyph />
          </summary>
          <div className="fixed inset-x-0 top-19 flex flex-col gap-4 border-b border-white/10 bg-solar-bg px-6 py-6 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
            {NAV_ANCHORS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={`font-solar text-[14.5px] font-bold tracking-[0.16em] uppercase ${NAV_LINK}`}
              >
                {link.label}
              </a>
            ))}
            <Link
              href="/precios"
              className={`font-solar text-[14.5px] font-bold tracking-[0.16em] uppercase ${NAV_LINK}`}
            >
              Precios
            </Link>
            <ProfileNavCta />
          </div>
        </details>
      </nav>
      {/* The gradient + marquee animation are both `[data-solar-sweep]`'s
          job in `app/globals.css` — this div only marks the spot. */}
      <div aria-hidden className="absolute inset-x-0 -bottom-px h-px overflow-hidden">
        <div data-solar-sweep />
      </div>
    </header>
  );
}

type Social =
  | { label: string; href: string; path: string }
  | { label: string; href: string; src: string };

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

// The real footer's "Recursos" (Guías/Ayuda/Estado) and "Compañía" (Sobre
// nosotros/Contacto/Empleo) columns have no pages behind them in this app —
// kept here is only what's real, matching Podio's footer content.
const PRODUCT_LINKS: Array<{ href: Route; label: string }> = [
  { href: "/perfil", label: "Crear cuenta" },
  { href: "/precios", label: "Precios" },
  { href: "/apoyar", label: "Apoyar el proyecto" },
];

// Externo, por eso no vive en `PRODUCT_LINKS` (tipado a rutas internas
// `Route`) — mismo motivo que separa `SOCIALS` de esa lista más abajo.
const CHROME_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/cvexact-%E2%80%94-seguimiento-de/jhpbeijafeffdechaplkdpjhfeankoak";

const FOOTER_LINK =
  "text-sm text-solar-muted transition-colors hover:text-solar-ink";
const FOOTER_LABEL =
  "font-solar text-[12.5px] font-bold tracking-[0.18em] text-solar-label uppercase";

export function Footer() {
  const source = sourceUrl();
  return (
    <footer className="relative overflow-hidden border-t border-white/[0.07] bg-solar-bg">
      <div
        aria-hidden
        className="absolute inset-x-0 -top-px h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--color-solar-g4) 30%, var(--color-solar-g2) 55%, transparent)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-220px] h-[400px] w-[900px] -translate-x-1/2 opacity-55"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(127,102,240,0.16), rgba(1,2,12,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "92px 100%",
          maskImage: "linear-gradient(180deg, #000, transparent 80%)",
          WebkitMaskImage: "linear-gradient(180deg, #000, transparent 80%)",
        }}
      />

      <div className="relative mx-auto grid max-w-[1340px] grid-cols-1 gap-14 px-10 pt-[68px] pb-8 sm:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="flex flex-col items-start gap-[18px]">
          <Link href="/">
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
          <p className="max-w-[260px] text-sm leading-relaxed text-solar-muted-2">
            Un CV exacto para cada oferta, generado en segundos.
          </p>
        </div>

        <nav className="flex flex-col gap-[14px]">
          <span className={FOOTER_LABEL}>Producto</span>
          {PRODUCT_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={FOOTER_LINK}>
              {link.label}
            </Link>
          ))}
          <Link href="/cv/demo/print" target="_blank" className={FOOTER_LINK}>
            Ver un CV de ejemplo
          </Link>
          <a href={CHROME_EXTENSION_URL} target="_blank" rel="noopener noreferrer" className={FOOTER_LINK}>
            Extensión de Chrome
          </a>
        </nav>

        <nav className="flex flex-col gap-[14px]">
          <span className={FOOTER_LABEL}>Legales</span>
          <Link href="/legales/terminos" className={FOOTER_LINK}>
            Términos y condiciones
          </Link>
          <Link href="/legales/privacidad" className={FOOTER_LINK}>
            Política de privacidad
          </Link>
          {source ? (
            <a href={source} target="_blank" rel="noopener noreferrer" className={FOOTER_LINK}>
              Código fuente
            </a>
          ) : null}
          {gaMeasurementId() ? (
            <AnalyticsPreferences className={`${FOOTER_LINK} text-left`} />
          ) : null}
          {salesEnabled ? (
            <>
              <Link href="/baja" className={FOOTER_LINK}>
                Dar de baja
              </Link>
              {/* Boxed button, not a plain link — Res. SCI 424/2020 requires
                  a literal button "en un lugar visible y destacado". */}
              <Link
                href="/arrepentimiento"
                className="mt-1 inline-flex w-fit border border-solar-g4 px-3 py-2 text-sm text-solar-ink transition-colors hover:bg-solar-g4"
              >
                Botón de arrepentimiento
              </Link>
            </>
          ) : null}
        </nav>

        <div className="flex flex-col gap-[14px]">
          <span className={FOOTER_LABEL}>Seguime</span>
          <ul className="flex items-center gap-5">
            {SOCIALS.map((social) => (
              <li key={social.label}>
                <a
                  href={social.href}
                  aria-label={social.label}
                  className="block text-solar-muted transition-colors hover:text-solar-ink"
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

      <OperatorIdentity containerClassName="relative mx-auto max-w-[1340px] px-10 pb-12" />
    </footer>
  );
}
