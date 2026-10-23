import type { ImportedJobFields } from "../jsonld";
import { stripHtml } from "../text-html";
import { extractElementByAttr } from "./html";

/**
 * Indeed no manda JSON-LD de `JobPosting` en la página de búsqueda con el
 * panel de detalle abierto (sólo `WebSite`/`SearchAction`) — confirmado
 * contra un HTML real. Los `data-testid` sí son estables: son atributos de
 * testing, pensados para no cambiar entre deploys de ellos, a diferencia de
 * las clases CSS.
 */
export function extractIndeed(html: string): ImportedJobFields | null {
  const titleEl = extractElementByAttr(html, "data-testid", "jobsearch-JobInfoHeader-title");
  // El título viene con " - job post" pegado adentro del mismo <h2>.
  const jobTitle = titleEl ? stripHtml(titleEl).replace(/\s*-\s*job post\s*$/i, "") : "";
  if (!jobTitle) return null;

  const companyEl = extractElementByAttr(html, "data-testid", "inlineHeader-companyName");
  const company = companyEl ? stripHtml(companyEl) : "";

  const locationEl = extractElementByAttr(html, "data-testid", "inlineHeader-companyLocation");
  const location = locationEl ? stripHtml(locationEl) : "";

  const salaryTypeEl = extractElementByAttr(html, "id", "salaryInfoAndJobType");
  const employmentType = salaryTypeEl ? stripHtml(salaryTypeEl) || null : null;

  const descriptionEl = extractElementByAttr(html, "id", "jobDescriptionText");
  const jdText = descriptionEl ? stripHtml(descriptionEl) : "";

  return {
    jobTitle,
    company,
    location,
    // "Desde casa" es el valor que Indeed pone directamente como ubicación
    // cuando el puesto es remoto — no hay un campo separado para eso.
    remote: /desde casa|remote|teletrabajo/i.test(location) ? true : null,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    jdText,
    jsonld: null,
    employmentType,
    datePosted: null,
    validThrough: null,
    fromFallback: false,
    extractedFrom: "site",
  };
}
