import { describe, expect, it } from "vitest";
import { describeProfile, hasSubstance, importProfilePrompt, restoreBackupPrompt, uploadReplacesPrompt } from "@/lib/profile/replace-guard";
import { readProfileFile, exportProfile } from "@/lib/storage/local";
import { addEntry, blankForm } from "@/lib/onboarding/entries";
import { addSkill } from "@/lib/profile/entities";
import { emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";

/**
 * Three taps put one profile in the place of another. What the person is asked, and what they are told they are
 * about to lose, has to be said in numbers they can compare — a wrong file used to be a profile gone.
 */

let n = 0;
const ids = { newId: () => `g-${++n}`, now: "2026-10-03T12:00:00.000Z" };

function profileWith({ jobs = 0, studies = 0, projects = 0 }: { jobs?: number; studies?: number; projects?: number }): StoredProfile {
  const profile = emptyStoredProfile();
  for (let i = 0; i < jobs; i++) addEntry(profile, { ...blankForm("job"), what: `Puesto ${i}`, where: `Empresa ${i}` }, ids);
  for (let i = 0; i < studies; i++) addEntry(profile, { ...blankForm("study"), what: `Carrera ${i}`, where: `Instituto ${i}` }, ids);
  for (let i = 0; i < projects; i++) addEntry(profile, { ...blankForm("project"), what: `Proyecto ${i}`, where: "Trabajo final" }, ids);
  return profile;
}

describe("a profile as a person counts it", () => {
  it("says jobs and studies, and projects when there are any", () => {
    expect(describeProfile(profileWith({ jobs: 5, studies: 2 }))).toBe("5 puestos y 2 estudios");
    expect(describeProfile(profileWith({ jobs: 1, studies: 1, projects: 3 }))).toBe("1 puesto, 1 estudio y 3 proyectos");
    expect(describeProfile(profileWith({ jobs: 1 }))).toBe("1 puesto");
  });

  it("says a profile with nothing in it is almost empty, and does not count it as worth a copy", () => {
    expect(describeProfile(emptyStoredProfile())).toBe("casi vacío");
    expect(hasSubstance(emptyStoredProfile())).toBe(false);
  });

  it("counts notes and skills as something, even without a job", () => {
    const withSkill = emptyStoredProfile();
    addSkill(withSkill, "Excel");
    expect(hasSubstance(withSkill)).toBe(true);
    const withNote = emptyStoredProfile();
    withNote.notes.push({ id: "n1", text: "Lo que conté", at: "" });
    expect(hasSubstance(withNote)).toBe(true);
  });
});

describe("what is said before a profile is replaced", () => {
  it("compares the one here with the one in the file, and says a copy is taken first", () => {
    const text = importProfilePrompt(profileWith({ jobs: 5, studies: 2 }), profileWith({ jobs: 3, studies: 1 }));
    expect(text).toContain("tu perfil actual (5 puestos y 2 estudios)");
    expect(text).toContain("el del archivo (3 puestos y 1 estudio)");
    expect(text).toContain("Antes te bajamos una copia del actual");
  });

  it("says the account's profile is the one that goes when uploading, and that a copy of it is taken", () => {
    const text = uploadReplacesPrompt(profileWith({ jobs: 4 }), profileWith({ jobs: 1 }));
    expect(text).toContain("Tu cuenta ya tiene un perfil guardado (4 puestos)");
    expect(text).toContain("el de este navegador (1 puesto)");
    expect(text).toContain("una copia del de tu cuenta");
  });

  it("says what a restore replaces: the profile and the applications, by what the file holds", () => {
    const text = restoreBackupPrompt(
      { profile: profileWith({ jobs: 2 }), applications: 12 },
      { profile: profileWith({ jobs: 1, studies: 1 }), applications: 0 },
    );
    expect(text).toContain("tu perfil (2 puestos) y 12 postulaciones");
    expect(text).toContain("un perfil con 1 puesto y 1 estudio y sin postulaciones");
    expect(text).toContain("una copia completa de lo actual");
    expect(restoreBackupPrompt({ profile: emptyStoredProfile(), applications: 1 }, { profile: profileWith({ jobs: 1 }), applications: 1 })).toContain("1 postulación");
  });
});

describe("reading a profile file without applying it", () => {
  const file = (body: unknown) => JSON.stringify(body);

  it("gives the profile it holds, ready to be compared", () => {
    const source = profileWith({ jobs: 2, studies: 1 });
    const read = readProfileFile(file(exportProfile(source)));
    expect(read.ok).toBe(true);
    if (read.ok) expect(describeProfile(read.profile)).toBe("2 puestos y 1 estudio");
  });

  it("says what is wrong with a file that cannot be used, in the words the import has always used", () => {
    expect(readProfileFile("no es json")).toEqual({ ok: false, error: "El archivo no es JSON válido." });
    expect(readProfileFile(file({ kind: "otra-cosa" }))).toEqual({ ok: false, error: "El archivo no es una copia de tu perfil." });
    expect(readProfileFile(file({ kind: "cvexact-backup" }))).toEqual({ ok: false, error: "Ese archivo es una copia de tu cuenta completa. Restauralo desde Ajustes." });
    expect(readProfileFile(file({ kind: "cvexact-profile", profile: 42 }))).toEqual({ ok: false, error: "El perfil del archivo no tiene un formato válido." });
  });
});
