import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  APPLICATION_STATUSES,
  eventTypeForManualTransition,
  isValidTransition,
  type ApplicationStatus,
} from "./status";
import { positionBetween, rebalance } from "./board";
import { computeMetricsFromRows, type TrackerMetrics } from "./metrics";

/**
 * Todo el acceso a `application` y sus tablas satélite pasa por acá. Nunca
 * por una query suelta en una route — es lo que hace verificable el
 * aislamiento entre usuarios que reemplaza a RLS (ver `docs/tracker-plan.md`,
 * sección 4): `requireOwnedApplication` es el único punto de entrada a una
 * fila por id, y todo lo demás que toca `application_event` /
 * `application_contact` pasa antes por ahí.
 */

export class TrackerNotFoundError extends Error {
  constructor(message = "No encontramos esa postulación.") {
    super(message);
    this.name = "TrackerNotFoundError";
  }
}

export class TrackerInvalidTransitionError extends Error {
  constructor(
    public readonly from: ApplicationStatus,
    public readonly to: ApplicationStatus,
  ) {
    super(`No es un movimiento habitual de "${from}" a "${to}".`);
    this.name = "TrackerInvalidTransitionError";
  }
}

type ApplicationRow = typeof schema.application.$inferSelect;

/** Trae una fila sólo si es del usuario — el punto de apoyo de todo lo demás
 *  en este archivo. Nunca expone si el id existe para otro usuario: siempre
 *  el mismo "no encontrado", exista o no exista para otra cuenta. */
async function requireOwnedApplication(userId: string, id: string): Promise<ApplicationRow> {
  const [row] = await getDb()
    .select()
    .from(schema.application)
    .where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)))
    .limit(1);
  if (!row) throw new TrackerNotFoundError();
  return row;
}

export type CreateApplicationInput = {
  id?: string;
  status?: ApplicationStatus;
  jobTitle?: string;
  company?: string;
  source?: string;
  jobPostingId?: string;
  jobUrl?: string;
  jdText?: string;
  jdJsonld?: unknown;
  location?: string;
  remote?: boolean;
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
  label?: string;
  appliedAt?: Date;
};

/**
 * Crea una postulación. `data` queda en `{}` — el documento del CV, si se
 * genera, lo escribe el flujo del wizard sobre la misma fila (ver
 * `app/api/sync/route.ts`), nunca esta función.
 *
 * El `id` puede venir del llamador (el navegador ya lo generó con
 * `crypto.randomUUID()` para poder prellenar el wizard con el mismo id que
 * el botón "Guardar"/"Ya me postulé" acaba de crear en el servidor) o se
 * genera acá si no.
 */
export async function createApplication(
  userId: string,
  input: CreateApplicationInput,
): Promise<ApplicationRow> {
  const [row] = await getDb()
    .insert(schema.application)
    .values({
      id: input.id ?? randomUUID(),
      userId,
      data: {},
      label: input.label ?? input.jobTitle ?? "",
      status: input.status ?? "guardado",
      jobTitle: input.jobTitle,
      company: input.company,
      source: input.source,
      jobPostingId: input.jobPostingId,
      jobUrl: input.jobUrl,
      jdText: input.jdText,
      jdJsonld: input.jdJsonld,
      location: input.location,
      remote: input.remote,
      salaryMin: input.salaryMin,
      salaryMax: input.salaryMax,
      currency: input.currency,
      appliedAt: input.appliedAt,
    })
    .returning();
  return row;
}

export type ListApplicationsFilter = {
  statuses?: ApplicationStatus[];
  includeArchived?: boolean;
  company?: string;
  source?: string;
  remote?: boolean;
  createdFrom?: Date;
  createdTo?: Date;
};

/** Para el kanban y la tabla — misma query, la vista decide cómo agrupar. */
export async function listApplications(
  userId: string,
  filter: ListApplicationsFilter = {},
): Promise<ApplicationRow[]> {
  const conditions = [eq(schema.application.userId, userId)];
  if (!filter.includeArchived) conditions.push(eq(schema.application.archived, false));
  if (filter.statuses?.length) conditions.push(inArray(schema.application.status, filter.statuses));
  if (filter.company) conditions.push(ilike(schema.application.company, `%${filter.company}%`));
  if (filter.source) conditions.push(eq(schema.application.source, filter.source));
  if (filter.remote !== undefined) conditions.push(eq(schema.application.remote, filter.remote));
  if (filter.createdFrom) conditions.push(gte(schema.application.createdAt, filter.createdFrom));
  if (filter.createdTo) conditions.push(lte(schema.application.createdAt, filter.createdTo));

  return getDb()
    .select()
    .from(schema.application)
    .where(and(...conditions))
    .orderBy(asc(schema.application.boardPosition), desc(schema.application.createdAt));
}

/**
 * ¿Ya está en el seguimiento el aviso que se ve en `jobUrl`? — lo que la
 * extensión de navegador (Fase 4) consulta al abrir su popup, para mostrar
 * el estado en el ícono en vez de dejar que la persona duplique sin darse
 * cuenta. Comparación exacta, no una búsqueda difusa: dos avisos con URLs
 * que difieren en un parámetro de tracking (`?utm_source=...`) son casos
 * reales que esto no cubre, y está bien — la detección de duplicados de
 * verdad (`lib/tracker/duplicates.ts`) ya corre en la creación.
 */
export async function getApplicationByUrl(userId: string, jobUrl: string): Promise<ApplicationRow | null> {
  const [row] = await getDb()
    .select()
    .from(schema.application)
    .where(and(eq(schema.application.userId, userId), eq(schema.application.jobUrl, jobUrl)))
    .limit(1);
  return row ?? null;
}

export type ApplicationDetail = {
  application: ApplicationRow;
  events: (typeof schema.applicationEvent.$inferSelect)[];
  contacts: (typeof schema.applicationContact.$inferSelect)[];
  reminders: (typeof schema.applicationReminder.$inferSelect)[];
};

export async function getApplicationDetail(userId: string, id: string): Promise<ApplicationDetail> {
  const application = await requireOwnedApplication(userId, id);

  const [events, contacts, reminders] = await Promise.all([
    getDb()
      .select()
      .from(schema.applicationEvent)
      .where(eq(schema.applicationEvent.applicationId, id))
      .orderBy(desc(schema.applicationEvent.occurredAt)),
    getDb()
      .select()
      .from(schema.applicationContact)
      .where(eq(schema.applicationContact.applicationId, id))
      .orderBy(desc(schema.applicationContact.createdAt)),
    getDb()
      .select()
      .from(schema.applicationReminder)
      .where(
        and(eq(schema.applicationReminder.applicationId, id), eq(schema.applicationReminder.dismissed, false)),
      )
      .orderBy(asc(schema.applicationReminder.dueAt)),
  ]);

  return { application, events, contacts, reminders };
}

export type ApplicationFieldPatch = Partial<
  Pick<
    ApplicationRow,
    | "jobTitle"
    | "company"
    | "location"
    | "remote"
    | "salaryMin"
    | "salaryMax"
    | "currency"
    | "jobUrl"
    | "label"
  >
>;

/** Edición de los datos del puesto — nunca del estado, que tiene su propio
 *  camino (`changeStatus`/`moveCard`) porque ese sí deja un evento. */
export async function updateApplicationFields(
  userId: string,
  id: string,
  patch: ApplicationFieldPatch,
): Promise<ApplicationRow> {
  await requireOwnedApplication(userId, id);
  const [row] = await getDb()
    .update(schema.application)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)))
    .returning();
  return row;
}

/**
 * Declara la procedencia de un cambio de estado para el trigger de la
 * migración 0017 y hace el `UPDATE`. Nunca inserta en `application_event` —
 * eso es exactamente lo que el trigger hace por su cuenta, y duplicarlo acá
 * sería el "guardia repetida que diverge" que el repo evita en otros lados.
 */
async function applyStatusChange(
  userId: string,
  id: string,
  toStatus: ApplicationStatus,
  opts: { eventType: string; detectedFrom: "manual" | "sistema" | "email" },
): Promise<ApplicationRow> {
  return getDb().transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.application)
      .where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)))
      .limit(1);
    if (!existing) throw new TrackerNotFoundError();

    await tx.execute(sql`select set_config('app.event_detected_from', ${opts.detectedFrom}, true)`);
    await tx.execute(sql`select set_config('app.event_type', ${opts.eventType}, true)`);

    const [row] = await tx
      .update(schema.application)
      .set({ status: toStatus, updatedAt: new Date() })
      .where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)))
      .returning();
    return row;
  });
}

export type ChangeStatusOptions = {
  /** Fuerza una transición fuera de la tabla de `lib/tracker/status.ts`. La
   *  UI la pide explícitamente con "cambiar estado" — nunca es el resultado
   *  por defecto de arrastrar una tarjeta. */
  force?: boolean;
};

/**
 * Cambia el estado a mano (desde el detalle, o un drag que no necesitó
 * confirmación). Tira `TrackerInvalidTransitionError` si el movimiento no
 * está en la tabla y no se pidió `force` — la route lo traduce a un 409 que
 * la UI usa para ofrecer "forzar" antes de reintentar.
 */
export async function changeStatus(
  userId: string,
  id: string,
  toStatus: ApplicationStatus,
  options: ChangeStatusOptions = {},
): Promise<ApplicationRow> {
  const current = await requireOwnedApplication(userId, id);
  const from = current.status as ApplicationStatus;

  if (!options.force && !isValidTransition(from, toStatus)) {
    throw new TrackerInvalidTransitionError(from, toStatus);
  }

  return applyStatusChange(userId, id, toStatus, {
    eventType: eventTypeForManualTransition(toStatus),
    detectedFrom: "manual",
  });
}

export type MoveCardInput = {
  toStatus: ApplicationStatus;
  /** Posición ya calculada por el cliente con `positionBetween` — se manda
   *  hecha porque el cliente es quien sabe qué dos tarjetas quedaron a los
   *  lados después del drag. */
  boardPosition: number;
  force?: boolean;
};

/** Lo que dispara soltar una tarjeta del kanban: mueve de columna (si
 *  corresponde, con la misma validación que `changeStatus`) y fija su
 *  posición dentro de la columna destino, en una sola escritura. */
export async function moveCard(
  userId: string,
  id: string,
  input: MoveCardInput,
): Promise<ApplicationRow> {
  const current = await requireOwnedApplication(userId, id);
  const from = current.status as ApplicationStatus;

  if (from === input.toStatus) {
    const [row] = await getDb()
      .update(schema.application)
      .set({ boardPosition: input.boardPosition })
      .where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)))
      .returning();
    return row;
  }

  if (!input.force && !isValidTransition(from, input.toStatus)) {
    throw new TrackerInvalidTransitionError(from, input.toStatus);
  }

  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.event_detected_from', 'manual', true)`);
    await tx.execute(
      sql`select set_config('app.event_type', ${eventTypeForManualTransition(input.toStatus)}, true)`,
    );
    const [row] = await tx
      .update(schema.application)
      .set({ status: input.toStatus, boardPosition: input.boardPosition, updatedAt: new Date() })
      .where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)))
      .returning();
    return row;
  });
}

/** Recalcula las posiciones de toda una columna cuando el hueco fraccional ya
 *  no da más — ver `lib/tracker/board.ts`. */
export async function rebalanceColumn(
  userId: string,
  status: ApplicationStatus,
): Promise<void> {
  const rows = await getDb()
    .select({ id: schema.application.id })
    .from(schema.application)
    .where(and(eq(schema.application.userId, userId), eq(schema.application.status, status)))
    .orderBy(asc(schema.application.boardPosition));

  const positions = rebalance(rows.map((r) => r.id));
  await getDb().transaction(async (tx) => {
    for (const [id, boardPosition] of positions) {
      await tx
        .update(schema.application)
        .set({ boardPosition })
        .where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)));
    }
  });
}

export { positionBetween };

export async function archiveApplications(
  userId: string,
  ids: string[],
  archived: boolean,
): Promise<void> {
  if (ids.length === 0) return;
  await getDb()
    .update(schema.application)
    .set({ archived, updatedAt: new Date() })
    .where(and(eq(schema.application.userId, userId), inArray(schema.application.id, ids)));
}

/** Cambio de estado en lote, para la selección múltiple de la vista tabla.
 *  Cada fila pasa por su propia transacción — una postulación con una
 *  transición inválida no debe frenar al resto del lote. */
export async function bulkChangeStatus(
  userId: string,
  ids: string[],
  toStatus: ApplicationStatus,
  options: ChangeStatusOptions = {},
): Promise<{ updated: string[]; rejected: string[] }> {
  const updated: string[] = [];
  const rejected: string[] = [];
  for (const id of ids) {
    try {
      await changeStatus(userId, id, toStatus, options);
      updated.push(id);
    } catch {
      rejected.push(id);
    }
  }
  return { updated, rejected };
}

export async function deleteApplication(userId: string, id: string): Promise<void> {
  await requireOwnedApplication(userId, id);
  await getDb()
    .delete(schema.application)
    .where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)));
}

/** Una nota manual en la línea de tiempo — no es un cambio de estado
 *  (`fromStatus`/`toStatus` quedan `null`), así que se inserta directo, sin
 *  pasar por el trigger: el trigger sólo es el único camino para eventos que
 *  sí mueven `status`. */
export async function addNote(userId: string, id: string, body: string): Promise<void> {
  await requireOwnedApplication(userId, id);
  await getDb().insert(schema.applicationEvent).values({
    id: randomUUID(),
    applicationId: id,
    eventType: "nota",
    detectedFrom: "manual",
    body,
  });
}

export async function addContact(
  userId: string,
  applicationId: string,
  input: { name?: string; email?: string; role?: string; linkedinUrl?: string },
): Promise<typeof schema.applicationContact.$inferSelect> {
  await requireOwnedApplication(userId, applicationId);
  const [row] = await getDb()
    .insert(schema.applicationContact)
    .values({ id: randomUUID(), applicationId, ...input })
    .returning();
  return row;
}

export async function deleteContact(
  userId: string,
  applicationId: string,
  contactId: string,
): Promise<void> {
  await requireOwnedApplication(userId, applicationId);
  await getDb()
    .delete(schema.applicationContact)
    .where(
      and(
        eq(schema.applicationContact.id, contactId),
        eq(schema.applicationContact.applicationId, applicationId),
      ),
    );
}

/**
 * Un recordatorio manual, o el de seguimiento a 7 días que la UI ofrece
 * (nunca crea sola) al marcar una postulación como `postulado` — ver
 * `docs/tracker-plan.md`. `userId` queda en la fila además de en
 * `applicationId` porque `lib/tracker/reminders.ts` (el cron) necesita
 * saber a quién mandarle el correo sin tener que volver a `application`
 * para cada recordatorio vencido.
 */
export async function createReminder(
  userId: string,
  applicationId: string,
  input: { dueAt: Date; kind: string; message?: string },
): Promise<typeof schema.applicationReminder.$inferSelect> {
  await requireOwnedApplication(userId, applicationId);
  const [row] = await getDb()
    .insert(schema.applicationReminder)
    .values({ id: randomUUID(), applicationId, userId, ...input })
    .returning();
  return row;
}

export async function dismissReminder(
  userId: string,
  applicationId: string,
  reminderId: string,
): Promise<void> {
  await requireOwnedApplication(userId, applicationId);
  await getDb()
    .update(schema.applicationReminder)
    .set({ dismissed: true })
    .where(
      and(
        eq(schema.applicationReminder.id, reminderId),
        eq(schema.applicationReminder.applicationId, applicationId),
      ),
    );
}

/**
 * Da de alta o recupera la versión de CV de `fingerprint` para este usuario.
 * `onConflictDoNothing` en vez de `onConflictDoUpdate`: si el usuario ya le
 * puso un nombre a esta versión, un `ensure` posterior (otra postulación con
 * el mismo CV base) no se lo tiene que pisar.
 */
export async function ensureCvVersion(
  userId: string,
  input: { fingerprint: string; label: string },
): Promise<typeof schema.cvVersion.$inferSelect> {
  await getDb()
    .insert(schema.cvVersion)
    .values({ id: randomUUID(), userId, fingerprint: input.fingerprint, label: input.label })
    .onConflictDoNothing({ target: [schema.cvVersion.userId, schema.cvVersion.fingerprint] });

  const [row] = await getDb()
    .select()
    .from(schema.cvVersion)
    .where(and(eq(schema.cvVersion.userId, userId), eq(schema.cvVersion.fingerprint, input.fingerprint)))
    .limit(1);
  return row;
}

export async function listCvVersions(
  userId: string,
): Promise<(typeof schema.cvVersion.$inferSelect)[]> {
  return getDb()
    .select()
    .from(schema.cvVersion)
    .where(eq(schema.cvVersion.userId, userId))
    .orderBy(desc(schema.cvVersion.createdAt));
}

export async function linkCvVersion(
  userId: string,
  applicationId: string,
  cvVersionId: string | null,
): Promise<void> {
  await requireOwnedApplication(userId, applicationId);
  if (cvVersionId) {
    const [version] = await getDb()
      .select({ id: schema.cvVersion.id })
      .from(schema.cvVersion)
      .where(and(eq(schema.cvVersion.id, cvVersionId), eq(schema.cvVersion.userId, userId)))
      .limit(1);
    if (!version) throw new TrackerNotFoundError();
  }
  await getDb()
    .update(schema.application)
    .set({ cvVersionId, updatedAt: new Date() })
    .where(and(eq(schema.application.id, applicationId), eq(schema.application.userId, userId)));
}

/** Todo lo del usuario, para el export sin límites (CSV/JSON) y para el
 *  export de cuenta (`app/api/sync/route.ts?export=account`). */
export async function exportRows(userId: string): Promise<{
  applications: ApplicationRow[];
  events: (typeof schema.applicationEvent.$inferSelect)[];
}> {
  const applications = await getDb()
    .select()
    .from(schema.application)
    .where(eq(schema.application.userId, userId))
    .orderBy(desc(schema.application.createdAt));

  const ids = applications.map((a) => a.id);
  const events = ids.length
    ? await getDb()
        .select()
        .from(schema.applicationEvent)
        .where(inArray(schema.applicationEvent.applicationId, ids))
        .orderBy(asc(schema.applicationEvent.occurredAt))
    : [];

  return { applications, events };
}

export { APPLICATION_STATUSES };

/** Las métricas parten de las mismas dos consultas que `exportRows` — es a
 *  propósito el mismo camino: si `pull()` puede traer todo con dos
 *  consultas, la analítica no necesita una por gráfico. */
export async function getMetrics(userId: string): Promise<TrackerMetrics> {
  const [{ applications, events }, cvVersions] = await Promise.all([
    exportRows(userId),
    listCvVersions(userId),
  ]);

  const metrics = computeMetricsFromRows(
    applications.map((a) => ({
      id: a.id,
      source: a.source,
      cvVersionId: a.cvVersionId,
      status: a.status,
      archived: a.archived,
    })),
    events.map((e) => ({
      applicationId: e.applicationId,
      eventType: e.eventType,
      toStatus: e.toStatus,
      occurredAt: e.occurredAt,
    })),
  );

  // `computeMetricsFromRows` no conoce el nombre de la versión — sólo el id
  // que trae `application.cv_version_id`. Se lo pone acá, después, en vez de
  // pasarle la tabla entera a una función que por lo demás es pura.
  const labelById = new Map(cvVersions.map((v) => [v.id, v.label || v.id]));
  return {
    ...metrics,
    byCvVersion: metrics.byCvVersion.map((v) => ({ ...v, label: labelById.get(v.key) ?? v.key })),
  };
}
