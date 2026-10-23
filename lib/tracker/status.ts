/**
 * Los nueve estados del pipeline y qué movimientos entre ellos son válidos.
 *
 * Sin XState: para un pipeline de nueve valores y una tabla de transiciones,
 * una máquina de estados formal es sobreingeniería — alcanza con un enum y un
 * `Record` de destinos permitidos, que es lo que hay acá.
 *
 * "Válido" no es lo único que la UI permite: el usuario puede forzar
 * cualquier transición con un "cambiar estado" explícito (ver
 * `lib/tracker/service.ts`), y ese caso siempre se registra como
 * `cambio_manual`. Esta tabla es la que decide si un movimiento del kanban
 * (arrastrar una tarjeta a otra columna) pasa sin pedir confirmación o si hay
 * que ofrecer "forzar" primero.
 */

export const APPLICATION_STATUSES = [
  "guardado",
  "postulado",
  "en_revision",
  "entrevista",
  "evaluacion",
  "oferta",
  "rechazado",
  "sin_respuesta",
  "retirado",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export function isApplicationStatus(value: string): value is ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(value);
}

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  guardado: "Guardado",
  postulado: "Postulado",
  en_revision: "En revisión",
  entrevista: "Entrevista",
  evaluacion: "Evaluación",
  oferta: "Oferta",
  rechazado: "Rechazado",
  sin_respuesta: "Sin respuesta",
  retirado: "Retirado",
};

/** Columnas visibles del kanban por defecto — el resto vive detrás de
 *  "Mostrar cerrados". */
export const OPEN_BOARD_STATUSES: readonly ApplicationStatus[] = [
  "guardado",
  "postulado",
  "en_revision",
  "entrevista",
  "evaluacion",
  "oferta",
];

/** Rechazado, sin respuesta y retirado — procesos que ya no siguen. */
export const CLOSED_BOARD_STATUSES: readonly ApplicationStatus[] = [
  "rechazado",
  "sin_respuesta",
  "retirado",
];

export function isClosedStatus(status: ApplicationStatus): boolean {
  return (CLOSED_BOARD_STATUSES as readonly string[]).includes(status);
}

/**
 * Transiciones automáticas válidas, tal como las especifica el requerimiento.
 * `sin_respuesta` puede volver a cualquier estado activo — un ghosting
 * detectado no es definitivo, una respuesta tardía es lo que revierte la
 * marca — y `oferta`/`rechazado`/`retirado` son terminales salvo por
 * "retirarse", que siempre queda disponible desde cualquier estado activo.
 */
const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  guardado: ["postulado", "retirado"],
  postulado: ["en_revision", "entrevista", "evaluacion", "rechazado", "sin_respuesta", "retirado"],
  en_revision: ["entrevista", "evaluacion", "rechazado", "sin_respuesta", "retirado"],
  entrevista: ["entrevista", "evaluacion", "oferta", "rechazado", "sin_respuesta", "retirado"],
  evaluacion: ["entrevista", "oferta", "rechazado", "sin_respuesta", "retirado"],
  oferta: ["retirado"],
  rechazado: [],
  sin_respuesta: OPEN_BOARD_STATUSES,
  retirado: [],
};

export function isValidTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

/**
 * Qué `event_type` deja un movimiento manual a `to`, para que las métricas de
 * `lib/tracker/metrics.ts` puedan distinguir "el usuario marcó que se
 * postuló" de "un cambio de estado cualquiera" sin depender todavía del
 * clasificador de email de la Fase 3.
 *
 * Es una asunción deliberada: hoy todo movimiento es manual (lo hizo la
 * persona, no un clasificador), pero el contenido semántico de "pasó a
 * entrevista" es el mismo lo haga un humano arrastrando una tarjeta o un
 * clasificador leyendo un correo. Mapear así es lo que hace que la tasa de
 * respuesta cuente una invitación a entrevista marcada a mano como una
 * respuesta real, y no como "cambio_manual" genérico e indistinguible de
 * archivar la postulación.
 */
const EVENT_TYPE_FOR_STATUS: Partial<Record<ApplicationStatus, string>> = {
  postulado: "postulada",
  entrevista: "invitacion_entrevista",
  evaluacion: "evaluacion",
  oferta: "oferta",
  rechazado: "rechazo",
  // `sin_respuesta` NO mapea acá a propósito: `ghosting_detectado` queda
  // reservado para cuando lo escribe el cron (`lib/tracker/ghosting.ts`) con
  // `detected_from = 'sistema'`. Si el usuario lo marca a mano desde
  // "cambiar estado", es un `cambio_manual` como cualquier otro — la
  // distinción es justamente lo que permite separar, en las métricas, el
  // ghosting que detectamos nosotros del que el usuario ya sabía.
};

export function eventTypeForManualTransition(to: ApplicationStatus): string {
  return EVENT_TYPE_FOR_STATUS[to] ?? "cambio_manual";
}
