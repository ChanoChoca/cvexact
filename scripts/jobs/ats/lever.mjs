// https://github.com/lever/postings-api — endpoint público sin auth, la
// respuesta es un array de avisos directamente (no envuelto en un objeto).
import { text, num, mapSeniority, resolveCountry } from "../shared.mjs";

export const ats = "lever";

export function endpoint(token) {
  return `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`;
}

export function rows(body, entry) {
  const items = Array.isArray(body) ? body : [];
  return items
    .filter((j) => j.id != null && text(j.text))
    .map((j) => {
      const location = text(j.categories?.location);
      const country = resolveCountry(location);
      // `workplaceType` es el campo estructurado que Lever agregó para esto
      // ("remote" | "hybrid" | "on-site"); no todas las cuentas lo completan,
      // así que cae a texto libre de ubicación cuando falta.
      const workplace = text(j.workplaceType).toLowerCase();
      const workMode =
        workplace === "remote" || /remote|remoto/i.test(location)
          ? "remote"
          : workplace === "hybrid"
            ? "hybrid"
            : (workplace === "on-site" || workplace === "onsite") && country === "AR"
              ? "onsite"
              : "unknown";
      const salary = j.salaryRange ?? j.salaryDescription ?? null;
      return {
        id: `${ats}:${entry.token}:${j.id}`,
        source: ats,
        url: text(j.hostedUrl) || text(j.applyUrl),
        title: text(j.text),
        company: text(entry.name),
        location,
        country,
        workMode,
        seniority: mapSeniority(`${j.text} ${text(j.categories?.commitment)}`),
        language: "",
        tags: [j.categories?.team, j.categories?.department]
          .map((t) => text(t))
          .filter(Boolean),
        description: text(j.descriptionPlain) || text(j.description),
        salaryMin: num(salary?.min),
        salaryMax: num(salary?.max),
        salaryCurrency: text(salary?.currency) || null,
        publishedAt: j.createdAt ? new Date(Number(j.createdAt)) : null,
        canPrefill: true,
      };
    });
}
