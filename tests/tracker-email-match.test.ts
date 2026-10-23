import { describe, expect, it } from "vitest";
import { matchApplicationForEmail } from "@/lib/tracker/email-match";

describe("matchApplicationForEmail", () => {
  it("empareja por el nombre de la empresa en el asunto", () => {
    const matches = matchApplicationForEmail(
      [{ id: "a1", company: "Mercado Libre" }, { id: "a2", company: "Globant" }],
      { from: "no-reply@hire.lever.co", subject: "Actualización de tu postulación en MercadoLibre", bodyText: "" },
    );
    expect(matches.map((m) => m.id)).toEqual(["a1"]);
  });

  it("empareja por el nombre de la empresa en el cuerpo cuando no está en el asunto", () => {
    const matches = matchApplicationForEmail(
      [{ id: "a1", company: "Acme Corp" }],
      { from: "no-reply@greenhouse.io", subject: "Novedades", bodyText: "Gracias por tu interés en Acme Corp." },
    );
    expect(matches).toHaveLength(1);
  });

  it("sin ninguna coincidencia, no matchea nada", () => {
    const matches = matchApplicationForEmail(
      [{ id: "a1", company: "Acme Corp" }],
      { from: "no-reply@greenhouse.io", subject: "Novedades", bodyText: "Un correo que no menciona ninguna empresa conocida." },
    );
    expect(matches).toHaveLength(0);
  });

  it("dos postulaciones abiertas a la misma empresa: ambigüedad honesta, no elige una al azar", () => {
    const matches = matchApplicationForEmail(
      [{ id: "a1", company: "Acme" }, { id: "a2", company: "Acme" }],
      { from: "no-reply@greenhouse.io", subject: "Actualización de Acme", bodyText: "" },
    );
    expect(matches).toHaveLength(2);
  });

  it("ignora empresas sin nombre cargado o demasiado cortas para ser señal", () => {
    const matches = matchApplicationForEmail(
      [{ id: "a1", company: null }, { id: "a2", company: "Go" }],
      { from: "no-reply@greenhouse.io", subject: "Go a full stop everywhere", bodyText: "" },
    );
    expect(matches).toHaveLength(0);
  });
});
