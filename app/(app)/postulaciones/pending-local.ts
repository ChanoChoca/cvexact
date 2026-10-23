import { useApplications } from "@/lib/storage/hooks";
import type { Application } from "@/lib/storage/local";
import type { TrackerApplication } from "@/lib/tracker/client-types";

/**
 * Las postulaciones que este navegador generó y que todavía no están en el
 * seguimiento. La coincidencia es por `id`: el mismo `crypto.randomUUID()`
 * vive de los dos lados (`tracker-plan.md` §2), así que un id presente en el
 * servidor ES esa misma postulación. Filtrar por puesto o empresa sería un
 * error: duplicaría avisos parecidos y rompería la regla de "duplicar
 * postulaciones, nunca" — `lib/tracker/duplicates.ts` ya se ocupa de avisar
 * las similitudes reales en la creación.
 */
export function pendingLocalApplications(
  local: Application[],
  tracked: TrackerApplication[],
): Application[] {
  const trackedIds = new Set(tracked.map((a) => a.id));
  return local.filter((a) => !trackedIds.has(a.id));
}

/**
 * La misma cuenta, reactiva. `useApplications` (`lib/storage/hooks.ts`) ya
 * revalida ante cada escritura de localStorage de la app, así que el banner,
 * el chip y el estado vacío de `/postulaciones` leen siempre el mismo número
 * de la misma fuente — tres vistas, un solo criterio.
 */
export function usePendingLocalApplications(tracked: TrackerApplication[]): Application[] {
  const local = useApplications();
  return pendingLocalApplications(local, tracked);
}
