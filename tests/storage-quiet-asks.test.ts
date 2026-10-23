import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The two things the app asks of the browser without a screen of their own (`keepDataQuietly`, `offerInstallOnce`): that they ask when they should, no more
 * than they should, and nothing at all where the browser cannot be asked.
 */

function installWindow(options: { persisted: boolean; persistAnswer?: boolean; stored?: Record<string, string> }) {
  const map = new Map(Object.entries(options.stored ?? {}));
  const persist = vi.fn(async () => options.persistAnswer ?? false);
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    },
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { storage: { persisted: async () => options.persisted, persist } },
  });
  return { map, persist };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  Reflect.deleteProperty(globalThis, "navigator");
  vi.resetModules();
});

describe("keepDataQuietly", () => {
  it("pide una vez por CV hasta tres veces, y no pide si el navegador ya aceptó", async () => {
    const { persist, map } = installWindow({ persisted: false, persistAnswer: false });
    const { keepDataQuietly } = await import("@/lib/storage/usage");
    for (let i = 0; i < 5; i++) await keepDataQuietly();
    expect(persist).toHaveBeenCalledTimes(3);
    expect(map.get("cvexact.keepAsked.v1")).toBe("3");

    const already = installWindow({ persisted: true });
    await keepDataQuietly();
    expect(already.persist).not.toHaveBeenCalled();
  });

  it("no pide donde el navegador no sabe de persistencia", async () => {
    installWindow({ persisted: false });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    const { keepDataQuietly } = await import("@/lib/storage/usage");
    await expect(keepDataQuietly()).resolves.toBeUndefined();
  });
});

describe("offerInstallOnce", () => {
  it("no hace nada sin la oferta del navegador", async () => {
    const { map } = installWindow({ persisted: false });
    const { offerInstallOnce } = await import("@/lib/pwa/install");
    offerInstallOnce();
    expect(map.has("cvexact.installAsked.v1")).toBe(false);
  });

  it("ofrece una sola vez, desde el toque, y no vuelve a ofrecer", async () => {
    const { map } = installWindow({ persisted: false });
    const listeners = new Map<string, (event: Event) => void>();
    (globalThis as unknown as { window: Record<string, unknown> }).window.addEventListener = (name: string, fn: (event: Event) => void) => void listeners.set(name, fn);
    const { captureInstallPrompt, offerInstallOnce } = await import("@/lib/pwa/install");
    captureInstallPrompt();
    const prompt = vi.fn(async () => {});
    listeners.get("beforeinstallprompt")!({ preventDefault() {}, prompt, userChoice: Promise.resolve({ outcome: "dismissed" }) } as unknown as Event);

    offerInstallOnce();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(map.get("cvexact.installAsked.v1")).toBe("1");

    // The browser fires its offer again on a later visit: the person was already asked.
    listeners.get("beforeinstallprompt")!({ preventDefault() {}, prompt, userChoice: Promise.resolve({ outcome: "dismissed" }) } as unknown as Event);
    offerInstallOnce();
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});
