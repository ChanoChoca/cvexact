import { describe, expect, it } from "vitest";
import { ENGINE } from "@/lib/onboarding/config";
import { addSkill } from "@/lib/profile/entities";
import { addEntry, blankForm } from "@/lib/onboarding/entries";
import { backedUntil, skillSegment, staleAfterYears, staleGapId, staleSkills, wholeYears } from "@/lib/profile/staleness";
import { NOW, STAMP, newId, profileWith } from "./helpers/profiles";

/**
 * A skill that nothing has backed for years (e5, O17; E4, 4): when there is something to ask, and — as much — that nothing is ever decided. A date
 * nothing can give is not an invention: a skill nothing dates is not asked about.
 */

/** A skill typed in on a day (2020, by default), linked to the given jobs. */
function withSkill(profile: ReturnType<typeof profileWith>, name: string, jobIds: string[] = [], at = "2020-01-15T10:00:00.000Z") {
  const skill = addSkill(profile, name, { now: at, newId }, jobIds[0])!;
  for (const id of jobIds.slice(1)) skill.experienceIds.push(id);
  return skill;
}

const stale = (profile: ReturnType<typeof profileWith>) => staleSkills(profile, NOW).map((entry) => entry.name);

describe("what kind of skill it is", () => {
  it("is a manual one when it is a trade — the word for it at the start of a word — and a technical one otherwise", () => {
    for (const name of ["Soldadura MIG", "Plomería", "Gasista matriculado", "Electricidad domiciliaria", "Albañilería", "Carpintería de obra", "Panadería", "Manejo de autoelevador", "Aire acondicionado", "Costura industrial", "Cocina"]) {
      expect(skillSegment(name), name).toBe("manual");
    }
    for (const name of ["Excel", "SAP", "Atención al cliente", "Electrónica", "Python", "Inglés", "Mantenimiento de software", "Instalación de redes", "Gestión de equipos"]) {
      expect(skillSegment(name), name).toBe("technical");
    }
  });

  it("has the years E4 proposes — three and five — as starting values that the config says, and nothing else says", () => {
    expect(ENGINE.currency.unusedSkillYears).toEqual({ technical: 3, manual: 5 });
    expect(staleAfterYears("technical")).toBe(3);
    expect(staleAfterYears("manual")).toBe(5);
  });
});

describe("whole years", () => {
  it("counts a year when it is complete: the 31st of December to the 20th of September is not three", () => {
    expect(wholeYears(new Date(2023, 11, 31), new Date(2026, 8, 21))).toBe(2);
    expect(wholeYears(new Date(2023, 7, 31), new Date(2026, 8, 21))).toBe(3);
    expect(wholeYears(new Date(2026, 8, 21), new Date(2026, 8, 21))).toBe(0);
    expect(wholeYears(new Date(2021, 8, 21), new Date(2026, 8, 21))).toBe(5);
  });
});

describe("what last backed a skill", () => {
  it("is the end of the latest job it was used in: the one it is linked to, or one whose own lines name it", () => {
    const profile = profileWith(
      { company: "Nubia", role: "Analista", from: { year: 2016 }, to: { year: 2019, month: 5 }, facts: [{ text: "Armaba informes en Excel" }] },
      { company: "Lumen", role: "Asistente", from: { year: 2019 }, to: { year: 2022, month: 11 }, facts: [{ text: "Atendía clientes" }] },
    );
    const [nubia, lumen] = profile.experience.slice().sort((a, b) => (a.start.value.year ?? 0) - (b.start.value.year ?? 0));
    const linked = withSkill(profile, "Tableau", [nubia!.id, lumen!.id]);
    expect(backedUntil(profile, linked, NOW)).toEqual(new Date(2022, 11, 0, 23, 59, 59));
    // Nobody linked it, and the older job's lines say it.
    const said = withSkill(profile, "Excel", [], "2015-01-01T00:00:00.000Z");
    expect(backedUntil(profile, said, NOW)).toEqual(new Date(2019, 5, 0, 23, 59, 59));
    // The person's own word counts too, and it is the later of the two that backs it: typed in 2020, after that job ended, it is 2020.
    expect(backedUntil(profile, withSkill(profile, "Excel avanzado", []), NOW)).toEqual(new Date("2020-01-15T10:00:00.000Z"));
  });

  it("is today for a job that is going on, or whose end nobody wrote, and for a project that names it: nothing is invented", () => {
    const profile = profileWith(
      { company: "Nubia", role: "Analista", from: { year: 2016 }, to: { year: 2018 } },
      { company: "Lumen", role: "Asistente", from: { year: 2023 }, to: "current" },
      { company: "Sin fin", role: "Ayudante", from: { year: 2015 } },
    );
    const jobs = Object.fromEntries(profile.experience.map((job) => [job.company.value, job.id]));
    expect(backedUntil(profile, withSkill(profile, "Excel", [jobs.Lumen!]), NOW)).toEqual(NOW);
    expect(backedUntil(profile, withSkill(profile, "Soldadura", [jobs["Sin fin"]!]), NOW)).toEqual(NOW);
    addEntry(profile, { ...blankForm("project"), what: "Mi tienda", where: "Hecha con Django y PostgreSQL" }, { newId, now: STAMP });
    expect(backedUntil(profile, withSkill(profile, "Django", []), NOW)).toEqual(NOW);
  });

  it("is the day the person last stood behind it when no job does — and nothing, for what nobody dated", () => {
    const profile = profileWith({ company: "Nubia", role: "Analista", from: { year: 2016 }, to: { year: 2018 } });
    const typed = withSkill(profile, "Photoshop", [], "2021-03-04T10:00:00.000Z");
    expect(backedUntil(profile, typed, NOW)).toEqual(new Date("2021-03-04T10:00:00.000Z"));
    const read = withSkill(profile, "Illustrator", []);
    read.name = { ...read.name, source: { kind: "cv", at: "2020-01-15T10:00:00.000Z" } };
    expect(backedUntil(profile, read, NOW)).toBeNull();
    typed.name.confirmedAt = "2026-09-01T10:00:00.000Z";
    expect(backedUntil(profile, typed, NOW)).toEqual(new Date("2026-09-01T10:00:00.000Z"));
    const blank = withSkill(profile, "x", []);
    blank.name = { ...blank.name, value: "  " };
    expect(backedUntil(profile, blank, NOW)).toBeNull();
  });
});

describe("the skills that are asked about", () => {
  it("are the technical ones nothing has backed for three years and the manual ones for five, and not a day sooner", () => {
    const profile = profileWith(
      { company: "A", role: "Analista", from: { year: 2018 }, to: { year: 2023, month: 8 } },
      { company: "B", role: "Analista", from: { year: 2018 }, to: { year: 2023, month: 9 } },
      { company: "C", role: "Soldador", from: { year: 2015 }, to: { year: 2021, month: 8 } },
      { company: "D", role: "Soldador", from: { year: 2015 }, to: { year: 2021, month: 9 } },
    );
    const by = Object.fromEntries(profile.experience.map((job) => [job.company.value, job.id]));
    withSkill(profile, "Excel", [by.A!]); // ended August 2023: three years complete
    withSkill(profile, "SAP", [by.B!]); // ended September 2023: not yet three
    withSkill(profile, "Soldadura MIG", [by.C!]); // ended August 2021: five years complete
    withSkill(profile, "Soldadura TIG", [by.D!]); // ended September 2021: not yet five
    expect(stale(profile)).toEqual(["Soldadura MIG", "Excel"]);
  });

  it("come oldest first, with the year they count from in their id so that «ahora no» turns down this lapse and not the next", () => {
    const profile = profileWith(
      { company: "A", role: "Analista", from: { year: 2010 }, to: { year: 2015 } },
      { company: "B", role: "Analista", from: { year: 2016 }, to: { year: 2019 } },
    );
    const by = Object.fromEntries(profile.experience.map((job) => [job.company.value, job.id]));
    // Typed in long ago, so that what backs each is its job and not the day it was written down.
    const recent = withSkill(profile, "Excel", [by.B!], "2005-01-01T00:00:00.000Z");
    const old = withSkill(profile, "SAP", [by.A!], "2005-01-01T00:00:00.000Z");
    const found = staleSkills(profile, NOW);
    expect(found.map((entry) => entry.name)).toEqual(["SAP", "Excel"]);
    expect(found.map(staleGapId)).toEqual([`skill_stale:${old.id}:2015`, `skill_stale:${recent.id}:2019`]);
    expect(found[0]).toMatchObject({ segment: "technical", years: 10 });
  });

  it("are never one that a job going on backs, nor one the person said holds this month", () => {
    const profile = profileWith(
      { company: "Nubia", role: "Analista", from: { year: 2016 }, to: { year: 2018 } },
      { company: "Lumen", role: "Asistente", from: { year: 2023 }, to: "current" },
    );
    const by = Object.fromEntries(profile.experience.map((job) => [job.company.value, job.id]));
    withSkill(profile, "Excel", [by.Nubia!, by.Lumen!]);
    const said = withSkill(profile, "SAP", [by.Nubia!]);
    expect(stale(profile)).toEqual(["SAP"]);
    said.name.confirmedAt = NOW.toISOString();
    expect(stale(profile)).toEqual([]);
  });

  it("are none in a profile with no jobs and no skills, and none for what nothing can date", () => {
    expect(staleSkills(profileWith(), NOW)).toEqual([]);
    const profile = profileWith({ company: "Nubia", role: "Analista", from: { year: 2016 }, to: { year: 2018 } });
    const read = withSkill(profile, "Illustrator", []);
    read.name = { ...read.name, source: { kind: "cv", at: "2020-01-15T10:00:00.000Z" } };
    expect(staleSkills(profile, NOW)).toEqual([]);
  });
});
