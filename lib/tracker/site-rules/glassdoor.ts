import type { ImportedJobFields } from "../jsonld";
import { stripHtml } from "../text-html";
import { extractElementByAttr, extractElementByAttrPrefix, extractElementByClassPrefix } from "./html";

/**
 * Glassdoor no manda JSON-LD de `JobPosting` en la búsqueda con panel
 * abierto (sólo `ItemList` de los resultados) — confirmado contra un HTML
 * real. Sus clases son CSS-modules con hash de build
 * (`JobDetails_jobDescription__uW_fK`) que cambia en cada deploy de ellos,
 * así que todo acá matchea por *prefijo*, nunca por la clase completa — ver
 * `extractElementByClassPrefix` en `./html`. `data-test="location"` es la
 * excepción: es un atributo de testing estable, no hace falta prefijo.
 */
export function extractGlassdoor(html: string): ImportedJobFields | null {
  const titleEl = extractElementByAttrPrefix(html, "id", "jd-job-title-");
  const jobTitle = titleEl ? stripHtml(titleEl) : "";
  if (!jobTitle) return null;

  // El nombre de la empresa suelto (`EmployerProfile_employerNameHeading`)
  // aparece una vez por tarjeta de resultado en la lista — hay que buscarlo
  // adentro del contenedor del panel de detalle, no en el documento entero.
  const headerScope = extractElementByClassPrefix(html, "JobDetails_employerAndJobTitle");
  const companyEl = headerScope ? extractElementByClassPrefix(headerScope, "EmployerProfile_employerNameHeading") : null;
  const company = companyEl ? stripHtml(companyEl) : "";

  const locationEl = extractElementByAttr(html, "data-test", "location");
  const location = locationEl ? stripHtml(locationEl) : "";

  const descriptionEl = extractElementByClassPrefix(html, "JobDetails_jobDescription");
  const jdText = descriptionEl ? stripHtml(descriptionEl) : "";

  return {
    jobTitle,
    company,
    location,
    remote: /remote|teletrabajo|home office/i.test(location) ? true : null,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    jdText,
    jsonld: null,
    // Sin badge de jornada confirmado contra el HTML real — null antes que
    // adivinar el formato.
    employmentType: null,
    datePosted: null,
    validThrough: null,
    fromFallback: false,
    extractedFrom: "site",
  };
}
