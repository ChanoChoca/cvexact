import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeStorage, installBrowser, uninstallBrowser } from "./helpers/browser-storage";

/**
 * A profile the browser refused to store stays the current one — on screen,
 * the base of the next edit — instead of vanishing (`pendingProfile` in
 * `lib/storage/local.ts`). The ~30 onboarding handlers that call
 * `updateStoredProfile` outside any `try` no longer see a throw; the callers
 * that already handle the error keep getting it from `saveProfile`.
 */

async function load() {
  vi.resetModules();
  return import("@/lib/storage/local");
}

afterEach(() => {
  uninstallBrowser();
  vi.resetModules();
});

describe("un perfil que el navegador no quiso guardar", () => {
  it("no lanza desde updateStoredProfile, y queda como el perfil actual", async () => {
    const local = new FakeStorage(1_000);
    installBrowser({ local });
    const api = await load();

    let saved = true;
    expect(() => {
      saved = api.updateStoredProfile((draft) => {
        draft.contact.fullName = { ...draft.contact.fullName, value: "Ana Gómez" };
      });
    }).not.toThrow();
    expect(saved).toBe(false);
    expect(api.pendingProfileProblem()).toBe("quota");
    // What the person typed is still what every reader sees.
    expect(api.loadProfile().fullName).toBe("Ana Gómez");

    // The next edit builds on it rather than on the older one on disk.
    api.updateStoredProfile((draft) => {
      draft.contact.phone = { ...draft.contact.phone, value: "+54 11 5555 0000" };
    });
    expect(api.loadProfile()).toMatchObject({ fullName: "Ana Gómez", phone: "+54 11 5555 0000" });
  });

  it("saveProfile sigue avisando con StorageFullError, pero también guarda el pendiente", async () => {
    installBrowser({ local: new FakeStorage(1_000) });
    const api = await load();
    expect(() => api.saveProfile({ ...api.loadProfile(), fullName: "Ana" })).toThrow(api.StorageFullError);
    expect(api.loadProfile().fullName).toBe("Ana");
  });

  it("se guarda al reintentar cuando hay lugar, y sobrevive a una recarga mientras espera", async () => {
    const local = new FakeStorage(1_000);
    const { session } = installBrowser({ local });
    let api = await load();
    api.updateStoredProfile((draft) => {
      draft.contact.fullName = { ...draft.contact.fullName, value: "Ana Gómez" };
    });
    expect(session.getItem("cvexact.profilePending.v1")).toContain("Ana Gómez");

    // Reload, still no room: recovered from sessionStorage, still pending.
    api = await load();
    expect(api.loadProfile().fullName).toBe("Ana Gómez");
    expect(api.pendingProfileProblem()).not.toBeNull();

    // Room appears: stored, and nothing left pending.
    local.quota = 1_000_000;
    expect(api.retryPendingProfile()).toBe(true);
    expect(api.pendingProfileProblem()).toBeNull();
    expect(local.getItem("cvexact.profile.v2")).toContain("Ana Gómez");
    expect(session.getItem("cvexact.profilePending.v1")).toBeNull();
  });
  it("cuando un guardado posterior entra, los suscriptores ven el perfil nuevo en ese mismo aviso", async () => {
    const local = new FakeStorage(1_000);
    installBrowser({ local });
    const api = await load();
    api.updateStoredProfile((draft) => {
      draft.contact.fullName = { ...draft.contact.fullName, value: "Pendiente" };
    });
    expect(api.pendingProfileProblem()).toBe("quota");

    // What `useSyncExternalStore` does: read the snapshot inside the listener.
    // The write notifies while the refused profile is still the current one;
    // without a second notice once it is cleared, the screen would stay on it.
    const seen: string[] = [];
    api.subscribeToStorage(() => seen.push(api.loadProfile().fullName));
    local.quota = 1_000_000;
    expect(
      api.updateStoredProfile((draft) => {
        draft.contact.fullName = { ...draft.contact.fullName, value: "Guardado" };
      }),
    ).toBe(true);
    expect(seen.at(-1)).toBe("Guardado");
    expect(api.pendingProfileProblem()).toBeNull();
  });
});
