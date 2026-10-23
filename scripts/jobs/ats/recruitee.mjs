// https://docs.recruitee.com/reference/offers — endpoint público sin auth.
// El único de los seis que declara `remote` como booleano propio, así que acá
// no hace falta inferirlo del texto de ubicación.
import { text, mapSeniority, resolveCountry } from "../shared.mjs";

export const ats = "recruitee";

export function endpoint(token) {
  return `https://${encodeURIComponent(token)}.recruitee.com/api/offers/`;
}

export function rows(body, entry) {
  const items = Array.isArray(body?.offers) ? body.offers : [];
  return items
    .filter((j) => j.id != null && text(j.title))
    .map((j) => {
      const location = [j.city, j.country].map((t) => text(t)).filter(Boolean).join(", ");
      const country = j.country && /argentin/i.test(text(j.country)) ? "AR" : resolveCountry(location);
      return {
        id: `${ats}:${entry.token}:${j.id}`,
        source: ats,
        url: text(j.careers_apply_url) || text(j.careers_url),
        title: text(j.title),
        company: text(entry.name),
        location,
        country,
        workMode: j.remote === true ? "remote" : country === "AR" ? "onsite" : "unknown",
        seniority: mapSeniority(j.title),
        language: "",
        tags: [j.department].map((t) => text(t)).filter(Boolean),
        description: text(j.description),
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        publishedAt: j.published_at ? new Date(j.published_at) : j.created_at ? new Date(j.created_at) : null,
        canPrefill: true,
      };
    });
}
