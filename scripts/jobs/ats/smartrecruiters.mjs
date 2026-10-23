// https://developers.smartrecruiters.com/docs/job-postings — endpoint
// público sin auth, `GET /v1/companies/{id}/postings`. A diferencia de los
// otros cinco ATS, el listado no siempre trae la descripción completa del
// puesto (depende de cómo la empresa publicó el aviso) — sólo a veces viene
// `jobAd.sections.jobDescription.text`. Por eso `canPrefill` acá no es un
// `true` fijo como en el resto: es honesto sobre lo que realmente hay,
// mismo criterio que hace que Jooble sea `false` siempre.
import { text, mapSeniority, resolveCountry } from "../shared.mjs";

export const ats = "smartrecruiters";

export function endpoint(token) {
  return `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings`;
}

export function rows(body, entry) {
  const items = Array.isArray(body?.content) ? body.content : [];
  return items
    .filter((j) => j.id != null && text(j.name))
    .map((j) => {
      const loc = j.location ?? {};
      const location = [loc.city, loc.region, loc.country].map((t) => text(t)).filter(Boolean).join(", ");
      const country =
        /^[A-Za-z]{2}$/.test(text(loc.country)) ? text(loc.country).toUpperCase() : resolveCountry(location);
      const description = text(j.jobAd?.sections?.jobDescription?.text);
      return {
        id: `${ats}:${entry.token}:${j.id}`,
        source: ats,
        url: text(j.applyUrl) || text(j.ref),
        title: text(j.name),
        company: text(j.company?.name) || text(entry.name),
        location,
        country,
        workMode: loc.remote === true ? "remote" : country === "AR" ? "onsite" : "unknown",
        seniority: mapSeniority(j.name),
        language: "",
        tags: [j.department?.label, j.function?.label].map((t) => text(t)).filter(Boolean),
        description,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        publishedAt: j.releasedDate ? new Date(j.releasedDate) : null,
        canPrefill: description.length > 0,
      };
    });
}
