import type { Metadata } from "next";
import { Barlow_Semi_Condensed, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialog";
import { CopyPasswordProvider } from "@/components/storage/CopyPassword";
import { GoogleAnalytics } from "@/components/analytics/GoogleAnalytics";
import { gaMeasurementId } from "@/lib/analytics";
import { siteUrl } from "@/lib/site";

/**
 * Declared on <html> as a variable rather than as a className so nothing
 * inherits a family it did not ask for: the CV and the interview prep set
 * their own `font-family` in their stylesheets and must keep rendering in
 * STIX whatever the app is wearing.
 *
 * Archivo used to load here too, for `--font-podio`/`font-podio` — the whole
 * app's body text, back when the app's identity ("Podio") was its own,
 * separate from the landing's ("Solar"). Now that the product is rethemed to
 * match the landing, `--font-podio` (`app/globals.css`) aliases the plain
 * system sans stack instead, and nothing renders in Archivo any more — so it
 * no longer loads here. `font-podio` itself is untouched and still used
 * everywhere: only the font *file* it used to pull in is gone.
 */

/** The wide-tracked micro-label the app uses throughout. */
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["300", "400"],
  variable: "--font-plex-mono",
  display: "swap",
});

/**
 * Chrome text across the whole app now — nav, buttons, labels, eyebrows
 * (`font-solar`, `app/globals.css`) — not just the landing's own tree
 * (`components/landing/solar/`) as it was before the retheme.
 */
const barlow = Barlow_Semi_Condensed({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-barlow",
  display: "swap",
});

/*
 * Terminaba en "Nunca inventa datos que no estén en tu perfil" — una garantía
 * absoluta sobre un sistema probabilístico, que el propio repo desmiente: ver el
 * comentario de cabecera de `lib/ai/practical.ts`, donde 4 de 5 postulaciones
 * medidas declararon una disponibilidad que el perfil nunca dijo. La oferta
 * integra el contrato (LDC art. 8), así que esa frase era exigible.
 *
 * El reemplazo describe lo que el producto sí hace y puede probar —
 * `lib/ai/verify.ts` y `lib/ai/evidence.ts`— y es mejor argumento de venta que
 * la promesa que no se puede cumplir.
 */
const DESCRIPTION =
  "Cargás tu perfil una vez y cvexact adapta tu CV a cada aviso: el CV, las respuestas del formulario, el email de presentación y la entrevista preparada. Verifica cada dato contra tu perfil y te marca lo que no puede respaldar.";

/*
 * Lo global vive acá; cada página sólo pone lo suyo (`title`, `description`).
 *
 * `"./"` en `canonical` y en `og:url` no es un descuido: Next lo resuelve contra
 * la ruta de cada página (`resolveRelativeUrl`), así que una sola línea en el
 * layout raíz da un canonical autorreferente correcto en todas — y sin la
 * query, por lo que `/postular?desde=x` canonicaliza a `/postular`. Un `"/"`
 * literal, que es lo que muestra el ejemplo de la documentación, estamparía la
 * home como canonical de todo el sitio. Para `/` sale `https://cvexact.com`, sin
 * barra final.
 *
 * `openGraph` no lleva `title` ni `description` a propósito: sin ellos Next usa
 * los del `metadata` de cada página (`inheritFromMetadata`), con el template
 * ya aplicado. Fijos acá, todas las páginas se compartían como «cvexact» y le
 * pisaban el título a cada una. `twitter` tampoco se declara: Next lo arma
 * desde `openGraph`.
 *
 * Trampa: los metadatos se fusionan por clave de primer nivel, no en
 * profundidad. Una página que exporte su propio `openGraph` reemplaza este
 * bloque entero y pierde `url`, `locale` y `siteName`. Hoy ninguna lo hace.
 *
 * Otra trampa, del mismo tipo que las de `scripts/verify-build-legal.mjs`: una
 * ruta prerenderizada hornea el canonical y el `og:url` con lo que
 * `NEXT_PUBLIC_SITE_URL` valga en el build, o sea `http://localhost:3000`. Hoy
 * sólo lo están las que no se indexan (`/cv/render`, `/prep/render`,
 * `/video/render`, el 404), y toda página indexable es `force-dynamic`. Al
 * agregar una que se indexe, mantenerla dinámica.
 *
 * `robots` no se declara acá: el default es indexar. La negación va por
 * segmento — `app/(app)/layout.tsx`, `app/{cv,prep,video}/layout.tsx` — y no en
 * `app/robots.ts`, porque un `Disallow` impediría rastrear la página y con eso
 * su `noindex` no se leería nunca.
 *
 * Íconos: los tres tamaños de la marca vigente. Se declaran acá y no con la
 * convención `app/icon.svg` porque ésta admite un solo SVG por segmento, y el de
 * 48 no es una versión escalada de los otros: agrega las marcas de mira, que a
 * 16 px sólo ensucian.
 *
 * `public/favicon-*.svg` es el mismo dibujo que `public/logo-*.svg` con el
 * `viewBox` recortado al símbolo. Los logos llevan aire alrededor (la X ocupa
 * 50 %, 44 % y 67 % del lienzo), que en una marca es margen y en una pestaña es
 * un ícono chico. Si cambia el dibujo de la marca, cambia en los dos juegos, y
 * hay que regenerar `app/favicon.ico` desde los `favicon-*.svg`.
 *
 * `apple` va acá aunque exista `app/apple-icon.png`: en cuanto el layout declara
 * `icons`, Next descarta los íconos por convención de archivo y no emite su
 * `<link>` (`resolve-metadata.js`, `if (!resolvedMetadata.icons)`). El archivo
 * se sirve igual; sin esta línea, sencillamente nadie lo enlaza. Lo mismo
 * valdría para un `app/icon.*`. `app/favicon.ico` no se ve afectado.
 *
 * Sin imagen OG todavía: falta un PNG de 1200×630 (los scrapers de redes no
 * leen SVG). Con `app/opengraph-image.png` se cablea solo, sin tocar este
 * archivo.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "cvexact",
    template: "%s — cvexact",
  },
  description: DESCRIPTION,
  alternates: { canonical: "./" },
  icons: {
    icon: [
      { url: "/favicon-16.svg", sizes: "16x16", type: "image/svg+xml" },
      { url: "/favicon-32.svg", sizes: "32x32", type: "image/svg+xml" },
      { url: "/favicon-48.svg", sizes: "48x48", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "es_AR",
    siteName: "cvexact",
    url: "./",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Apagado salvo que exista GA_MEASUREMENT_ID (`lib/analytics.ts` dice por qué).
  // Se lee acá, en cada render, y no en un const de módulo: en el build no hay
  // entorno. Las rutas prerenderizadas (`/cv/render`…) salen sin GA por eso
  // mismo, y de todos modos el componente las excluye por ruta.
  const gaId = gaMeasurementId();

  return (
    <html lang="es" className={`h-full antialiased ${plexMono.variable} ${barlow.variable}`}>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ToastProvider>
          <ConfirmDialogProvider>
            <CopyPasswordProvider>{children}</CopyPasswordProvider>
          </ConfirmDialogProvider>
        </ToastProvider>
        {gaId && <GoogleAnalytics measurementId={gaId} />}
      </body>
    </html>
  );
}
