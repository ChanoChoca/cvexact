import { afterEach, describe, expect, it, vi } from "vitest";
import { installBrowser, uninstallBrowser } from "./helpers/browser-storage";

/**
 * The onboarding's originals and AI caches on IndexedDB (`lib/onboarding/stores.ts`).
 * Without IndexedDB they behave exactly as before — `onboarding-source-store.test.ts`
 * covers that path unchanged.
 */

afterEach(() => {
  uninstallBrowser();
  vi.resetModules();
});

async function load() {
  vi.resetModules();
  const sources = await import("@/lib/onboarding/source-store");
  const stores = await import("@/lib/onboarding/stores");
  const { openAppDatabase } = await import("@/lib/storage/db");
  return { sources, stores, openAppDatabase };
}

describe("originales y cachés del onboarding en IndexedDB", () => {
  it("se mudan desde localStorage, verificados, y se leen desde memoria", async () => {
    const { local } = installBrowser({ indexedDB: true });
    local.setItem(
      "cvexact.sources.v1",
      JSON.stringify({ a: { name: "cv.pdf", lines: ["Ana Gómez", "Analista"], at: "2026-01-01T00:00:00.000Z" } }),
    );
    local.setItem(
      "cvexact.extractCache.v1",
      JSON.stringify({ h1: { result: { sections: [] }, at: "2026-01-01T00:00:00.000Z" } }),
    );

    const { sources, stores, openAppDatabase } = await load();
    await stores.ensureOnboardingStoresHydrated();

    expect(sources.loadSource("a")).toEqual({ name: "cv.pdf", lines: ["Ana Gómez", "Analista"] });
    expect(stores.readCollection("cvexact.extractCache.v1")).toEqual({
      h1: { result: { sections: [] }, at: "2026-01-01T00:00:00.000Z" },
    });
    expect(local.has("cvexact.sources.v1")).toBe(false);
    expect(local.has("cvexact.extractCache.v1")).toBe(false);
    const { db } = await openAppDatabase();
    expect(await db!.sources.count()).toBe(1);
  });

  it("lo guardado queda en IndexedDB para la próxima carga, con el mismo tope", async () => {
    installBrowser({ indexedDB: true });
    let { sources, stores } = await load();
    await stores.ensureOnboardingStoresHydrated();
    const big = ["x".repeat(sources.MAX_SOURCE_CHARS / 2 - 10)];
    sources.saveSource("viejo", "a.pdf", big, { now: "2026-01-01T00:00:00.000Z" });
    sources.saveSource("medio", "b.pdf", big, { now: "2026-02-01T00:00:00.000Z" });
    sources.saveSource("nuevo", "c.pdf", big, { now: "2026-03-01T00:00:00.000Z" });
    expect(sources.loadSource("viejo")).toBeNull();
    // Let the background writes land, then reload.
    await new Promise((resolve) => setTimeout(resolve, 50));

    ({ sources, stores } = await load());
    await stores.ensureOnboardingStoresHydrated();
    expect(sources.loadSource("viejo")).toBeNull();
    expect(sources.loadSource("medio")).not.toBeNull();
    expect(sources.loadSource("nuevo")).not.toBeNull();
  });
});
