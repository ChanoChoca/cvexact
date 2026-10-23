// https://workable.readme.io/reference/public-api-jobs — endpoint público de
// careers page sin auth. `details=true` trae `description` completo por
// aviso; sin ese parámetro el listado viene sin descripción.
import { text, mapSeniority, resolveCountry } from "../shared.mjs";

export const ats = "workable";

export function endpoint(token) {
  return `https://www.workable.com/api/accounts/${encodeURIComponent(token)}?details=true`;
}

export function rows(body, entry) {
  const items = Array.isArray(body?.jobs) ? body.jobs : [];
  return items
    .filter((j) => text(j.shortcode) && text(j.title))
    .map((j) => {
      const loc = j.location ?? {};
      const location = [loc.city, loc.region, loc.country].map((t) => text(t)).filter(Boolean).join(", ");
      const country =
        /^[A-Za-z]{2}$/.test(text(loc.countryCode))
          ? text(loc.countryCode).toUpperCase()
          : resolveCountry(`${location} ${text(loc.country)}`);
      // `workplace` es el campo estructurado que Workable expone para esto
      // ("on-site" | "remote" | "hybrid"); `telecommuting` es el flag legado
      // que sigue apareciendo en cuentas viejas.
      const workplace = text(loc.workplace || j.workplace).toLowerCase();
      const workMode =
        workplace === "remote" || j.telecommuting === true
          ? "remote"
          : workplace === "hybrid"
            ? "hybrid"
            : country === "AR"
              ? "onsite"
              : "unknown";
      return {
        id: `${ats}:${entry.token}:${j.shortcode}`,
        source: ats,
        url: text(j.url),
        title: text(j.title),
        company: text(entry.name),
        location,
        country,
        workMode,
        seniority: mapSeniority(j.title),
        language: "",
        tags: [j.department].map((t) => text(t)).filter(Boolean),
        description: text(j.description),
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        publishedAt: j.created ? new Date(j.created) : null,
        canPrefill: true,
      };
    });
}
