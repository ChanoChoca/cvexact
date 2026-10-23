/**
 * Extrae un `JobPosting` de JSON-LD de una página de aviso, y si no hay,
 * cae a `<title>`/`og:title`/meta description. Puro — recibe el HTML ya
 * descargado, nunca hace la request él mismo (eso es responsabilidad de la
 * route, que es la que decide el User-Agent, el timeout y que no hay
 * reintentos: ver `app/api/tracker/import/url/route.ts`).
 *
 * Basado en regex y no en un parser de DOM: lo único que hace falta es el
 * contenido de un puñado de `<script>`/`<meta>` etiquetas, y sumar una
 * dependencia de parsing HTML completo (jsdom, cheerio) para eso es más
 * peso del que pide la tarea — la restricción de costo cero no prohíbe
 * dependencias gratuitas, pero cada una es superficie de mantenimiento que
 * no hace falta acá.
 *
 * Cuatro capas, en orden: JSON-LD (`mapJobPosting`) → microdata schema.org
 * (`microdata.ts`, para sitios que anotan el aviso con `itemprop` en vez de
 * JSON-LD) → reglas por sitio (`site-rules/`, para DOMs predecibles sin
 * ninguno de los dos, como LinkedIn) → fallback genérico (`fallbackFields`,
 * sólo `<h1>`/`<title>`/meta).
 */

import { extractMicrodata } from "./microdata";
import { extractWithSiteRule } from "./site-rules";
import { stripHtml } from "./text-html";

export type ImportedJobFields = {
  jobTitle: string;
  company: string;
  location: string;
  remote: boolean | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  jdText: string;
  /** Crudo, para guardar en `jd_jsonld` y poder auditar qué se leyó. */
  jsonld: unknown;
  /** Metadatos que no tienen columna propia pero vale la pena mostrar en el
   *  formulario de revisión antes de confirmar. */
  employmentType: string | null;
  datePosted: string | null;
  validThrough: string | null;
  /** Si no había JSON-LD y esto viene del fallback de `<title>`/meta. */
  fromFallback: boolean;
  /** De dónde salió el resultado — más fino que `fromFallback`, que agrupa
   *  "microdata"/"site"/"site-post" (ver `microdata.ts`/`site-rules/`) junto
   *  con "jsonld" porque las cuatro son datos estructurados de verdad, no
   *  una adivinanza de `<title>`. "site-post" es aparte de "site": una
   *  publicación de LinkedIn en texto libre (`site-rules/linkedin-post.ts`)
   *  trae `company`/`location` vacíos como algo normal, no como una señal de
   *  que la extracción falló — el popup de la extensión (`renderReview`,
   *  `renderMaybeNotAJob`) necesita distinguir los dos casos. */
  extractedFrom: "jsonld" | "microdata" | "site" | "site-post" | "generic";
  /** URL propia del aviso encontrada en el DOM (un `itemprop="url"`, un link
   *  de la lista que apunta al mismo id que el panel de detalle) — cuando
   *  está, es más confiable que la URL de la pestaña para canonicalizar
   *  (`lib/tracker/job-url.ts`), sobre todo en sitios donde el panel de
   *  detalle no cambia la URL de la pestaña. */
  domJobUrl?: string;
  /** Otros puestos detectados en la misma publicación de LinkedIn
   *  (`site-rules/linkedin-post.ts`, cuando el texto libre nombra más de un
   *  rol — un reclutador que abre varias búsquedas a la vez). `jobTitle` ya
   *  es el primero de esta lista; se manda aparte para que la persona elija
   *  otro con un click en vez de volver a escribirlo. */
  jobTitleCandidates?: string[];
  /** Empresa mencionada en prosa, sin link ni etiqueta ("En AreaMovil
   *  tenemos...") — señal débil a propósito: nunca se escribe directo en
   *  `company` (puede ser el cliente final de una consultora de staffing,
   *  no quien contrata), sólo se ofrece como sugerencia cuando `company`
   *  quedó vacío. */
  suggestedCompany?: string;
  /** Mismo criterio que `suggestedCompany`, para una ubicación marcada con
   *  📍 sin la etiqueta "Ubicación:"/"Location:" que sí resuelve `location`
   *  directo. */
  suggestedLocation?: string;
};

function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch {
      // JSON-LD roto no es raro — se ignora ese bloque y se sigue con el resto.
    }
  }
  return blocks;
}

function isJobPosting(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as Record<string, unknown>)["@type"];
  if (typeof type === "string") return type === "JobPosting";
  if (Array.isArray(type)) return type.includes("JobPosting");
  return false;
}

/** Recorre `@graph`, arrays y objetos anidados buscando el primer `JobPosting`. */
function findJobPosting(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6 || node === null || typeof node !== "object") return null;
  if (isJobPosting(node)) return node as Record<string, unknown>;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPosting(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const record = node as Record<string, unknown>;
  if ("@graph" in record) {
    const found = findJobPosting(record["@graph"], depth + 1);
    if (found) return found;
  }
  for (const value of Object.values(record)) {
    if (typeof value === "object" && value !== null) {
      const found = findJobPosting(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null;
}

function mapJobPosting(job: Record<string, unknown>): ImportedJobFields {
  const org = job.hiringOrganization as Record<string, unknown> | undefined;
  const location = job.jobLocation as Record<string, unknown> | Record<string, unknown>[] | undefined;
  const firstLocation = Array.isArray(location) ? location[0] : location;
  const address = firstLocation?.address as Record<string, unknown> | undefined;
  const locality = asString(address?.addressLocality);
  const region = asString(address?.addressRegion);

  const salary = job.baseSalary as Record<string, unknown> | undefined;
  const salaryValue = salary?.value as Record<string, unknown> | undefined;

  return {
    jobTitle: asString(job.title),
    company: asString(org?.name),
    location: [locality, region].filter(Boolean).join(", "),
    remote: job.jobLocationType === "TELECOMMUTE" ? true : null,
    salaryMin: asNumber(salaryValue?.minValue ?? salaryValue?.value),
    salaryMax: asNumber(salaryValue?.maxValue ?? salaryValue?.value),
    currency: asString(salary?.currency) || null,
    jdText: stripHtml(asString(job.description)),
    jsonld: job,
    employmentType: asString(job.employmentType) || null,
    datePosted: asString(job.datePosted) || null,
    validThrough: asString(job.validThrough) || null,
    fromFallback: false,
    extractedFrom: "jsonld",
  };
}

function metaContent(html: string, attr: "property" | "name", key: string): string {
  const re = new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]*content=["']([^"']*)["']`, "i");
  const reversed = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']${key}["']`, "i");
  const match = html.match(re) ?? html.match(reversed);
  return match ? match[1] : "";
}

// Encabezados que no son el título de un aviso, aunque sean el primer <h1>
// de la página — saludos de la barra ("Hola, Juan") y encabezados de listado
// ("475 Ofertas de trabajo de java", "21 empleos de Desarrollador java").
// Verificado contra Indeed y Glassdoor: en los dos, el <h1> del aviso es el
// primero que no matchea ninguno de los dos patrones.
const GREETING_H1 = /^(hola|hi|hello|bienvenid[oa])\b/i;
const LISTING_H1 = /^\d[\d.,]*\s+(ofertas?|empleos?|resultados?|vacantes?|trabajos?|jobs?)\b/i;

function isCredibleH1(text: string): boolean {
  return text.length > 0 && text.length <= 200 && !GREETING_H1.test(text) && !LISTING_H1.test(text);
}

/** El primer `<h1>` que parece el título de un aviso, no cualquier `<h1>`
 *  de la página — ver `isCredibleH1`. Si ninguno lo parece, no se inventa:
 *  devuelve "" y `fallbackFields` sigue con el `<title>`. */
function firstH1Text(html: string): string {
  for (const match of html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)) {
    const text = stripHtml(match[1]);
    if (isCredibleH1(text)) return text;
  }
  return "";
}

/**
 * Sólo se aplica al último recurso (`<title>` crudo, sin `og:title` ni
 * `<h1>` utilizable): saca el contador de notificaciones ("(22) ...") y el
 * sufijo de nombre de sitio ("... | LinkedIn", "... - Gmail"). Sólo mira `|`
 * y `-` ASCII — nunca "—"/"–" (guiones largos), que son parte legítima de
 * títulos reales ("Analista QA — Foo Inc") y no un separador de sitio.
 *
 * El recorte de sufijo se repite hasta que no quede nada más para sacar —
 * LinkedIn apila más de uno ("Puesto | Empresa | LinkedIn"): sacar sólo el
 * último dejaba "Puesto | Empresa" en vez de "Puesto".
 */
function cleanTitle(raw: string): string {
  let title = raw.replace(/^\(\d+\)\s*/, "").trim();
  let next = title;
  do {
    title = next;
    next = title.replace(/\s+\|\s*[^|]{1,60}$/, "").replace(/\s+-\s+[^-]{1,40}$/, "");
  } while (next !== title);
  return title;
}

function fallbackFields(html: string): ImportedJobFields {
  const ogTitle = metaContent(html, "property", "og:title");
  const h1Text = ogTitle ? "" : firstH1Text(html);
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const rawTitle = titleMatch ? titleMatch[1].trim() : "";
  const title = ogTitle || h1Text || cleanTitle(rawTitle);
  const description = metaContent(html, "property", "og:description") || metaContent(html, "name", "description");

  return {
    jobTitle: title,
    company: "",
    location: "",
    remote: null,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    jdText: description,
    jsonld: null,
    employmentType: null,
    datePosted: null,
    validThrough: null,
    fromFallback: true,
    extractedFrom: "generic",
  };
}

/**
 * `url` es opcional (el import por URL y la extensión de navegador siempre
 * la tienen; los tests no la necesitan) — sin ella se salta la capa de
 * reglas por sitio y se va directo al fallback genérico.
 */
export function extractJobPosting(html: string, url?: string): ImportedJobFields {
  const blocks = extractJsonLdBlocks(html);
  for (const block of blocks) {
    const job = findJobPosting(block);
    if (job) return mapJobPosting(job);
  }

  const microdataResult = extractMicrodata(html, url);
  if (microdataResult) return microdataResult;

  const siteResult = url ? extractWithSiteRule(html, url) : null;
  if (siteResult) return siteResult;

  return fallbackFields(html);
}
