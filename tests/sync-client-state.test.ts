import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMetrics } from "@/lib/metrics/counters";
import { syncStatus } from "@/lib/profile/sync-status";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { parseSyncState } from "@/lib/storage/sync-state";
import { installBrowser, uninstallBrowser, type FakeStorage } from "./helpers/browser-storage";
import { profileWith } from "./helpers/profiles";

/**
 * What this browser remembers of its meetings with an account, and the two taps that make them happen: «Subir», which
 * remembers with which account and at which `rev` the profile went up, and «Traerlo», which does the same the other way
 * round. Neither does anything without a tap, and neither replaces a profile worth keeping without saying so and writing
 * it down first.
 */

// `saveProfileFile` downloads a file, which needs a page; what matters here is that it was asked for, and for what.
const copies: Array<{ profile: StoredProfile | undefined; label: string | undefined }> = [];
vi.mock("@/lib/storage/profile-copy", () => ({
  saveProfileFile: (profile?: StoredProfile, label?: string) => void copies.push({ profile, label }),
  exportOwnProfile: () => {},
}));

const JOB_A = { company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current" as const, facts: [{ text: "Armo los pedidos del local" }] };
const JOB_B = { company: "Grupo Lumen", role: "Asistente", from: { year: 2018, month: 9 }, to: { year: 2021, month: 1 }, facts: [{ text: "Atendía clientes" }] };

let local: FakeStorage;
let api: typeof import("@/lib/storage/local");

/** What the account answers: its profile for `?only=profile`, and 200 to an upload. Everything it was asked is kept. */
function stubAccount(accountProfile: StoredProfile | null, options: { failUpload?: (call: number) => boolean; whileUploading?: () => void } = {}) {
  const calls: Array<{ method: string; url: string }> = [];
  let uploads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url });
      if (method === "GET") return new Response(JSON.stringify({ profileV2: accountProfile }));
      uploads += 1;
      options.whileUploading?.();
      if (options.failUpload?.(uploads)) return new Response(JSON.stringify({ error: "Demasiados pedidos." }), { status: 429 });
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, applications: body.applications.length, skippedOversize: 0, skippedFull: 0 }));
    }),
  );
  return calls;
}

const syncState = () => parseSyncState(local.getItem("cvexact.syncState.v1"));
const metrics = () => parseMetrics(local.getItem("cvexact.metrics.v1"));
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
/** A profile as the account would hold it: older than anything saved here today. */
const accountProfile = (...jobs: Parameters<typeof profileWith>): StoredProfile => ({ ...profileWith(...jobs), rev: 40, updatedAt: "2026-09-20T10:00:00.000Z" });
/** What this browser has, saved the way the app saves it (which counts a save). */
async function savedHere(...jobs: Parameters<typeof profileWith>): Promise<StoredProfile> {
  api.saveStoredProfile(profileWith(...jobs));
  return api.loadStoredProfile();
}

beforeEach(async () => {
  ({ local } = installBrowser({ indexedDB: true }));
  copies.length = 0;
  vi.resetModules();
  api = await import("@/lib/storage/local");
});

afterEach(() => {
  uninstallBrowser();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("«Subir» remembers the meeting", () => {
  it("records the account and the rev of the profile that was sent, and counts it", async () => {
    const sent = await savedHere(JOB_A);
    stubAccount(null);
    const { uploadProfile } = await import("@/lib/api/sync-client");

    await uploadProfile("u1");

    // The account's profile is now the one that was sent: that version is settled, and is not offered back.
    expect(syncState()).toMatchObject({ userId: "u1", rev: sent.rev, accountAt: sent.updatedAt });
    expect(syncState().at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(metrics().days[today()]).toEqual({ profile_uploaded: 1 });
    expect(syncStatus(api.loadStoredProfile(), syncState(), "u1")).toBe("synced");
  });

  it("does not claim a change made while it was going up: the account has what was read to be sent, not what came after", async () => {
    const sent = await savedHere(JOB_A);
    stubAccount(null, {
      whileUploading: () => {
        const edited = api.loadStoredProfile();
        edited.contact.city = { value: "Rosario", status: "confirmed" };
        api.saveStoredProfile(edited);
      },
    });
    const { uploadProfile } = await import("@/lib/api/sync-client");

    await uploadProfile("u1");

    expect(syncState().rev).toBe(sent.rev);
    expect(api.loadStoredProfile().rev).toBeGreaterThan(sent.rev);
    expect(syncStatus(api.loadStoredProfile(), syncState(), "u1")).toBe("pending");
  });

  it("remembers nothing when the first request fails: the account does not have it", async () => {
    await savedHere(JOB_A);
    stubAccount(null, { failUpload: () => true });
    const { uploadProfile } = await import("@/lib/api/sync-client");

    await expect(uploadProfile("u1")).rejects.toThrow("Demasiados pedidos.");

    expect(local.has("cvexact.syncState.v1")).toBe(false);
    expect(local.has("cvexact.metrics.v1")).toBe(false);
  });

  it("remembers it when only a later request fails: every request carries the profile, and the first one put it there", async () => {
    const sent = await savedHere(JOB_A);
    // 700 deleted ids go in two requests, so there is a second one to fail.
    local.setItem("cvexact.deletedApplications.v1", JSON.stringify(Array.from({ length: 700 }, (_, index) => `gone-${index}`)));
    stubAccount(null, { failUpload: (call) => call === 2 });
    const { uploadProfile } = await import("@/lib/api/sync-client");

    await expect(uploadProfile("u1")).rejects.toThrow(/después falló/);

    expect(syncState()).toMatchObject({ userId: "u1", rev: sent.rev });
    expect(metrics().days[today()]).toEqual({ profile_uploaded: 1 });
  });

  it("starts the notice from nothing again: what was put off belonged to the state before", async () => {
    await savedHere(JOB_A);
    local.setItem("cvexact.syncState.v1", JSON.stringify({ userId: "u1", rev: 1, snoozedUntil: "2099-01-01T00:00:00.000Z", accountAt: "x" }));
    stubAccount(null);
    const { uploadProfile } = await import("@/lib/api/sync-client");

    await uploadProfile("u1");

    expect(syncState().snoozedUntil).toBeUndefined();
    expect(syncState().accountAt).not.toBe("x");
  });
});

describe("«Subir» over a profile the account already has", () => {
  it("says so, with both side by side, and writes the account's down before it goes", async () => {
    await savedHere(JOB_A);
    const account = accountProfile(JOB_A, JOB_B);
    const calls = stubAccount(account);
    const ask = vi.fn(async () => true);
    const { uploadWithGuard } = await import("@/lib/api/sync-client");

    const outcome = await uploadWithGuard("u1", ask);

    expect(outcome.status).toBe("uploaded");
    expect(ask).toHaveBeenCalledWith(
      "Tu cuenta ya tiene un perfil guardado (2 puestos). Subir el de este navegador (1 puesto) lo reemplaza por completo. Antes te bajamos una copia del de tu cuenta, para que no se pierda. ¿Seguimos?",
      { title: "Reemplazar el perfil de tu cuenta", confirmLabel: "Bajar la copia y reemplazar" },
    );
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ label: "perfil-de-tu-cuenta" });
    expect(copies[0]!.profile).toMatchObject({ rev: 40 });
    // The question and the copy came before the upload, not after it.
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST"]);
  });

  it("uploads nothing, copies nothing and remembers nothing when the answer is no", async () => {
    await savedHere(JOB_A);
    const calls = stubAccount(accountProfile(JOB_A, JOB_B));
    const { uploadWithGuard } = await import("@/lib/api/sync-client");

    const outcome = await uploadWithGuard("u1", async () => false);

    expect(outcome).toEqual({ status: "cancelled" });
    expect(copies).toHaveLength(0);
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
    expect(local.has("cvexact.syncState.v1")).toBe(false);
  });

  it("does not ask when the account has nothing: there is nothing to lose", async () => {
    await savedHere(JOB_A);
    stubAccount(null);
    const ask = vi.fn(async () => true);
    const { uploadWithGuard } = await import("@/lib/api/sync-client");

    expect((await uploadWithGuard("u1", ask)).status).toBe("uploaded");
    expect(ask).not.toHaveBeenCalled();
    expect(copies).toHaveLength(0);
  });

  it("asks the account for the profile only, not for the whole history behind it", async () => {
    await savedHere(JOB_A);
    const calls = stubAccount(null);
    const { uploadWithGuard } = await import("@/lib/api/sync-client");

    await uploadWithGuard("u1", async () => true);

    expect(calls[0]).toEqual({ method: "GET", url: "/api/sync?only=profile" });
  });
});

describe("«Traerlo»", () => {
  it("brings the account's profile to a browser with nothing in it, without asking and without a copy", async () => {
    const account = accountProfile(JOB_A, JOB_B);
    stubAccount(account);
    const ask = vi.fn(async () => true);
    const { pullWithGuard } = await import("@/lib/api/sync-client");

    const outcome = await pullWithGuard("u1", ask);

    expect(outcome).toEqual({ status: "brought" });
    expect(ask).not.toHaveBeenCalled();
    expect(copies).toHaveLength(0);
    expect(api.loadStoredProfile().experience.map((job) => job.company.value).sort()).toEqual(["Grupo Lumen", "Nubia Retail"]);
  });

  it("remembers that this browser and the account now say the same, and counts it", async () => {
    stubAccount(accountProfile(JOB_A, JOB_B));
    const { pullWithGuard } = await import("@/lib/api/sync-client");

    await pullWithGuard("u1", async () => true);

    // The rev is the one the save gave the profile here, which is not the account's; the version is the account's own, so that
    // it is not offered back even when this browser's clock says that it is newer than what was just saved.
    expect(syncState()).toMatchObject({ userId: "u1", rev: api.loadStoredProfile().rev, accountAt: "2026-09-20T10:00:00.000Z" });
    expect(syncStatus(api.loadStoredProfile(), syncState(), "u1")).toBe("synced");
    // Brought into a browser that had nothing: a profile lost and found, counted as such too (e5, I7).
    expect(metrics().days[today()]).toEqual({ profile_pulled: 1, profile_recovered: 1 });
  });

  it("does not count a recovery where the browser already had a profile of its own", async () => {
    await savedHere(JOB_A);
    stubAccount(accountProfile(JOB_A, JOB_B));
    const { pullWithGuard } = await import("@/lib/api/sync-client");

    await pullWithGuard("u1", async () => true);

    expect(metrics().days[today()]).toEqual({ profile_pulled: 1 });
  });

  it("over a profile worth keeping says so, with both side by side, and writes this one down before it goes", async () => {
    const here = await savedHere(JOB_A);
    stubAccount(accountProfile(JOB_A, JOB_B));
    const ask = vi.fn(async () => true);
    const { pullWithGuard } = await import("@/lib/api/sync-client");

    const outcome = await pullWithGuard("u1", ask);

    expect(outcome).toEqual({ status: "brought" });
    expect(ask).toHaveBeenCalledWith(
      "Vas a reemplazar el perfil de este navegador (1 puesto) por el de tu cuenta (2 puestos). Antes te bajamos una copia del de este navegador, para que no se pierda. ¿Seguimos?",
      { title: "Reemplazar el perfil de este navegador", confirmLabel: "Bajar la copia y reemplazar" },
    );
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ label: "perfil-de-este-navegador" });
    expect(copies[0]!.profile).toMatchObject({ rev: here.rev });
    expect(api.loadStoredProfile().experience).toHaveLength(2);
  });

  it("changes nothing when the answer is no", async () => {
    const here = await savedHere(JOB_A);
    stubAccount(accountProfile(JOB_A, JOB_B));
    const { pullWithGuard } = await import("@/lib/api/sync-client");

    const outcome = await pullWithGuard("u1", async () => false);

    expect(outcome).toEqual({ status: "cancelled" });
    expect(copies).toHaveLength(0);
    expect(api.loadStoredProfile()).toEqual(here);
    expect(local.has("cvexact.syncState.v1")).toBe(false);
  });

  it("asks the account again instead of trusting what was on screen: it says so when the account no longer has one", async () => {
    stubAccount(null);
    const { pullWithGuard } = await import("@/lib/api/sync-client");

    await expect(pullWithGuard("u1", async () => true)).rejects.toThrow(/ya no tiene un perfil guardado/);
    expect(api.loadStoredProfile().experience).toHaveLength(0);
  });

  it("does not take the account's profile for one worth bringing when it has only a name", async () => {
    const named = { ...accountProfile(), rev: 3 };
    named.contact.fullName = { value: "Lucía Pérez", status: "confirmed" };
    stubAccount(named);
    const { pullWithGuard } = await import("@/lib/api/sync-client");

    // Nothing in it to bring: the answer is the same as for an account with none.
    await expect(pullWithGuard("u1", async () => true)).rejects.toThrow(/ya no tiene un perfil guardado/);
  });
});
