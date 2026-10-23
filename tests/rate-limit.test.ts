import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The ceiling on the routes Better Auth never sees — the PDF render, the model
 * listing, the anonymous BYOK generation path. Each of those is expensive to
 * serve and free to call, so the limit is the only thing standing between one
 * script and everyone else's share of the box.
 *
 * These run against the in-memory store, the path taken when DATABASE_URL is
 * unset. The Postgres path expresses the same decision as a single upsert; what
 * is pinned here is the decision, not the statement.
 */

async function loadRateLimit() {
  vi.resetModules();
  return import("@/lib/rate-limit");
}

beforeEach(() => {
  delete process.env.DATABASE_URL;
});

describe("consume", () => {
  it("deja pasar exactamente `max` pedidos y rechaza el siguiente", async () => {
    const { consume } = await loadRateLimit();
    const rule = { window: 60, max: 3 };

    for (let i = 0; i < 3; i += 1) {
      expect(await consume("k", rule), `pedido ${i + 1}`).toEqual({ ok: true });
    }

    const refused = await consume("k", rule);
    expect(refused.ok).toBe(false);
  });

  it("cuenta cada clave por separado", async () => {
    const { consume } = await loadRateLimit();
    const rule = { window: 60, max: 1 };

    expect(await consume("uno", rule)).toEqual({ ok: true });
    // Gastar la primera clave no puede consumir la de otro.
    expect(await consume("dos", rule)).toEqual({ ok: true });
    expect((await consume("uno", rule)).ok).toBe(false);
  });

  it("vuelve a abrir cuando pasó la ventana", async () => {
    vi.useFakeTimers();
    try {
      const { consume } = await loadRateLimit();
      const rule = { window: 60, max: 1 };

      expect(await consume("k", rule)).toEqual({ ok: true });
      expect((await consume("k", rule)).ok).toBe(false);

      vi.advanceTimersByTime(60_000);
      expect(await consume("k", rule)).toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("no reabre un instante antes de tiempo", async () => {
    vi.useFakeTimers();
    try {
      const { consume } = await loadRateLimit();
      const rule = { window: 60, max: 1 };

      await consume("k", rule);
      vi.advanceTimersByTime(59_999);
      expect((await consume("k", rule)).ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("informa cuánto falta, siempre al menos un segundo", async () => {
    vi.useFakeTimers();
    try {
      const { consume } = await loadRateLimit();
      const rule = { window: 60, max: 1 };

      await consume("k", rule);
      vi.advanceTimersByTime(30_000);

      const refused = await consume("k", rule);
      expect(refused).toEqual({ ok: false, retryAfterSeconds: 30 });

      // Al filo de la ventana el resto redondea a cero, y un `retry-after: 0`
      // le dice a un cliente obediente que reintente ya mismo.
      vi.advanceTimersByTime(29_999);
      const atTheEdge = await consume("k", rule);
      expect(atTheEdge.ok).toBe(false);
      if (!atTheEdge.ok) expect(atTheEdge.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("la ventana es fija: los pedidos de adentro no la corren hacia adelante", async () => {
    vi.useFakeTimers();
    try {
      const { consume } = await loadRateLimit();
      const rule = { window: 60, max: 2 };

      await consume("k", rule);
      vi.advanceTimersByTime(50_000);
      await consume("k", rule);

      // Si el segundo pedido hubiese reiniciado el reloj, todavía faltarían 50 s.
      vi.advanceTimersByTime(10_000);
      expect(await consume("k", rule)).toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("rateLimitKey", () => {
  it("separa a dos usuarios distintos aunque compartan la IP", async () => {
    const { rateLimitKey } = await loadRateLimit();
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7" });

    expect(rateLimitKey("pdf", headers, "user-a")).not.toEqual(
      rateLimitKey("pdf", headers, "user-b"),
    );
  });

  it("separa dos límites distintos del mismo usuario", async () => {
    const { rateLimitKey } = await loadRateLimit();
    const headers = new Headers();

    expect(rateLimitKey("pdf", headers, "user-a")).not.toEqual(
      rateLimitKey("models", headers, "user-a"),
    );
  });

  it("no escribe la IP cruda en la clave", async () => {
    const { rateLimitKey } = await loadRateLimit();
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7" });

    expect(rateLimitKey("pdf", headers)).not.toContain("203.0.113.7");
  });
});
