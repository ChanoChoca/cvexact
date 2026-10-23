import type { ImportedJobFields } from "../jsonld";
import { extractLinkedInJobId } from "../job-url";
import { stripHtml } from "../text-html";
import { extractElementByAttr, extractElementByClass, extractElementById, sliceElement } from "./html";
import { extractLinkedInPost } from "./linkedin-post";

/**
 * LinkedIn no manda JSON-LD ni `og:*` en sus páginas logueadas (ni la de
 * búsqueda ni `/jobs/view/`) — confirmado contra un HTML real. El dato sí
 * está en el DOM, así que esta regla vive en el servidor (se arregla con un
 * deploy cuando el markup cambie, sin pasar por la revisión de la Chrome Web
 * Store) y sigue el mismo criterio que `jsonld.ts`: regex, sin sumar un
 * parser de DOM completo.
 *
 * Dos vías, probadas en orden — LinkedIn reemplazó sus clases BEM
 * semánticas por clases hasheadas por build (sin ningún significado, tipo
 * `_2fc5bc11`) en al menos un estado de la página (confirmado el 2026-09,
 * dos días después de verificar la vía vieja), pero no hay evidencia de que
 * la vía vieja haya desaparecido de todos lados. Si ninguna de las dos
 * matchea, `null` — `extractJobPosting` cae al fallback genérico de
 * `<h1>`/`<title>`, nunca revienta.
 */

const REMOTE_TERMS = ["en remoto", "remoto", "remote"];

const EMPLOYMENT_TYPE_TERMS: [string[], string][] = [
  [["jornada completa", "full-time", "full time"], "Full-time"],
  [["media jornada", "medio tiempo", "part-time", "part time"], "Part-time"],
  [["contrato", "contract"], "Contract"],
  [["prácticas", "pasantía", "internship"], "Internship"],
  [["temporal", "temporary"], "Temporary"],
];

function matchesAny(haystack: string, terms: string[]): boolean {
  return terms.some((term) => haystack.includes(term));
}

function extractEmploymentType(badgesText: string): string | null {
  const lower = badgesText.toLowerCase();
  for (const [terms, label] of EMPLOYMENT_TYPE_TERMS) {
    if (matchesAny(lower, terms)) return label;
  }
  return null;
}

/** Selectores verificados el 2026-09 contra una página de búsqueda con el
 *  panel de detalle abierto. */
function extractLinkedInLegacyCard(html: string): ImportedJobFields | null {
  const titleEl = extractElementByClass(html, "job-details-jobs-unified-top-card__job-title");
  const jobTitle = titleEl ? stripHtml(titleEl) : "";
  // Sin título ni siquiera vale la pena devolver algo — que caiga a la otra
  // vía o al fallback genérico en vez de un resultado a medias.
  if (!jobTitle) return null;

  const companyEl = extractElementByClass(html, "job-details-jobs-unified-top-card__company-name");
  const company = companyEl ? stripHtml(companyEl) : "";

  // La ubicación es el primer tramo antes del "·" — por posición, no por
  // idioma, así "América Latina" sale igual en cualquier locale de LinkedIn.
  const tertiaryEl = extractElementByClass(
    html,
    "job-details-jobs-unified-top-card__tertiary-description-container",
  );
  const location = tertiaryEl ? (stripHtml(tertiaryEl).split("·")[0] ?? "").trim() : "";

  const badgesEl = extractElementByClass(html, "job-details-fit-level-preferences");
  const badgesText = badgesEl ? stripHtml(badgesEl).toLowerCase() : "";

  const descriptionEl = extractElementById(html, "job-details");
  const jdText = descriptionEl ? stripHtml(descriptionEl) : "";

  return {
    jobTitle,
    company,
    location,
    // Igual que el mapeo de JSON-LD: sólo se afirma `true` ante una señal
    // explícita, nunca se infiere `false` de la ausencia de la palabra.
    remote: matchesAny(badgesText, REMOTE_TERMS) ? true : null,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    jdText,
    jsonld: null,
    employmentType: extractEmploymentType(badgesText),
    datePosted: null,
    validThrough: null,
    fromFallback: false,
    extractedFrom: "site",
  };
}

/**
 * Segunda vía, para el rediseño con clases hasheadas. El único atributo que
 * sigue siendo estable ahí (no es un hash de build) es `componentkey` en el
 * contenedor de la tarjeta del aviso: `job-card-component-ref-<id>`.
 * Balanceado ese elemento, trae en orden: título, empresa, ubicación,
 * estado ("Visto"), separadores y fecha relativa de publicación.
 *
 * El id no es opcional acá: en una página de búsqueda hay una tarjeta con
 * este mismo `componentkey` **por cada aviso de la lista** (verificado:
 * 25 en un HTML real). Sin anclar al id de la URL, `.exec()` devuelve la
 * primera tarjeta del documento — la primera del listado, casi nunca la que
 * el usuario tiene abierta — que fue exactamente el bug real: capturar
 * siempre traía el mismo aviso sin importar en cuál se hacía click.
 */
function extractLinkedInJobCard(html: string, url: string): ImportedJobFields | null {
  let jobId: string | null;
  try {
    jobId = extractLinkedInJobId(new URL(url));
  } catch {
    return null;
  }
  if (!jobId) return null;

  const cardMatch = new RegExp(`<(\\w+)[^>]*\\bcomponentkey="job-card-component-ref-${jobId}"[^>]*>`, "i").exec(
    html,
  );
  if (!cardMatch) return null;
  const card = sliceElement(html, cardMatch.index, cardMatch[1]);

  const paragraphs = [...card.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => m[1]);
  if (paragraphs.length < 3) return null;

  // El primer <p> trae el título duplicado — un <span> visible y un
  // <span aria-hidden="true"> con el mismo texto, para lectores de
  // pantalla — leer todo el <p> con stripHtml concatenaría las dos copias.
  const firstSpan = /<span[^>]*>([^<]*)<\/span>/.exec(paragraphs[0]);
  const jobTitle = firstSpan ? stripHtml(firstSpan[1]) : "";
  if (!jobTitle) return null;

  const company = stripHtml(paragraphs[1]);

  // La ubicación trae el modificador de remoto pegado entre paréntesis:
  // "Argentina (En remoto)".
  const locationRaw = stripHtml(paragraphs[2]);
  const locationMatch = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(locationRaw);
  const location = locationMatch ? locationMatch[1].trim() : locationRaw;
  const modifier = locationMatch ? locationMatch[2].toLowerCase() : "";

  // La descripción vive en un panel aparte. `data-testid="expandable-text-
  // box"` solo no alcanza como ancla — aparece varias veces en la página,
  // para cualquier texto expandible — así que primero se ubica el heading
  // "Acerca del empleo" (único) y se toma el primer expandable-text-box que
  // aparece después.
  const headingMatch = /<h\d[^>]*>\s*Acerca del empleo\s*<\/h\d>/i.exec(html);
  let jdText = "";
  if (headingMatch) {
    const descriptionEl = extractElementByAttr(html.slice(headingMatch.index), "data-testid", "expandable-text-box");
    if (descriptionEl) jdText = stripHtml(descriptionEl);
  }

  return {
    jobTitle,
    company,
    location,
    remote: matchesAny(modifier, REMOTE_TERMS) ? true : null,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    jdText,
    jsonld: null,
    // Sin badge de jornada confirmado en esta vía — null antes que adivinar.
    employmentType: null,
    datePosted: null,
    validThrough: null,
    fromFallback: false,
    extractedFrom: "site",
  };
}

/**
 * `extractLinkedInPost` va primero: sólo devuelve algo cuando el HTML trae
 * la marca de anclaje de la extensión o es el permalink de una única
 * publicación (ver `linkedin-post.ts`) — ninguna de las dos condiciones se
 * da en una página de `/jobs/`, así que encadenarla acá no le cambia nada a
 * las otras dos vías.
 */
export function extractLinkedIn(html: string, url: string): ImportedJobFields | null {
  return extractLinkedInPost(html, url) ?? extractLinkedInLegacyCard(html) ?? extractLinkedInJobCard(html, url);
}
