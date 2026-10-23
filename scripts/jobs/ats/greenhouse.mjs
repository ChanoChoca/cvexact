// https://developers.greenhouse.io/job-board.html — endpoint público de job
// board, sin auth. `content=true` trae la descripción completa en HTML; sin
// ese parámetro el listado viene sin `content` y no serviría para nada acá.
//
// Cada adaptador de scripts/jobs/ats/ tiene la misma forma: `ats` (el nombre
// que va a `job_posting.source`), `endpoint(token)` y `rows(body, entry)` —
// ver scripts/ingest-ats.mjs, el único caller.
import { text, mapSeniority, resolveCountry } from "../shared.mjs";

export const ats = "greenhouse";

export function endpoint(token) {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
}

export function rows(body, entry) {
  const items = Array.isArray(body?.jobs) ? body.jobs : [];
  return items
    .filter((j) => j.id != null && text(j.title))
    .map((j) => {
      const location = text(j.location?.name);
      const country = resolveCountry(location);
      // Greenhouse no declara remoto de forma estructurada en este endpoint —
      // sólo texto libre de ubicación. "remote" únicamente cuando el propio
      // texto lo dice; nunca "onsite" salvo con evidencia de Argentina, igual
      // criterio que el resto de los adaptadores de ATS (ver el comentario de
      // `country` en lib/db/schema.ts).
      const isRemote = /remote|remoto/i.test(location);
      return {
        id: `${ats}:${entry.token}:${j.id}`,
        source: ats,
        url: text(j.absolute_url),
        title: text(j.title),
        company: text(entry.name),
        location,
        country,
        workMode: isRemote ? "remote" : country === "AR" ? "onsite" : "unknown",
        seniority: mapSeniority(j.title),
        language: "",
        tags: Array.isArray(j.departments)
          ? j.departments.map((d) => text(d?.name)).filter(Boolean)
          : [],
        description: text(j.content),
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        publishedAt: j.updated_at ? new Date(j.updated_at) : null,
        canPrefill: true,
      };
    });
}
