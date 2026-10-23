import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeStorage, installBrowser, QUOTA_CHARS, realisticApplication, uninstallBrowser } from "./helpers/browser-storage";

/**
 * The failure this was built for came from growth, not from a bug in any one
 * save: every application went into the same 5 MiB localStorage as everything
 * else, so a long enough history made the next save impossible. This keeps the
 * property that fixes it: accumulating applications does not accumulate
 * localStorage.
 */

afterEach(() => {
  uninstallBrowser();
  vi.resetModules();
});

describe("un historial grande", () => {
  it("450 postulaciones realistas (≈7,5 M caracteres) se guardan todas, y localStorage no crece con ellas", async () => {
    const local = new FakeStorage(QUOTA_CHARS);
    installBrowser({ local, indexedDB: true });
    vi.resetModules();
    const api = await import("@/lib/storage/local");
    await api.listApplications();

    let totalChars = 0;
    let usedAt50 = 0;
    // ~17 K each once compacted — the real average without the duplicate `cvOriginal`.
    for (let index = 0; index < 450; index++) {
      const app = realisticApplication(index);
      totalChars += JSON.stringify(app).length;
      expect(await api.saveApplication(app)).toEqual({ ok: true });
      if (index === 49) usedAt50 = local.used();
    }

    // More than localStorage could ever hold, all of it stored.
    expect(totalChars).toBeGreaterThan(7_000_000);
    expect(totalChars).toBeGreaterThan(QUOTA_CHARS);
    expect(await api.listApplications()).toHaveLength(450);

    // localStorage did not grow with the history.
    expect(local.used()).toBe(usedAt50);
    expect(local.used()).toBeLessThan(10_000);

    // And everything that still lives there keeps working.
    api.saveProfile({ ...api.loadProfile(), fullName: "Ana Gómez" });
    expect(api.loadProfile().fullName).toBe("Ana Gómez");

    // After a reload, everything is still there.
    vi.resetModules();
    const reloaded = await import("@/lib/storage/local");
    expect(await reloaded.listApplications()).toHaveLength(450);
  }, 60_000);
});
