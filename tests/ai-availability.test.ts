import { describe, expect, it } from "vitest";
import { aiAvailability } from "@/lib/ai/availability";
import type { BillingStatus } from "@/lib/api/billing";

/**
 * Whether the assistant will work is decided from two facts that live in
 * different places — the user's own key, in the browser; the service's key and
 * the tier, on the server — and getting the cross wrong is invisible until
 * someone loses a paragraph to a 400.
 *
 * There is no server-funded trial: `free` always means "bring your own key",
 * whether or not this installation happens to have a key of its own — that key
 * belongs to `pro`/`credits` alone. And their counter can be full while the
 * capability behind it is still absent, so both cases read the same message.
 */

const status = (overrides: Partial<BillingStatus> = {}): BillingStatus => ({
  tier: "free",
  used: 0,
  allowance: 0,
  credits: 0,
  gateways: [],
  serviceConfigured: true,
  packApplications: null,
  signedIn: false,
  subscription: { gateway: null, active: false, canSubscribe: { mercadopago: false } },
  // Sin pasarela configurada no hay nada que contratar, que es el caso base acá.
  terms: { pack: null, subscription: null },
  ...overrides,
});

describe("aiAvailability", () => {
  it("says nothing until the server has answered", () => {
    expect(aiAvailability({ byok: false, status: null })).toBeNull();
  });

  it("reports a user's own key as unlimited, without waiting for the server", () => {
    const result = aiAvailability({ byok: true, status: null });
    expect(result).toEqual({
      tone: "ok",
      message: "IA con tu key · sin límite",
      actionable: false,
      byok: true,
    });
  });

  it("says whether the text goes to the person's own provider or the service's", () => {
    expect(aiAvailability({ byok: true, status: null })?.byok).toBe(true);
    expect(aiAvailability({ byok: false, status: status({ tier: "byok" }) })?.byok).toBe(true);
    expect(aiAvailability({ byok: false, status: status({ tier: "pro" }) })?.byok).toBe(false);
    expect(aiAvailability({ byok: false, status: status({ tier: "credits", credits: 1 }) })?.byok).toBe(false);
  });

  it("reports an active subscription", () => {
    expect(aiAvailability({ byok: false, status: status({ tier: "pro" }) })).toMatchObject({
      tone: "ok",
      message: "IA incluida en tu suscripción",
    });
  });

  it("reports a credit balance", () => {
    expect(
      aiAvailability({ byok: false, status: status({ tier: "credits", credits: 42 }) }),
    ).toMatchObject({ tone: "ok", message: "IA · te quedan 42 créditos" });
  });

  it("el tier free se rechaza siempre, aunque el servicio tenga key", () => {
    const result = aiAvailability({
      byok: false,
      status: status({ serviceConfigured: true }),
    });
    expect(result?.tone).toBe("bad");
    expect(result?.message).toMatch(/Sin IA disponible/);
    expect(result?.actionable).toBe(true);
  });

  /** The line that sends to Ajustes says where, and not that the key is free: what the key of Google asks comes first, where the key is made (e5 UX, U37). */
  it("sends to Ajustes without selling the key", () => {
    const result = aiAvailability({ byok: false, status: status({ serviceConfigured: false }) });
    expect(result?.message).toBe("Sin IA disponible · poné tu key en Ajustes");
    expect(result?.message).not.toMatch(/gratis|gratuita/i);
  });

  /**
   * The reason `serviceConfigured` was added. A `pro`/`credits` user can be
   * told by every other field that they have a working plan; none of it can
   * succeed if the installation never configured a key of its own.
   */
  it("refuses to promise pro/credits when the installation has no key of its own", () => {
    const result = aiAvailability({
      byok: false,
      status: status({ tier: "pro", serviceConfigured: false }),
    });

    expect(result?.tone).toBe("bad");
    expect(result?.message).toMatch(/Sin IA disponible/);
  });

  it("still works with an unconfigured service when the user brought a key", () => {
    expect(
      aiAvailability({ byok: true, status: status({ serviceConfigured: false }) }),
    ).toMatchObject({ tone: "ok" });
  });
});
