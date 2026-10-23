// Trae listados de portales de empleo públicos y los guarda en `job_posting`
// para que /api/jobs/feed los sirva y lib/jobs/score.ts los puntúe en el
// navegador contra el perfil de cada usuario — ver el plan de "descubrimiento
// de empleo" que agregó esta tabla, en lib/db/schema.ts, para el porqué de esa
// división cliente/servidor.
//
// Cuatro fuentes hoy, las cuatro sin API key: Get on Board (LatAm tech),
// Himalayas, Remotive y Arbeitnow (las tres remoto/EU, de relleno). Cada
// `read*` de abajo devuelve filas ya en la forma de `job_posting`; nada se
// reescribe ni se resume — lo que el candidato lee es lo que la fuente
// publicó. RemoteOK quedó afuera por ahora: devuelve 403 a un fetch sin un
// User-Agent de navegador real, y falsear uno para una fuente sin key propia
// no valía la pena todavía.
//
// Como scripts/prune.mjs y scripts/backup.mjs: standalone, sólo `pg` y fetch
// nativo (Node 24), sin importar nada de lib/ — un script de CronJob corre en
// la imagen `migrator`, que no compila TypeScript. La duplicación con
// lib/jobs/score.ts (los mismos enums `workMode`/`seniority` que
// lib/schemas/job.ts) es a propósito: ver el comentario de `job_posting` en
// lib/db/schema.ts. Los helpers de texto/fecha/normalización sí se comparten
// — ver scripts/jobs/shared.mjs — porque esos no dependen de la forma de
// ninguna fuente en particular.
//
// Upsert por `id = "${source}:${externalId}"`, así una re-ingesta pisa la fila
// existente en vez de duplicarla. Nada borra lo que dejó de aparecer en una
// fuente — eso lo hace scripts/prune.mjs por antigüedad de `fetched_at`, igual
// que ya hace con el resto de las tablas que crecen solas.
import { Pool } from "pg";
import { getJson, text, num, mapSeniority, toTimestamp, dedupGroupId, resolveCountry } from "./jobs/shared.mjs";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

/** Por fuente. Ninguna pagina más allá de esto por corrida — se corre cada
 *  30 minutos (ver el CronJob), así que no hace falta traer miles de la vez:
 *  lo nuevo de la corrida siguiente llega igual. */
const PAGE_LIMIT = 100;

// --- Get on Board -----------------------------------------------------------
//
// API pública sin key: https://www.getonbrd.com/api-doc.html. La búsqueda
// exige al menos uno de query/companies/featured/remote/country_code/
// board_host — country_code=AR es el que nos interesa, y de paso filtra a lo
// que le importa a este producto en vez de traer todo el catálogo (Chile y
// México pesan más que Argentina en el volumen total).
//
// `tags`, `seniority`, `modality`, `location_*` y `company` no son los
// valores planos que la forma de la respuesta sugiere: son relaciones
// JSON:API (`{data: {id, type}}`), y este endpoint no responde a `?include=`
// con nada del lado de tags/seniority/modality — se probó y no vino
// `included`. Sin un mapa id → nombre para esas tres, mejor dejarlas afuera
// que inventarlas; `workMode` no depende de ninguna de ellas (usa `remote` y
// `countries`, que sí son valores planos), y `description`/`título` le siguen
// dando a `matchKeywords` texto de sobra para leer tecnologías nombradas.
//
// `company` sí vale la pena resolver — es lo primero que se lee de un
// listado — y a diferencia de las otras tres, tiene su propio endpoint por
// id (`/api/v0/companies/{id}`). `resolveCompanyNames` lo hace una vez por
// corrida, deduplicando: una página de 50 avisos trae ~25 empresas distintas,
// así que es una fracción de los requests que un lookup por aviso sería.
async function resolveCompanyNames(companyIds) {
  const names = new Map();
  const ids = [...new Set(companyIds)];
  let cursor = 0;
  const CONCURRENCY = 8;

  async function worker() {
    while (cursor < ids.length) {
      const id = ids[cursor];
      cursor += 1;
      try {
        const body = await getJson(`https://www.getonbrd.com/api/v0/companies/${id}`);
        names.set(id, text(body?.data?.attributes?.name));
      } catch {
        names.set(id, "");
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  return names;
}

async function readGetonbrd() {
  const raw = [];
  for (let page = 1; page <= 2; page += 1) {
    const body = await getJson(
      `https://www.getonbrd.com/api/v0/search/jobs?country_code=AR&per_page=50&page=${page}`,
    );
    const items = Array.isArray(body?.data) ? body.data : [];
    if (items.length === 0) break;
    raw.push(...items);
    if (page >= (body?.meta?.total_pages ?? 1)) break;
  }

  const companyNames = await resolveCompanyNames(
    raw.map((item) => item.attributes?.company?.data?.id).filter((id) => id != null),
  );

  return raw.map((item) => {
    const a = item.attributes ?? {};
    const countries = Array.isArray(a.countries) ? a.countries : [];
    const isRemote = a.remote === true || countries.includes("Remote");
    const companyId = a.company?.data?.id;
    // "lang_not_specified" is the sentinel Get on Board itself uses for "the
    // poster never said" — treated the same as an absent field everywhere
    // else here, not passed through as if it were a real BCP-47 tag.
    const lang = text(a.lang);

    return {
      id: `getonbrd:${item.id}`,
      source: "getonbrd",
      url: text(item.links?.public_url),
      title: text(a.title),
      company: companyId != null ? (companyNames.get(companyId) ?? "") : "",
      location: countries.filter((c) => c !== "Remote").join(", "),
      // La consulta entera ya pide country_code=AR — ver el comentario de
      // `country` en job_posting (lib/db/schema.ts): esto no es un parseo por
      // aviso, es que la fuente ya filtró por nosotros.
      country: "AR",
      workMode: isRemote ? "remote" : countries.length > 0 ? "onsite" : "unknown",
      seniority: "unknown",
      language: lang === "lang_not_specified" ? "" : lang,
      tags: [],
      description: text(a.description) || text(a.description_headline),
      salaryMin: num(a.min_salary),
      salaryMax: num(a.max_salary),
      salaryCurrency: null,
      publishedAt: toTimestamp(a.published_at),
      canPrefill: true,
    };
  });
}

// --- Himalayas ----------------------------------------------------------------
//
// https://himalayas.app/api — sin key, cursor de paginación, pero una sola
// página (50) alcanza por corrida de 30 minutos. Sitio de remoto puro: todo
// lo que lista es workMode "remote". No declara idioma; el sitio es en
// inglés, así que se asume "en" en vez de dejarlo vacío — a diferencia de
// Arbeitnow más abajo, acá la fuente entera es de un solo idioma.
async function readHimalayas() {
  const body = await getJson(`https://himalayas.app/jobs/api?limit=${PAGE_LIMIT}`);
  const items = Array.isArray(body?.jobs) ? body.jobs : [];

  return items
    .filter((j) => text(j.guid))
    .map((j) => ({
      id: `himalayas:${text(j.guid)}`,
      source: "himalayas",
      url: text(j.applicationLink) || text(j.guid),
      title: text(j.title),
      company: text(j.companyName),
      location: Array.isArray(j.locationRestrictions) ? j.locationRestrictions.join(", ") : "",
      // Sin scoping por país en la request: el país sale de las restricciones
      // de ubicación que el aviso declara, y sólo si nombran uno solo. Sólo
      // ordena el feed — la fuente produce "remote", que no pasa por el
      // filtro Presencial/Híbrido. Ver `country` en job_posting.
      country: resolveCountry(Array.isArray(j.locationRestrictions) ? j.locationRestrictions.join(", ") : ""),
      workMode: "remote",
      seniority: mapSeniority(Array.isArray(j.seniority) ? j.seniority[0] : j.seniority),
      language: "en",
      tags: Array.isArray(j.categories) ? j.categories.filter((c) => typeof c === "string") : [],
      description: text(j.description) || text(j.excerpt),
      salaryMin: num(j.minSalary),
      salaryMax: num(j.maxSalary),
      salaryCurrency: text(j.currency) || null,
      publishedAt: toTimestamp(j.pubDate),
      canPrefill: true,
    }));
}

// --- Remotive -------------------------------------------------------------
//
// https://remotive.com/api/remote-jobs — sin key. Tampoco declara seniority
// ni idioma de forma estructurada; "unknown"/"en" por la misma razón que
// arriba (sitio remoto, en inglés).
async function readRemotive() {
  const body = await getJson(`https://remotive.com/api/remote-jobs?limit=${PAGE_LIMIT}`);
  const items = Array.isArray(body?.jobs) ? body.jobs : [];

  return items
    .filter((j) => j.id != null)
    .map((j) => ({
      id: `remotive:${j.id}`,
      source: "remotive",
      url: text(j.url),
      title: text(j.title),
      company: text(j.company_name),
      location: text(j.candidate_required_location),
      // Mismo criterio que Himalayas arriba, sobre el país que el aviso exige.
      country: resolveCountry(text(j.candidate_required_location)),
      workMode: "remote",
      seniority: "unknown",
      language: "en",
      tags: Array.isArray(j.tags) ? j.tags.filter((t) => typeof t === "string") : [],
      description: text(j.description),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      publishedAt: j.publication_date ? new Date(j.publication_date) : null,
      canPrefill: true,
    }));
}

// --- Arbeitnow --------------------------------------------------------------
//
// https://www.arbeitnow.com/api/job-board-api — sin key, mayormente Alemania.
// No declara idioma y los avisos vienen mezclados en alemán e inglés (a
// diferencia de Himalayas/Remotive, que son un solo idioma cada una), así que
// language queda "" en vez de asumir uno — igual que jobAnalysisSchema no
// adivina lo que no puede leer.
//
// Por el mismo motivo, un aviso no remoto NUNCA pasa a workMode "onsite"
// acá: la request no filtra por país (a diferencia de Get on Board) y
// `j.location` es texto libre de una fuente mayormente europea — no hay
// forma honesta de saber si un aviso puntual es de Argentina. Antes se
// asumía "onsite" con sólo que `location` no viniera vacío, y el resultado
// era que el filtro "Presencial" de /empleos terminaba mostrando mayormente
// avisos alemanes. Ver el comentario de `country` en `job_posting`
// (lib/db/schema.ts): `workMode: "unknown"` + `country: ""` es lo que hace
// que ese filtro los excluya, en vez de depender de que nadie vuelva a
// escribir esta línea distinto.
async function readArbeitnow() {
  const body = await getJson("https://www.arbeitnow.com/api/job-board-api");
  const items = Array.isArray(body?.data) ? body.data : [];

  return items
    .filter((j) => text(j.slug))
    .slice(0, PAGE_LIMIT)
    .map((j) => ({
      id: `arbeitnow:${text(j.slug)}`,
      source: "arbeitnow",
      url: text(j.url),
      title: text(j.title),
      company: text(j.company_name),
      location: text(j.location),
      // Sólo ordena el feed: `workMode` sigue en "unknown" para lo no remoto,
      // así que un país deducido de texto libre nunca habilita "Presencial".
      country: resolveCountry(text(j.location)),
      workMode: j.remote === true ? "remote" : "unknown",
      seniority: "unknown",
      language: "",
      tags: Array.isArray(j.tags) ? j.tags.filter((t) => typeof t === "string") : [],
      description: text(j.description),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      publishedAt: toTimestamp(j.created_at),
      canPrefill: true,
    }));
}

// --- Jobicy ------------------------------------------------------------------
//
// https://jobicy.com/api/v2/remote-jobs — sin key. Mismo criterio que
// Himalayas y Remotive: sitio de remoto puro, en inglés, sin scoping por
// país en la request.
async function readJobicy() {
  const body = await getJson(`https://jobicy.com/api/v2/remote-jobs?count=${PAGE_LIMIT}`);
  const items = Array.isArray(body?.jobs) ? body.jobs : [];

  return items
    .filter((j) => j.id != null)
    .map((j) => ({
      id: `jobicy:${j.id}`,
      source: "jobicy",
      url: text(j.url),
      title: text(j.jobTitle),
      company: text(j.companyName),
      location: text(j.jobGeo),
      country: resolveCountry(text(j.jobGeo)),
      workMode: "remote",
      seniority: mapSeniority(j.jobLevel),
      language: "en",
      tags: Array.isArray(j.jobIndustry) ? j.jobIndustry.filter((t) => typeof t === "string") : [],
      description: text(j.jobExcerpt) || text(j.jobDescription),
      salaryMin: num(j.annualSalaryMin),
      salaryMax: num(j.annualSalaryMax),
      salaryCurrency: text(j.salaryCurrency) || null,
      publishedAt: j.pubDate ? new Date(j.pubDate) : null,
      canPrefill: true,
    }));
}

const SOURCES = [
  ["getonbrd", readGetonbrd],
  ["himalayas", readHimalayas],
  ["remotive", readRemotive],
  ["arbeitnow", readArbeitnow],
  ["jobicy", readJobicy],
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function upsert(row) {
  await pool.query(
    `INSERT INTO job_posting (
       id, source, url, title, company, location, country, work_mode, seniority,
       language, tags, description, salary_min, salary_max, salary_currency,
       published_at, fetched_at, can_prefill, dedup_group_id
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now(), $17, $18)
     ON CONFLICT (id) DO UPDATE SET
       url = excluded.url,
       title = excluded.title,
       company = excluded.company,
       location = excluded.location,
       country = excluded.country,
       work_mode = excluded.work_mode,
       seniority = excluded.seniority,
       language = excluded.language,
       tags = excluded.tags,
       description = excluded.description,
       salary_min = excluded.salary_min,
       salary_max = excluded.salary_max,
       salary_currency = excluded.salary_currency,
       published_at = excluded.published_at,
       fetched_at = now(),
       can_prefill = excluded.can_prefill,
       dedup_group_id = excluded.dedup_group_id`,
    [
      row.id,
      row.source,
      row.url,
      row.title,
      row.company,
      row.location,
      row.country,
      row.workMode,
      row.seniority,
      row.language,
      JSON.stringify(row.tags),
      row.description,
      row.salaryMin,
      row.salaryMax,
      row.salaryCurrency,
      row.publishedAt,
      row.canPrefill,
      dedupGroupId(row.company, row.title),
    ],
  );
}

try {
  let total = 0;
  for (const [name, read] of SOURCES) {
    try {
      const rows = (await read()).filter((r) => r.title && r.url);
      for (const row of rows) await upsert(row);
      console.log(`${name}: ${rows.length} aviso(s).`);
      total += rows.length;
    } catch (err) {
      // Una fuente caída no debe tirar abajo a las demás — cada una es
      // independiente, y la próxima corrida (30 min después) lo vuelve a
      // intentar sola.
      console.error(`${name}: falló —`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`Ingesta terminada: ${total} aviso(s) en total.`);
} finally {
  await pool.end();
}
