import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backendProfile } from "./fixtures";

/**
 * The server's half of the kept results (A5): encrypted with the browser's key,
 * found only for the same request, a lock against paying for the same CV twice,
 * and — the point of it all — a replay that reserves no grant and asks no model.
 */

const openRequest = vi.fn();
vi.mock("@/lib/api/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/context")>();
  return { ...actual, openRequest: (...args: unknown[]) => openRequest(...args) };
});

type Cache = typeof import("@/lib/generation/result-cache");

let cache: Cache;
let store: ReturnType<Cache["memoryResultStore"]>;

beforeEach(async () => {
  vi.resetModules();
  openRequest.mockReset();
  cache = await import("@/lib/generation/result-cache");
  store = cache.memoryResultStore();
  cache.setResultStoreForTests(store);
});

afterEach(() => {
  cache.setResultStoreForTests(null);
});

const KEY = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

describe("el cifrado de lo guardado", () => {
  it("sólo se abre con la clave que lo pidió, y detecta si lo tocaron", () => {
    const sealed = cache.sealResult(KEY, { value: { cv: "listo" }, jobText: "aviso" });
    expect(cache.openResult(KEY, sealed.ciphertext, sealed.iv)).toEqual({ value: { cv: "listo" }, jobText: "aviso" });
    expect(cache.openResult("9c3a1b2d-0e4f-4a5b-8c6d-7e8f9a0b1c2d", sealed.ciphertext, sealed.iv)).toBeNull();
    const tampered = Buffer.from(sealed.ciphertext, "base64");
    tampered[0] = tampered[0]! ^ 1;
    expect(cache.openResult(KEY, tampered.toString("base64"), sealed.iv)).toBeNull();
  });

  it("la base sólo ve el hash de la clave, nunca la clave ni el contenido", async () => {
    await cache.storeResult(KEY, "cv", "body", { value: { secreto: "Ana Gómez" } });
    const [row] = [...store.rows.values()];
    expect(row!.keyHash).not.toContain(KEY);
    expect(JSON.stringify(row)).not.toContain(KEY);
    expect(JSON.stringify(row)).not.toContain("Ana Gómez");
  });
});

describe("lo que se guarda y cuándo se devuelve", () => {
  it("devuelve el resultado sólo para el mismo pedido y mientras no venció", async () => {
    await cache.storeResult(KEY, "cv", "hash-a", { value: { cv: 1 } });
    expect(await cache.findReplay(KEY, "cv", "hash-a")).toEqual({ value: { cv: 1 } });
    expect(await cache.findReplay(KEY, "cv", "hash-b")).toBeNull();
    expect(await cache.findReplay(KEY, "email", "hash-a")).toBeNull();
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
    expect(await cache.findReplay(KEY, "cv", "hash-a", later)).toBeNull();
    expect(await cache.readForRecovery(KEY, later)).toBeNull();
  });

  it("un segundo pedido con la misma clave mientras se genera queda bloqueado; uno colgado se retoma", async () => {
    const now = new Date();
    expect(await cache.claimGeneration(KEY, "cv", "h", now)).toBe("claimed");
    expect(await cache.claimGeneration(KEY, "cv", "h", now)).toBe("busy");
    expect(await cache.readForRecovery(KEY, now)).toEqual({ status: "running" });
    const muchLater = new Date(now.getTime() + cache.RUNNING_STALE_MS + 1);
    expect(await cache.claimGeneration(KEY, "cv", "h", muchLater)).toBe("claimed");
  });

  it("liberar una clave no toca un resultado ya terminado", async () => {
    await cache.storeResult(KEY, "cv", "h", { value: 1 });
    await cache.releaseGeneration(KEY);
    expect(await cache.readForRecovery(KEY)).toMatchObject({ status: "done", kind: "cv" });
  });

  it("sin base configurada no hace nada y no rompe nada", async () => {
    cache.setResultStoreForTests(null);
    expect(await cache.claimGeneration(KEY, "cv", "h")).toBe("unavailable");
    await expect(cache.storeResult(KEY, "cv", "h", { value: 1 })).resolves.toBeUndefined();
    expect(await cache.findReplay(KEY, "cv", "h")).toBeNull();
  });
});

describe("las rutas", () => {
  const body = JSON.stringify({ profile: backendProfile, jobText: "Buscamos analista de datos con experiencia en SQL y Python." });
  const post = (headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/generate/cv", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });

  it("repetir un pedido ya respondido devuelve lo mismo sin reservar crédito ni llamar a ningún modelo", async () => {
    await cache.storeResult(KEY, "cv", cache.hashBody(body), { value: { cv: "el mismo" } });
    const { POST } = await import("@/app/api/generate/cv/route");

    const response = await POST(post({ "x-cvp-idempotency-key": KEY }));
    expect(response.headers.get("x-cvp-replayed")).toBe("1");
    expect(await response.text()).toBe(`${JSON.stringify({ type: "done", value: { cv: "el mismo" } })}\n`);
    expect(openRequest).not.toHaveBeenCalled();
  });

  it("un pedido igual mientras el primero sigue generando recibe 409, y se le devuelve el crédito", async () => {
    await cache.claimGeneration(KEY, "cv", cache.hashBody(body));
    const release = vi.fn(async () => {});
    openRequest.mockResolvedValue({ chain: {}, grant: { release }, tier: "byok" });
    const { POST } = await import("@/app/api/generate/cv/route");

    const response = await POST(post({ "x-cvp-idempotency-key": KEY }));
    expect(response.status).toBe(409);
    expect(release).toHaveBeenCalledWith("failure");
  });

  it("GET /api/generate/result devuelve por clave lo guardado", async () => {
    await cache.storeResult(KEY, "cv", "cualquiera", { value: { cv: "recuperado" }, jobText: "aviso" });
    const { GET } = await import("@/app/api/generate/result/route");
    const response = await GET(new Request("http://localhost/api/generate/result", { headers: { "x-cvp-idempotency-key": KEY } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "cv", value: { cv: "recuperado" }, jobText: "aviso" });

    const missing = await GET(
      new Request("http://localhost/api/generate/result", {
        headers: { "x-cvp-idempotency-key": "11111111-2222-4333-8444-555555555555" },
      }),
    );
    expect(missing.status).toBe(404);
  });
});
