import type { ImportedJobFields } from "./jsonld";
import { normalizeEmploymentType, stripHtml } from "./text-html";
import { extractElementByAttr, sliceElement } from "./site-rules/html";

/**
 * Segunda capa de `extractJobPosting`, entre el JSON-LD y las reglas de
 * sitio — para sitios que anotan el aviso con microdata schema.org
 * (`itemprop`/`itemscope`) en vez de (o adicionalmente a) JSON-LD. Es el
 * mismo vocabulario que ya lee `mapJobPosting` para JSON-LD, sólo que
 * expresado en atributos HTML — cubre cualquier sitio que lo use, no sólo
 * el que lo destapó (Get on Board), sin sumar una regla por sitio.
 *
 * No exige un `itemscope`/`itemtype` de nivel superior para `JobPosting`:
 * alcanza con que los `itemprop` sueltos estén — algunos sitios (Get on
 * Board) marcan los campos sin declarar el tipo contenedor.
 */

function findItemPropText(html: string, prop: string): string | null {
  const el = extractElementByAttr(html, "itemprop", prop);
  return el ? stripHtml(el) : null;
}

/** El contenido de un `itemprop` anidado dentro de otro (p. ej. `name`
 *  adentro de `hiringOrganization`) — balancea el contenedor primero para no
 *  agarrar el `itemprop` de otra parte de la página. */
function findNestedItemPropText(html: string, containerProp: string, nestedProp: string): string | null {
  const container = extractElementByAttr(html, "itemprop", containerProp);
  if (!container) return null;
  return findItemPropText(container, nestedProp);
}

function findItemPropAttr(html: string, prop: string, attr: string): string | null {
  const re = new RegExp(`<(\\w+)[^>]*\\bitemprop="${prop}"[^>]*>`, "i");
  const match = re.exec(html);
  if (!match) return null;
  const openTag = match[0];
  const attrMatch = openTag.match(new RegExp(`\\b${attr}="([^"]*)"`, "i"));
  return attrMatch ? attrMatch[1] : null;
}

export function extractMicrodata(html: string, url?: string): ImportedJobFields | null {
  const jobTitle = findItemPropText(html, "title");
  // Sin título no vale la pena tratar de mapear el resto — que caiga a la
  // regla de sitio o al fallback genérico.
  if (!jobTitle) return null;

  const company = findNestedItemPropText(html, "hiringOrganization", "name") ?? "";

  const locationScopeMatch = /<(\w+)[^>]*\bitemprop="jobLocation"[^>]*>/i.exec(html);
  let location = "";
  let remote: boolean | null = null;
  if (locationScopeMatch) {
    const locationScope = sliceElement(html, locationScopeMatch.index, locationScopeMatch[1]);
    const locality = findItemPropText(locationScope, "addressLocality");
    const region = findItemPropText(locationScope, "addressRegion");
    if (locality || region) {
      location = [locality, region].filter(Boolean).join(", ");
    } else {
      // Muchos sitios envuelven sólo el texto visible ("Remote") sin
      // desglosarlo en addressLocality/addressRegion — a diferencia del
      // JSON-LD (pensado para máquinas), la microdata la escribe a mano
      // quien arma la página, y no siempre completa el detalle fino.
      location = stripHtml(locationScope).slice(0, 100);
    }
    remote = /remote|teletrabajo|home office/i.test(location) ? true : null;
  }

  const description = findItemPropText(html, "description") ?? "";
  const employmentTypeRaw = findItemPropText(html, "employmentType");
  const datePosted =
    findItemPropAttr(html, "datePosted", "datetime")?.slice(0, 10) ?? findItemPropText(html, "datePosted");

  // `itemprop="url"` es la URL propia del recurso en el vocabulario
  // schema.org — cuando el sitio la declara (un <link> o <a>), es más
  // confiable que reconstruir la URL a mano.
  const urlHref = findItemPropAttr(html, "url", "href");
  let domJobUrl: string | undefined;
  if (urlHref && url) {
    try {
      domJobUrl = new URL(urlHref, url).toString();
    } catch {
      // URL rota — se ignora, extractJobPosting sigue con la de la pestaña.
    }
  }

  return {
    jobTitle,
    company,
    location,
    remote,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    jdText: description,
    jsonld: null,
    employmentType: employmentTypeRaw ? normalizeEmploymentType(employmentTypeRaw) : null,
    datePosted: datePosted ?? null,
    validThrough: null,
    fromFallback: false,
    extractedFrom: "microdata",
    domJobUrl,
  };
}
