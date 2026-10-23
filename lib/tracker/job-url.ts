/**
 * Recorta parámetros de tracking de una URL de aviso y, para sitios
 * conocidos, la reescribe a su forma canónica — así "guardar" y "buscar"
 * (`getApplicationByUrl`, comparación por igualdad exacta) coinciden aunque
 * la URL de origen traiga basura de sesión/analytics (o, en LinkedIn, sea
 * directamente la URL de una búsqueda con el aviso abierto en el panel
 * lateral, no su propia página).
 */

const TRACKING_PARAM_NAMES = new Set([
  "ref",
  "refid",
  "trackingid",
  "trk",
  "ebp",
  "origin",
  "position",
  "pagenum",
  "start",
]);

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAM_NAMES.has(lower);
}

function stripParams(url: URL, names: Set<string>): void {
  for (const key of [...url.searchParams.keys()]) {
    if (names.has(key.toLowerCase())) url.searchParams.delete(key);
  }
}

function stripTrackingParams(url: URL): void {
  for (const key of [...url.searchParams.keys()]) {
    if (isTrackingParam(key)) url.searchParams.delete(key);
  }
}

/**
 * `currentJobId` es el caso más común: la persona está mirando el aviso
 * abierto en el panel lateral de `/jobs/search/`, no en su propia página.
 * Si no está, `/jobs/view/<id>` trae el id en el propio path.
 *
 * Exportado — `site-rules/linkedin.ts` necesita este mismo id para anclar la
 * tarjeta correcta dentro de una lista de resultados (no sólo LinkedIn tiene
 * varias tarjetas con el mismo `componentkey` genérico; sin esto, agarrar
 * "la primera tarjeta del HTML" en vez de "la que corresponde a este id" fue
 * exactamente el bug que motivó este helper).
 */
export function extractLinkedInJobId(url: URL): string | null {
  const currentJobId = url.searchParams.get("currentJobId");
  if (currentJobId && /^\d+$/.test(currentJobId)) return currentJobId;
  const viewMatch = url.pathname.match(/\/jobs\/view\/(\d+)/);
  return viewMatch ? viewMatch[1] : null;
}

/**
 * Sin id de aviso, puede ser el permalink de una publicación del feed
 * (`/feed/update/urn:li:share:<n>/` o `…urn:li:ugcPost:<n>/`) — la forma que
 * arma `site-rules/linkedin-post.ts` cuando la publicación no tiene un aviso
 * adjunto. `decodeURIComponent` porque LinkedIn a veces escapa los `:` como
 * `%3A`. Se conserva el trailing slash: es la forma que LinkedIn linkea
 * desde sus propias publicaciones (verificado contra el fixture).
 */
function canonicalizeLinkedInPost(url: URL): string | null {
  const match = decodeURIComponent(url.pathname).match(/\/feed\/update\/(urn:li:(?:share|ugcPost|activity):\d+)/);
  return match ? `https://www.linkedin.com/feed/update/${match[1]}/` : null;
}

function canonicalizeLinkedIn(url: URL): string | null {
  const jobId = extractLinkedInJobId(url);
  if (jobId) return `https://www.linkedin.com/jobs/view/${jobId}`;
  return canonicalizeLinkedInPost(url);
}

/**
 * `vjk` es el id del aviso abierto en el panel de una búsqueda; en su propia
 * página (`/viewjob`) es `jk`. A diferencia de LinkedIn, se conserva el
 * hostname en vez de fijar uno solo — Indeed tiene un sitio real por país
 * (`ar.indeed.com`, `indeed.com`, …), no subdominios de un único sitio
 * global.
 */
function canonicalizeIndeed(url: URL): string | null {
  const key = url.searchParams.get("vjk") ?? url.searchParams.get("jk");
  if (key && /^[a-f0-9]{16}$/i.test(key)) {
    return `https://${url.hostname}/viewjob?jk=${key}`;
  }
  return null;
}

const GLASSDOOR_TRACKING_PARAMS = new Set([
  "pos",
  "ao",
  "s",
  "guid",
  "src",
  "t",
  "vt",
  "uido",
  "cs",
  "cb",
  "jrtk",
  "ctk",
  "org",
  "channel",
  "showpreapplymodal",
  "applyredirecturl",
]);

/**
 * Glassdoor no tiene, verificado, una URL corta que se sepa que resuelve
 * (a diferencia de LinkedIn o Indeed) — inventar una arriesga un link roto
 * en "Ver aviso original" (`DetailPanel.tsx`). Se mantiene el pathname/slug
 * real tal cual, sólo se saca la cola de tracking (`pos`, `ao`, `guid`, …) y
 * se normaliza a `jobListingId` — el nombre que usa la URL real de la
 * búsqueda con panel abierto — cuando llega como `jl` (el que usan los
 * links sueltos de "ver este aviso").
 */
function canonicalizeGlassdoor(url: URL): void {
  const jl = url.searchParams.get("jl");
  if (jl && !url.searchParams.has("jobListingId")) {
    url.searchParams.delete("jl");
    url.searchParams.set("jobListingId", jl);
  }
  stripParams(url, GLASSDOOR_TRACKING_PARAMS);
}

/**
 * El id de 32 caracteres hex ya es parte del path real
 * (`/ofertas-de-trabajo/<slug>-<id>`) — alcanza con quedarse con eso y
 * tirar el slug de SEO y el `#lc=…` de tracking que le sigue.
 */
function canonicalizeComputrabajo(url: URL): string | null {
  const match = url.pathname.match(/([0-9A-F]{32})$/i);
  if (!match) return null;
  return `https://${url.hostname}/ofertas-de-trabajo/${match[1].toUpperCase()}`;
}

export function canonicalizeJobUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  if (url.hostname.endsWith("linkedin.com")) {
    const canonical = canonicalizeLinkedIn(url);
    if (canonical) return canonical;
  }

  if (url.hostname.endsWith("indeed.com")) {
    const canonical = canonicalizeIndeed(url);
    if (canonical) return canonical;
  }

  if (url.hostname.includes("computrabajo.")) {
    const canonical = canonicalizeComputrabajo(url);
    if (canonical) return canonical;
  }

  if (url.hostname.includes("glassdoor.")) {
    canonicalizeGlassdoor(url);
    return url.toString();
  }

  stripTrackingParams(url);
  return url.toString();
}
