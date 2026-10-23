import { describe, expect, it } from "vitest";
import {
  APPLICATION_STATUSES,
  CLOSED_BOARD_STATUSES,
  OPEN_BOARD_STATUSES,
  eventTypeForManualTransition,
  isApplicationStatus,
  isClosedStatus,
  isValidTransition,
} from "@/lib/tracker/status";

describe("isValidTransition", () => {
  it("permite el camino feliz completo", () => {
    expect(isValidTransition("guardado", "postulado")).toBe(true);
    expect(isValidTransition("postulado", "en_revision")).toBe(true);
    expect(isValidTransition("en_revision", "entrevista")).toBe(true);
    expect(isValidTransition("entrevista", "entrevista")).toBe(true); // otra ronda
    expect(isValidTransition("entrevista", "evaluacion")).toBe(true);
    expect(isValidTransition("evaluacion", "oferta")).toBe(true);
  });

  it("guardado no salta directo a estados avanzados", () => {
    expect(isValidTransition("guardado", "entrevista")).toBe(false);
    expect(isValidTransition("guardado", "oferta")).toBe(false);
  });

  it("los estados terminales no aceptan nada salvo quedarse", () => {
    for (const terminal of ["rechazado", "retirado"] as const) {
      for (const status of APPLICATION_STATUSES) {
        expect(isValidTransition(terminal, status)).toBe(status === terminal);
      }
    }
  });

  it("oferta sólo puede retirarse", () => {
    expect(isValidTransition("oferta", "retirado")).toBe(true);
    expect(isValidTransition("oferta", "rechazado")).toBe(false);
  });

  it("sin_respuesta puede volver a cualquier estado abierto", () => {
    for (const status of OPEN_BOARD_STATUSES) {
      expect(isValidTransition("sin_respuesta", status)).toBe(true);
    }
    expect(isValidTransition("sin_respuesta", "rechazado")).toBe(false);
  });

  it("retirarse está siempre disponible desde un estado activo", () => {
    for (const status of OPEN_BOARD_STATUSES) {
      expect(isValidTransition(status, "retirado")).toBe(true);
    }
  });
});

describe("isClosedStatus / listas de columnas", () => {
  it("no se superponen abiertas y cerradas, y cubren los nueve estados", () => {
    expect(OPEN_BOARD_STATUSES.length + CLOSED_BOARD_STATUSES.length).toBe(APPLICATION_STATUSES.length);
    for (const status of CLOSED_BOARD_STATUSES) expect(isClosedStatus(status)).toBe(true);
    for (const status of OPEN_BOARD_STATUSES) expect(isClosedStatus(status)).toBe(false);
  });
});

describe("isApplicationStatus", () => {
  it("distingue un estado válido de basura arbitraria", () => {
    expect(isApplicationStatus("postulado")).toBe(true);
    expect(isApplicationStatus("enviada")).toBe(false); // el valor legacy de 4 estados
    expect(isApplicationStatus("")).toBe(false);
  });
});

describe("eventTypeForManualTransition", () => {
  it("mapea los estados con significado semántico propio", () => {
    expect(eventTypeForManualTransition("postulado")).toBe("postulada");
    expect(eventTypeForManualTransition("entrevista")).toBe("invitacion_entrevista");
    expect(eventTypeForManualTransition("evaluacion")).toBe("evaluacion");
    expect(eventTypeForManualTransition("oferta")).toBe("oferta");
    expect(eventTypeForManualTransition("rechazado")).toBe("rechazo");
  });

  it("ghosting_detectado queda reservado para el cron, nunca para un cambio manual", () => {
    expect(eventTypeForManualTransition("sin_respuesta")).toBe("cambio_manual");
  });

  it("cae a cambio_manual para el resto", () => {
    expect(eventTypeForManualTransition("guardado")).toBe("cambio_manual");
    expect(eventTypeForManualTransition("en_revision")).toBe("cambio_manual");
    expect(eventTypeForManualTransition("retirado")).toBe("cambio_manual");
  });
});
