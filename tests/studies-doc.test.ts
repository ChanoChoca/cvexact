import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chooseRequirementAsk } from "@/lib/jobs/requirement-ask";
import { readRequirements } from "@/lib/jobs/requirements";
import { METRICS } from "@/lib/metrics/counters";
import { toPlainProfile } from "@/lib/profile/project";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";

/**
 * The public specification of the studies (`docs/estudios-perfil-especificacion.md`)
 * is what an engineer follows to the letter: the lines a study plants in an
 * advertisement have to be read the way the specification says, or the study
 * measures nothing. So they are run here, and the rest is held to its own shape.
 * The research plan and the open questions are not part of the public documentation.
 */

const doc = readFileSync("docs/estudios-perfil-especificacion.md", "utf8");
const metrics = readFileSync("docs/metricas.md", "utf8").replace(/[ \t]*\n[ \t]*(?!\n)/g, " ");

/** The rows of the first table after a marker, as the cells of each. */
const rowsAfter = (text: string, marker: string): string[][] => {
  const from = text.indexOf(marker);
  expect(from, marker).toBeGreaterThanOrEqual(0);
  const lines = text.slice(from).split("\n");
  const start = lines.findIndex((line) => line.startsWith("|"));
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(line.split("|").slice(1, -1).map((cell) => cell.trim()));
  }
  return rows;
};

describe("S1, the requirement that does not exist", () => {
  const planted = rowsAfter(doc, "| Qué se planta |").map(([what, line, understood]) => ({ what: what!, line: line!.replace(/`/g, ""), understood: understood! }));
  const EXPECTED: Record<string, { type: string; obligation: string; thing: string }> = {
    "herramienta, excluyente": { type: "tool", obligation: "required", thing: "ZQX" },
    "herramienta, no lo dice": { type: "tool", obligation: "unstated", thing: "QBX" },
    "credencial, no lo dice": { type: "credential", obligation: "unstated", thing: "Carnet de manipulación de ZQX" },
  };

  it("plants one of each of the three ways, as lines of an advertisement", () => {
    expect(planted.map((row) => row.understood)).toEqual(Object.keys(EXPECTED));
    for (const row of planted) expect(row.line, row.what).toMatch(/^- \S/);
  });

  for (const row of planted) {
    it(`is read as «${row.understood}» and is asked: ${row.line}`, () => {
      const wanted = EXPECTED[row.understood]!;
      const posting = ["Oferta", "", "Requisitos:", row.line].join("\n");
      const requirements = readRequirements(posting);
      expect(requirements).toHaveLength(1);
      expect(requirements[0]).toMatchObject({ type: wanted.type, obligation: wanted.obligation });
      // A profile that says nothing of it, which is what a person who does not have it has: the question is put, with the line beside it.
      const stored = emptyStoredProfile();
      const ask = chooseRequirementAsk({ requirements, profile: toPlainProfile(stored), stored, now: new Date("2026-10-07T12:00:00.000Z") });
      expect(ask).not.toBeNull();
      expect(ask!.thing).toBe(wanted.thing);
      // The line of the advertisement is beside the question; the wording of a tool's names it, and a credential's is «¿Tenés esa credencial?».
      expect(ask!.fragment).toContain(wanted.thing);
      if (wanted.type === "tool") expect(ask!.question).toContain(wanted.thing);
    });
  }

  it("tells whoever runs a round to change the names for ones that do not exist, and to look them up first", () => {
    expect(doc).toContain("antes de cada ronda se cambian por una que no exista");
    expect(doc).toContain("se comprueba en un buscador");
  });
});

describe("the studies and where each one is", () => {
  it("has the three studies, and says where the ads bank and durability are, which exist", () => {
    for (const heading of ["## El requisito plantado", "## El diario", "## La comparación a ciegas"]) expect(doc, heading).toContain(heading);
    expect(doc).toContain("`docs/banco-de-avisos.md`");
    expect(doc).toContain("`docs/durabilidad.md`");
    expect(existsSync("docs/banco-de-avisos.md")).toBe(true);
    expect(existsSync("docs/durabilidad.md")).toBe(true);
  });

  it("says in what state the first of them is, because it is the one that a launched question depends on", () => {
    expect(doc).toContain("**Este estudio no se corrió.**");
    expect(doc).toContain("está prendida en el código");
  });

  it("counts in cases and not in percentages, and asks for a consent before each of them", () => {
    expect(doc).toContain("Resultados en cuentas, no en porcentajes");
    expect(doc).toContain("## El consentimiento de una prueba");
    expect(doc).toContain("No participan menores de 18 años");
  });
});

describe("the counts that people decide to give", () => {
  it("are said in the studies document: handed over by the person, ten at least for each cell, and nothing sent by the product", () => {
    const text = doc.replace(/\s+/g, " ");
    expect(text).toContain("## Los conteos que la gente decide dar");
    expect(text).toContain("**Lo entrega ella.**");
    expect(text).toContain("**Un mínimo de personas por celda: 10**");
    expect(text).toContain("El producto no lo manda");
    expect(text).toContain("`template_counts`");
  });
});

describe("the indicators, in the public metrics document", () => {
  it("separates the one that leaves the browser (I0) from the seven that do not leave it, and says so", () => {
    expect(metrics).toContain("## Qué mide hoy cada indicador: I0 frente a I1–I7");
    expect(metrics).toContain("**ningún indicador de I1 a I7 sale del navegador**");
  });

  it("names counters that exist", () => {
    for (const name of ["requirement_claimed", "requirement_declined", "inferred_skill_vetoed", "correction_saved", "correction_only_here", "correction_mistake", "profile_recovered", "persistence_granted"]) {
      expect(metrics, name).toContain(name);
      expect(Object.keys(METRICS), name).toContain(name);
    }
    expect(Object.keys(METRICS).filter((name) => name.startsWith("ask_"))).toHaveLength(12);
    expect(metrics).toContain("`ask_<tipo>_<respuesta>`");
  });

  it("points at code that exists", () => {
    for (const path of ["lib/profile/inventory.ts", "lib/profile/currency.ts", "lib/metrics/counters.ts", "lib/db/schema.ts"]) {
      expect(metrics, path).toContain(path);
      expect(existsSync(path), path).toBe(true);
    }
    expect(readFileSync("lib/db/schema.ts", "utf8")).toContain("generation_usage");
  });
});
