import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncStatus } from "@/lib/profile/sync-status";
import { parseSyncState } from "@/lib/storage/sync-state";
import { installBrowser, realisticApplication, uninstallBrowser, type FakeStorage } from "./helpers/browser-storage";
import { profileWith } from "./helpers/profiles";

/**
 * «Bajar de mi cuenta» (U02): the account's postings in the place of this browser's, and its profile when it has one. It replaced both on a
 * tap, with no copy of what went, while the screen said that it wrote one down first. What is checked is that it asks like every other tap
 * that replaces something, with both sides in numbers; that the copy of this browser is taken BEFORE anything is replaced; and that a
 * «no» leaves everything as it was.
 */

// A download needs a page. What matters is that it was asked for, and what this browser held at that moment.
let copies: Array<{ company: string | undefined; applications: number }> = [];
let holdsNow: () => Promise<{ company: string | undefined; applications: number }> = async () => ({ company: undefined, applications: 0 });
vi.mock("@/lib/storage/download", () => ({
  downloadAccountBackup: async () => void copies.push(await holdsNow()),
  downloadJson: () => {},
  todayStamp: () => "2026-10-10",
}));
vi.mock("@/lib/storage/profile-copy", () => ({ saveProfileFile: () => {}, exportOwnProfile: () => {} }));

const JOB_A = { company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current" as const, facts: [{ text: "Armo los pedidos del local" }] };
const JOB_B = { company: "Grupo Lumen", role: "Asistente", from: { year: 2018, month: 9 }, to: { year: 2021, month: 1 }, facts: [{ text: "Atendía clientes" }] };

let local: FakeStorage;
let api: typeof import("@/lib/storage/local");
let sync: typeof import("@/lib/api/sync-client");

/** What the account answers to `GET /api/sync?export=account`. */
function stubAccount(body: Record<string, unknown>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      // A body with a numeric `status` is the account failing to answer; anything else is what it holds.
      if (typeof body.status === "number") return new Response(JSON.stringify({ error: body.error }), { status: body.status });
      return new Response(JSON.stringify(body));
    }),
  );
  return calls;
}

const accountProfile = (...jobs: Parameters<typeof profileWith>) => ({ ...profileWith(...jobs), rev: 40, updatedAt: "2026-09-20T10:00:00.000Z" });
const syncState = () => parseSyncState(local.getItem("cvexact.syncState.v1"));
const companyHere = () => api.loadStoredProfile().experience[0]?.company.value;
const postings = async () => (await api.listApplications()).map((application) => application.id).sort();

beforeEach(async () => {
  ({ local } = installBrowser({ indexedDB: true }));
  copies = [];
  vi.resetModules();
  api = await import("@/lib/storage/local");
  sync = await import("@/lib/api/sync-client");
  holdsNow = async () => ({ company: companyHere(), applications: (await api.listApplications()).length });
});

afterEach(() => {
  uninstallBrowser();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("«Bajar de mi cuenta», over what this browser holds", () => {
  async function arrange() {
    api.saveStoredProfile(profileWith(JOB_B));
    await api.replaceApplicationsFromAccount([realisticApplication(1), realisticApplication(2)]);
    stubAccount({
      profileV2: accountProfile(JOB_A),
      applications: [realisticApplication(7), realisticApplication(8), realisticApplication(9)],
      deletedIds: [],
      account: { email: "lucia@example.com" },
    });
  }

  it("asks with both sides in numbers, writes this browser down before replacing anything, and then replaces both", async () => {
    await arrange();
    const asked: Array<{ message: string; options: object | undefined }> = [];
    const ask = async (message: string, options?: object) => {
      asked.push({ message, options });
      return true;
    };

    const outcome = await sync.pullAllWithGuard("u1", ask);

    expect(outcome.status).toBe("brought");
    expect(asked).toHaveLength(1);
    expect(asked[0]!.message).toMatch(/tu perfil \(1 puesto\) y 2 postulaciones.*por lo que tiene tu cuenta: un perfil con 1 puesto y 3 postulaciones/);
    expect(asked[0]!.message).toContain("recuperarlo con «Recuperar una copia»");
    expect(asked[0]!.options).toMatchObject({ title: "Bajar de mi cuenta", confirmLabel: "Bajar la copia y reemplazar" });
    // The copy was taken while this browser still had what it had: the profile of Grupo Lumen and its two postings, not the account's.
    expect(copies).toEqual([{ company: "Grupo Lumen", applications: 2 }]);
    expect(companyHere()).toBe("Nubia Retail");
    expect(await postings()).toEqual(["app-0007", "app-0008", "app-0009"]);
    // And the account and this browser now say the same thing.
    expect(syncStatus(api.loadStoredProfile(), syncState(), "u1")).toBe("synced");
  });

  it("hands back what else the account answered, for the file of everything it holds", async () => {
    await arrange();
    const outcome = await sync.pullAllWithGuard("u1", async () => true);
    expect(outcome.status === "brought" && outcome.payload.account).toEqual({ email: "lucia@example.com" });
    expect(outcome.status === "brought" && outcome.profile?.experience[0]?.company.value).toBe("Nubia Retail");
  });

  it("changes nothing, writes nothing down and remembers no meeting when the question is turned down", async () => {
    await arrange();

    const outcome = await sync.pullAllWithGuard("u1", async () => false);

    expect(outcome).toEqual({ status: "cancelled" });
    expect(copies).toEqual([]);
    expect(companyHere()).toBe("Grupo Lumen");
    expect(await postings()).toEqual(["app-0001", "app-0002"]);
    expect(local.has("cvexact.syncState.v1")).toBe(false);
  });

  it("leaves the profile alone, and says so, when the account has none: only the postings are replaced", async () => {
    api.saveStoredProfile(profileWith(JOB_B));
    await api.replaceApplicationsFromAccount([realisticApplication(1)]);
    stubAccount({ applications: [realisticApplication(7)], deletedIds: [] });
    const asked: string[] = [];

    await sync.pullAllWithGuard("u1", async (message) => {
      asked.push(message);
      return true;
    });

    expect(asked[0]).toMatch(/postulaciones de este navegador \(1 postulación\) por las de tu cuenta \(1 postulación\).*se queda como está: tu cuenta no tiene uno/);
    expect(companyHere()).toBe("Grupo Lumen");
    expect(await postings()).toEqual(["app-0007"]);
    // The account never had this browser's profile, so nothing says they met.
    expect(local.has("cvexact.syncState.v1")).toBe(false);
  });

  it("does not bring back a posting that was deleted from another device", async () => {
    api.saveStoredProfile(profileWith(JOB_B));
    stubAccount({ profileV2: accountProfile(JOB_A), applications: [realisticApplication(7), realisticApplication(8)], deletedIds: ["app-0008"] });

    await sync.pullAllWithGuard("u1", async () => true);

    expect(await postings()).toEqual(["app-0007"]);
  });
});

describe("«Bajar de mi cuenta», into a browser with nothing in it", () => {
  it("only asks whether to bring it, as something that loses nothing, and writes nothing down", async () => {
    stubAccount({ profileV2: accountProfile(JOB_A), applications: [realisticApplication(7)], deletedIds: [] });
    const asked: Array<{ message: string; options: { confirmTone?: string } | undefined }> = [];

    const outcome = await sync.pullAllWithGuard("u1", async (message, options) => {
      asked.push({ message, options });
      return true;
    });

    expect(outcome.status).toBe("brought");
    expect(asked[0]!.message).toMatch(/^Esto trae a este navegador el perfil y las postulaciones de tu cuenta/);
    expect(asked[0]!.options).toMatchObject({ confirmLabel: "Bajar", confirmTone: "primary" });
    expect(copies).toEqual([]);
    expect(companyHere()).toBe("Nubia Retail");
  });
});

describe("«Bajar de mi cuenta», when the account does not answer", () => {
  it("says what the server says, and asks nothing and changes nothing", async () => {
    api.saveStoredProfile(profileWith(JOB_B));
    stubAccount({ status: 500, error: "El servidor no pudo armar tu cuenta." });
    const ask = vi.fn(async () => true);

    await expect(sync.pullAllWithGuard("u1", ask)).rejects.toThrow("El servidor no pudo armar tu cuenta.");

    expect(ask).not.toHaveBeenCalled();
    expect(copies).toEqual([]);
    expect(companyHere()).toBe("Grupo Lumen");
  });
});
