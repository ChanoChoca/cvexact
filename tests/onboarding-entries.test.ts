import { describe, expect, it } from "vitest";
import { addEntry, blankForm, ENTRY_KIND_LABEL, ENTRY_KINDS, ENTRY_LABELS, isFilled, type EntryForm } from "@/lib/onboarding/entries";
import { toPlainProfile } from "@/lib/profile/project";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";

const NOW = "2026-09-21T12:00:00.000Z";
let n = 0;
const ids = () => ({ newId: () => `id-${++n}`, now: NOW });
const form = (over: Partial<EntryForm>): EntryForm => ({ ...blankForm("job"), ...over });

describe("the step-by-step entries", () => {
  it("makes a job: what is the role, where is the company, the dates are what the picker gave", () => {
    const draft = emptyStoredProfile();
    const id = addEntry(draft, form({ what: "Cajero", where: "Supermercados Delta", from: { year: 2019, month: 3 }, to: { year: 2021 } }), ids());
    const job = draft.experience.find((entry) => entry.id === id)!;
    expect(job.role.value).toBe("Cajero");
    expect(job.company.value).toBe("Supermercados Delta");
    expect(job.start.value).toEqual({ year: 2019, month: 3 });
    expect(job.end.value).toEqual({ year: 2021 });
    expect(toPlainProfile(draft).experience[0]).toMatchObject({ start: "Marzo 2019", end: "2021", current: false });
  });

  it("takes it as said by the person: confirmed, and theirs", () => {
    const draft = emptyStoredProfile();
    addEntry(draft, form({ what: "Cajero", where: "Delta" }), ids());
    expect(draft.experience[0]!.role).toMatchObject({ status: "confirmed", source: { kind: "manual", at: NOW } });
    expect(draft.experience[0]!.company.source?.kind).toBe("manual");
  });

  it("gives a value nobody typed no source", () => {
    const draft = emptyStoredProfile();
    addEntry(draft, form({ what: "Cajero" }), ids());
    expect(draft.experience[0]!.company).toEqual({ value: "", status: "confirmed" });
    expect(draft.experience[0]!.start.value).toEqual({});
  });

  it("marks a job that is still going, and ignores an end date typed beside it", () => {
    const draft = emptyStoredProfile();
    addEntry(draft, form({ what: "Cajero", where: "Delta", from: { year: 2023 }, to: { year: 2024 }, current: true }), ids());
    expect(draft.experience[0]!.end.value).toEqual({ current: true });
    expect(toPlainProfile(draft).experience[0]).toMatchObject({ current: true });
  });

  it("makes internships and volunteering jobs of their own kind", () => {
    const draft = emptyStoredProfile();
    addEntry(draft, form({ kind: "internship", what: "Pasante", where: "Estudio Rey" }), ids());
    addEntry(draft, form({ kind: "volunteer", what: "Voluntaria", where: "Cruz Roja" }), ids());
    expect(draft.experience.map((e) => e.employmentType?.value)).toEqual(["internship", "volunteer"]);
  });

  it("makes teaching, research and a student organisation jobs of their own kind", () => {
    const draft = emptyStoredProfile();
    addEntry(draft, form({ kind: "teaching", what: "Ayudante de cátedra", where: "Algoritmos I" }), ids());
    addEntry(draft, form({ kind: "research", what: "Becaria", where: "Grupo de Robótica" }), ids());
    addEntry(draft, form({ kind: "student_org", what: "Presidenta", where: "Club de Robótica" }), ids());
    expect(draft.experience.map((e) => e.employmentType?.value)).toEqual(["teaching", "research", "student_org"]);
    expect(toPlainProfile(draft).experience.map((e) => e.employmentType)).toEqual(["teaching", "research", "student_org"]);
  });

  it("makes a study: the degree, the institution, still studying as its status", () => {
    const draft = emptyStoredProfile();
    addEntry(draft, form({ kind: "study", what: "Licenciatura en Estadística", where: "UNR", from: { year: 2020 }, current: true }), ids());
    expect(draft.education[0]).toMatchObject({
      degree: { value: "Licenciatura en Estadística" },
      institution: { value: "UNR" },
      start: { value: { year: 2020 } },
      status: { value: "in_progress" },
    });
    expect(draft.education[0]!.end.value).toEqual({});
  });

  it("makes a project of its own kind, with the where as its description", () => {
    const draft = emptyStoredProfile();
    addEntry(draft, form({ kind: "project", what: "Sistema de turnos", where: "Trabajo final de la facultad" }), ids());
    expect(draft.projects[0]).toMatchObject({ name: { value: "Sistema de turnos" }, description: { value: "Trabajo final de la facultad" } });
  });

  it("does not make an entry out of nothing, or out of spaces", () => {
    const draft = emptyStoredProfile();
    expect(addEntry(draft, blankForm("job"), ids())).toBeNull();
    expect(addEntry(draft, form({ what: "  ", where: "" }), ids())).toBeNull();
    expect(draft.experience).toHaveLength(0);
    expect(isFilled(form({ where: "Delta" }))).toBe(true);
    expect(isFilled(form({}))).toBe(false);
  });

  it("does not leave a year with no month claiming a month", () => {
    const draft = emptyStoredProfile();
    addEntry(draft, form({ what: "Cajero", from: { year: 2019 } }), ids());
    expect(draft.experience[0]!.start.value.month).toBeUndefined();
  });
});

describe("what the parts of an entry are called", () => {
  it("has a name and two field labels for every kind, wherever it is asked", () => {
    for (const kind of ENTRY_KINDS) {
      expect(ENTRY_KIND_LABEL[kind], kind).toBeTruthy();
      expect(ENTRY_LABELS[kind].what, kind).toBeTruthy();
      expect(ENTRY_LABELS[kind].where, kind).toBeTruthy();
    }
    expect(new Set(ENTRY_KINDS).size).toBe(9);
  });

  it("asks a job, an internship and volunteering the same two things in the same words", () => {
    expect(ENTRY_LABELS.internship).toEqual(ENTRY_LABELS.job);
    expect(ENTRY_LABELS.volunteer).toEqual(ENTRY_LABELS.job);
    expect(ENTRY_LABELS.job).toEqual({ what: "Puesto o tarea principal", where: "Empresa o lugar" });
  });

  it("calls a project's second field what it is kept as: what it is about, not where", () => {
    expect(ENTRY_LABELS.project.where).toBe("De qué se trata");
    const draft = emptyStoredProfile();
    const id = addEntry(draft, form({ kind: "project", what: "Turnos", where: "Una app para reservar canchas" }), ids());
    expect(draft.projects.find((project) => project.id === id)!.description.value).toBe("Una app para reservar canchas");
  });
});

describe("courses and certificates", () => {
  it("makes one: the name, who gives it, and the date it was finished or given", () => {
    const draft = emptyStoredProfile();
    const id = addEntry(draft, form({ kind: "certification", what: "Manipulación de alimentos", where: "Municipalidad de Córdoba", to: { year: 2024, month: 5 } }), ids());
    expect(draft.certifications).toHaveLength(1);
    const cert = draft.certifications.find((entry) => entry.id === id)!;
    expect(cert.name.value).toBe("Manipulación de alimentos");
    expect(cert.issuer.value).toBe("Municipalidad de Córdoba");
    expect(cert.date.value).toEqual({ year: 2024, month: 5 });
    // Not a job, a study or a project: it goes where the profile keeps certifications, and nowhere else.
    expect([draft.experience.length, draft.education.length, draft.projects.length]).toEqual([0, 0, 0]);
  });

  it("takes it as said by the person: confirmed, and theirs", () => {
    const draft = emptyStoredProfile();
    addEntry(draft, form({ kind: "certification", what: "Curso de Excel", where: "Fundación Telefónica", to: { year: 2023 } }), ids());
    expect(draft.certifications[0]!.name).toMatchObject({ status: "confirmed", source: { kind: "manual", at: NOW } });
    expect(draft.certifications[0]!.date).toMatchObject({ status: "confirmed", source: { kind: "manual" } });
  });

  it("is an entry with only a name, or only who gave it, and with no date at all", () => {
    const draft = emptyStoredProfile();
    expect(addEntry(draft, form({ kind: "certification", what: "Carnet de conducir" }), ids())).not.toBeNull();
    expect(addEntry(draft, form({ kind: "certification", where: "Cruz Roja" }), ids())).not.toBeNull();
    expect(draft.certifications[0]!.date.source).toBeUndefined();
    expect(addEntry(draft, form({ kind: "certification" }), ids())).toBeNull();
  });

  it("reaches the CV as a line of the profile, like one read from a document", () => {
    const draft = emptyStoredProfile();
    addEntry(draft, form({ kind: "certification", what: "Curso de Excel", where: "Fundación Telefónica", to: { year: 2023 } }), ids());
    expect(toPlainProfile(draft).certifications).toEqual([expect.objectContaining({ name: "Curso de Excel", issuer: "Fundación Telefónica", date: "2023" })]);
  });

  it("has its own words for what it is and for the two things asked of it", () => {
    expect(ENTRY_KIND_LABEL.certification).toBe("Curso o certificado");
    expect(ENTRY_LABELS.certification).toEqual({ what: "Curso o certificado", where: "Quién lo da" });
  });
});
