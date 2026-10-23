import { describe, expect, it } from "vitest";
import { hasActiveSubscription } from "@/lib/auth";

/**
 * Who counts as a paying subscriber.
 *
 * Mercado Pago says `authorized` for an active preapproval. Pinned in a set
 * rather than a single comparison so the same predicate reads cleanly if a
 * second gateway's word for "paid" ever joins it.
 */

const user = (over: Partial<Parameters<typeof hasActiveSubscription>[0]> = {}) => ({
  id: "u1",
  email: "a@example.com",
  name: "Ana",
  ...over,
});

describe("hasActiveSubscription", () => {
  it("acepta el estado activo de Mercado Pago", () => {
    expect(hasActiveSubscription(user({ subscriptionStatus: "authorized" }))).toBe(true);
  });

  it("rechaza los estados de Mercado Pago que no dan acceso", () => {
    // `pending` es una suscripción creada y todavía no autorizada: si diera
    // acceso, abrir el checkout y abandonarlo saldría gratis.
    for (const status of ["paused", "cancelled", "pending"]) {
      expect(hasActiveSubscription(user({ subscriptionStatus: status }))).toBe(false);
    }
  });

  it("rechaza a quien no tiene suscripción", () => {
    expect(hasActiveSubscription(null)).toBe(false);
    expect(hasActiveSubscription(user())).toBe(false);
    expect(hasActiveSubscription(user({ subscriptionStatus: null }))).toBe(false);
  });

  it("un período vencido gana sobre un estado activo", () => {
    // La pasarela puede demorar en avisar una baja, y mientras tanto la fecha
    // es el dato más confiable que tenemos.
    const past = new Date(Date.now() - 86_400_000);
    expect(
      hasActiveSubscription(user({ subscriptionStatus: "authorized", subscriptionCurrentPeriodEnd: past })),
    ).toBe(false);
  });

  it("un período futuro no molesta", () => {
    const future = new Date(Date.now() + 86_400_000);
    expect(
      hasActiveSubscription(
        user({ subscriptionStatus: "authorized", subscriptionCurrentPeriodEnd: future }),
      ),
    ).toBe(true);
  });

  it("sin fecha de fin, el estado alcanza", () => {
    // Mercado Pago no siempre trae next_payment_date; que eso bloqueara el
    // acceso sería cortarle el servicio a alguien que está pagando.
    expect(
      hasActiveSubscription(
        user({ subscriptionStatus: "authorized", subscriptionCurrentPeriodEnd: null }),
      ),
    ).toBe(true);
  });
});
