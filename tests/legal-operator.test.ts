import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `lib/legal/operator.ts`, centrado en la trampa de secuencia de la auditoría
 * legal de 2026-09 (la auditoría legal interna, Bloque 1): el Secret de
 * producción tenía `LEGAL_RNBD_NUMBER` cargado con un número de EXPEDIENTE
 * GDE ("EX-2026-83681646- -APN-DNPDP#AAIP"), no un número de inscripción.
 * Antes de este archivo, nada distinguía uno de otro — `isPlaceholder()` sólo
 * ataja `"[pendiente de carga]"` y `"XXXXX"` — así que ese valor se
 * renderizaba en la cláusula 8 de privacidad como "La base está inscripta
 * ... bajo el número EX-2026-...": la misma afirmación falsa de inscripción
 * que el propio `isPlaceholder()` existe para evitar (B1 de la auditoría),
 * con otro texto.
 *
 * `salesEnabled` se mockea a `false`, como hace `tests/legal-request.test.ts`
 * para el caso contrario: esta instalación es BYOK-only en producción, y sin
 * el mock el resultado dependería del entorno ambiente de quien corre la
 * suite en vez de ser determinístico.
 */

vi.mock("@/lib/payments/sales", () => ({ salesEnabled: false }));

const { operator, operatorConfigured, rnbdStatus } = await import("@/lib/legal/operator");

const REAL_PROD_EXPEDIENTE = "EX-2026-83681646- -APN-DNPDP#AAIP";

const ENV_KEYS = [
  "LEGAL_OPERATOR_NAME",
  "LEGAL_OPERATOR_ADDRESS",
  "LEGAL_OPERATOR_TAX_ID",
  "LEGAL_CONTACT_EMAIL",
  "LEGAL_RNBD_NUMBER",
  "LEGAL_RNBD_FILE",
] as const;

beforeEach(() => {
  // Identidad válida en las tres, para aislar lo que cada test de RNBD
  // realmente varía.
  process.env.LEGAL_OPERATOR_NAME = "Ana Pérez";
  process.env.LEGAL_CONTACT_EMAIL = "legal@cvexact.com";
  delete process.env.LEGAL_RNBD_NUMBER;
  delete process.env.LEGAL_RNBD_FILE;
  delete process.env.LEGAL_OPERATOR_ADDRESS;
  delete process.env.LEGAL_OPERATOR_TAX_ID;
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("un expediente GDE nunca pasa por número de inscripción", () => {
  it("el expediente real que estuvo cargado en producción se trata como ausente", () => {
    process.env.LEGAL_RNBD_NUMBER = REAL_PROD_EXPEDIENTE;

    expect(operator().rnbdNumber).toBeNull();
    // Esta es la aserción que le pone nombre al bug: nunca "inscripto" con
    // un expediente cargado en el campo del número.
    expect(rnbdStatus()).toBe("en trámite");
  });

  it("detecta el formato con cualquier capitalización", () => {
    process.env.LEGAL_RNBD_NUMBER = REAL_PROD_EXPEDIENTE.toLowerCase();
    expect(operator().rnbdNumber).toBeNull();
  });

  it("un número de inscripción real —sin el prefijo EX-AAAA-— sí se acepta", () => {
    process.env.LEGAL_RNBD_NUMBER = "RNBD-2026-004821";
    expect(operator().rnbdNumber).toBe("RNBD-2026-004821");
    expect(rnbdStatus()).toBe("inscripto");
  });
});

describe("rnbdFile — el expediente, mostrado aparte mientras no hay inscripción", () => {
  it("se expone en rnbdFile y NO hace que rnbdStatus diga inscripto", () => {
    process.env.LEGAL_RNBD_FILE = REAL_PROD_EXPEDIENTE;

    expect(operator().rnbdFile).toBe(REAL_PROD_EXPEDIENTE);
    expect(operator().rnbdNumber).toBeNull();
    expect(rnbdStatus()).toBe("en trámite");
  });

  it("el placeholder de la plantilla de despliegue (XXXXX) se trata como ausente", () => {
    process.env.LEGAL_RNBD_FILE = "XXXXX";
    expect(operator().rnbdFile).toBeNull();
  });
});

describe("regresión: los placeholders ya atajados siguen atajados", () => {
  it('"XXXXX" en LEGAL_RNBD_NUMBER se trata como ausente', () => {
    process.env.LEGAL_RNBD_NUMBER = "XXXXX";
    expect(operator().rnbdNumber).toBeNull();
    expect(rnbdStatus()).toBe("en trámite");
  });

  it("vacío se trata como ausente", () => {
    expect(operator().rnbdNumber).toBeNull();
    expect(rnbdStatus()).toBe("en trámite");
  });
});

describe("operatorConfigured() ya no depende del RNBD", () => {
  /**
   * El otro lado de la trampa de secuencia: antes, vaciar `LEGAL_RNBD_NUMBER`
   * —lo correcto, mientras el trámite sigue abierto— hacía que
   * `operatorConfigured()` diera `false` para siempre, sin relación con si la
   * identidad del responsable estaba completa. `legal` en `/api/health` tiene
   * que poder dar `true` con el RNBD "en trámite": ese es un estado honesto
   * para publicar, no una falta de cumplimiento.
   */
  it("da true con nombre y correo cargados, aunque el RNBD esté vacío", () => {
    expect(operator().rnbdNumber).toBeNull();
    expect(operatorConfigured()).toBe(true);
  });

  it("sigue dando false si falta la identidad, con o sin RNBD", () => {
    delete process.env.LEGAL_OPERATOR_NAME;
    expect(operatorConfigured()).toBe(false);

    process.env.LEGAL_OPERATOR_NAME = "Ana Pérez";
    process.env.LEGAL_RNBD_NUMBER = "RNBD-2026-004821";
    expect(operatorConfigured()).toBe(true);
  });
});

describe("address — el domicilio del responsable, con o sin venta", () => {
  /**
   * El art. 6 b) de la Ley 25.326 pide informar «la identidad y domicilio de su
   * responsable» al recolectar datos, se venda algo o no. Antes `address` era
   * `salesEnabled ? read(...) : null`: con la venta apagada —que es lo que corre en
   * producción— cargar `LEGAL_OPERATOR_ADDRESS` no hacía nada, y la cláusula 1 de
   * privacidad no tenía cómo publicarlo. Estos tests fijan las dos mitades: sin venta
   * se publica cuando se carga, y no cambia nada mientras no se cargue.
   */
  it("sin venta, se publica en cuanto se carga", () => {
    process.env.LEGAL_OPERATOR_ADDRESS = "Av. Siempreviva 742, CABA";
    expect(operator().address).toBe("Av. Siempreviva 742, CABA");
  });

  it("sin venta y sin cargar es null, no «[pendiente de carga]»", () => {
    // Un "[pendiente de carga]" acá se vería en la página, resaltado, justo donde
    // hoy la cláusula 1 no dice nada. La ausencia tiene que ser silenciosa.
    expect(operator().address).toBeNull();
  });

  it("el placeholder de la plantilla de despliegue (XXXXX) se trata como ausente", () => {
    process.env.LEGAL_OPERATOR_ADDRESS = "XXXXX";
    expect(operator().address).toBeNull();
  });

  it("no lo exige operatorConfigured(): que falte no apaga `legal` en /api/health", () => {
    expect(operator().address).toBeNull();
    expect(operatorConfigured()).toBe(true);
  });
});

describe("con venta, el domicilio y el CUIT siguen siendo obligatorios y visibles si faltan", () => {
  /**
   * La otra mitad de la misma línea: el cambio de arriba no puede aflojar lo que ya
   * exigía la venta. Módulo aparte porque `salesEnabled` se evalúa al importar.
   */
  afterEach(() => {
    vi.doUnmock("@/lib/payments/sales");
    vi.resetModules();
  });

  it("falta el domicilio: se ve como pendiente y operatorConfigured() da false", async () => {
    vi.resetModules();
    vi.doMock("@/lib/payments/sales", () => ({ salesEnabled: true }));
    const withSales = await import("@/lib/legal/operator");

    process.env.LEGAL_OPERATOR_TAX_ID = "20-12345678-9";
    expect(withSales.operator().address).toBe("[pendiente de carga]");
    expect(withSales.operatorConfigured()).toBe(false);

    process.env.LEGAL_OPERATOR_ADDRESS = "Av. Siempreviva 742, CABA";
    expect(withSales.operator().address).toBe("Av. Siempreviva 742, CABA");
    expect(withSales.operatorConfigured()).toBe(true);
  });
});
