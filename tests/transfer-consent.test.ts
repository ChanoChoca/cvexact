import { beforeEach, describe, expect, it, vi } from "vitest";
import { denialOf } from "@/components/billing/LimitReached";

/**
 * El consentimiento a la transferencia internacional (Ley 25.326 art. 12).
 *
 * Lo que se fija acá son las dos propiedades de las que depende que el permiso
 * sirva de algo: que esté atado a la versión del texto que se aceptó, y que el
 * servidor sea quien la elige. Un consentimiento que sobrevive a un cambio
 * sustantivo del texto es un consentimiento prestado sobre otra información, y
 * uno cuya versión llega en el body es uno que el cliente puede declarar dado
 * sobre un texto que nunca vio.
 */

const insert = vi.fn();
const select = vi.fn();

vi.mock("@/lib/db", () => ({
  databaseConfigured: true,
  getDb: () => ({
    insert: () => ({ values: (v: unknown) => ({ onConflictDoNothing: () => insert(v) }) }),
    select: () => ({
      from: () => ({ where: (w: unknown) => ({ limit: () => select(w) }) }),
    }),
  }),
  schema: { consent: { userId: "user_id", kind: "kind", version: "version" } },
}));

const { hasTransferConsent, recordTransferConsent } = await import("@/lib/legal/consent");
const { LEGAL_VERSION } = await import("@/lib/legal/operator");

beforeEach(() => {
  insert.mockReset().mockResolvedValue(undefined);
  select.mockReset().mockResolvedValue([]);
});

describe("consentimiento de transferencia", () => {
  it("registra la versión vigente, elegida por el servidor", async () => {
    await recordTransferConsent("user-1");
    expect(insert).toHaveBeenCalledWith({
      userId: "user-1",
      kind: "transfer",
      version: LEGAL_VERSION,
    });
  });

  it("sin fila, no hay consentimiento", async () => {
    select.mockResolvedValue([]);
    expect(await hasTransferConsent("user-1")).toBe(false);
  });

  it("con la fila de la versión vigente, sí", async () => {
    select.mockResolvedValue([{ version: LEGAL_VERSION }]);
    expect(await hasTransferConsent("user-1")).toBe(true);
  });

  it("la consulta filtra por la versión vigente y no por «alguna»", async () => {
    // La condición se arma con `and(...)` de drizzle; lo que importa fijar es
    // que `LEGAL_VERSION` participe de ella. Si alguien la saca para que el
    // consentimiento «no caduque», este test cae.
    await hasTransferConsent("user-1");
    expect(JSON.stringify(select.mock.calls[0][0])).toContain(LEGAL_VERSION);
  });
});

describe("denialOf", () => {
  it("lee el 403 del consentimiento pendiente", () => {
    expect(denialOf({ status: 403, reason: "transfer_consent" })).toBe("transfer_consent");
  });

  it("sigue leyendo el 429 de la cuota", () => {
    expect(denialOf({ status: 429, reason: "daily_limit" })).toBe("daily_limit");
  });

  it("ignora otros errores, aunque traigan reason", () => {
    // Un 500 con `reason` sería un bug del servidor, no una refusal accionable:
    // ofrecerle al usuario comprar créditos por una excepción sería peor que el
    // error genérico.
    expect(denialOf({ status: 500, reason: "no_credits" })).toBeNull();
    expect(denialOf({ status: 403 })).toBeNull();
    expect(denialOf(new Error("boom"))).toBeNull();
    expect(denialOf(undefined)).toBeNull();
  });
});
