// Ingesta desde los sistemas de seguimiento de postulantes (ATS) de una
// lista semilla de empresas — scripts/jobs/companies.json — vía sus
// endpoints públicos de job board, sin key. Es la fuente de menor riesgo
// legal del proyecto: cada endpoint existe para que terceros lo lean (ver
// scripts/jobs/ats/*.mjs, uno por ATS), a diferencia de scrapear una página
// de carreras.
//
// Script propio, no una fuente más dentro de scripts/ingest-jobs.mjs: son
// ~N requests por corrida (una por empresa de la lista semilla, hoy N=10),
// con otra cadencia (cada 3 horas, no cada 30 minutos — ver el CronJob en
// los CronJobs de tu despliegue) y otro perfil de falla — un token de empresa que
// dejó de existir da 404 para siempre, no un timeout ocasional.
//
// Cada request manda `If-None-Match` con el ETag de la corrida anterior
// (job_source_etag) y, si el ATS responde 304, no vuelve a escribir nada:
// evita upserts innecesarios y respeta el ancho de banda de una API pública
// que no pedimos permiso especial para usar. No todos los ATS declaran
// ETag — cuando no lo hacen, esta corrida simplemente vuelve a procesar todo
// (equivalente a no tener el ETag guardado).
//
// Standalone como scripts/ingest-jobs.mjs: sólo `pg` y fetch nativo (Node
// 24), sin importar nada de lib/ — corre en la imagen `migrator`, que no
// compila TypeScript.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Pool } from "pg";
import { dedupGroupId } from "./jobs/shared.mjs";
import * as greenhouse from "./jobs/ats/greenhouse.mjs";
import * as lever from "./jobs/ats/lever.mjs";
import * as ashby from "./jobs/ats/ashby.mjs";
import * as recruitee from "./jobs/ats/recruitee.mjs";
import * as workable from "./jobs/ats/workable.mjs";
import * as smartrecruiters from "./jobs/ats/smartrecruiters.mjs";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const TIMEOUT_MS = 15_000;

const ADAPTERS = {
  greenhouse,
  lever,
  ashby,
  recruitee,
  workable,
  smartrecruiters,
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const companies = JSON.parse(
  readFileSync(join(__dirname, "jobs", "companies.json"), "utf8"),
);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function etagFor(key) {
  const { rows } = await pool.query(
    "SELECT etag FROM job_source_etag WHERE key = $1",
    [key],
  );
  return rows[0]?.etag ?? null;
}

async function saveEtag(key, etag) {
  if (!etag) return;
  await pool.query(
    `INSERT INTO job_source_etag (key, etag, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET etag = excluded.etag, updated_at = now()`,
    [key, etag],
  );
}

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

async function ingestOne(entry) {
  const adapter = ADAPTERS[entry.ats];
  if (!adapter) {
    console.error(`${entry.ats}/${entry.token}: sin adaptador registrado — se salta.`);
    return { written: 0, skipped: true };
  }

  const key = `${entry.ats}:${entry.token}`;
  const previousEtag = await etagFor(key);
  const headers = previousEtag ? { "if-none-match": previousEtag } : {};

  const response = await fetch(adapter.endpoint(entry.token), {
    headers: { accept: "application/json", ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (response.status === 304) {
    return { written: 0, notModified: true };
  }
  if (!response.ok) {
    throw new Error(`respondió ${response.status}`);
  }

  const body = await response.json();
  const rows = adapter
    .rows(body, entry)
    .filter((r) => r.title && r.url);
  for (const row of rows) await upsert(row);
  await saveEtag(key, response.headers.get("etag"));
  return { written: rows.length };
}

try {
  let total = 0;
  let notModified = 0;
  for (const entry of companies) {
    const label = `${entry.ats}/${entry.token}`;
    try {
      const result = await ingestOne(entry);
      if (result.notModified) {
        notModified += 1;
        console.log(`${label}: sin cambios (304).`);
      } else if (!result.skipped) {
        total += result.written;
        console.log(`${label}: ${result.written} aviso(s).`);
      }
    } catch (err) {
      // Un token muerto o una empresa caída no debe tirar abajo a las
      // demás — la próxima corrida (cada 3 horas) lo vuelve a intentar sola.
      console.error(`${label}: falló —`, err instanceof Error ? err.message : err);
    }
  }
  console.log(
    `Ingesta ATS terminada: ${total} aviso(s) en total, ${notModified} empresa(s) sin cambios.`,
  );
} finally {
  await pool.end();
}
