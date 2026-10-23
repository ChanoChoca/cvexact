import { describe, expect, it } from "vitest";
import { addSkill } from "@/lib/profile/entities";
import { removeFact } from "@/lib/profile/facts";
import { describeJoin, joinProfiles } from "@/lib/profile/join";
import { removeExperience, removeSkill } from "@/lib/onboarding/review";
import { storedProfileSchema, type StoredProfile } from "@/lib/schemas/profile-v2";
import { STAMP, newId, profileWith, withJob, withStudy } from "./helpers/profiles";

/**
 * «Juntar los dos»: two versions of one profile, from two devices, in a single one. It adds, and does not decide: where both say
 * something different about the same thing the browser's stays, and what was removed here is not brought back.
 */

const ctx = { now: STAMP, newId };
const copy = (profile: StoredProfile): StoredProfile => storedProfileSchema.parse(structuredClone(profile));

const base = () =>
  profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes" }] });

describe("joining a browser's profile with the account's", () => {
  it("adds a job the account has and the browser does not", () => {
    const local = base();
    const account = copy(local);
    withJob(account, { company: "Grupo Lumen", role: "Asistente", from: { year: 2019 }, to: { year: 2021 }, facts: [{ text: "Atendía a los clientes" }] });
    const { profile, added } = joinProfiles(local, account);
    expect(profile.experience.map((job) => job.company.value)).toEqual(["Nubia Retail", "Grupo Lumen"]);
    expect(added.jobs).toBe(1);
    expect(profile.experience[1]!.facts.map((fact) => fact.text)).toEqual(["Atendía a los clientes"]);
  });

  it("adds the task of a job both have, after the ones it has", () => {
    const local = base();
    const account = copy(local);
    account.experience[0]!.facts.push({ id: newId(), kind: "responsibility", text: "Coordino al equipo de ventas", source: { kind: "manual", at: STAMP }, status: "confirmed" });
    const { profile, added } = joinProfiles(local, account);
    expect(profile.experience[0]!.facts.map((fact) => fact.text)).toEqual(["Armo los informes", "Coordino al equipo de ventas"]);
    expect(added).toMatchObject({ jobs: 0, tasks: 1 });
  });

  it("keeps the browser's version where both say something different about the same thing", () => {
    const local = base();
    const account = copy(local);
    account.experience[0]!.company = { value: "Nubia S.A.", status: "edited" };
    account.experience[0]!.facts[0]!.text = "Armo todos los informes";
    const { profile, added } = joinProfiles(local, account);
    expect(profile.experience[0]!.company.value).toBe("Nubia Retail");
    expect(profile.experience[0]!.facts[0]!.text).toBe("Armo los informes");
    expect(describeJoin(added)).toBe("");
  });

  it("does not bring back a job, a task or a skill that was removed on this browser", () => {
    const local = profileWith(
      { company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes" }, { text: "Cierro el mes" }] },
      { company: "Grupo Lumen", role: "Asistente", from: { year: 2019 }, to: { year: 2021 }, facts: [{ text: "Atendía a los clientes" }] },
    );
    addSkill(local, "Excel", ctx);
    const account = copy(local);
    // On this browser: the second job goes, so does a task of the first, and a skill.
    removeExperience(local, local.experience[1]!.id, ctx);
    removeFact(local, local.experience[0]!.id, local.experience[0]!.facts[1]!.id, ctx);
    removeSkill(local, local.skills[0]!.id, ctx);
    const { profile, added } = joinProfiles(local, account);
    expect(profile.experience.map((job) => job.company.value)).toEqual(["Nubia Retail"]);
    expect(profile.experience[0]!.facts.map((fact) => fact.text)).toEqual(["Armo los informes"]);
    expect(profile.skills).toHaveLength(0);
    expect(describeJoin(added)).toBe("");
  });

  it("adds a skill by its name, and the jobs it was used in, once", () => {
    const local = base();
    addSkill(local, "Excel", ctx);
    const account = copy(local);
    const second = withJob(account, { company: "Grupo Lumen", role: "Asistente", from: { year: 2019 }, to: { year: 2021 } });
    addSkill(account, "excel", ctx, second.id); // the same skill, said otherwise, and linked to the job it brings
    addSkill(account, "SQL", ctx);
    const { profile, added } = joinProfiles(local, account);
    expect(profile.skills.map((skill) => skill.name.value)).toEqual(["Excel", "SQL"]);
    expect(profile.skills[0]!.experienceIds).toEqual([second.id]);
    expect(added.skills).toBe(1);
  });

  it("fills in what the browser left empty and not what it has", () => {
    const local = base();
    local.contact.fullName = { value: "Ana Ruiz", status: "confirmed" };
    const account = copy(local);
    account.contact.fullName = { value: "Ana R.", status: "confirmed" };
    account.contact.email = { value: "ana@example.com", status: "confirmed" };
    account.contact.links = { value: [{ label: "LinkedIn", url: "https://linkedin.com/in/perfil-ejemplo" }], status: "confirmed" };
    account.legacy.headline = { value: "Analista de datos", status: "confirmed" };
    const { profile, added } = joinProfiles(local, account);
    expect(profile.contact.fullName.value).toBe("Ana Ruiz");
    expect(profile.contact.email.value).toBe("ana@example.com");
    expect(profile.contact.links.value.map((link) => link.url)).toEqual(["https://linkedin.com/in/perfil-ejemplo"]);
    expect(profile.legacy.headline.value).toBe("Analista de datos");
    expect(added.fields).toBe(3);
  });

  it("brings a study, a note and what has no place, and keeps what is only the browser's", () => {
    const local = base();
    local.notes.push({ id: newId(), text: "Solo acá", at: STAMP });
    const account = copy(local);
    withStudy(account, { degree: "Licenciatura en Administración", institution: "UBA", from: { year: 2015 }, to: { year: 2020 } });
    account.notes.push({ id: newId(), text: "De la cuenta", at: STAMP });
    account.unassigned.push({ id: newId(), text: "Voluntariado en un comedor", kind: "interests" });
    const { profile, added } = joinProfiles(local, account);
    expect(profile.education).toHaveLength(1);
    expect(profile.notes.map((note) => note.text)).toEqual(["Solo acá", "De la cuenta"]);
    expect(profile.unassigned).toHaveLength(1);
    expect(added).toMatchObject({ studies: 1, notes: 1 });
  });

  it("changes nothing else about the browser's profile: its history, what it archived and where it is in the flow", () => {
    const local = base();
    removeFact(local, local.experience[0]!.id, local.experience[0]!.facts[0]!.id, ctx);
    local.onboarding.done = true;
    const { profile } = joinProfiles(local, copy(local));
    expect(profile.history).toEqual(local.history);
    expect(profile.archive).toEqual(local.archive);
    expect(profile.onboarding.done).toBe(true);
    expect(profile.rev).toBe(local.rev);
  });

  it("is done once: joining the result with the same account adds nothing more", () => {
    const local = base();
    const account = copy(local);
    withJob(account, { company: "Grupo Lumen", role: "Asistente", from: { year: 2019 }, to: { year: 2021 } });
    account.contact.phone = { value: "+54 11 5555 0000", status: "confirmed" };
    const once = joinProfiles(local, account).profile;
    expect(describeJoin(joinProfiles(once, account).added)).toBe("");
  });
});

/** The same CV imported on two devices: the same jobs, with ids of their own. */
const imported = (profile: StoredProfile): StoredProfile => {
  const other = copy(profile);
  const fresh = (id: string) => `${id}-otro-equipo`;
  for (const job of other.experience) {
    job.id = fresh(job.id);
    for (const task of job.facts) task.id = fresh(task.id);
  }
  for (const entry of other.education) entry.id = fresh(entry.id);
  return other;
};

describe("the same thing on both sides, with ids of its own", () => {
  it("is one job: only the tasks the other lacks are added, and nothing is doubled", () => {
    const local = base();
    const account = imported(local);
    account.experience[0]!.facts.push({ id: newId(), kind: "responsibility", text: "Coordino al equipo de ventas", source: { kind: "manual", at: STAMP }, status: "confirmed" });
    const { profile, added } = joinProfiles(local, account);
    expect(profile.experience).toHaveLength(1);
    expect(profile.experience[0]!.facts.map((task) => task.text)).toEqual(["Armo los informes", "Coordino al equipo de ventas"]);
    expect(added).toMatchObject({ jobs: 0, tasks: 1 });
  });

  it("tells a task by its words, in any case and with any accents", () => {
    const local = base();
    const account = imported(local);
    account.experience[0]!.facts[0]!.text = "ARMO LOS INFORMES";
    expect(describeJoin(joinProfiles(local, account).added)).toBe("");
  });

  it("is one study, one course, one language, one project and one note, by what they say", () => {
    const local = base();
    withStudy(local, { degree: "Licenciatura en Administración", institution: "UBA", from: { year: 2015 }, to: { year: 2020 } });
    local.notes.push({ id: newId(), text: "Me mudo en marzo", at: STAMP });
    const account = imported(local);
    account.notes[0]!.id = newId();
    expect(describeJoin(joinProfiles(local, account).added)).toBe("");
  });

  it("does not make a job of two that merely share a company: the role and the year say they are different", () => {
    const local = base();
    const account = copy(local);
    withJob(account, { company: "Nubia Retail", role: "Gerente", from: { year: 2024 }, to: "current" });
    const { profile, added } = joinProfiles(local, account);
    expect(profile.experience).toHaveLength(2);
    expect(added.jobs).toBe(1);
  });

  it("links a skill to the browser's job when it was linked to the account's twin of it", () => {
    const local = base();
    addSkill(local, "Excel", ctx);
    const account = imported(local);
    addSkill(account, "Excel", ctx, account.experience[0]!.id);
    const { profile } = joinProfiles(local, account);
    expect(profile.skills[0]!.experienceIds).toEqual([local.experience[0]!.id]);
  });

  it("does not bring back what was removed here even when the account has it under another id", () => {
    const local = profileWith(
      { company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes" }, { text: "Cierro el mes" }] },
      { company: "Grupo Lumen", role: "Asistente", from: { year: 2019 }, to: { year: 2021 }, facts: [{ text: "Atendía a los clientes" }] },
    );
    const account = imported(local);
    removeExperience(local, local.experience[1]!.id, ctx);
    removeFact(local, local.experience[0]!.id, local.experience[0]!.facts[1]!.id, ctx);
    const { profile, added } = joinProfiles(local, account);
    expect(profile.experience.map((job) => job.company.value)).toEqual(["Nubia Retail"]);
    expect(profile.experience[0]!.facts.map((task) => task.text)).toEqual(["Armo los informes"]);
    expect(describeJoin(added)).toBe("");
  });

  it("does not bring back what came out with a whole document that was taken out", () => {
    const local = base();
    local.sources.push({ id: "doc-1", kind: "cv", name: "", fileHash: "h", pasted: false, chars: 10, importedAt: STAMP });
    local.archive.push({ id: newId(), at: STAMP, kind: "source", parentPath: [], label: "doc", entity: { id: "doc-1", source: local.sources[0], sourceIndex: 0, experience: [{ entity: copy(local).experience[0], index: 0 }], education: [], facts: [], skills: [], languages: [], certifications: [], projects: [], unassigned: [], conflicts: [], skillLinks: [], resets: [] } });
    const account = imported(local);
    local.experience = [];
    expect(joinProfiles(local, account).profile.experience).toHaveLength(0);
  });
});

describe("what joining says it added", () => {
  const zero = { jobs: 0, tasks: 0, studies: 0, certifications: 0, languages: 0, projects: 0, skills: 0, notes: 0, declined: 0, evidence: 0, fields: 0 };

  it("counts in words, in the order a person lists a profile", () => {
    expect(describeJoin({ ...zero, jobs: 1, tasks: 2, studies: 1 })).toBe("1 puesto, 2 tareas y 1 estudio");
    expect(describeJoin({ ...zero, skills: 3 })).toBe("3 habilidades");
    expect(describeJoin({ ...zero, fields: 1, notes: 1 })).toBe("1 nota y 1 dato suelto");
  });

  it("is empty when there is nothing to add", () => {
    expect(describeJoin(zero)).toBe("");
  });
});
