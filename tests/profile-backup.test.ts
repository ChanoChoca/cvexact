import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The ficha's own export is the profile alone; `exportBackup`/`importBackup`
 * (unchanged, tested in `storage-migration.test.ts`) is the fuller copy that
 * belongs in Ajustes. What matters here is that the two stay genuinely
 * separate — a profile-only file must not carry applications along, and each
 * importer must recognise the other's file and say where it does belong,
 * rather than fail with a generic "not a cvexact file".
 */

function installStorage(): Map<string, string> {
  const map = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => void map.set(key, value),
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

const application = (id: string) => ({
  id,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  jobText: "Cajero para supermercado.",
  label: "Coto",
});

describe("a copy with a password that reaches a reader without having been opened (e5, O1)", () => {
  const locked = JSON.stringify({ kind: "cvexact-locked", version: 1, holds: "cvexact-profile", exportedAt: "2026-10-06T12:00:00.000Z", data: "AAAA" });

  it("is told so by the profile's reader, and by the backup's: neither takes it for a file of another kind", async () => {
    const { readProfileFile, importBackup } = await load();
    installStorage();
    expect(readProfileFile(locked)).toEqual({ ok: false, error: "Ese archivo tiene contraseña: hace falta abrirlo con ella." });
    expect(await importBackup(locked)).toBe("Ese archivo tiene contraseña: hace falta abrirlo con ella.");
  });
});

describe("exportProfile / importProfile", () => {
  it("carries only the profile, never applications", async () => {
    const { exportProfile, saveProfile, loadProfile, write, APPLICATIONS_KEY } = await load();
    installStorage();

    saveProfile({ ...loadProfile(), fullName: "Ana Gómez" });
    write(APPLICATIONS_KEY, [application("a1")]);

    const backup = exportProfile();
    expect(backup.kind).toBe("cvexact-profile");
    expect(backup.profile.contact.fullName.value).toBe("Ana Gómez");
    expect(backup).not.toHaveProperty("applications");
    expect(backup).not.toHaveProperty("intake");
  });

  it("round-trips a profile and leaves existing applications untouched", async () => {
    const { exportProfile, importProfile, saveProfile, loadProfile, listApplications, write, APPLICATIONS_KEY } =
      await load();
    installStorage();

    write(APPLICATIONS_KEY, [application("a1")]);
    saveProfile({ ...loadProfile(), fullName: "Ana Gómez" });
    const file = JSON.stringify(exportProfile());

    saveProfile({ ...loadProfile(), fullName: "" });
    const error = importProfile(file);

    expect(error).toBeNull();
    expect(loadProfile().fullName).toBe("Ana Gómez");
    expect(await listApplications()).toHaveLength(1);
  });

  it("redirects an account backup to Ajustes instead of failing generically", async () => {
    const { exportBackup, importProfile, saveProfile, loadProfile } = await load();
    installStorage();

    saveProfile({ ...loadProfile(), fullName: "Antes" });
    const accountFile = JSON.stringify(await exportBackup());

    const error = importProfile(accountFile);

    expect(error).toMatch(/cuenta completa/);
    expect(error).toMatch(/Ajustes/);
    // Refused, so nothing changed.
    expect(loadProfile().fullName).toBe("Antes");
  });

  it("rejects an unrelated JSON file without a kind", async () => {
    const { importProfile } = await load();
    installStorage();

    expect(importProfile(JSON.stringify({ hello: "world" }))).toMatch(/no es una copia/);
  });
});

describe("importBackup meeting a profile-only file", () => {
  it("redirects to the profile page instead of failing generically", async () => {
    const { exportProfile, importBackup, saveProfile, loadProfile } = await load();
    installStorage();

    saveProfile({ ...loadProfile(), fullName: "Antes" });
    const profileFile = JSON.stringify(exportProfile());

    const error = await importBackup(profileFile);

    expect(error).toMatch(/tu perfil/);
    expect(loadProfile().fullName).toBe("Antes");
  });
});
