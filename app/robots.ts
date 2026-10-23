import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * Dinámico por la misma razón que `app/sitemap.ts`: la línea `Sitemap:` lleva
 * `siteUrl()`, que en el build no existe. Prerenderizado, apuntaría a
 * localhost para siempre.
 */
export const dynamic = "force-dynamic";

/**
 * Lo único que se bloquea es `/api/`. Ninguna página se bloquea acá, y es a
 * propósito: un `Disallow` impide rastrear la URL, y una URL que no se rastrea
 * nunca deja leer su `<meta name="robots" content="noindex">`, así que puede
 * aparecer igual en los resultados como dirección pelada. Las páginas que no
 * deben indexarse —`(app)`, `/cv`, `/prep`, `/video`— llevan `noindex` (ver
 * `NO_INDEX` en `lib/site.ts`) y necesitan seguir siendo rastreables para que se
 * lea. `tests/seo.test.ts` afirma justamente eso: que este archivo NO las
 * bloquee. Tampoco se bloquea `/_next/`, porque Google necesita el JS y el CSS
 * para renderizar.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
