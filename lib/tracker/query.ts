import { isApplicationStatus, type ApplicationStatus } from "./status";
import type { ListApplicationsFilter } from "./service";

/**
 * Parsea el querystring de `GET /api/tracker/applications`. Separado de la
 * route por la misma razón que `lib/jobs/feed-query.ts`: cada `route.ts` de
 * este repo exporta sólo lo que Next.js reconoce, así que lo testeable vive
 * en `lib/`.
 */
export function parseApplicationsQuery(url: URL): ListApplicationsFilter {
  const statusParam = url.searchParams.get("status");
  const statuses = statusParam
    ? statusParam.split(",").map((s) => s.trim()).filter(isApplicationStatus)
    : undefined;

  const remoteParam = url.searchParams.get("remote");
  const remote = remoteParam === "true" ? true : remoteParam === "false" ? false : undefined;

  const createdFrom = parseDate(url.searchParams.get("createdFrom"));
  const createdTo = parseDate(url.searchParams.get("createdTo"));

  return {
    statuses: statuses?.length ? (statuses as ApplicationStatus[]) : undefined,
    includeArchived: url.searchParams.get("includeArchived") === "true",
    company: optionalParam(url, "company"),
    source: optionalParam(url, "source"),
    remote,
    createdFrom,
    createdTo,
  };
}

function optionalParam(url: URL, name: string): string | undefined {
  return url.searchParams.get(name)?.trim() || undefined;
}

function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
