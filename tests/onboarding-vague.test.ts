import { describe, expect, it } from "vitest";
import { vagueScaleIn } from "@/lib/onboarding/vague";

/**
 * The words that say «cuánto» without saying how much. A closed list: what it reads is a quantity or it is nothing, because
 * a question asked about a phrase that was no quantity is the one that tells the person the app did not read it.
 */

describe("a line that says much without saying how much", () => {
  it("reads «muchos», «varios» and their feminine, with what they count", () => {
    expect(vagueScaleIn("Atendía a muchos clientes")).toEqual({ phrase: "muchos clientes", flavor: "count" });
    expect(vagueScaleIn("Gestioné varios proyectos de diseño")).toEqual({ phrase: "varios proyectos", flavor: "count" });
    expect(vagueScaleIn("Respondí muchas consultas por mail")).toEqual({ phrase: "muchas consultas", flavor: "count" });
    expect(vagueScaleIn("Coordiné varias sucursales")).toEqual({ phrase: "varias sucursales", flavor: "count" });
  });

  it("reads the quantifiers that carry their own «de»", () => {
    expect(vagueScaleIn("Preparé cientos de pedidos por semana")).toEqual({ phrase: "cientos de pedidos", flavor: "count" });
    expect(vagueScaleIn("Resolví miles de reclamos")).toEqual({ phrase: "miles de reclamos", flavor: "count" });
    expect(vagueScaleIn("Armé decenas de presupuestos")).toEqual({ phrase: "decenas de presupuestos", flavor: "count" });
    expect(vagueScaleIn("Manejé una gran cantidad de llamadas")).toEqual({ phrase: "gran cantidad de llamadas", flavor: "count" });
    expect(vagueScaleIn("Atendí un montón de turnos")).toEqual({ phrase: "un montón de turnos", flavor: "count" });
    expect(vagueScaleIn("Revisé un montón de planillas")).not.toBeNull();
  });

  it("reads how often, which only a number per period can pin down", () => {
    expect(vagueScaleIn("Atendía clientes a diario")).toEqual({ phrase: "a diario", flavor: "frequency" });
    expect(vagueScaleIn("Actualizaba el stock diariamente")).toEqual({ phrase: "diariamente", flavor: "frequency" });
  });

  it("is not fooled by how regular something is: «todos los días» says when, and not how much", () => {
    for (const text of ["Cargaba pedidos todos los días", "Atiendo la caja todos los días", "Reviso el stock cada mañana", "Voy al banco una vez por semana"]) {
      expect(vagueScaleIn(text), text).toBeNull();
    }
  });

  it("says what is counted first when a line has both", () => {
    expect(vagueScaleIn("Atendía muchos clientes a diario")).toEqual({ phrase: "muchos clientes", flavor: "count" });
  });

  it("is not fooled by a stretch of time: «varios años» is when, not how much", () => {
    for (const text of ["Trabajé varios años en el local", "Hace muchos meses que lo hago", "Estuve varias semanas de reemplazo", "Muchos días de campo", "Viajé muchas veces"]) {
      expect(vagueScaleIn(text), text).toBeNull();
    }
  });

  it("is not fooled by what is not a quantity at all", () => {
    for (const text of ["Muchas gracias por la oportunidad", "Siempre con buena actitud", "Atención al público", "Trabajo en equipo", "Armo los pedidos del local", "Un cliente importante", "Varios"]) {
      expect(vagueScaleIn(text), text).toBeNull();
    }
  });

  it("needs a noun after the quantifier, not the next word of the sentence", () => {
    expect(vagueScaleIn("Muchos de ellos")).toBeNull();
    expect(vagueScaleIn("Varios y variados")).toBeNull();
  });

  it("does not read the middle of a longer word", () => {
    expect(vagueScaleIn("Hablé de variaciones muchosque")).toBeNull();
    expect(vagueScaleIn("Hice diariamentes")).toBeNull();
  });

  it("is case-insensitive and keeps the words as they were written", () => {
    expect(vagueScaleIn("MUCHOS Clientes nuevos")).toEqual({ phrase: "MUCHOS Clientes", flavor: "count" });
  });
});
