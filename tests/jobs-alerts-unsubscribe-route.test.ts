import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitMemory } from "@/lib/rate-limit";
import { signJobAlertUnsubscribeToken } from "@/lib/jobs/alert-token";

/**
 * `/api/jobs/alerts/unsubscribe` — el link de baja de un clic de
 * `jobAlertMail`. No usa base real: `databaseConfigured: false` hace que el
 * rate limit caiga a su fallback en memoria (ver `consumeInMemory` en
 * `lib/rate-limit.ts`), y `deactivateJobAlert` va mockeado, así que este test
 * se queda en lo que la ruta misma decide — validar el token y responder —
 * sin repetir la cobertura de `deactivateJobAlert` (borra `jobAlert` + retira
 * el consentimiento, mismo camino que ya ejercita el `DELETE` logueado).
 */

const deactivateJobAlert = vi.fn(async () => {});

vi.mock("@/lib/db", async () => ({
  databaseConfigured: false,
  getDb: () => {
    throw new Error("no debería tocar la base en este test");
  },
  schema: await import("@/lib/db/schema"),
}));

vi.mock("@/lib/jobs/alerts", () => ({ deactivateJobAlert }));

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-value";
  resetRateLimitMemory();
  deactivateJobAlert.mockClear();
});

afterEach(() => {
  delete process.env.BETTER_AUTH_SECRET;
});

function request(query: string) {
  return new Request(`http://localhost/api/jobs/alerts/unsubscribe${query}`, {
    headers: { "x-forwarded-for": "203.0.113.9" },
  });
}

describe("GET /api/jobs/alerts/unsubscribe", () => {
  it("deactivates the alert and confirms, given a valid token", async () => {
    const { GET } = await import("@/app/api/jobs/alerts/unsubscribe/route");
    const token = signJobAlertUnsubscribeToken("user-1");

    const response = await GET(request(`?u=user-1&t=${encodeURIComponent(token)}`));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Alerta desactivada");
    expect(deactivateJobAlert).toHaveBeenCalledExactlyOnceWith("user-1");
  });

  it("does not touch anything when the token is tampered with", async () => {
    const { GET } = await import("@/app/api/jobs/alerts/unsubscribe/route");
    const token = signJobAlertUnsubscribeToken("user-1");
    const tampered = token.slice(0, -1) + (token.at(-1) === "a" ? "b" : "a");

    const response = await GET(request(`?u=user-1&t=${encodeURIComponent(tampered)}`));

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Link inválido");
    expect(deactivateJobAlert).not.toHaveBeenCalled();
  });

  it("does not touch anything when a token for another user is reused", async () => {
    const { GET } = await import("@/app/api/jobs/alerts/unsubscribe/route");
    const token = signJobAlertUnsubscribeToken("user-1");

    const response = await GET(request(`?u=user-2&t=${encodeURIComponent(token)}`));

    expect(response.status).toBe(400);
    expect(deactivateJobAlert).not.toHaveBeenCalled();
  });

  it("rejects a request missing the token entirely", async () => {
    const { GET } = await import("@/app/api/jobs/alerts/unsubscribe/route");

    const response = await GET(request("?u=user-1"));

    expect(response.status).toBe(400);
    expect(deactivateJobAlert).not.toHaveBeenCalled();
  });
});
