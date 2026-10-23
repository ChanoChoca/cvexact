import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMetrics } from "@/lib/metrics/counters";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { lockCopy } from "@/lib/storage/locked-copy";
import type { AskToOpen } from "@/lib/storage/copy-file";
import { installBrowser, realisticApplication, uninstallBrowser, type FakeStorage } from "./helpers/browser-storage";
import { profileWith } from "./helpers/profiles";

/**
 * Bringing a copy back, once, whatever kind it is (U04). It was three screens with three readers, and each sent the file the others take to the
 * screen that takes it. What is checked is what a person relies on: that any copy is read as what it says it is, that nothing is replaced
 * without saying what by what, that what goes is written down before it does, and that a cancelled question leaves everything where it was.
 */

// What downloads a file needs a page; what matters here is that it was asked for, and for what.
const profileCopies: Array<{ profile: StoredProfile | undefined; label: string | undefined }> = [];
let backupCopies = 0;
vi.mock("@/lib/storage/profile-copy", () => ({
  saveProfileFile: (profile?: StoredProfile, label?: string) => void profileCopies.push({ profile, label }),
  exportOwnProfile: () => {},
}));
vi.mock("@/lib/storage/download", () => ({
  downloadAccountBackup: async () => void (backupCopies += 1),
  downloadJson: () => {},
  todayStamp: () => "2026-10-10",
}));

const JOB_A = { company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current" as const, facts: [{ text: "Armo los pedidos del local" }] };
const JOB_B = { company: "Grupo Lumen", role: "Asistente", from: { year: 2018, month: 9 }, to: { year: 2021, month: 1 }, facts: [{ text: "Atendía clientes" }] };

let local: FakeStorage;
let api: typeof import("@/lib/storage/local");
let recoverCopy: typeof import("@/lib/storage/recover-copy").recoverCopy;

const file = (contents: unknown) => new File([typeof contents === "string" ? contents : JSON.stringify(contents)], "copia.json", { type: "application/json" });
const never: AskToOpen = async () => {
  throw new Error("no password was expected");
};
/** The profile file the ficha's own export makes. */
async function profileFile(...jobs: Parameters<typeof profileWith>) {
  return api.exportProfile(profileWith(...jobs));
}
/** The whole backup, taken from a browser that has the given profile and `applications` postings. */
async function backupFile(jobs: Parameters<typeof profileWith>, applications: number) {
  api.saveStoredProfile(profileWith(...jobs));
  await api.replaceApplicationsFromAccount(Array.from({ length: applications }, (_, index) => realisticApplication(index)));
  return api.exportBackup();
}
const metrics = () => parseMetrics(local.getItem("cvexact.metrics.v1"));
const profileHere = () => api.loadStoredProfile();
const jobsHere = () => profileHere().experience.map((job) => job.company.value);

beforeEach(async () => {
  ({ local } = installBrowser({ indexedDB: true }));
  profileCopies.length = 0;
  backupCopies = 0;
  vi.resetModules();
  api = await import("@/lib/storage/local");
  ({ recoverCopy } = await import("@/lib/storage/recover-copy"));
});

afterEach(() => {
  uninstallBrowser();
  vi.resetModules();
});

describe("a profile file", () => {
  it("is brought into a browser with nothing in it without asking, and counted as a profile recovered", async () => {
    const confirm = vi.fn(async () => true);
    const result = await recoverCopy(file(await profileFile(JOB_A)), { confirm, ask: never });

    expect(result).toEqual({ status: "recovered", kind: "profile", message: "Listo: recuperamos tu perfil." });
    expect(confirm).not.toHaveBeenCalled();
    expect(jobsHere()).toEqual(["Nubia Retail"]);
    expect(profileCopies).toEqual([]);
    expect(Object.values(metrics().days)[0]).toMatchObject({ profile_recovered: 1 });
  });

  it("over a profile worth keeping says what replaces what, with both in numbers, and writes the one that goes down first", async () => {
    api.saveStoredProfile(profileWith(JOB_B));
    const before = profileHere();
    const confirm = vi.fn<(message: string, options?: object) => Promise<boolean>>(async () => true);

    const result = await recoverCopy(file(await profileFile(JOB_A)), { confirm, ask: never });

    expect(result).toMatchObject({ status: "recovered", kind: "profile" });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]![0]).toMatch(/reemplazar tu perfil actual \(1 puesto\) por el del archivo \(1 puesto\)/);
    expect(confirm.mock.calls[0]![1]).toMatchObject({ confirmLabel: "Bajar la copia y reemplazar" });
    // What went is the profile as it was, written down before.
    expect(profileCopies).toEqual([{ profile: expect.objectContaining({ rev: before.rev }), label: "perfil-anterior" }]);
    expect(jobsHere()).toEqual(["Nubia Retail"]);
    // Not a profile lost and found: this browser had one.
    expect(metrics().days).toEqual({});
  });

  it("changes nothing, and writes nothing down, when the question is turned down", async () => {
    api.saveStoredProfile(profileWith(JOB_B));
    const result = await recoverCopy(file(await profileFile(JOB_A)), { confirm: async () => false, ask: never });

    expect(result).toEqual({ status: "cancelled" });
    expect(jobsHere()).toEqual(["Grupo Lumen"]);
    expect(profileCopies).toEqual([]);
  });
});

describe("a whole backup", () => {
  it("replaces profile and postings after saying both sides in numbers, and after the copy of what goes", async () => {
    const backup = await backupFile([JOB_A], 3);
    // This browser, as it is now: another profile and one posting.
    api.saveStoredProfile(profileWith(JOB_B));
    await api.replaceApplicationsFromAccount([realisticApplication(9)]);
    const confirm = vi.fn<(message: string, options?: object) => Promise<boolean>>(async () => true);

    const result = await recoverCopy(file(backup), { confirm, ask: never });

    expect(result).toMatchObject({ status: "recovered", kind: "backup" });
    expect(confirm.mock.calls[0]![0]).toMatch(/tu perfil \(1 puesto\) y 1 postulación.*un perfil con 1 puesto y 3 postulaciones/);
    expect(backupCopies).toBe(1);
    expect(jobsHere()).toEqual(["Nubia Retail"]);
    expect((await api.listApplications()).length).toBe(3);
  });

  it("is brought into a browser with nothing without asking and without a copy of nothing", async () => {
    const backup = await backupFile([JOB_A], 2);
    uninstallBrowser();
    ({ local } = installBrowser({ indexedDB: true }));
    vi.resetModules();
    api = await import("@/lib/storage/local");
    ({ recoverCopy } = await import("@/lib/storage/recover-copy"));
    const confirm = vi.fn(async () => true);

    const result = await recoverCopy(file(backup), { confirm, ask: never });

    expect(result).toMatchObject({ status: "recovered", kind: "backup" });
    expect(confirm).not.toHaveBeenCalled();
    expect(backupCopies).toBe(0);
    expect(jobsHere()).toEqual(["Nubia Retail"]);
    expect(Object.values(metrics().days)[0]).toMatchObject({ profile_recovered: 1 });
  });

  it("changes nothing when the question is turned down", async () => {
    const backup = await backupFile([JOB_A], 2);
    api.saveStoredProfile(profileWith(JOB_B));

    const result = await recoverCopy(file(backup), { confirm: async () => false, ask: never });

    expect(result).toEqual({ status: "cancelled" });
    expect(backupCopies).toBe(0);
    expect(jobsHere()).toEqual(["Grupo Lumen"]);
  });
});

describe("what is neither", () => {
  it("is told so, in the words the screens use for where a copy comes from, and nothing is touched", async () => {
    api.saveStoredProfile(profileWith(JOB_B));
    const result = await recoverCopy(file({ kind: "otra-cosa" }), { confirm: async () => true, ask: never });

    expect(result).toMatchObject({ status: "failed", message: expect.stringContaining("«Descargar perfil»") });
    expect(jobsHere()).toEqual(["Grupo Lumen"]);
  });

  it("is told it could not be read when it is not even JSON", async () => {
    const result = await recoverCopy(file("esto no es json"), { confirm: async () => true, ask: never });
    expect(result).toEqual({ status: "failed", message: expect.stringContaining("«Descargar perfil»") });
  });
});

describe("an archive of postings", () => {
  it("adds, and replaces nothing, so it is not asked about", async () => {
    api.saveStoredProfile(profileWith(JOB_B));
    await api.replaceApplicationsFromAccount([realisticApplication(1)]);
    const confirm = vi.fn(async () => true);

    const result = await recoverCopy(file(api.buildArchive([realisticApplication(2), realisticApplication(3)])), { confirm, ask: never });

    expect(result).toMatchObject({ status: "recovered", kind: "archive", message: expect.stringContaining("Agregamos 2 postulaciones") });
    expect(confirm).not.toHaveBeenCalled();
    expect((await api.listApplications()).length).toBe(3);
    expect(jobsHere()).toEqual(["Grupo Lumen"]);
  });
});

describe("a copy with a password", () => {
  it("is opened with it, and then read as what it was", async () => {
    const locked = await lockCopy(await profileFile(JOB_A), "una clave larga");
    const ask: AskToOpen = async (request) => {
      expect(request).toMatchObject({ mode: "enter", holds: "cvexact-profile" });
      return request.use("una clave larga");
    };

    const result = await recoverCopy(file(locked), { confirm: async () => true, ask });

    expect(result).toMatchObject({ status: "recovered", kind: "profile" });
    expect(jobsHere()).toEqual(["Nubia Retail"]);
  });

  it("is cancelled, and nothing is read, when the person gives up on the password", async () => {
    api.saveStoredProfile(profileWith(JOB_B));
    const locked = await lockCopy(await profileFile(JOB_A), "una clave larga");

    const result = await recoverCopy(file(locked), { confirm: async () => true, ask: async () => null });

    expect(result).toEqual({ status: "cancelled" });
    expect(jobsHere()).toEqual(["Grupo Lumen"]);
  });
});
