import { describe, expect, it } from "vitest";
import { inventoryLine, inventoryOf } from "@/lib/profile/inventory";
import { addSkill } from "@/lib/profile/entities";
import { addEntry, blankForm } from "@/lib/onboarding/entries";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";
import { STAMP, newId, profileWith } from "./helpers/profiles";

const ctx = () => ({ now: STAMP, newId });

const ADELA = [
  { company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current" as const, facts: [
    { text: "Armo los pedidos del local" },
    { kind: "achievement" as const, text: "Subí las ventas un 20%" },
    { kind: "achievement" as const, text: "Cerré el año con mejor resultado en 2022" },
    { kind: "tool" as const, text: "Excel" },
  ] },
  { company: "Grupo Lumen", role: "Asistente", from: { year: 2018, month: 9 }, to: { year: 2021, month: 1 }, facts: [{ text: "Atendía a unos 40 clientes por día", metric: undefined }] },
];

describe("what a profile already has", () => {
  it("counts its jobs, the lines done in them, the lines with a figure, its studies and its skills", () => {
    const profile = profileWith(...ADELA);
    addEntry(profile, { ...blankForm("study"), what: "Licenciatura en Comercio", where: "UBA" }, { newId, now: STAMP });
    addSkill(profile, "SEO", ctx());
    addSkill(profile, "Google Ads", ctx());
    expect(inventoryOf(profile)).toEqual({ jobs: 2, tasks: 4, withFigure: 2, studies: 1, skills: 2 });
  });

  it("does not count the tools listed beside a job as what was done in it", () => {
    const profile = profileWith({ company: "A", role: "x", from: { year: 2020 }, facts: [{ kind: "tool", text: "Excel" }, { kind: "tool", text: "SQL" }] });
    expect(inventoryOf(profile)).toMatchObject({ jobs: 1, tasks: 0 });
  });

  it("does not take a year for a figure, and does count a figure kept beside a line", () => {
    const profile = profileWith({
      company: "A",
      role: "x",
      from: { year: 2020 },
      facts: [
        { kind: "achievement", text: "Aumenté las ventas en 2022" },
        { kind: "achievement", text: "Subí las ventas", metric: { value: "20", unit: "%", approx: false } },
        { kind: "achievement", text: "No supe el número", metric: { unknown: true } },
      ],
    });
    expect(inventoryOf(profile).withFigure).toBe(1);
  });

  it("does not count an empty entry as a job or a study", () => {
    const profile = emptyStoredProfile();
    addEntry(profile, { ...blankForm("study") }, { newId, now: STAMP });
    expect(inventoryOf(profile)).toEqual({ jobs: 0, tasks: 0, withFigure: 0, studies: 0, skills: 0 });
  });
});

describe("the line that says it", () => {
  it("lists what there is, in counts, in the order a CV is read, and no percentage", () => {
    const line = inventoryLine({ jobs: 5, tasks: 23, withFigure: 4, studies: 2, skills: 8 });
    expect(line).toBe("Ya tenés: 5 puestos, 23 tareas, 4 con cifra, 2 estudios, 8 habilidades.");
    expect(line).not.toMatch(/%|de \d+|puntaje|completo/i);
  });

  it("says one in the singular, and leaves out what there is none of", () => {
    expect(inventoryLine({ jobs: 1, tasks: 1, withFigure: 0, studies: 1, skills: 1 })).toBe("Ya tenés: 1 puesto, 1 tarea, 1 estudio, 1 habilidad.");
    expect(inventoryLine({ jobs: 3, tasks: 0, withFigure: 0, studies: 0, skills: 0 })).toBe("Ya tenés: 3 puestos.");
  });

  it("says nothing when there is nothing to count", () => {
    expect(inventoryLine({ jobs: 0, tasks: 0, withFigure: 0, studies: 0, skills: 0 })).toBeNull();
    expect(inventoryLine(inventoryOf(emptyStoredProfile()))).toBeNull();
  });

  it("is in voseo", () => {
    expect(inventoryLine({ jobs: 1, tasks: 0, withFigure: 0, studies: 0, skills: 0 })).toMatch(/^Ya tenés:/);
  });
});
