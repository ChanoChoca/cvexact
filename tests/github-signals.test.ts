import { describe, expect, it } from "vitest";
import { hasTechnicalSignals } from "@/lib/github/signals";
import { addEntry, blankForm } from "@/lib/onboarding/entries";
import { addSkill } from "@/lib/profile/entities";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";
import { STAMP, newId, profileWith, withStudy } from "./helpers/profiles";

/**
 * Whether the profile speaks of code (e5 UX, U42): the one reason to put «Traer mis proyectos de GitHub» in front of someone. Where it does not, the way to GitHub is a
 * line under «Agregar proyecto» — P14, a GitHub nobody has is not a hole, and having one is no reproach — so what decides must be what the person wrote, and only the names that
 * mean code: a woman in charge of a warehouse says «el software de stock» and has used a spreadsheet, and neither is a reason.
 */

const WAREHOUSE = () =>
  profileWith({ company: "Logística Sur", role: "Encargada de depósito", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los pedidos del depósito" }, { text: "Controlo el stock con el software de stock y una planilla de Excel" }] });

describe("a profile that does not speak of code", () => {
  it("is not one for a warehouse, a till or a kitchen: nothing in it names a language, a tool of the trade or the work of writing programs", () => {
    expect(hasTechnicalSignals(emptyStoredProfile())).toBe(false);
    expect(hasTechnicalSignals(WAREHOUSE())).toBe(false);
    const till = profileWith({ company: "Kiosco del Centro", role: "Cajero", from: { year: 2020 }, to: "current", facts: [{ text: "Atiendo la caja y el mostrador" }] });
    addSkill(till, "Atención al cliente", { now: STAMP, newId });
    addSkill(till, "Excel", { now: STAMP, newId });
    expect(hasTechnicalSignals(till)).toBe(false);
  });

  it("is not taken for one by the words that are also words: a profile of steel, a bank, a courier, a developer of land, a programmer of machines", () => {
    const profile = profileWith(
      { company: "Aceros del Sur", role: "Operario de perfiles angular", from: { year: 2015 }, to: { year: 2019 }, facts: [{ text: "Cortaba hierro angular y perfiles" }] },
      { company: "Banco del Plata", role: "Cajero", from: { year: 2019 }, to: { year: 2022 }, facts: [{ text: "Transferencias por SWIFT al exterior" }] },
      { company: "Envíos Ya", role: "Repartidor", from: { year: 2022 }, to: "current", facts: [{ text: "Entregas express en el centro" }] },
    );
    expect(hasTechnicalSignals(profile)).toBe(false);
    for (const role of ["Desarrollador inmobiliario", "Programador de CNC", "Programadora de radio", "Analista de calidad", "Business developer"]) {
      expect(hasTechnicalSignals(profileWith({ company: "X", role, from: { year: 2020 }, to: "current" })), role).toBe(false);
    }
  });
});

describe("a profile that does", () => {
  it("says so in a skill: a language, a framework or a tool of the trade", () => {
    for (const name of ["Python", "JavaScript", "React", "Docker", "Git", "SQL", "Node.js", "C#", "C++", "ASP.NET"]) {
      const profile = WAREHOUSE();
      addSkill(profile, name, { now: STAMP, newId });
      expect(hasTechnicalSignals(profile), name).toBe(true);
    }
  });

  it("says so in what a job is called, or what was done in it — with accents or without, in any case", () => {
    expect(hasTechnicalSignals(profileWith({ company: "Nubia", role: "Desarrolladora web", from: { year: 2021 }, to: "current" }))).toBe(true);
    expect(hasTechnicalSignals(profileWith({ company: "Nubia", role: "Analista programador", from: { year: 2021 }, to: "current" }))).toBe(true);
    expect(hasTechnicalSignals(profileWith({ company: "Nubia", role: "Ingeniero de software", from: { year: 2021 }, to: "current" }))).toBe(true);
    expect(hasTechnicalSignals(profileWith({ company: "Nubia", role: "Soporte", from: { year: 2021 }, to: "current", facts: [{ text: "Armé una API en Node.js para el equipo" }] }))).toBe(true);
    expect(hasTechnicalSignals(profileWith({ company: "Nubia", role: "Soporte", from: { year: 2021 }, to: "current", facts: [{ text: "Mantenía los despliegues con DOCKER y GitHub Actions" }] }))).toBe(true);
  });

  it("says so in a study", () => {
    const profile = WAREHOUSE();
    withStudy(profile, { degree: "Tecnicatura en Programación", institution: "UTN", from: { year: 2015 }, to: { year: 2018 } });
    expect(hasTechnicalSignals(profile)).toBe(true);
    const other = WAREHOUSE();
    withStudy(other, { degree: "Licenciatura en Administración", institution: "UBA", from: { year: 2015 }, to: { year: 2019 } });
    expect(hasTechnicalSignals(other)).toBe(false);
  });

  it("says so in a project: what it is called, what it says of itself or what it is made with", () => {
    const profile = WAREHOUSE();
    addEntry(profile, { ...blankForm("project"), what: "Mi tienda", where: "Una tienda online hecha con React y Node.js" }, { newId, now: STAMP });
    expect(hasTechnicalSignals(profile)).toBe(true);
    const plain = WAREHOUSE();
    addEntry(plain, { ...blankForm("project"), what: "Huerta comunitaria", where: "Una huerta en el barrio" }, { newId, now: STAMP });
    expect(hasTechnicalSignals(plain)).toBe(false);
  });

  it("says so in what the person says they look for", () => {
    const profile = WAREHOUSE();
    profile.objective = { value: "Desarrollo web full stack", status: "confirmed" };
    expect(hasTechnicalSignals(profile)).toBe(true);
  });
});
