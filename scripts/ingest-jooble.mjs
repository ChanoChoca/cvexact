// Ingesta de Jooble Argentina — deliberadamente SEPARADA de scripts/
// ingest-jobs.mjs y de su CronJob de cada 30 minutos.
//
// La key gratuita de Jooble no es una cuota diaria como todo lo demás que
// este proyecto mide (usage_counter, app_rate_limit): son 500 requests de
// por vida, para siempre, sin reinicio. Un cron cada 30 minutos la gastaría
// en menos de dos semanas y después la fuente no aportaría nada por el resto
// de la vida del despliegue, sin que nada lo avise. Este script en cambio:
//
//   1. Lee cuánto se gastó ya de la tabla `job_source_budget` (nunca podada
//      por scripts/prune.mjs — ver el comentario de esa tabla en
//      lib/db/schema.ts).
//   2. Se niega a llamar si eso se acerca al techo (JOOBLE_BUDGET_CEILING,
//      bien por debajo de 500 a propósito: ver la constante).
//   3. Hace pocas queries anchas por corrida — no una por categoría — y
//      guarda cuánto gastó, atómicamente, en la misma tabla.
//
// Pensado para correr poco: un CronJob semanal (ver los CronJobs de tu despliegue)
// y, cuando haga falta ver ofertas nuevas antes de esa semana, a mano con
//   kubectl create job --from=cronjob/cvexact-jobs-jooble jooble-manual-1
//
// canPrefill queda en false SIEMPRE para esta fuente: Jooble cobra por click
// hacia jooble.org, y su respuesta trae sólo `snippet` — un fragmento, no el
// aviso entero — así que precargar el asistente con eso sería tanto faltarle
// al tráfico que Jooble cobra como entregarle a analyzeJob() un texto
// demasiado pobre para leer. "Postular" manda derecho al aviso en Jooble.
//
// Standalone como scripts/ingest-jobs.mjs: sólo `pg` y fetch nativo (Node
// 24), sin importar nada de lib/ — corre en la imagen `migrator`, que no
// compila TypeScript. Los helpers de texto/fecha/normalización sí se
// comparten con las demás fuentes — ver scripts/jobs/shared.mjs.
import { Pool } from "pg";
import { text, toDate, normalize, dedupGroupId } from "./jobs/shared.mjs";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const API_KEY = process.env.JOOBLE_AR_API_KEY?.trim();
if (!API_KEY) {
  // No es un error: la fuente simplemente no está configurada todavía. El
  // CronJob sigue existiendo y corriendo (no cuesta nada hacerlo), y
  // arranca solo el día que se cargue la key en el Secret.
  console.log("JOOBLE_AR_API_KEY no está configurada — nada que hacer.");
  process.exit(0);
}

/**
 * Techo de gasto, bien por debajo del límite real de 500. Deja margen para:
 * llamadas de prueba manuales mientras se calibra JOOBLE_QUERIES, y para que
 * "se niega a llamar" avise con tiempo de sobra antes de quedarse en 0 en
 * vez de en la corrida exacta que lo agota.
 */
const BUDGET_CEILING = Number(process.env.JOOBLE_BUDGET_CEILING) || 400;

/**
 * Las queries que se corren por vez, separadas por `;`. Anchas a propósito:
 * el objetivo es cobertura del mercado argentino más allá de tech —que ya
 * cubre bien Get on Board—, así que por defecto es una sola búsqueda vacía
 * de palabra clave que Jooble interpreta como "todo" en la ubicación dada,
 * no una por rubro. Configurable porque no hay forma de calibrar la mezcla
 * ideal sin una key real para probar contra la API en vivo.
 */
const QUERIES = (process.env.JOOBLE_QUERIES ?? "")
  .split(";")
  .map((q) => q.trim())
  .filter(Boolean);
if (QUERIES.length === 0) QUERIES.push("");

const RESULTS_PER_QUERY = Number(process.env.JOOBLE_RESULTS_PER_QUERY) || 100;
/** El país no lo decide el subdominio de la key — lo pide el body de cada
 *  búsqueda, como cualquier otro filtro. Configurable por si algún día se
 *  quiere acotar a una provincia u otra ubicación más fina. */
const LOCATION = process.env.JOOBLE_LOCATION?.trim() || "Argentina";
const TIMEOUT_MS = 15_000;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function currentBudget() {
  const { rows } = await pool.query(
    "SELECT used FROM job_source_budget WHERE source = 'jooble'",
  );
  return rows[0]?.used ?? 0;
}

/** Suma `calls` al contador, atómicamente — nunca lee-modifica-escribe en dos pasos. */
async function spendBudget(calls) {
  await pool.query(
    `INSERT INTO job_source_budget (source, used, updated_at)
     VALUES ('jooble', $1, now())
     ON CONFLICT (source) DO UPDATE SET
       used = job_source_budget.used + $1,
       updated_at = now()`,
    [calls],
  );
}

// Raíces, no palabras completas — "hibrid" alcanza para "híbrido" y para
// "híbrida" (concordancia de género: "modalidad híbrida", "trabajo
// híbrido") sin listar cada forma; "remot" alcanza para "remoto/remota/
// remotamente" y para el inglés "remote/remotely" con la misma entrada.
const REMOTE_MARKERS = ["remot", "teletrabajo", "home office", "desde casa", "desde tu casa"];
const HYBRID_MARKERS = ["hibrid", "hybrid"];

/**
 * Remoto/híbrido/presencial a partir del propio texto del aviso — Jooble no
 * entrega esto de forma estructurada. `title`+`snippet` es todo el texto que
 * la API da (`job.snippet` es un fragmento, no el aviso completo — el mismo
 * motivo por el que `canPrefill` es `false` para esta fuente).
 *
 * Sin marcador de remoto ni de híbrido, el default es "onsite" — no
 * "unknown" — apoyado en que `searchJooble` ya pide `location: LOCATION`
 * (Argentina por default): la búsqueda entera está scopeada, así que la
 * ausencia de un marcador de modalidad es evidencia real de presencial, el
 * mismo criterio que ya usa Get on Board para sus propios avisos scopeados
 * (`isRemote ? "remote" : countries.length > 0 ? "onsite" : "unknown"` en
 * scripts/ingest-jobs.mjs). Ver el comentario de `country` en `job_posting`
 * (lib/db/schema.ts) para por qué esto es seguro sólo porque `country` viaja
 * "AR" junto con el resultado, no porque esta clasificación sea infalible.
 *
 * Híbrido se comprueba antes que remoto: un aviso que dice "modalidad
 * híbrida, 2 días remotos" está nombrando su propia modalidad con esa
 * palabra, y la mención de "remoto" ahí describe cuántos días de la semana,
 * no contradice el híbrido.
 */
function classifyWorkMode(title, snippet) {
  const haystack = normalize(`${title} ${snippet}`);
  if (HYBRID_MARKERS.some((marker) => haystack.includes(marker))) return "hybrid";
  if (REMOTE_MARKERS.some((marker) => haystack.includes(marker))) return "remote";
  return "onsite";
}

/**
 * The key's own subdomain (`ar.jooble.org`) is where it was issued, not
 * where it is called: the documented endpoint is the bare apex domain, with
 * `location` in the body doing the country filtering instead — see
 * help.jooble.org's REST API documentation.
 */
async function searchJooble(keywords) {
  const response = await fetch(`https://jooble.org/api/${API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      keywords,
      location: LOCATION,
      page: 1,
      ResultOnPage: RESULTS_PER_QUERY,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Jooble respondió ${response.status} para "${keywords}"`);
  }
  return response.json();
}

async function upsert(row) {
  await pool.query(
    `INSERT INTO job_posting (
       id, source, url, title, company, location, country, work_mode, seniority,
       language, tags, description, salary_min, salary_max, salary_currency,
       published_at, fetched_at, can_prefill, dedup_group_id
     )
     VALUES ($1,'jooble',$2,$3,$4,$5,'AR',$6,'unknown','es','[]',$7,
             NULL,NULL,NULL,$8, now(), false, $9)
     ON CONFLICT (id) DO UPDATE SET
       url = excluded.url,
       title = excluded.title,
       company = excluded.company,
       location = excluded.location,
       work_mode = excluded.work_mode,
       description = excluded.description,
       published_at = excluded.published_at,
       fetched_at = now(),
       dedup_group_id = excluded.dedup_group_id`,
    [
      row.id,
      row.url,
      row.title,
      row.company,
      row.location,
      row.workMode,
      row.description,
      row.publishedAt,
      dedupGroupId(row.company, row.title),
    ],
  );
}

try {
  const used = await currentBudget();
  const remaining = BUDGET_CEILING - used;
  if (remaining < QUERIES.length) {
    console.error(
      `[jooble-budget] ${used} requests ya gastadas de un techo de ${BUDGET_CEILING} ` +
        `(límite real de Jooble: 500 de por vida). No queda margen para las ` +
        `${QUERIES.length} query(s) configuradas — no se llama a la API esta corrida.`,
    );
    process.exit(0);
  }

  let calls = 0;
  let total = 0;
  try {
    for (const keywords of QUERIES) {
      calls += 1; // Contado antes de la llamada: si la llamada gastó la
      // request en el lado de Jooble pero la respuesta se perdió por un
      // timeout, mejor sobreestimar el gasto que subestimarlo.
      const body = await searchJooble(keywords);
      const jobs = Array.isArray(body?.jobs) ? body.jobs : [];

      for (const job of jobs) {
        if (job?.id == null || !text(job.title) || !text(job.link)) continue;
        const title = text(job.title);
        const description = text(job.snippet);
        await upsert({
          id: `jooble:${job.id}`,
          url: text(job.link),
          title,
          company: text(job.company),
          location: text(job.location),
          workMode: classifyWorkMode(title, description),
          description,
          publishedAt: toDate(job.updated),
        });
        total += 1;
      }
      console.log(`jooble "${keywords || "(sin palabra clave)"}": ${jobs.length} aviso(s).`);
    }
  } finally {
    // Se registra el gasto haya o no haya terminado el for — una llamada que
    // Jooble ya cobró no se recupera porque el proceso se cayó después.
    if (calls > 0) await spendBudget(calls);
  }

  console.log(
    `Ingesta de Jooble terminada: ${total} aviso(s), ${calls} request(s) gastada(s) ` +
      `(${used + calls}/${BUDGET_CEILING} del techo, ${used + calls}/500 del límite real).`,
  );
} finally {
  await pool.end();
}
