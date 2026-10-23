import { describe, expect, it } from "vitest";
import { daysSince, formatDaysSince, formatElapsed, formatSalary } from "@/lib/tracker/format";

describe("daysSince / formatDaysSince", () => {
  const now = new Date("2026-09-03T12:00:00.000Z");

  it("hoy", () => {
    expect(formatDaysSince("2026-09-03T01:00:00.000Z", now)).toBe("hoy");
  });
  it("ayer", () => {
    expect(formatDaysSince("2026-09-02T01:00:00.000Z", now)).toBe("ayer");
  });
  it("hace N días", () => {
    expect(formatDaysSince("2026-08-13T01:00:00.000Z", now)).toBe("hace 21 días");
  });
  it("nunca negativo, aunque la fecha sea del futuro", () => {
    expect(daysSince("2026-09-10T00:00:00.000Z", now)).toBe(0);
  });
});

describe("formatElapsed", () => {
  const now = new Date("2026-09-03T12:00:00.000Z");

  it("minutos", () => {
    expect(formatElapsed("2026-09-03T11:55:00.000Z", now)).toBe("hace 5 min");
  });
  it("menos de un minuto", () => {
    expect(formatElapsed("2026-09-03T11:59:30.000Z", now)).toBe("hace instantes");
  });
  it("horas", () => {
    expect(formatElapsed("2026-09-03T09:00:00.000Z", now)).toBe("hace 3 h");
  });
  /** Es la antigüedad de una nota de proveedor: pasado el día vuelve a días. */
  it("más de un día cae en el formato de días", () => {
    expect(formatElapsed("2026-09-01T11:00:00.000Z", now)).toBe("hace 2 días");
  });
  it("nunca negativo, aunque la fecha sea del futuro", () => {
    expect(formatElapsed("2026-09-03T13:00:00.000Z", now)).toBe("hace instantes");
  });
});

describe("formatSalary", () => {
  it("rango completo", () => {
    expect(formatSalary(1000, 2000, "USD")).toBe("USD 1.000 – 2.000");
  });
  it("un solo valor", () => {
    expect(formatSalary(1500, null, "USD")).toBe("USD 1.500");
  });
  it("sin datos, vacío", () => {
    expect(formatSalary(null, null, null)).toBe("");
  });
});
