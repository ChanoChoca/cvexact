import { afterEach, describe, expect, it, vi } from "vitest";
import { profileSchema } from "@/lib/schemas/profile";
import { devProfile } from "./fixtures";

/**
 * The profile changed shape under everyone who already has one. What these
 * tests protect is the one thing that must never happen: a person opening the
 * app after the change and finding their profile gone.
 *
 * Migration runs at module evaluation, so — like `storage-migration.test.ts` —
 * each case seeds a fake browser store and imports the module fresh.
 */

type Store = Map<string, string>;

function installStorage(seed: Record<string, string> = {}, failOn: (key: string) => boolean = () => false): Store {
  const map: Store = new Map(Object.entries(seed));
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => {
        if (failOn(key)) throw new Error("QuotaExceededError");
        map.set(key, value);
      },
      removeItem: (key: string) => void map.delete(key),
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return map;
}

async function load() {
  vi.resetModules();
  return import("@/lib/storage/local");
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  vi.resetModules();
});

const V1 = "cvexact.profile.v1";
const V2 = "cvexact.profile.v2";
const BAK = "cvexact.profile.v1.bak";
const CORRUPT = "cvexact.profile.v2.corrupt";

const v1Raw = JSON.stringify(devProfile);

describe("migration to the stored profile", () => {
  it("brings a profile from before provenance across without losing anything", async () => {
    const store = installStorage({ [V1]: v1Raw });
    const local = await load();

    expect(local.loadProfile()).toEqual(devProfile);
    expect(store.has(V2)).toBe(true);
    expect(local.loadStoredProfile().onboarding.done).toBe(true);
  });

  it("keeps the old profile whole under a backup key and removes the old one", async () => {
    const store = installStorage({ [V1]: v1Raw });
    await load();

    expect(store.get(BAK)).toBe(v1Raw);
    expect(store.has(V1)).toBe(false);
  });

  it("is idempotent: a second load changes nothing", async () => {
    const store = installStorage({ [V1]: v1Raw });
    await load();
    const after = new Map(store);
    await load();
    expect(new Map(store)).toEqual(after);
  });

  it("leaves the old profile in place, and keeps working from it, when the store is full", async () => {
    const store = installStorage({ [V1]: v1Raw }, (key) => key === V2);
    const local = await load();

    expect(store.get(V1)).toBe(v1Raw);
    expect(store.has(V2)).toBe(false);
    // Still readable, straight from the old key, until a write succeeds.
    expect(local.loadProfile()).toEqual(devProfile);
  });

  it("does not touch an old profile it cannot read", async () => {
    const store = installStorage({ [V1]: '{"version":1,"experience":"no es una lista"}' });
    await load();
    expect(store.get(V1)).toBe('{"version":1,"experience":"no es una lista"}');
    expect(store.has(V2)).toBe(false);
  });

  it("applies what a tab left open across the change writes afterwards, as an edit", async () => {
    const store = installStorage({ [V1]: v1Raw });
    await load();

    // The old build, still running in another tab, saves its view of the profile.
    store.set(V1, JSON.stringify({ ...devProfile, city: "Córdoba" }));
    const local = await load();

    expect(local.loadProfile().city).toBe("Córdoba");
    expect(local.loadStoredProfile().contact.city).toMatchObject({
      status: "edited",
      original: "Rosario",
    });
    expect(store.has(V1)).toBe(false);
    // The pre-migration copy is still the first one.
    expect(store.get(BAK)).toBe(v1Raw);
  });
});

describe("a stored profile that cannot be read", () => {
  it("comes back empty, but is set aside untouched rather than lost", async () => {
    const store = installStorage({ [V2]: '{"version":2,"experience":"roto"}' });
    const local = await load();

    expect(local.loadProfile().fullName).toBe("");
    expect(local.isProfileCorrupt()).toBe(true);
    expect(store.get(CORRUPT)).toBe('{"version":2,"experience":"roto"}');
    expect(local.readCorruptProfile()).toBe('{"version":2,"experience":"roto"}');
    // Not overwritten by the read.
    expect(store.get(V2)).toBe('{"version":2,"experience":"roto"}');
  });

  it("is set aside the moment the app loads, before anything has read it", async () => {
    const store = installStorage({ [V2]: '{"version":2,"experience":"roto"}' });
    await load();
    // No load call: the reactive hooks never make the copy, so loading must.
    expect(store.get(CORRUPT)).toBe('{"version":2,"experience":"roto"}');
  });

  it("is set aside before a save can overwrite it", async () => {
    const store = installStorage();
    const local = await load();
    store.set(V2, "{se rompió después de cargar");
    local.saveProfile({ ...local.loadProfile(), fullName: "Ana" });
    expect(store.get(CORRUPT)).toBe("{se rompió después de cargar");
  });

  it("keeps the first copy when a later read finds it broken again", async () => {
    const store = installStorage({ [V2]: "{roto" });
    const local = await load();
    local.loadProfile();
    store.set(V2, "{otra cosa rota");
    local.loadProfile();
    expect(store.get(CORRUPT)).toBe("{roto");
  });

  it("does not call an empty store corrupt", async () => {
    installStorage();
    const local = await load();
    expect(local.isProfileCorrupt()).toBe(false);
    expect(local.readCorruptProfile()).toBeNull();
  });

  it("refuses a profile from a newer build instead of reading it as an empty one", async () => {
    installStorage({ [V2]: JSON.stringify({ version: 3, contact: {} }) });
    const local = await load();
    expect(local.isProfileCorrupt()).toBe(true);
  });
});

describe("saving", () => {
  it("round-trips a plain profile through the stored one", async () => {
    installStorage();
    const local = await load();
    local.saveProfile(devProfile);
    expect(local.loadProfile()).toEqual(devProfile);
  });

  it("counts each save that changes something, and none that does not", async () => {
    installStorage();
    const local = await load();

    local.saveProfile({ ...local.loadProfile(), fullName: "Ana" });
    const first = local.loadStoredProfile();
    expect(first.rev).toBe(1);
    expect(first.updatedAt).not.toBe("");

    local.saveProfile(local.loadProfile());
    expect(local.loadStoredProfile().rev).toBe(1);

    local.saveProfile({ ...local.loadProfile(), fullName: "Ana Gómez" });
    expect(local.loadStoredProfile().rev).toBe(2);
  });

  it("does not notify subscribers when nothing changed", async () => {
    installStorage();
    const local = await load();
    local.saveProfile({ ...local.loadProfile(), fullName: "Ana" });

    const seen = vi.fn();
    local.subscribeToStorage(seen);
    local.saveProfile(local.loadProfile());
    expect(seen).not.toHaveBeenCalled();
    local.saveProfile({ ...local.loadProfile(), fullName: "Ana Gómez" });
    expect(seen).toHaveBeenCalled();
  });

  it("credits new values to the origin it is given", async () => {
    installStorage();
    const local = await load();
    local.saveProfile({ ...local.loadProfile(), fullName: "Ana Gómez" }, { origin: "cv" });
    expect(local.loadStoredProfile().contact.fullName.source?.kind).toBe("cv");
  });

  it("still throws a friendly error when the store is full", async () => {
    installStorage({}, (key) => key === V2);
    const local = await load();
    expect(() => local.saveProfile({ ...local.loadProfile(), fullName: "Ana" })).toThrow(
      local.StorageFullError,
    );
  });
});

describe("backups", () => {
  it("round-trips the stored profile with its provenance", async () => {
    installStorage();
    const local = await load();
    local.saveProfile(devProfile, { origin: "cv" });
    const file = JSON.stringify(await local.exportBackup());

    local.saveProfile({ ...local.loadProfile(), fullName: "Otro" });
    expect(await local.importBackup(file)).toBeNull();

    expect(local.loadProfile().fullName).toBe("Juan Pérez");
    expect(local.loadStoredProfile().contact.fullName.source?.kind).toBe("cv");
  });

  it("exports the current format, and says which", async () => {
    installStorage();
    const local = await load();
    expect(await local.exportBackup()).toMatchObject({ kind: "cvexact-backup", version: 2 });
    expect(local.exportProfile()).toMatchObject({ kind: "cvexact-profile", version: 2 });
  });

  it("still restores a backup written before provenance", async () => {
    installStorage();
    const local = await load();
    const oldFile = JSON.stringify({
      kind: "cvexact-backup",
      version: 1,
      exportedAt: "2026-01-01T00:00:00.000Z",
      profile: devProfile,
      applications: [],
    });

    expect(await local.importBackup(oldFile)).toBeNull();
    expect(local.loadProfile()).toEqual(devProfile);
    expect(local.loadStoredProfile().contact.fullName.source?.kind).toBe("legacy");
  });

  it("still restores a profile-only file written before provenance", async () => {
    installStorage();
    const local = await load();
    const oldFile = JSON.stringify({
      kind: "cvexact-profile",
      version: 1,
      exportedAt: "2026-01-01T00:00:00.000Z",
      profile: devProfile,
    });
    expect(local.importProfile(oldFile)).toBeNull();
    expect(local.loadProfile()).toEqual(devProfile);
  });

  it("refuses a file from a newer build rather than importing an empty profile", async () => {
    installStorage();
    const local = await load();
    local.saveProfile(devProfile);
    const newer = JSON.stringify({
      kind: "cvexact-profile",
      version: 9,
      exportedAt: "2027-01-01T00:00:00.000Z",
      profile: { version: 9, contact: {} },
    });
    expect(local.importProfile(newer)).toMatch(/formato válido/);
    expect(local.loadProfile()).toEqual(devProfile);
  });
});

describe("clearing this browser", () => {
  it("removes every copy of the profile, the backup and the quarantine included", async () => {
    const store = installStorage({ [V2]: "{roto", [BAK]: v1Raw, [CORRUPT]: "{roto", [V1]: v1Raw });
    const local = await load();
    await local.clearBrowserData();
    for (const key of [V1, V2, BAK, CORRUPT]) expect(store.has(key)).toBe(false);
  });
});

it("leaves an empty profile empty", async () => {
  installStorage();
  const local = await load();
  expect(local.loadProfile()).toEqual(profileSchema.parse({}));
});
