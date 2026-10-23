import type { ImportedJobFields } from "../jsonld";
import { stripHtml, stripPostText } from "../text-html";
import { extractElementByAttr, extractElementByAttrPrefix, sliceElement } from "./html";

/**
 * Una publicación del feed/búsqueda de contenido de LinkedIn
 * (`/search/results/content/…`, `/feed/…`) que resulta ser una oferta de
 * trabajo en texto libre — no un aviso estructurado de `/jobs/`. Es un DOM
 * distinto al de `linkedin.ts` (otra ancla, otro concepto: texto de una
 * persona, no campos de un formulario), así que vive aparte.
 *
 * El único atributo estable en el markup nuevo de LinkedIn para esto es
 * `componentkey="update-card-focus…"` en el contenedor de la tarjeta
 * (verificado: 18/18 tarjetas de un HTML real de búsqueda de contenido,
 * 1:1). Pero a diferencia de `job-card-component-ref-<id>` en `linkedin.ts`,
 * acá no hay ningún id de publicación en la URL de la página — es una lista
 * de 18 publicaciones de gente distinta, y no hay forma de saber cuál quiso
 * el usuario sin que él mismo la señale.
 *
 * Por eso esta regla nunca adivina entre varias: sólo extrae una tarjeta
 * cuando (a) el HTML trae `data-cvexact-anchor="1"` — la extensión de
 * navegador la marca en el propio DOM, sobre la tarjeta que contiene la
 * selección de texto del usuario, antes de mandar el HTML — o (b) la URL es
 * el permalink de una publicación (`/feed/update/<urn>`) y hay exactamente
 * una tarjeta en la página. Ninguna de las dos condiciones puede darse en
 * una página de `/jobs/`, así que encadenar esto antes de `linkedin.ts`
 * (ver `extractLinkedIn`) no le cambia nada a ese camino.
 */

const CARD_COMPONENTKEY_PREFIX = "update-card-focus";

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function locateCard(html: string, url: string): string | null {
  const anchored = extractElementByAttr(html, "data-cvexact-anchor", "1");
  if (anchored) return anchored;

  let isPermalink: boolean;
  try {
    isPermalink = /\/feed\/update\//.test(new URL(url).pathname);
  } catch {
    return null;
  }
  if (!isPermalink) return null;

  // Sin marca y con más de una tarjeta, adivinar es exactamente el bug que
  // ya se pagó una vez con `job-card-component-ref-<id>` (ver linkedin.ts) —
  // acá no hay ni siquiera un id de URL con el que desambiguar, así que la
  // única situación segura es "una sola tarjeta en toda la página".
  if (countOccurrences(html, `componentkey="${CARD_COMPONENTKEY_PREFIX}`) !== 1) return null;
  return extractElementByAttrPrefix(html, "componentkey", CARD_COMPONENTKEY_PREFIX);
}

/** El primer `<p>` de la tarjeta es el nombre de quien publica — a
 *  diferencia del título en `job-card-component-ref-<id>`, no viene
 *  duplicado en un `<span aria-hidden>` (verificado contra el fixture). */
function extractAuthor(card: string): { name: string; isCompany: boolean } | null {
  const firstP = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(card);
  const name = firstP ? stripHtml(firstP[1]) : "";
  const hrefMatch = /href="https:\/\/www\.linkedin\.com\/(in|company|school|showcase)\/[^"]+"/i.exec(card);
  if (!name || !hrefMatch) return null;
  return { name, isCompany: hrefMatch[1] === "company" || hrefMatch[1] === "showcase" };
}

/**
 * Cuando quien publica es una persona (un reclutador, normalmente), la
 * empresa real puede estar mencionada como un link dentro del propio texto
 * ("DBiz.ai We're Hiring…", con "DBiz.ai" linkeado a `/company/…`). Se usa
 * sólo si hay exactamente una mención — nunca se adivina entre varias.
 */
function companyFromTextMention(box: string): string {
  const matches = [...box.matchAll(/<a[^>]*\bhref="https:\/\/www\.linkedin\.com\/(?:company|showcase)\/[^"]*"[^>]*>/gi)];
  if (matches.length !== 1) return "";
  const [match] = matches;
  return stripHtml(sliceElement(box, match.index, "a"));
}

// --- Título: varios candidatos, nunca uno inventado ------------------------
//
// Una publicación puede nombrar UN puesto ("Buscamos talento Java. En
// AreaMovil tenemos una nueva oportunidad para un/a Desarrollador/a Java
// Semi Senior.") o VARIOS a la vez (un reclutador que abre 2 a 7 búsquedas
// con viñetas en el mismo texto) — en el segundo caso no existe "el" título
// correcto, así que en vez de forzar una sola respuesta se juntan todos los
// candidatos encontrados; `jobTitle` es el primero (ver
// `rank-title.ts` para cómo se reordena según el perfil del usuario) y el
// resto viaja en `jobTitleCandidates` para que la persona elija con un click
// en la pantalla de revisión del popup, en vez de tener que volver a
// escribirlo.

// Emoji y símbolos decorativos que estos posts usan como viñetas ("🚀", "📍",
// "✅", "💼") — no son parte del título ni impiden reconocer una etiqueta que
// viene pegada después ("💼 Job Title: X").
const LEADING_DECORATION = String.raw`(?:[^\w\s][ \t]*){0,2}`;
const LABELED_TITLE_RE = new RegExp(
  String.raw`^[ \t]*${LEADING_DECORATION}(?:job\s*title|job\s*position|position|role|puesto|vacante|cargo)[ \t]*[:\-][ \t]*(.+)$`,
  "imu",
);

/**
 * Roles de IT — mismo criterio que `EMPLOYMENT_TYPE_TERMS`/`REMOTE_TERMS` en
 * `linkedin.ts`: la lista está sesgada a perfiles técnicos porque es lo que
 * este producto genera CVs para, y se puede ampliar después sin tocar nada
 * más que esta constante.
 */
const ROLE_WORD = String.raw`(?:Desarrollador(?:\/?a)?|Programador(?:\/?a)?|Ingenier[oa]|Arquitect[oa]|Analista|Administrador(?:\/?a)?|Consultor(?:\/?a)?|Dise[ñn]ador(?:\/?a)?|Especialista|Coordinador(?:\/?a)?|Gerente|Tester|Soporte|Operador(?:\/?a)?|Developer|Engineer|Architect|Analyst|Administrator|Consultant|Designer|Specialist|Coordinator|Manager|Lead)`;
const ROLE_WORD_RE = new RegExp(ROLE_WORD, "iu");
const ROLE_WORD_GLOBAL_RE = new RegExp(ROLE_WORD, "giu");

// Viñetas reales observadas en publicaciones de reclutamiento — 🔹 es la más
// común, el resto cubre variantes vistas en el corpus del producto.
const BULLET_LINE_RE = /^[ \t]*(?:🔹|🔸|▪|●|➤|✅|✔️?|[-*•])[ \t]*(.+)$/gmu;

// Modificador de seniority u otra palabra capitalizada (un lenguaje/tecnología,
// "Java Developer") inmediatamente antes de la palabra de rol — sin esto,
// "Estoy incorporando un/a Java Developer" perdía el "Java" y quedaba sólo
// "Developer", un candidato demasiado genérico para servir de título.
const ROLE_PREFIX_RE =
  /(?:(?:Senior|Semi[ \t]+Senior|Junior|Ssr\.?|Sr\.?|Jr\.?|Trainee|Lead|L[ií]der|[A-ZÁÉÍÓÚÑ][\wÀ-ÿ+.#]{1,20})[ \t]+){0,2}$/;
// Corta la frase en el próximo límite duro — mismo criterio que ya usaba
// `HIRING_TAIL_CUT_RE` para no arrastrar la oración entera detrás del rol.
const ROLE_SUFFIX_STOP_RE = /[\n.!?]| \b(?:para|con|en[ \t]+un[ao]?|that|who|to|at|with|for|in)\b/iu;
const ROLE_PROSE_WINDOW = 90;

function cleanTitleCandidate(raw: string): string {
  let title = raw
    .replace(/[\u{1F1E6}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/gu, " ")
    .trim();
  title = title.replace(/^[\s"'“”•!:.\-–—]+/, "").replace(/[\s"'“”•!:.\-–—]+$/, "");
  title = title.replace(/^(a|an|the|un|una|nuevo|nueva|new)\s+/i, "");
  title = (title.split(/\s[|#]/)[0] ?? "").trim();
  if (title.length > 120) title = title.slice(0, 120).trim();
  return title.length >= 3 && /\p{L}/u.test(title) ? title : "";
}

/** Líneas con viñeta que además contienen una palabra de rol — sin la
 *  segunda condición, cualquier viñeta de la publicación ("📩 Enviame tu
 *  CV") entraría como candidato. */
function bulletCandidates(jdText: string): string[] {
  const out: string[] = [];
  for (const match of jdText.matchAll(BULLET_LINE_RE)) {
    const line = match[1] ?? "";
    if (!ROLE_WORD_RE.test(line)) continue;
    const cleaned = cleanTitleCandidate(line);
    if (cleaned) out.push(cleaned);
  }
  return out;
}

/** Toda mención de un rol en cualquier parte del texto, no sólo la primera
 *  línea — resuelve el post que abre con un gancho genérico ("Buscamos
 *  talento Java.") y recién nombra el puesto real en la oración siguiente. */
function proseCandidates(jdText: string): string[] {
  const out: string[] = [];
  for (const match of jdText.matchAll(ROLE_WORD_GLOBAL_RE)) {
    const start = match.index;
    const prefixMatch = ROLE_PREFIX_RE.exec(jdText.slice(Math.max(0, start - 30), start));
    const realStart = prefixMatch ? start - prefixMatch[0].length : start;
    const rest = jdText.slice(start, start + ROLE_PROSE_WINDOW);
    const stopMatch = ROLE_SUFFIX_STOP_RE.exec(rest);
    const end = start + (stopMatch ? stopMatch.index : rest.length);
    const cleaned = cleanTitleCandidate(jdText.slice(realStart, end));
    if (cleaned) out.push(cleaned);
  }
  return out;
}

/** Exacta (normalizada) y por subsunción — la viñeta larga
 *  ("Desarrollador/a COBOL con inglés conversacional...") y la frase corta
 *  que `proseCandidates` encuentra escaneando la misma línea
 *  ("Desarrollador/a COBOL") son el mismo candidato; se queda el más largo. */
function dedupeCandidates(candidates: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const candidate of candidates) {
    const key = candidate.replace(/\s+/g, " ").trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      unique.push(candidate);
    }
  }
  return unique.filter((candidate, index) => {
    const lower = candidate.toLowerCase();
    return !unique.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      const otherLower = other.toLowerCase();
      return otherLower.length > lower.length && (otherLower.startsWith(lower) || otherLower.endsWith(lower));
    });
  });
}

const GREETING_LINE_RE = /^[ \t]*(?:hola|buenas|buen[ \t]*d[ií]a|hi|hello|hey)\b[^.\n]{0,40}$/imu;

/** Último recurso, sólo cuando ni las viñetas ni ninguna mención de rol
 *  encontraron nada: la primera línea que no sea un saludo, corta y sin
 *  punto final — sigue sin inventar nada si ni eso aparece. */
function firstLineFallback(jdText: string): string {
  for (const line of jdText.split("\n").slice(0, 3)) {
    if (GREETING_LINE_RE.test(line)) continue;
    if (line.length > 0 && line.length <= 80 && !line.trim().endsWith(".")) {
      const cleaned = cleanTitleCandidate(line);
      if (cleaned) return cleaned;
    }
    break;
  }
  return "";
}

/**
 * Ante la duda, `""` en el primer elemento — el título real lo deriva
 * `analyzeJob` al generar el CV (ver `app/api/generate/cv/route.ts`); esta
 * heurística sólo sirve para la etiqueta de la fila del tracker y para
 * prellenar un campo editable, así que no hay costo en ser conservador.
 */
function collectTitleCandidates(jdText: string): string[] {
  const labeled = LABELED_TITLE_RE.exec(jdText);
  const labeledCandidate = labeled ? cleanTitleCandidate(labeled[1]) : "";

  const candidates = dedupeCandidates(
    [labeledCandidate, ...bulletCandidates(jdText), ...proseCandidates(jdText)].filter(Boolean),
  );
  if (candidates.length > 0) return candidates;

  const fallback = firstLineFallback(jdText);
  return fallback ? [fallback] : [];
}

const LABELED_LOCATION_RE = new RegExp(
  String.raw`^[ \t]*${LEADING_DECORATION}(?:work\s*location|location|ubicaci[oó]n|lugar)[ \t]*[:\-][ \t]*(.+)$`,
  "imu",
);

function guessLocation(jdText: string): string {
  const match = LABELED_LOCATION_RE.exec(jdText);
  if (!match) return "";
  return (match[1].split("|")[0] ?? "").trim().slice(0, 120);
}

// --- Empresa/ubicación mencionadas sin etiqueta ni link: sólo sugerencia ---
//
// A diferencia de todo lo de arriba, acá el texto nunca alcanza para tener
// certeza — "Proyecto para Accenture" puede ser quien contrata o el cliente
// final de una consultora de staffing, y eso ni un humano lo resuelve sólo
// con la publicación. Por eso estas dos nunca completan `company`/`location`
// directo: quedan aparte, y el popup las ofrece como un click para aceptar,
// nunca como el valor ya puesto.

const COMPANY_MENTION_RE =
  /\bEn[ \t]+([A-ZÁÉÍÓÚÑ][\wÀ-ÿ.&-]*(?:[ \t]+[A-ZÁÉÍÓÚÑ][\wÀ-ÿ.&-]*){0,2})[ \t]+(?:tenemos|buscamos|estamos|somos)\b/u;

function suggestCompany(jdText: string): string {
  const match = COMPANY_MENTION_RE.exec(jdText);
  return match ? match[1].trim() : "";
}

const PIN_LOCATION_RE = new RegExp(String.raw`^[ \t]*📍[ \t]*(.+)$`, "mu");

function suggestLocation(jdText: string): string {
  const match = PIN_LOCATION_RE.exec(jdText);
  if (!match) return "";
  return (match[1].split("|")[0] ?? "").trim().slice(0, 120);
}

// --- URL del puesto ---------------------------------------------------------

function attachedJobUrl(card: string): string | undefined {
  const match = /href="(https:\/\/www\.linkedin\.com\/jobs\/view\/\d+)[^"]*"/i.exec(card);
  return match ? match[1] : undefined;
}

/** Sin aviso adjunto, la URL propia es el permalink de la publicación — el
 *  id vive en el `componentkey` de `translatable-commentary-…`, como
 *  `ShareUrn(shareId=<n>)` o `UserGeneratedContentPostUrn(userGeneratedContentId=<n>)`
 *  (verificado 18/18: 17 avisos comparten un share, el resto es un ugcPost). */
function permalinkUrl(card: string): string | undefined {
  const share = /shareId=(\d+)/.exec(card);
  if (share) return `https://www.linkedin.com/feed/update/urn:li:share:${share[1]}/`;
  const ugcPost = /userGeneratedContentId=(\d+)/.exec(card);
  if (ugcPost) return `https://www.linkedin.com/feed/update/urn:li:ugcPost:${ugcPost[1]}/`;
  return undefined;
}

export function extractLinkedInPost(html: string, url: string): ImportedJobFields | null {
  const card = locateCard(html, url);
  if (!card) return null;

  const box = extractElementByAttr(card, "data-testid", "expandable-text-box");
  if (!box) return null;
  const jdText = stripPostText(box);
  if (!jdText) return null;

  const author = extractAuthor(card);
  const company = author?.isCompany ? author.name : companyFromTextMention(box);
  const location = guessLocation(jdText);

  const titleCandidates = collectTitleCandidates(jdText);

  return {
    jobTitle: titleCandidates[0] ?? "",
    // Sólo cuando hay más de uno entre los que elegir — con un único
    // candidato no hay nada que ofrecer aparte del propio `jobTitle`.
    jobTitleCandidates: titleCandidates.length > 1 ? titleCandidates : undefined,
    company,
    // Nunca pisa un dato ya resuelto (autor-empresa o mención con link) —
    // sólo se ofrece cuando el campo real quedó vacío.
    suggestedCompany: company ? undefined : suggestCompany(jdText) || undefined,
    location,
    suggestedLocation: location ? undefined : suggestLocation(jdText) || undefined,
    // El mismo texto dice "Onsite", "Hybrid" y "remote" en publicaciones
    // distintas — a diferencia de un aviso estructurado, acá no hay un único
    // campo de modalidad del que afirmar `true` ante una señal explícita.
    remote: null,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    jdText,
    jsonld: null,
    employmentType: null,
    datePosted: null,
    validThrough: null,
    fromFallback: false,
    extractedFrom: "site-post",
    domJobUrl: attachedJobUrl(card) ?? permalinkUrl(card),
  };
}
