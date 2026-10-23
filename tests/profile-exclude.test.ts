import { describe, expect, it } from "vitest";
import { baseCv, isPreviewReady, previewEntryCount, previewFactRefs } from "@/lib/cv/from-profile";
import { setFactExcluded, setFactTransferable, setJobExcluded } from "@/lib/profile/facts";
import { undoEntry } from "@/lib/profile/edit";
import { toPlainProfile } from "@/lib/profile/project";
import { applicationSchema } from "@/lib/storage/application";
import { reconcileFromPlain } from "@/lib/profile/reconcile";
import { profileSchema } from "@/lib/schemas/profile";
import { storedProfileSchema } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, newId, profileWith, withStudy } from "./helpers/profiles";

/**
 * «No usar en CVs»: a task or a job that stays in the profile and goes into no CV. What is left out is not in the plain profile
 * at all — a generator cannot use what it does not see — and an edit made on the plain one must neither archive it nor lose its
 * place.
 */

const ctx = { now: STAMP, newId };

const twoJobs = () =>
  profileWith(
    { company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes" }, { text: "Coordino al equipo de ventas" }, { kind: "tool", text: "Excel" }] },
    { company: "Grupo Lumen", role: "Asistente", from: { year: 2019 }, to: { year: 2021 }, facts: [{ text: "Atendía a los clientes" }] },
  );

describe("leaving a task out of every CV", () => {
  it("is a mark on the task, and nothing else changes: the words, the order and the rest stay", () => {
    const profile = twoJobs();
    const [first, second] = profile.experience[0]!.facts;
    expect(setFactExcluded(profile, profile.experience[0]!.id, second!.id, true, ctx)).toBe(true);
    const after = profile.experience[0]!.facts;
    expect(after.map((fact) => fact.text)).toEqual(["Armo los informes", "Coordino al equipo de ventas", "Excel"]);
    expect(after[1]!.excluded).toBe(true);
    expect(after[0]).toBe(first);
  });

  it("is absent, not false, when the task is used again — and says nothing when nothing changed", () => {
    const profile = twoJobs();
    const job = profile.experience[0]!;
    setFactExcluded(profile, job.id, job.facts[0]!.id, true, ctx);
    setFactExcluded(profile, job.id, job.facts[0]!.id, false, ctx);
    expect("excluded" in job.facts[0]!).toBe(false);
    const steps = profile.history.length;
    expect(setFactExcluded(profile, job.id, job.facts[0]!.id, false, ctx)).toBe(true);
    expect(profile.history).toHaveLength(steps);
    expect(setFactExcluded(profile, job.id, "nobody", true, ctx)).toBe(false);
  });

  it("can be taken back with the history, like any other edit", () => {
    const profile = twoJobs();
    const job = profile.experience[0]!;
    setFactExcluded(profile, job.id, job.facts[0]!.id, true, ctx);
    const undone = undoEntry(profile, profile.history[profile.history.length - 1]!.id);
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(undone.profile.experience[0]!.facts[0]!.excluded).toBeUndefined();
  });

  it("takes a whole job out the same way, and the history takes it back", () => {
    const profile = twoJobs();
    const id = profile.experience[1]!.id;
    expect(setJobExcluded(profile, id, true, ctx)).toBe(true);
    expect(profile.experience[1]!.excluded).toBe(true);
    const undone = undoEntry(profile, profile.history[profile.history.length - 1]!.id);
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(undone.profile.experience[1]!.excluded).toBeUndefined();
    expect(setJobExcluded(profile, "nobody", true, ctx)).toBe(false);
  });
});

describe("what the plain profile has of it", () => {
  it("is nothing: not the task, not a job that was left out whole", () => {
    const profile = twoJobs();
    const job = profile.experience[0]!;
    setFactExcluded(profile, job.id, job.facts[1]!.id, true, ctx);
    setJobExcluded(profile, profile.experience[1]!.id, true, ctx);
    const plain = toPlainProfile(profile);
    expect(plain.experience.map((entry) => entry.company)).toEqual(["Nubia Retail"]);
    expect(plain.experience[0]!.bullets).toEqual(["Armo los informes"]);
    expect(plain.experience[0]!.tags).toEqual(["Excel"]);
  });

  it("says which lines were told as results and which carry over, by their text, and the type and mode of the job", () => {
    const profile = profileWith({ company: "Nubia Retail", role: "Analista", facts: [{ kind: "achievement", text: "Subí las ventas", metric: { value: "20", unit: "%", approx: false } }, { text: "Armo los informes" }] });
    const job = profile.experience[0]!;
    job.employmentType = { value: "internship", status: "confirmed" };
    job.workMode = { value: "remote", status: "confirmed" };
    setFactTransferable(profile, job.id, job.facts[1]!.id, true, ctx);
    const [plain] = toPlainProfile(profile).experience;
    expect(plain!.achievements).toEqual(["Subí las ventas — 20 %"]);
    expect(plain!.transferable).toEqual(["Armo los informes"]);
    expect(plain).toMatchObject({ employmentType: "internship", workMode: "remote" });
    expect(toPlainProfile(profileWith({ company: "A", role: "b" })).experience[0]).toMatchObject({ employmentType: "", workMode: "", achievements: [], transferable: [] });
  });

  it("has the start of a study, and the stored profile gets it back", () => {
    const profile = profileWith();
    withStudy(profile, { degree: "Licenciatura", institution: "UNC", from: { year: 2021, month: 3 }, to: { year: 2025 } });
    const plain = toPlainProfile(profile);
    expect(plain.education[0]!.start).toBe("Marzo 2021");
    const next = structuredClone(plain);
    next.education[0]!.start = "2020";
    const saved = reconcileFromPlain(profile, profileSchema.parse(next), { now: STAMP, newId });
    expect(saved.education[0]!.start.value).toMatchObject({ year: 2020 });
  });
});

describe("an edit made on the plain profile, with something left out", () => {
  it("does not archive what it never had, and leaves it where it was", () => {
    const profile = twoJobs();
    const job = profile.experience[0]!;
    setFactExcluded(profile, job.id, job.facts[0]!.id, true, ctx);
    setJobExcluded(profile, profile.experience[1]!.id, true, ctx);

    const next = structuredClone(toPlainProfile(profile));
    next.experience[0]!.bullets.push("Capacité a los nuevos");
    const saved = reconcileFromPlain(profile, profileSchema.parse(next), { now: STAMP, newId });

    expect(saved.archive).toHaveLength(0);
    expect(saved.experience.map((entry) => entry.company.value)).toEqual(["Nubia Retail", "Grupo Lumen"]);
    expect(saved.experience[1]!.excluded).toBe(true);
    const texts = saved.experience[0]!.facts.map((fact) => fact.text);
    expect(texts[0]).toBe("Armo los informes");
    expect(saved.experience[0]!.facts[0]!.excluded).toBe(true);
    expect(texts).toContain("Capacité a los nuevos");
    expect(texts).toContain("Coordino al equipo de ventas");
    // And what comes out is what was asked for.
    expect(toPlainProfile(saved).experience[0]!.bullets).toEqual(["Coordino al equipo de ventas", "Capacité a los nuevos"]);
  });

  it("does not take a task that is left out for a line that was removed", () => {
    const profile = twoJobs();
    const job = profile.experience[0]!;
    setFactExcluded(profile, job.id, job.facts[1]!.id, true, ctx);
    const next = structuredClone(toPlainProfile(profile));
    next.experience[0]!.bullets = [];
    const saved = reconcileFromPlain(profile, profileSchema.parse(next), { now: STAMP, newId });
    expect(saved.experience[0]!.facts.map((fact) => fact.text)).toEqual(["Coordino al equipo de ventas", "Excel"]);
    expect(saved.archive.map((entry) => entry.label)).toEqual(["Armo los informes"]);
  });

  it("returns the very same profile when nothing was edited, with or without marks", () => {
    const profile = twoJobs();
    setFactExcluded(profile, profile.experience[0]!.id, profile.experience[0]!.facts[0]!.id, true, ctx);
    expect(reconcileFromPlain(profile, toPlainProfile(profile))).toBe(profile);
  });
});

describe("the base CV", () => {
  it("does not draw a job or a task that was left out, and its preview says the same", () => {
    const profile = twoJobs();
    const job = profile.experience[0]!;
    setFactExcluded(profile, job.id, job.facts[1]!.id, true, ctx);
    setJobExcluded(profile, profile.experience[1]!.id, true, ctx);
    const { document } = baseCv(profile);
    const experience = document.sections.find((section) => section.kind === "experience");
    expect(experience?.kind === "experience" && experience.items.map((item) => item.company)).toEqual(["Nubia Retail"]);
    expect(experience?.kind === "experience" && experience.items[0]!.bullets).toEqual(["Armo los informes"]);
    expect([...previewFactRefs(profile).values()].map((ref) => ref.factId)).toEqual([job.facts[0]!.id]);
    expect(previewEntryCount(profile)).toBe(1);
    expect(isPreviewReady(profile)).toBe(true);
    setJobExcluded(profile, job.id, true, ctx);
    expect(previewEntryCount(profile)).toBe(0);
  });
});

describe("a profile from before the marks existed", () => {
  it("has none, and a mark that is not a boolean is let go of", () => {
    const profile = twoJobs();
    const raw = JSON.parse(JSON.stringify(profile)) as { experience: Array<Record<string, unknown>> };
    raw.experience[0]!.excluded = "yes";
    (raw.experience[0]!.facts as Array<Record<string, unknown>>)[0]!.excluded = 1;
    const parsed = storedProfileSchema.parse(raw);
    expect(parsed.experience[0]!.excluded).toBeUndefined();
    expect(parsed.experience[0]!.facts[0]!.excluded).toBeUndefined();
    expect(NOW.getFullYear()).toBeGreaterThan(2000);
  });
});

describe("an application saved when one could leave things out of it", () => {
  it("still parses, with its list of ids read and unused, and one from before has none", () => {
    const base = { id: "a1", createdAt: STAMP, updatedAt: STAMP, jobText: "Buscamos analista", label: "Analista" };
    expect(applicationSchema.parse(base).excludedIds).toBeUndefined();
    expect(applicationSchema.parse({ ...base, excludedIds: ["x", "y"] }).excludedIds).toEqual(["x", "y"]);
  });
});
