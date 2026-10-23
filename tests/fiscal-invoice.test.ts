import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `ensureInvoice` es la pieza que no puede fallar mal: la obligación de
 * facturar corre después de acreditar el pago, y un error acá jamás puede
 * hacer que el webhook de Mercado Pago falle ni que un pago quede sin sus
 * créditos — ver el comentario de cabecera en `lib/fiscal/invoice.ts`. Estos
 * tests fijan esa propiedad con ARCA mockeado, sin red ni certificados: el
 * cliente real (`lib/fiscal/wsaa.ts`, `lib/fiscal/wsfev1.ts`) tiene los suyos
 * propios en `tests/fiscal-wsaa.test.ts` y `tests/fiscal-wsfev1.test.ts`.
 */

const selectResult = vi.fn();
const insertValues = vi.fn();
const updateSet = vi.fn();
const txExecute = vi.fn();

vi.mock("@/lib/db", () => ({
  databaseConfigured: true,
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: () => selectResult() }) }) }),
    insert: () => ({ values: (v: unknown) => ({ onConflictDoNothing: () => insertValues(v) }) }),
    update: () => ({ set: (v: unknown) => ({ where: () => updateSet(v) }) }),
    transaction: async (cb: (tx: unknown) => unknown) => cb({ execute: txExecute }),
  }),
  schema: {
    invoice: {
      gateway: "gateway",
      externalId: "external_id",
      status: "status",
    },
    user: {
      id: "id",
      email: "email",
    },
  },
}));

const fiscalConfig = vi.fn();
vi.mock("@/lib/fiscal/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fiscal/config")>();
  return { ...actual, fiscalConfig };
});

const getTicket = vi.fn();
vi.mock("@/lib/fiscal/wsaa", () => ({ getTicket }));

const ultimoAutorizado = vi.fn();
const solicitarCAE = vi.fn();
class FakeArcaError extends Error {
  details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.details = details;
  }
}
vi.mock("@/lib/fiscal/wsfev1", () => ({
  ultimoAutorizado,
  solicitarCAE,
  ArcaError: FakeArcaError,
}));

const { ensureInvoice } = await import("@/lib/fiscal/invoice");

const CONFIG = {
  cuit: "20123456789",
  ptoVta: 3,
  certPem: "cert",
  keyPem: "key",
  environment: "homologacion" as const,
};

beforeEach(() => {
  // `ensureInvoice` puede hacer hasta dos `select`: primero si ya existe la
  // factura, y sólo si termina en éxito, después el email del comprador para
  // el recibo. Cada test encola exactamente los que su camino recorre, con
  // `mockResolvedValueOnce` — un default compartido entre tests con caminos
  // distintos es la forma más fácil de que el segundo `select` de un test
  // devuelva la respuesta pensada para el primero de otro.
  selectResult.mockReset();
  insertValues.mockReset().mockResolvedValue(undefined);
  updateSet.mockReset().mockResolvedValue(undefined);
  txExecute.mockReset().mockResolvedValue(undefined);
  fiscalConfig.mockReset().mockReturnValue(CONFIG);
  getTicket.mockReset().mockResolvedValue({ token: "t", sign: "s", expirationTime: new Date() });
  ultimoAutorizado.mockReset().mockResolvedValue(41);
  solicitarCAE.mockReset().mockResolvedValue({
    resultado: "A",
    cae: "75311234567890",
    caeVto: new Date("2026-09-15"),
    observaciones: [],
  });
});

describe("ensureInvoice", () => {
  it("sin fiscalConfig, no toca la base ni llama a ARCA", async () => {
    fiscalConfig.mockReturnValue(undefined);

    await ensureInvoice({
      userId: "u1",
      gateway: "mercadopago",
      externalId: "pay-1",
      importe: 6080,
    });

    expect(selectResult).not.toHaveBeenCalled();
    expect(getTicket).not.toHaveBeenCalled();
  });

  it("ya emitida, no vuelve a pedir CAE", async () => {
    selectResult.mockResolvedValueOnce([{ status: "issued" }]);

    await ensureInvoice({
      userId: "u1",
      gateway: "mercadopago",
      externalId: "pay-1",
      importe: 6080,
    });

    expect(insertValues).not.toHaveBeenCalled();
    expect(getTicket).not.toHaveBeenCalled();
    expect(solicitarCAE).not.toHaveBeenCalled();
  });

  it("primera vez: inserta 'pending', pide el próximo número y cierra en 'issued'", async () => {
    selectResult
      .mockResolvedValueOnce([]) // no existe todavía
      .mockResolvedValueOnce([{ email: "buyer@example.com" }]); // email para el recibo

    await ensureInvoice({
      userId: "u1",
      gateway: "mercadopago",
      externalId: "pay-1",
      importe: 6080,
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway: "mercadopago",
        externalId: "pay-1",
        userId: "u1",
        ptoVta: 3,
        importe: 6080,
        status: "pending",
      }),
    );
    // 41 autorizado -> pide el 42.
    expect(solicitarCAE).toHaveBeenCalledWith(
      expect.anything(),
      CONFIG,
      expect.objectContaining({ cbteNro: 42, importe: 6080 }),
    );
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "issued", cae: "75311234567890", cbteNro: 42 }),
    );
  });

  it("una fila 'pending' o 'failed' existente no se reinserta, pero sí se reintenta", async () => {
    selectResult
      .mockResolvedValueOnce([{ status: "failed" }])
      .mockResolvedValueOnce([{ email: "buyer@example.com" }]);

    await ensureInvoice({
      userId: "u1",
      gateway: "mercadopago",
      externalId: "pay-1",
      importe: 6080,
    });

    expect(insertValues).not.toHaveBeenCalled();
    expect(solicitarCAE).toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "issued" }));
  });

  it("ARCA rechaza (Resultado: R): queda 'failed', con el detalle, sin tirar", async () => {
    selectResult.mockResolvedValueOnce([]);
    solicitarCAE.mockResolvedValue({
      resultado: "R",
      cae: null,
      caeVto: null,
      observaciones: ["10016: CbteDesde no es correlativo"],
    });

    await expect(
      ensureInvoice({ userId: "u1", gateway: "mercadopago", externalId: "pay-1", importe: 6080 }),
    ).resolves.toBeUndefined();

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        lastError: expect.stringContaining("10016"),
      }),
    );
  });

  /**
   * La propiedad que más importa: nada de lo que pueda salir mal acá puede
   * escapar como una excepción hacia el webhook que llamó a `ensureInvoice`.
   */
  it("WSAA/ARCA caído: no tira, y deja la fila en 'failed'", async () => {
    selectResult.mockResolvedValueOnce([]);
    getTicket.mockRejectedValue(new Error("wsaahomo.afip.gov.ar: connection refused"));

    await expect(
      ensureInvoice({ userId: "u1", gateway: "mercadopago", externalId: "pay-1", importe: 6080 }),
    ).resolves.toBeUndefined();

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        lastError: expect.stringContaining("connection refused"),
      }),
    );
  });

  it("un ArcaError con observaciones detalladas las incluye en lastError", async () => {
    selectResult.mockResolvedValueOnce([]);
    ultimoAutorizado.mockRejectedValue(
      new FakeArcaError("FECompUltimoAutorizado falló.", ["11002: PtoVta no habilitado"]),
    );

    await ensureInvoice({
      userId: "u1",
      gateway: "mercadopago",
      externalId: "pay-1",
      importe: 6080,
    });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        lastError: expect.stringContaining("11002"),
      }),
    );
  });

  /**
   * El bug real que este test encontró: sin el try/catch propio alrededor del
   * paso de mandar el recibo, un fallo buscando el email del comprador subía
   * hasta el `catch` de afuera, que volvía a escribir la fila como
   * `"failed"` — pisando el `"issued"` con CAE que ya se había guardado un
   * instante antes. La factura habría quedado emitida de verdad en ARCA pero
   * marcada como fallida en esta base.
   */
  it("si falla mandar el recibo, la factura sigue 'issued' — no se pisa con 'failed'", async () => {
    selectResult
      .mockResolvedValueOnce([]) // no existe todavía
      .mockRejectedValueOnce(new Error("timeout buscando el email")); // falla el paso del recibo

    await expect(
      ensureInvoice({ userId: "u1", gateway: "mercadopago", externalId: "pay-1", importe: 6080 }),
    ).resolves.toBeUndefined();

    const statuses = updateSet.mock.calls.map((call) => (call[0] as { status?: string }).status);
    expect(statuses).toEqual(["issued"]);
    expect(statuses).not.toContain("failed");
  });

  it("toma el punto de venta bajo un advisory lock antes de pedir el número", async () => {
    selectResult.mockResolvedValueOnce([]).mockResolvedValueOnce([{ email: "buyer@example.com" }]);

    await ensureInvoice({
      userId: "u1",
      gateway: "mercadopago",
      externalId: "pay-1",
      importe: 6080,
    });

    expect(txExecute).toHaveBeenCalled();
    // `sql\`...\`` no stringea a texto legible (da "[object Object]"); el SQL
    // real vive en `queryChunks`, que sí serializa.
    const lockCall = txExecute.mock.calls[0][0];
    expect(JSON.stringify(lockCall)).toContain("pg_advisory_xact_lock");
  });
});
