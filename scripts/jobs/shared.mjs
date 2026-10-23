// Helpers compartidos por los cuatro scripts de ingesta de empleo
// (scripts/ingest-jobs.mjs, scripts/ingest-jooble.mjs, scripts/ingest-ats.mjs
// y los módulos de scripts/jobs/ats/). Antes de este archivo, `normalize()`
// estaba reimplementado suelto en ingest-jooble.mjs y `text`/`num`/
// `mapSeniority`/`toTimestamp` vivían sueltos en ingest-jobs.mjs — con un
// tercer y cuarto script de ingesta esa duplicación dejó de ser aceptable.
//
// JS puro, sin imports de `lib/`, como cada script que ya importa de acá: un
// CronJob de ingesta corre en la imagen `migrator` (ver Dockerfile), que
// copia sólo `lib/db` y estos scripts, y no compila TypeScript.

/** "" cuando no hay nada que decir — no es un `unknown` a rellenar después. */
export function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Igual criterio en todas las fuentes que declaran (o insinúan, vía el
 * título) un nivel: mapea a los mismos cinco valores de `JobAnalysis.seniority`
 * (lib/schemas/job.ts) más "unknown" — nunca inventa un nivel que la fuente
 * no dijo.
 */
export function mapSeniority(raw) {
  const s = text(raw).toLowerCase();
  if (!s) return "unknown";
  if (s.includes("intern") || s.includes("trainee") || s.includes("pasant"))
    return "intern";
  if (s.includes("junior") || s.includes("jr") || s.includes("entry")) return "junior";
  if (
    s.includes("lead") ||
    s.includes("principal") ||
    s.includes("director") ||
    s.includes("staff") ||
    s.includes("head of")
  )
    return "lead";
  if (s.includes("senior") || s.includes("sr")) return "senior";
  if (s.includes("mid") || s.includes("semi") || s.includes("ssr")) return "mid";
  return "unknown";
}

export function toTimestamp(unixSeconds) {
  return typeof unixSeconds === "number" && Number.isFinite(unixSeconds)
    ? new Date(unixSeconds * 1000)
    : null;
}

/** `null` en cualquier fecha no parseable — una fecha ausente o mal escrita es
 *  "no lo sabemos", nunca una adivinada. Necesario además de `toTimestamp`
 *  porque algunas fuentes (ATS) mandan ISO-8601 en vez de epoch en segundos,
 *  y un `Invalid Date` rompe el serializador de `pg` en cuanto intenta
 *  llamar `.toISOString()` sobre él. */
export function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Casefold y pliegue de acentos — el mismo criterio que `normalizeForSearch`
 * en `lib/text/normalize.ts`, reimplementado acá porque estos scripts no
 * importan nada de `lib/` (ver la cabecera). Si ese preset cambia, este
 * bloque hay que actualizarlo a mano.
 */
export function normalize(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Marcadores de ubicación → país (ISO-2), para inferir `country` de un texto
 * libre cuando la fuente no scopeó la request por país (Get on Board y Jooble
 * sí lo hacen y fijan "AR" directamente — ver el comentario de `country` en
 * `lib/db/schema.ts`). Deliberadamente conservadora: sólo nombres de país y
 * ciudades inequívocas, nunca "remote", "worldwide" ni "anywhere". Un falso
 * negativo (`country: ""`) es aceptable — el aviso sigue en el feed, sólo no
 * sube para los visitantes de ese país y, si es argentino, pierde el filtro
 * Presencial/Híbrido —; un falso positivo pondría un aviso de otro país
 * detrás de ese filtro, que es el bug que este archivo existe para no repetir.
 * Por eso, si el texto nombra dos países distintos ("USA, Canada"), el
 * resultado es "": no es de un país.
 *
 * Los marcadores van sin acentos y sin puntuación (ver `normalizePlace`) y se
 * comparan como palabras completas, no como subcadenas.
 */
const COUNTRY_MARKERS = {
  AR: [
    "argentina", "buenos aires", "caba", "cordoba", "rosario", "mendoza",
    "la plata", "tucuman", "mar del plata", "salta", "santa fe", "neuquen",
  ],
  BR: ["brazil", "brasil", "sao paulo", "rio de janeiro"],
  CL: ["chile"],
  MX: ["mexico", "ciudad de mexico", "cdmx", "guadalajara", "monterrey"],
  CO: ["colombia", "bogota", "medellin"],
  UY: ["uruguay", "montevideo"],
  PE: ["peru"],
  US: ["united states", "usa", "estados unidos", "ee uu", "eeuu"],
  CA: ["canada", "toronto", "vancouver"],
  ES: ["spain", "espana", "madrid", "barcelona"],
  PT: ["portugal", "lisbon", "lisboa"],
  FR: ["france", "francia", "paris"],
  DE: ["germany", "deutschland", "alemania", "berlin", "munich", "hamburg"],
  GB: ["united kingdom", "great britain", "england", "uk", "london"],
  IE: ["ireland", "dublin"],
  NL: ["netherlands", "amsterdam"],
  PL: ["poland", "warsaw"],
  IN: ["india", "bangalore", "bengaluru"],
  AU: ["australia", "sydney", "melbourne"],
};

/** Casefold, sin acentos y con la puntuación como espacio ("EE. UU." → "ee uu"). */
function normalizePlace(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, " ").trim();
}

const COUNTRY_MATCHERS = Object.entries(COUNTRY_MARKERS).map(([code, markers]) => [
  code,
  new RegExp(`(?:^| )(?:${markers.join("|")})(?: |$)`),
]);

/**
 * ISO-2 del único país que el texto nombra, o "" si no nombra ninguno o
 * nombra más de uno. "Santa Fe, New Mexico" es el caso que motiva quitar
 * "new mexico" antes de comparar: si no, "mexico" sumaría un segundo país y
 * un aviso de Estados Unidos podría pasar por argentino.
 */
export function resolveCountry(locationText) {
  const haystack = normalizePlace(text(locationText)).replace("new mexico", "united states");
  const found = COUNTRY_MATCHERS.filter(([, matcher]) => matcher.test(haystack)).map(([code]) => code);
  return found.length === 1 ? found[0] : "";
}

/**
 * Agrupa avisos del mismo puesto publicados en más de una fuente —
 * `app/api/jobs/feed/route.ts` colapsa el feed por este valor. Empresa +
 * título normalizados, nunca título solo: "Desarrollador Backend" en dos
 * empresas distintas no es el mismo aviso, y agruparlas por título a secas
 * escondería avisos reales detrás de uno solo.
 *
 * `""` cuando no hay empresa que anclar el agrupamiento — el feed trata una
 * cadena vacía como "sin grupo", cada fila es su propio grupo de uno, en vez
 * de agrupar entre sí a todos los avisos sin empresa conocida.
 */
export function dedupGroupId(company, title) {
  const c = normalize(text(company));
  const t = normalize(text(title));
  if (!c || !t) return "";
  return `${t}|${c}`;
}

const TIMEOUT_MS = 15_000;

export async function getJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json", ...options.headers },
  });
  if (!response.ok) {
    const err = new Error(`${url} respondió ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}
