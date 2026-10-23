import { describe, expect, it } from "vitest";
import { findLocalCvMatches } from "@/lib/tracker/match-local-cv";
import type { Application } from "@/lib/storage/local";

function app(overrides: Partial<Application> = {}): Application {
  return {
    id: "a1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    jobText: "",
    label: "",
    cv: {} as never,
    analysis: { title: "Backend Engineer", company: "Mercado Libre" } as never,
    ...overrides,
  };
}

describe("findLocalCvMatches", () => {
  it("empareja por empresa normalizada y título parecido", () => {
    const matches = findLocalCvMatches([app()], { title: "Backend Engineer (Node.js)", company: "MercadoLibre" });
    expect(matches).toHaveLength(1);
  });

  it("no empareja si la empresa es distinta", () => {
    const matches = findLocalCvMatches([app()], { title: "Backend Engineer", company: "Globant" });
    expect(matches).toHaveLength(0);
  });

  it("no empareja si el título no se parece", () => {
    const matches = findLocalCvMatches([app()], { title: "Diseñador UX", company: "Mercado Libre" });
    expect(matches).toHaveLength(0);
  });

  it("ignora aplicaciones sin CV generado", () => {
    const matches = findLocalCvMatches([app({ cv: undefined })], { title: "Backend Engineer", company: "Mercado Libre" });
    expect(matches).toHaveLength(0);
  });

  it("puede devolver más de una coincidencia", () => {
    const matches = findLocalCvMatches(
      [app({ id: "a1" }), app({ id: "a2" })],
      { title: "Backend Engineer", company: "Mercado Libre" },
    );
    expect(matches.map((m) => m.id).sort()).toEqual(["a1", "a2"]);
  });
});
