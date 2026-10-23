// https://developers.ashbyhq.com/docs/public-job-posting-api — endpoint
// público sin auth. `includeCompensation=true` agrega el resumen de sueldo
// cuando la empresa lo carga (no todas lo hacen).
import { text, num, mapSeniority, resolveCountry } from "../shared.mjs";

export const ats = "ashby";

export function endpoint(token) {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`;
}

export function rows(body, entry) {
  const items = Array.isArray(body?.jobs) ? body.jobs : [];
  return items
    .filter((j) => j.id != null && text(j.title))
    .map((j) => {
      const location = text(j.location);
      const country = resolveCountry(location);
      const comp = j.compensation?.summaryComponents?.find(
        (c) => typeof c?.minValue === "number" || typeof c?.maxValue === "number",
      );
      return {
        id: `${ats}:${entry.token}:${j.id}`,
        source: ats,
        url: text(j.jobUrl) || text(j.applyUrl),
        title: text(j.title),
        company: text(entry.name),
        location,
        country,
        workMode: j.isRemote === true ? "remote" : country === "AR" ? "onsite" : "unknown",
        seniority: mapSeniority(j.title),
        language: "",
        tags: [j.department, j.team, j.employmentType].map((t) => text(t)).filter(Boolean),
        description: text(j.descriptionPlain) || text(j.descriptionHtml),
        salaryMin: num(comp?.minValue),
        salaryMax: num(comp?.maxValue),
        salaryCurrency: text(comp?.currencyCode) || null,
        publishedAt: j.publishedAt ? new Date(j.publishedAt) : null,
        canPrefill: true,
      };
    });
}
