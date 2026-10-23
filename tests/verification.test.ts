import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who gets asked to confirm their address, and what that gates.
 *
 * The policy is narrow on purpose. An unverified account can still use the
 * whole product — it works signed out, so there is nothing there an anonymous
 * visitor could not already do — and what it cannot reach is the account's own
 * surface: syncing a profile to the server, starting a subscription. Blocking
 * the login instead would mean a mail that lands in spam costs someone the
 * profile they already wrote.
 *
 * The other half is that none of this may fire when there is no mailer, since
 * then nobody was ever sent a link and the requirement would be ours to have
 * failed rather than theirs.
 */

async function loadAuth() {
  vi.resetModules();
  return import("@/lib/auth");
}

const verified = { id: "u1", email: "a@ejemplo.com", name: "A", emailVerified: true };
const unverified = { ...verified, emailVerified: false };

beforeEach(() => {
  process.env.SMTP_HOST = "smtp.ejemplo.com";
  process.env.MAIL_FROM = "cvexact <hola@ejemplo.com>";
});

afterEach(() => {
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_FROM;
});

describe("requiresVerification", () => {
  it("exige confirmar a quien no confirmó", async () => {
    const { requiresVerification } = await loadAuth();
    expect(requiresVerification(unverified)).toBe(true);
  });

  it("no molesta a quien ya confirmó", async () => {
    const { requiresVerification } = await loadAuth();
    expect(requiresVerification(verified)).toBe(false);
  });

  it("no exige nada si no hay servidor de correo", async () => {
    delete process.env.SMTP_HOST;
    const { requiresVerification } = await loadAuth();
    // Sin mailer nunca se mandó ningún enlace: pedirlo sería cobrarle al
    // usuario una configuración que falta de nuestro lado.
    expect(requiresVerification(unverified)).toBe(false);
  });

  it("no aplica a quien no inició sesión", async () => {
    const { requiresVerification } = await loadAuth();
    expect(requiresVerification(null)).toBe(false);
  });

  it("trata un `emailVerified` ausente como sin confirmar", async () => {
    const { requiresVerification } = await loadAuth();
    // Fallar hacia el lado seguro: un campo que no llegó no es una confirmación.
    const withoutFlag = { id: "u1", email: "a@ejemplo.com", name: "A" };
    expect(requiresVerification(withoutFlag)).toBe(true);
  });
});

describe("requireVerifiedEmail", () => {
  it("devuelve un 403 con un motivo que el cliente puede leer", async () => {
    vi.resetModules();
    const { requireVerifiedEmail } = await import("@/lib/api/guards");

    const response = requireVerifiedEmail(unverified);
    expect(response?.status).toBe(403);

    const body = await response!.json();
    // El cliente ramifica sobre `reason`, igual que con las cuotas.
    expect(body.reason).toBe("email_unverified");
    expect(body.error).toBeTruthy();
  });

  it("deja seguir a quien ya confirmó", async () => {
    vi.resetModules();
    const { requireVerifiedEmail } = await import("@/lib/api/guards");
    expect(requireVerifiedEmail(verified)).toBeNull();
  });

  it("deja seguir cuando no hay correo configurado", async () => {
    delete process.env.SMTP_HOST;
    vi.resetModules();
    const { requireVerifiedEmail } = await import("@/lib/api/guards");
    expect(requireVerifiedEmail(unverified)).toBeNull();
  });
});

describe("enforceRateLimit", () => {
  it("responde 429 con retry-after cuando se pasa", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
    const { enforceRateLimit } = await import("@/lib/api/guards");
    const headers = new Headers({ "x-forwarded-for": "203.0.113.4" });
    const rule = { window: 60, max: 1 };

    expect(await enforceRateLimit("prueba", headers, rule)).toBeNull();

    const refused = await enforceRateLimit("prueba", headers, rule);
    expect(refused?.status).toBe(429);
    // Sin esto, un cliente obediente no sabe cuánto esperar y vuelve enseguida.
    expect(Number(refused?.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await refused!.json()).reason).toBe("rate_limited");
  });
});
