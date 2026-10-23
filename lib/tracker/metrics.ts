import { isClosedStatus, type ApplicationStatus } from "./status";

/**
 * Todo el cómputo de la página de analítica, separado de la consulta a la
 * base (`computeMetricsFromRows` es puro) por la misma razón que
 * `lib/jobs/feed-query.ts` separa el armado del SQL de la route: lo que
 * vale la pena testear no necesita una base de datos para correr.
 *
 * Todo sale de `application_event`, nunca del estado actual de
 * `application` — una postulación que pasó por entrevista y terminó
 * rechazada tiene que seguir contando como "llegó a entrevista".
 *
 * Se trae todo (aplicaciones + eventos del usuario) en dos consultas y se
 * agrega acá en JS, en vez de una consulta SQL por métrica. Es al revés de
 * cómo está escrito el resto del repo para datos de alto volumen, y es
 * deliberado: esto es el tablero de una sola cuenta, no un cron que
 * recorre a todos los usuarios — el volumen que hay que cuidar acá es
 * "cuántas veces se golpea la base por carga de página" (dos), no cuántas
 * filas trae cada consulta.
 */

export type MetricsApplicationRow = {
  id: string;
  source: string | null;
  cvVersionId: string | null;
  status: string;
  archived: boolean;
};

export type MetricsEventRow = {
  applicationId: string;
  eventType: string;
  toStatus: string | null;
  occurredAt: Date;
};

/** Eventos que no cuentan como "una respuesta real" — el alta, marcar que
 *  se postuló, y el acuse automático de recibido de un ATS. Todo lo demás
 *  (entrevista, evaluación, oferta, rechazo, y cualquier `cambio_manual`
 *  que el usuario haya hecho a mano) sí cuenta: si movió la tarjeta, es
 *  porque pasó algo. */
const NON_RESPONSE_EVENT_TYPES = new Set(["creada", "postulada", "confirmacion"]);

const FUNNEL_STAGES: ApplicationStatus[] = ["postulado", "en_revision", "entrevista", "oferta"];

/** Con menos postulaciones que esto agrupadas bajo una misma versión de CV,
 *  un porcentaje es ruido, no señal — se marca `significant: false` en vez
 *  de mostrarlo. */
export const CV_VERSION_MIN_SIGNIFICANT = 10;

export type TrackerMetrics = {
  total: number;
  active: number;
  closed: number;
  responseRate: { totalPostulated: number; responded: number; rate: number | null };
  medianDaysToFirstResponse: number | null;
  stageConversion: { stage: ApplicationStatus; count: number }[];
  bySource: SourceOrVersionMetric[];
  byCvVersion: (SourceOrVersionMetric & { significant: boolean })[];
  weeklyApplications: { weekStart: string; count: number }[];
};

type SourceOrVersionMetric = {
  key: string;
  label: string;
  total: number;
  responseRate: number | null;
  interviewRate: number | null;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Lunes de la semana ISO de `date`, como `YYYY-MM-DD`. */
function weekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // domingo (0) retrocede 6 días
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function computeMetricsFromRows(
  applications: MetricsApplicationRow[],
  events: MetricsEventRow[],
): TrackerMetrics {
  const eventsByApplication = new Map<string, MetricsEventRow[]>();
  for (const event of events) {
    const list = eventsByApplication.get(event.applicationId) ?? [];
    list.push(event);
    eventsByApplication.set(event.applicationId, list);
  }
  for (const list of eventsByApplication.values()) {
    list.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  }

  const applicationById = new Map(applications.map((a) => [a.id, a]));

  // --- Postulada / primera respuesta, por postulación ----------------------
  type Reached = { postuladaAt: Date | null; responseAt: Date | null; toStatuses: Set<string> };
  const reached = new Map<string, Reached>();
  for (const [applicationId, list] of eventsByApplication) {
    let postuladaAt: Date | null = null;
    let responseAt: Date | null = null;
    const toStatuses = new Set<string>();
    for (const event of list) {
      if (event.toStatus) toStatuses.add(event.toStatus);
      // `to_status`, no `event_type`: una postulación creada directamente en
      // `postulado` (el camino de "Ya me postulé" en `/empleos`) deja su
      // único evento con `event_type = 'creada'` — lo escribe el trigger de
      // la migración 0017, que no distingue el estado inicial — pero
      // `to_status` sí es 'postulado' en cualquiera de los dos casos.
      if (event.toStatus === "postulado" && !postuladaAt) postuladaAt = event.occurredAt;
      if (postuladaAt && !responseAt && !NON_RESPONSE_EVENT_TYPES.has(event.eventType) && event.occurredAt > postuladaAt) {
        responseAt = event.occurredAt;
      }
    }
    reached.set(applicationId, { postuladaAt, responseAt, toStatuses });
  }

  const postuladaIds = [...reached.entries()].filter(([, r]) => r.postuladaAt).map(([id]) => id);
  const respondedIds = postuladaIds.filter((id) => reached.get(id)?.responseAt);

  const responseTimesDays = respondedIds.map((id) => {
    const r = reached.get(id)!;
    return (r.responseAt!.getTime() - r.postuladaAt!.getTime()) / (1000 * 60 * 60 * 24);
  });

  // --- Conteos generales -----------------------------------------------------
  const open = applications.filter((a) => !a.archived && !isClosedStatus(a.status as ApplicationStatus));
  const closed = applications.filter((a) => !a.archived && isClosedStatus(a.status as ApplicationStatus));

  // --- Conversión por etapa ----------------------------------------------
  const stageConversion = FUNNEL_STAGES.map((stage) => ({
    stage,
    count: postuladaIds.filter((id) => reached.get(id)?.toStatuses.has(stage)).length,
  }));

  // --- Agrupación genérica por una clave (fuente, o versión de CV) ---------
  function groupBy(keyOf: (id: string) => string | null, labelOf: (key: string) => string): SourceOrVersionMetric[] {
    const groups = new Map<string, string[]>();
    for (const id of postuladaIds) {
      const key = keyOf(id);
      if (!key) continue;
      const list = groups.get(key) ?? [];
      list.push(id);
      groups.set(key, list);
    }
    return [...groups.entries()].map(([key, ids]) => {
      const responded = ids.filter((id) => reached.get(id)?.responseAt).length;
      const interviews = ids.filter((id) => reached.get(id)?.toStatuses.has("entrevista")).length;
      return {
        key,
        label: labelOf(key),
        total: ids.length,
        responseRate: ids.length ? responded / ids.length : null,
        interviewRate: ids.length ? interviews / ids.length : null,
      };
    });
  }

  const bySource = groupBy(
    (id) => applicationById.get(id)?.source ?? null,
    (key) => key,
  ).sort((a, b) => b.total - a.total);

  const byCvVersion = groupBy(
    (id) => applicationById.get(id)?.cvVersionId ?? null,
    (key) => key,
  )
    .map((m) => ({ ...m, significant: m.total >= CV_VERSION_MIN_SIGNIFICANT }))
    .sort((a, b) => b.total - a.total);

  // --- Serie semanal ---------------------------------------------------------
  const weekly = new Map<string, number>();
  for (const id of postuladaIds) {
    const at = reached.get(id)?.postuladaAt;
    if (!at) continue;
    const key = weekStart(at);
    weekly.set(key, (weekly.get(key) ?? 0) + 1);
  }
  const weeklyApplications = [...weekly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, count]) => ({ weekStart, count }));

  return {
    total: applications.filter((a) => !a.archived).length,
    active: open.length,
    closed: closed.length,
    responseRate: {
      totalPostulated: postuladaIds.length,
      responded: respondedIds.length,
      rate: postuladaIds.length ? respondedIds.length / postuladaIds.length : null,
    },
    medianDaysToFirstResponse: median(responseTimesDays),
    stageConversion,
    bySource,
    byCvVersion,
    weeklyApplications,
  };
}
