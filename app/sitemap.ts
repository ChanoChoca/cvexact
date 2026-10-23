import type { MetadataRoute } from "next";
import { salesEnabled } from "@/lib/payments/sales";
import { absoluteUrl } from "@/lib/site";

/**
 * Dinámico, no prerenderizado. Depende de dos cosas del entorno que no existen
 * durante el build (`.dockerignore` excluye `.env`): `NEXT_PUBLIC_SITE_URL` y
 * `salesEnabled`. Prerenderizado, el sitemap saldría del build con localhost y
 * sin las dos páginas de venta, y ningún reinicio lo corregiría: es el mismo
 * mecanismo que documenta `scripts/verify-build-legal.mjs`.
 */
export const dynamic = "force-dynamic";

/**
 * Sólo lo público e indexable. Quedan afuera, a propósito, las seis páginas de
 * `(app)`, `/cv`, `/prep`, `/video` y `/api`: llevan `noindex` (ver `NO_INDEX` en
 * `lib/site.ts`) o directamente no son páginas. `tests/seo.test.ts` fija este
 * conjunto entero, así que sumar una ruta exige tocar el test.
 */
const PUBLIC_PATHS = [
  "/",
  "/precios",
  "/apoyar",
  "/legales/privacidad",
  "/legales/terminos",
];

/**
 * Responden 404 cuando `salesEnabled` es falso (ver esas dos páginas), y un 404
 * en el sitemap es una URL enviada que no existe: Search Console lo reporta como
 * error. Se listan sólo si el flag está encendido, que es lo mismo que decide si
 * las páginas existen. Ambas leen el mismo `salesEnabled` y son `force-dynamic`,
 * de modo que no hay una copia horneada en el build que discrepe.
 */
const SALES_PATHS = ["/arrepentimiento", "/baja"];

/**
 * Sin `lastModified`, `changeFrequency` ni `priority`. Google ignora los dos
 * últimos, y usa `lastModified` sólo si es consistentemente cierto; en una ruta
 * dinámica `new Date()` diría «modificada ahora» en cada consulta, que es falso,
 * y llevar una fecha a mano por URL no se paga. Inventar un valor es peor que
 * omitirlo, y los tres campos son opcionales.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = salesEnabled ? [...PUBLIC_PATHS, ...SALES_PATHS] : PUBLIC_PATHS;
  return paths.map((path) => ({ url: absoluteUrl(path) }));
}
