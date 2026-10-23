/**
 * La URL pública del sitio: de acá salen `metadataBase` (`app/layout.tsx`), las
 * URL de `app/sitemap.ts` y la línea `Sitemap:` de `app/robots.ts`.
 *
 * Son funciones y no un `const` de módulo, a propósito. Un const se evalúa al
 * importar, y las rutas prerenderizadas se importan en el build, donde no existe
 * ninguna variable de entorno (`.dockerignore` excluye `.env`): para variables
 * de servidor quedaría grabado `http://localhost:3000` para siempre, mismo
 * mecanismo que documenta `scripts/verify-build-legal.mjs`.
 *
 * Las variables `NEXT_PUBLIC_*` son otra historia: Next las reemplaza
 * literalmente en el bundle durante `next build`, aunque se lean dentro de una
 * función y la ruta sea `force-dynamic`. `sourceUrl()` y `NEXT_PUBLIC_SITE_URL`
 * quedan fijadas por el build; definilas antes de compilar (el valor del pod no
 * las cambia). Ver `docs/PUBLISHING.md` y `scripts/verify-public-source.mjs`.
 *
 * Sin `server-only`, igual que `lib/payments/sales.ts`: no protege nada y
 * volvería el módulo imposible de importar desde los tests.
 *
 * El fallback a localhost existe para desarrollo, pero es también la falla
 * silenciosa a vigilar: si el Secret pierde `NEXT_PUBLIC_SITE_URL`, el
 * sitemap sigue respondiendo 200 con URLs de localhost. Nada en el build lo
 * atrapa, así que hay que mirar el pod real antes de mandar el sitemap a
 * Search Console.
 *
 * Fuera de alcance de esta pasada, pero deberían migrar acá:
 * `app/api/tracker/cron/route.ts` y `app/api/jobs/alerts/send/route.ts`, que
 * repiten cada uno su propio `process.env.NEXT_PUBLIC_SITE_URL ?? ...`.
 */

import type { Metadata } from "next";

const FALLBACK = "http://localhost:3000";

/**
 * El origen público, sin barra final (si la trajera, `${siteUrl()}/sitemap.xml`
 * saldría `//sitemap.xml`). Una variable vacía cuenta como ausente: `.env.example`
 * la trae en blanco, y `new URL("")` tiraría abajo el layout raíz entero.
 */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  return raw || FALLBACK;
}

/**
 * `path` resuelto contra `siteUrl()`. La raíz sale sin barra final
 * (`https://cvexact.com`) porque así es como Next resuelve el canonical de `/`
 * (`resolveAbsoluteUrlWithPathname` devuelve `URL.origin`): que el sitemap y el
 * canonical de cada página digan lo mismo evita una discrepancia gratuita.
 */
export function absoluteUrl(path: string): string {
  const base = siteUrl();
  if (path === "" || path === "/") return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * URL del código fuente de la versión desplegada, para el enlace «Código
 * fuente» del pie (AGPL §13). Es `null` cuando no está configurada o no es una
 * URL http(s) válida: un enlace vacío o roto es peor que no ofrecerlo.
 *
 * En producción tiene que apuntar al tag o commit que efectivamente corre, no
 * a la rama de desarrollo. `NEXT_PUBLIC_SOURCE_URL` es una variable
 * `NEXT_PUBLIC_*`: Next la inlinea en el bundle al compilar, así que esta
 * función ve el valor del build, no el del pod. Definila antes de
 * `pnpm build`/`docker build`; rotarla en el runtime no cambia el HTML y
 * obliga a reconstruir la imagen. Para verificarlo después del build:
 * `pnpm verify:publication-source`.
 */
export function sourceUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_SOURCE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * Metadatos de una zona que no debe indexarse: las seis páginas de `(app)` y las
 * rutas de impresión y render de `/cv`, `/prep` y `/video`. Cada una de esas
 * carpetas lo exporta desde su `layout.tsx`, y los metadatos se fusionan hacia
 * abajo por clave, así que un `title` propio de la página no lo pisa. Es la
 * única forma de cubrir `/cv/render` y compañía, que son componentes de cliente
 * y no pueden exportar `metadata` por su cuenta.
 *
 * Va por `<meta name="robots">` y no por un `Disallow` en `app/robots.ts` porque
 * un `Disallow` impide rastrear la URL, y una URL que no se rastrea nunca deja
 * leer su `noindex`: puede terminar en los resultados igual, como dirección
 * pelada. Estas rutas están enlazadas desde el landing («Crear mi CV», «Ver un CV de
 * ejemplo»), así que se van a descubrir. Por eso `tests/seo.test.ts` afirma que
 * robots.txt NO las bloquea — el instinto de «endurecerlo» rompe esto en silencio.
 */
export const NO_INDEX: Metadata = { robots: { index: false, follow: false } };
