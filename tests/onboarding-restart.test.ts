import { afterEach, describe, expect, it, vi } from "vitest";
import { installBrowser, uninstallBrowser } from "./helpers/browser-storage";
import { profileWith } from "./helpers/profiles";

/** The modules fresh each time: what they remember of storage (`stores`) is per browser, and each test is a new one. */
async function modules() {
  vi.resetModules();
  const local = await import("@/lib/storage/local");
  const stores = await import("@/lib/onboarding/stores");
  const sourceStore = await import("@/lib/onboarding/source-store");
  const restart = await import("@/lib/onboarding/restart");
  return { local, stores, sourceStore, restart };
}

afterEach(() => {
  uninstallBrowser();
  vi.resetModules();
});

describe("starting over", () => {
  it("leaves an empty profile that begins the first-run flow again, and keeps counting the saves", async () => {
    installBrowser();
    const { local, restart } = await modules();
    const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2021 }, to: "current", facts: [{ text: "Llevo las campañas" }] });
    profile.contact.fullName = { value: "Lucía Pérez", status: "confirmed" };
    profile.onboarding.done = true;
    profile.onboarding.step = "done";
    local.saveStoredProfile(profile);
    const before = local.loadStoredProfile();
    expect(before.experience).toHaveLength(1);

    expect(restart.startOver()).toBe(true);

    const after = local.loadStoredProfile();
    expect(after.experience).toEqual([]);
    expect(after.contact.fullName.value).toBe("");
    expect(after.onboarding).toMatchObject({ done: false, step: "start" });
    expect(after.rev).toBeGreaterThan(before.rev);
  });

  it("forgets what was made of the documents that were read — the originals, the model's answers, the box half written", async () => {
    installBrowser();
    const { local, stores, sourceStore, restart } = await modules();
    await stores.ensureOnboardingStoresHydrated();
    sourceStore.saveSource("doc-1", "cv.pdf", ["Lucía Pérez", "Analista"]);
    stores.writeCollection(local.EXTRACT_CACHE_KEY, { abc: { result: { jobs: [] }, at: "2026-01-01" } });
    stores.writeCollection(local.SPLIT_CACHE_KEY, { def: { result: { pieces: ["a"] }, at: "2026-01-01" } });
    local.saveDumpDraft("Trabajé en un kiosco");
    expect(sourceStore.loadSource("doc-1")).not.toBeNull();

    restart.startOver();

    expect(sourceStore.loadSource("doc-1")).toBeNull();
    expect(stores.readCollection(local.EXTRACT_CACHE_KEY)).toEqual({});
    expect(stores.readCollection(local.SPLIT_CACHE_KEY)).toEqual({});
    expect(local.loadDumpDraft()).toBe("");
  });

  it("does not touch the settings, or the applications: they are not the profile", async () => {
    const { local: storage } = installBrowser();
    const { local, restart } = await modules();
    local.saveSettings({ entries: [{ provider: "groq", apiKey: "gsk-1", model: "" }] });
    expect(local.loadSettings().entries).toHaveLength(1);
    restart.startOver();
    expect(local.loadSettings().entries).toHaveLength(1);
    expect(storage.has(local.SETTINGS_KEY)).toBe(true);
  });

  it("keeps the originals when the browser refused to empty the profile: nothing is half gone", async () => {
    const browser = installBrowser();
    const { local, sourceStore, restart } = await modules();
    local.saveStoredProfile(profileWith({ company: "A", role: "b", from: { year: 2020 } }));
    sourceStore.saveSource("doc-1", "cv.pdf", ["Lucía Pérez"]);
    // The browser has no room: every write of the profile now fails.
    browser.local.quota = 1;
    expect(restart.startOver()).toBe(false);
    expect(sourceStore.loadSource("doc-1")).not.toBeNull();
  });
});
