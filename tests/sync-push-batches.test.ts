import { afterEach, describe, expect, it, vi } from "vitest";
import { installBrowser, realisticApplication, uninstallBrowser } from "./helpers/browser-storage";

/**
 * «Subir a mi cuenta» used to send the whole history in one request, and the
 * server takes at most 1 MiB, 500 applications and 500 deleted ids per request
 * (`app/api/sync/route.ts`): from a few dozen applications on, it answered 413
 * and nothing went up. It is sent in batches now.
 */

afterEach(() => {
  uninstallBrowser();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("batchApplications", () => {
  it("parte en lotes que entran junto a lo fijo de cada pedido, y respeta el tope de cantidad", async () => {
    const { batchApplications } = await import("@/lib/api/sync-client");
    const items = Array.from({ length: 30 }, (_, i) => ({ id: `a${i}`, text: "x".repeat(1_000) }));
    const { batches, tooLarge } = batchApplications(items, 500, 5_000, 4);
    expect(tooLarge).toBe(0);
    expect(batches.flat()).toHaveLength(30);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(4);
      expect(JSON.stringify(batch).length + 500).toBeLessThanOrEqual(5_000);
    }
  });

  it("deja afuera y cuenta la que no entra ni sola, en vez de romper su lote", async () => {
    const { batchApplications } = await import("@/lib/api/sync-client");
    const { batches, tooLarge } = batchApplications([{ id: "enorme", text: "x".repeat(10_000) }, { id: "chica" }], 0, 5_000);
    expect(tooLarge).toBe(1);
    expect(batches).toEqual([[{ id: "chica" }]]);
  });
});

describe("uploadProfile", () => {
  it("sube un historial de más de 1 MiB en varios pedidos, cada uno bajo el límite, y suma lo que contestó el servidor", async () => {
    const { local } = installBrowser({ indexedDB: true });
    local.setItem("cvexact.deletedApplications.v1", JSON.stringify(Array.from({ length: 700 }, (_, i) => `gone-${i}`)));
    vi.resetModules();
    const api = await import("@/lib/storage/local");
    for (let index = 0; index < 120; index++) await api.saveApplication(realisticApplication(index));

    const bodies: Array<{ applications: unknown[]; deletedIds?: string[]; profileV2?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const text = String(init.body);
        expect(new TextEncoder().encode(text).length).toBeLessThan(1024 * 1024);
        const body = JSON.parse(text);
        bodies.push(body);
        return new Response(JSON.stringify({ ok: true, applications: body.applications.length, skippedOversize: 0, skippedFull: 0 }));
      }),
    );

    const { uploadProfile, describeUpload } = await import("@/lib/api/sync-client");
    const result = await uploadProfile("user-1");

    expect(bodies.length).toBeGreaterThan(1);
    expect(bodies.every((body) => body.profileV2 !== undefined)).toBe(true);
    expect(bodies.flatMap((body) => body.applications)).toHaveLength(120);
    // 700 tombstones: two chunks, each within the server's 500.
    const deleted = bodies.flatMap((body) => body.deletedIds ?? []);
    expect(deleted).toHaveLength(700);
    expect(bodies.every((body) => (body.deletedIds?.length ?? 0) <= 500)).toBe(true);
    expect(result.applications).toBe(120);
    expect(describeUpload(result)).toBe("Subimos tu perfil y 120 postulaciones.");
  }, 30_000);

  it("si falla a mitad, dice cuánto llegó a subir", async () => {
    installBrowser({ indexedDB: true });
    vi.resetModules();
    const api = await import("@/lib/storage/local");
    for (let index = 0; index < 120; index++) await api.saveApplication(realisticApplication(index));

    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls += 1;
        if (calls === 2) return new Response(JSON.stringify({ error: "Demasiados pedidos." }), { status: 429 });
        const body = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ ok: true, applications: body.applications.length }));
      }),
    );
    const { uploadProfile } = await import("@/lib/api/sync-client");
    await expect(uploadProfile("user-1")).rejects.toThrow(/Subimos \d+ postulaciones y después falló: Demasiados pedidos\./);
  }, 30_000);
});
