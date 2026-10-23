import { APPLICATION_STATUS_LABEL } from "./status";
import type { schema } from "@/lib/db";

type ApplicationRow = typeof schema.application.$inferSelect;
type EventRow = typeof schema.applicationEvent.$inferSelect;

/**
 * Export sin límites, en un click — decisión de producto (ver
 * `docs/tracker-plan.md`, sección 8): la portabilidad es una señal de
 * confianza, y ninguna versión "premium" del tracker le agrega un tope.
 * Puro y sin `"server-only"`: la route lo llama con lo que ya trajo de
 * `lib/tracker/service.ts`, y así queda testeable sin una base.
 */

const CSV_COLUMNS = [
  "id",
  "puesto",
  "empresa",
  "ubicacion",
  "remoto",
  "fuente",
  "estado",
  "salario_min",
  "salario_max",
  "moneda",
  "postulado_el",
  "creado_el",
  "url_aviso",
] as const;

function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function applicationsToCsv(applications: ApplicationRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = applications.map((a) =>
    [
      a.id,
      a.jobTitle ?? "",
      a.company ?? "",
      a.location ?? "",
      a.remote === null ? "" : a.remote ? "sí" : "no",
      a.source ?? "",
      APPLICATION_STATUS_LABEL[a.status as keyof typeof APPLICATION_STATUS_LABEL] ?? a.status,
      a.salaryMin ?? "",
      a.salaryMax ?? "",
      a.currency ?? "",
      a.appliedAt ? new Date(a.appliedAt).toISOString() : "",
      new Date(a.createdAt).toISOString(),
      a.jobUrl ?? "",
    ]
      .map(csvField)
      .join(","),
  );
  // BOM para que Excel en Windows no confunda los acentos con otra codificación.
  return "﻿" + [header, ...rows].join("\r\n");
}

export function applicationsToJson(applications: ApplicationRow[], events: EventRow[]): string {
  const eventsByApplication = new Map<string, EventRow[]>();
  for (const event of events) {
    const list = eventsByApplication.get(event.applicationId) ?? [];
    list.push(event);
    eventsByApplication.set(event.applicationId, list);
  }

  const payload = applications.map((a) => ({
    ...a,
    timeline: eventsByApplication.get(a.id) ?? [],
  }));

  return JSON.stringify(payload, null, 2);
}
