import { describe, expect, it } from "vitest";
import { applicationsToCsv, applicationsToJson } from "@/lib/tracker/export";

function app(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    userId: "u1",
    label: "",
    data: {},
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    jobTitle: "Backend, Node",
    company: "Acme \"S.A.\"",
    companyNorm: "acme",
    source: "buscador_interno",
    jobPostingId: null,
    jobUrl: "https://example.com",
    jdText: null,
    jdJsonld: null,
    location: "CABA",
    remote: true,
    salaryMin: 1000,
    salaryMax: 2000,
    currency: "USD",
    status: "postulado",
    appliedAt: new Date("2026-01-02T00:00:00.000Z"),
    lastActivityAt: new Date("2026-01-02T00:00:00.000Z"),
    cvVersionId: null,
    boardPosition: 0,
    archived: false,
    ...overrides,
  } as never;
}

describe("applicationsToCsv", () => {
  it("escapa comas y comillas, y usa las etiquetas en español del estado", () => {
    const csv = applicationsToCsv([app()]);
    expect(csv).toContain('"Backend, Node"');
    expect(csv).toContain('"Acme ""S.A."""');
    expect(csv).toContain("Postulado");
    expect(csv.startsWith("﻿")).toBe(true);
  });

  it("una lista vacía sólo trae el encabezado", () => {
    const csv = applicationsToCsv([]);
    expect(csv.replace(/^﻿/, "").split("\r\n")).toHaveLength(1);
  });
});

describe("applicationsToJson", () => {
  it("agrupa el timeline por postulación", () => {
    const events = [
      { id: "e1", applicationId: "a1", eventType: "creada", fromStatus: null, toStatus: "guardado", detectedFrom: "manual", confidence: null, rawSender: null, rawSubject: null, body: null, occurredAt: new Date(), createdAt: new Date() },
    ] as never[];
    const json = JSON.parse(applicationsToJson([app()], events));
    expect(json).toHaveLength(1);
    expect(json[0].timeline).toHaveLength(1);
    expect(json[0].timeline[0].eventType).toBe("creada");
  });

  it("una postulación sin eventos trae un timeline vacío, no undefined", () => {
    const json = JSON.parse(applicationsToJson([app()], []));
    expect(json[0].timeline).toEqual([]);
  });
});
