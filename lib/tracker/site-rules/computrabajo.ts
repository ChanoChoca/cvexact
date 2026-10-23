import type { ImportedJobFields } from "../jsonld";
import { stripHtml } from "../text-html";
import { escapeRegExp, extractElementByAttr, extractElementByClass } from "./html";

/**
 * Computrabajo no manda JSON-LD de `JobPosting` en el listado con panel de
 * detalle abierto (sólo `ItemList` de los resultados, más `Organization` de
 * la empresa) — confirmado contra un HTML real. El panel de detalle vive en
 * `[data-offers-grid-detail-container]`, con el id de la oferta en el
 * `data-id` del mismo elemento.
 *
 * Ese HTML también trae, en otra parte de la página, una plantilla
 * Handlebars sin renderizar (`<script id="templateDetailOffer"
 * type="text/x-handlebars-template">`) con las mismas clases pero
 * `{{placeholders}}` en vez de texto — el recorte que ya hace la extensión
 * (`extension/entrypoints/popup/main.ts`) saca todos los `<script>` antes de
 * mandar el HTML acá, así que en producción nunca llega. Los selectores de
 * acá exigen el atributo con valor (`="" `) — la plantilla lo deja sin
 * `=""` — por las dudas de que algún día llegue sin pasar por la extensión
 * (el import por URL, por ejemplo).
 */

function findJobUrlById(html: string, id: string, pageUrl?: string): string | undefined {
  if (!pageUrl) return undefined;
  const re = new RegExp(`<a[^>]*\\bhref="([^"]*${escapeRegExp(id)}[^"]*)"`, "i");
  const match = re.exec(html);
  if (!match) return undefined;
  const href = match[1].replace(/#.*$/, "");
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return undefined;
  }
}

export function extractComputrabajo(html: string, pageUrl?: string): ImportedJobFields | null {
  const container = extractElementByAttr(html, "data-offers-grid-detail-container", "");
  if (!container) return null;

  const titleEl = extractElementByAttr(container, "data-offers-grid-detail-title", "");
  const jobTitle = titleEl ? stripHtml(titleEl) : "";
  if (!jobTitle) return null;

  // Dentro de `.header_detail`, empresa y ubicación son los primeros dos
  // `<p>` no vacíos, en ese orden — el primero con un `<a>` adentro es la
  // empresa (todas las apariciones vistas la envuelven en un link), el
  // siguiente sin link es la ubicación. Nunca la clase `fs16 mb15` sola: es
  // una utilidad de espaciado que se repite en cualquier parte de la página,
  // no un selector de "esto es la ubicación".
  const headerDetail = extractElementByClass(container, "header_detail");
  let company = "";
  let location = "";
  if (headerDetail) {
    for (const match of headerDetail.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
      const inner = match[1];
      const text = stripHtml(inner);
      if (!text) continue;
      const hasLink = /<a[\s>]/i.test(inner);
      if (hasLink && !company) {
        company = text;
      } else if (!hasLink && !location) {
        location = text;
      }
      if (company && location) break;
    }
  }

  const descriptionEl = extractElementByClass(container, "description_offer");
  const jdText = descriptionEl ? stripHtml(descriptionEl) : "";

  const idMatch = /\bdata-id="([^"]+)"/i.exec(container.slice(0, container.indexOf(">") + 1));
  const domJobUrl = idMatch ? findJobUrlById(html, idMatch[1], pageUrl) : undefined;

  return {
    jobTitle,
    company,
    location,
    remote: /remoto|remote|teletrabajo/i.test(location) ? true : null,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    jdText,
    jsonld: null,
    employmentType: null,
    datePosted: null,
    validThrough: null,
    fromFallback: false,
    extractedFrom: "site",
    domJobUrl,
  };
}
