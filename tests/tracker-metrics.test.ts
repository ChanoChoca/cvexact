import { describe, expect, it } from "vitest";
import { CV_VERSION_MIN_SIGNIFICANT, computeMetricsFromRows, type MetricsApplicationRow, type MetricsEventRow } from "@/lib/tracker/metrics";

function app(overrides: Partial<MetricsApplicationRow> = {}): MetricsApplicationRow {
  return { id: "a1", source: "getonbrd", cvVersionId: null, status: "postulado", archived: false, ...overrides };
}

function ev(overrides: Partial<MetricsEventRow> = {}): MetricsEventRow {
  // `to_status` es lo que de verdad marca "llegó a postulado" (ver el
  // comentario en `lib/tracker/metrics.ts`) — así que un evento
  // `postulada` por default también trae `toStatus: "postulado"`, como
  // ocurre siempre en la fila real que escribe el trigger.
  const eventType = overrides.eventType ?? "creada";
  const defaultToStatus = eventType === "postulada" ? "postulado" : "guardado";
  return { applicationId: "a1", eventType, toStatus: defaultToStatus, occurredAt: new Date("2026-01-01"), ...overrides };
}

describe("computeMetricsFromRows — conteos generales", () => {
  it("separa activas, cerradas, y no cuenta archivadas", () => {
    const applications = [
      app({ id: "a1", status: "postulado" }),
      app({ id: "a2", status: "rechazado" }),
      app({ id: "a3", status: "guardado", archived: true }),
    ];
    const metrics = computeMetricsFromRows(applications, []);
    expect(metrics.total).toBe(2); // la archivada no cuenta
    expect(metrics.active).toBe(1);
    expect(metrics.closed).toBe(1);
  });
});

describe("computeMetricsFromRows — tasa de respuesta", () => {
  it("una postulación con sólo creada+postulada no cuenta como respondida", () => {
    const applications = [app()];
    const events = [
      ev({ eventType: "creada", toStatus: "guardado", occurredAt: new Date("2026-01-01") }),
      ev({ eventType: "postulada", toStatus: "postulado", occurredAt: new Date("2026-01-02") }),
      ev({ eventType: "confirmacion", toStatus: null, occurredAt: new Date("2026-01-02T01:00:00Z") }),
    ];
    const metrics = computeMetricsFromRows(applications, events);
    expect(metrics.responseRate.totalPostulated).toBe(1);
    expect(metrics.responseRate.responded).toBe(0);
    expect(metrics.responseRate.rate).toBe(0);
  });

  it("una invitación a entrevista después de postularse cuenta como respuesta", () => {
    const applications = [app()];
    const events = [
      ev({ eventType: "postulada", toStatus: "postulado", occurredAt: new Date("2026-01-01") }),
      ev({ eventType: "invitacion_entrevista", toStatus: "entrevista", occurredAt: new Date("2026-01-05") }),
    ];
    const metrics = computeMetricsFromRows(applications, events);
    expect(metrics.responseRate.responded).toBe(1);
    expect(metrics.responseRate.rate).toBe(1);
  });

  it("sin ninguna postulación marcada como postulada, la tasa es null (no 0/0)", () => {
    const metrics = computeMetricsFromRows([app()], [ev({ eventType: "creada", toStatus: "guardado" })]);
    expect(metrics.responseRate.rate).toBeNull();
  });
});

describe("computeMetricsFromRows — tiempo mediano hasta primera respuesta", () => {
  it("calcula la mediana en días entre postulada y la primera respuesta real", () => {
    const applications = [app({ id: "a1" }), app({ id: "a2" }), app({ id: "a3" })];
    const events = [
      ev({ applicationId: "a1", eventType: "postulada", occurredAt: new Date("2026-01-01T00:00:00Z") }),
      ev({ applicationId: "a1", eventType: "rechazo", toStatus: "rechazado", occurredAt: new Date("2026-01-03T00:00:00Z") }), // 2 días
      ev({ applicationId: "a2", eventType: "postulada", occurredAt: new Date("2026-01-01T00:00:00Z") }),
      ev({ applicationId: "a2", eventType: "invitacion_entrevista", toStatus: "entrevista", occurredAt: new Date("2026-01-05T00:00:00Z") }), // 4 días
      ev({ applicationId: "a3", eventType: "postulada", occurredAt: new Date("2026-01-01T00:00:00Z") }),
      ev({ applicationId: "a3", eventType: "oferta", toStatus: "oferta", occurredAt: new Date("2026-01-11T00:00:00Z") }), // 10 días
    ];
    const metrics = computeMetricsFromRows(applications, events);
    expect(metrics.medianDaysToFirstResponse).toBe(4);
  });

  it("sin ninguna respuesta todavía, es null", () => {
    const metrics = computeMetricsFromRows([app()], [ev({ eventType: "postulada" })]);
    expect(metrics.medianDaysToFirstResponse).toBeNull();
  });
});

describe("computeMetricsFromRows — conversión por etapa", () => {
  it("cuenta cuántas postulaciones llegaron a cada etapa alguna vez, aunque después bajen", () => {
    const applications = [app({ id: "a1" }), app({ id: "a2" })];
    const events = [
      ev({ applicationId: "a1", eventType: "postulada", toStatus: "postulado", occurredAt: new Date("2026-01-01") }),
      ev({ applicationId: "a1", eventType: "invitacion_entrevista", toStatus: "entrevista", occurredAt: new Date("2026-01-02") }),
      ev({ applicationId: "a1", eventType: "rechazo", toStatus: "rechazado", occurredAt: new Date("2026-01-03") }),
      ev({ applicationId: "a2", eventType: "postulada", toStatus: "postulado", occurredAt: new Date("2026-01-01") }),
    ];
    const metrics = computeMetricsFromRows(applications, events);
    const byStage = Object.fromEntries(metrics.stageConversion.map((s) => [s.stage, s.count]));
    expect(byStage.postulado).toBe(2);
    expect(byStage.entrevista).toBe(1); // a1 llegó, aunque terminó rechazada
    expect(byStage.oferta).toBe(0);
  });
});

describe("computeMetricsFromRows — por fuente y por versión de CV", () => {
  it("agrupa por fuente sólo entre las que llegaron a postulado", () => {
    const applications = [
      app({ id: "a1", source: "getonbrd" }),
      app({ id: "a2", source: "linkedin-manual" }),
    ];
    const events = [
      ev({ applicationId: "a1", eventType: "postulada", occurredAt: new Date("2026-01-01") }),
      ev({ applicationId: "a2", eventType: "postulada", occurredAt: new Date("2026-01-01") }),
      ev({ applicationId: "a2", eventType: "invitacion_entrevista", toStatus: "entrevista", occurredAt: new Date("2026-01-02") }),
    ];
    const metrics = computeMetricsFromRows(applications, events);
    const byKey = Object.fromEntries(metrics.bySource.map((s) => [s.key, s]));
    expect(byKey.getonbrd.total).toBe(1);
    expect(byKey.getonbrd.responseRate).toBe(0);
    expect(byKey["linkedin-manual"].responseRate).toBe(1);
  });

  it("marca una versión de CV como no significativa por debajo del umbral", () => {
    const applications = Array.from({ length: CV_VERSION_MIN_SIGNIFICANT - 1 }, (_, i) =>
      app({ id: `a${i}`, cvVersionId: "v1" }),
    );
    const events = applications.map((a) => ev({ applicationId: a.id, eventType: "postulada" }));
    const metrics = computeMetricsFromRows(applications, events);
    expect(metrics.byCvVersion[0].total).toBe(CV_VERSION_MIN_SIGNIFICANT - 1);
    expect(metrics.byCvVersion[0].significant).toBe(false);
  });

  it("marca una versión de CV como significativa al llegar al umbral", () => {
    const applications = Array.from({ length: CV_VERSION_MIN_SIGNIFICANT }, (_, i) =>
      app({ id: `a${i}`, cvVersionId: "v1" }),
    );
    const events = applications.map((a) => ev({ applicationId: a.id, eventType: "postulada" }));
    const metrics = computeMetricsFromRows(applications, events);
    expect(metrics.byCvVersion[0].significant).toBe(true);
  });

  it("una postulación sin versión de CV no entra en el agrupamiento", () => {
    const applications = [app({ id: "a1", cvVersionId: null })];
    const events = [ev({ applicationId: "a1", eventType: "postulada" })];
    const metrics = computeMetricsFromRows(applications, events);
    expect(metrics.byCvVersion).toHaveLength(0);
  });
});

describe("computeMetricsFromRows — serie semanal", () => {
  it("agrupa postulaciones por el lunes de su semana ISO", () => {
    const applications = [app({ id: "a1" }), app({ id: "a2" })];
    const events = [
      // Miércoles 2026-01-07 y viernes 2026-01-09 -> misma semana, lunes 2026-01-05
      ev({ applicationId: "a1", eventType: "postulada", occurredAt: new Date("2026-01-07T12:00:00Z") }),
      ev({ applicationId: "a2", eventType: "postulada", occurredAt: new Date("2026-01-09T12:00:00Z") }),
    ];
    const metrics = computeMetricsFromRows(applications, events);
    expect(metrics.weeklyApplications).toEqual([{ weekStart: "2026-01-05", count: 2 }]);
  });
});
