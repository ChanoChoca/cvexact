import { describe, expect, it } from "vitest";
import { creditExpiryDate, CREDIT_EXPIRY_MONTHS } from "@/lib/quota";

/**
 * `creditExpiryDate` es lo que `grantCredits` usa para fechar el vencimiento
 * de una compra nueva (cláusula 4 de los términos, `scripts/prune.mjs` es
 * quien de verdad lo hace cumplir). Verificado acá porque `Date#setUTCMonth`
 * no clampea un día que no existe en el mes de destino — 31 de enero + 1 mes
 * no es "28 o 29 de febrero", es "3 de marzo" — y es el tipo de borde que
 * conviene fijar con un test y no descubrir en producción.
 */
describe("creditExpiryDate", () => {
  it(`suma ${CREDIT_EXPIRY_MONTHS} meses en el caso general`, () => {
    const from = new Date("2026-08-29T12:00:00.000Z");
    expect(creditExpiryDate(from).toISOString()).toBe("2028-08-29T12:00:00.000Z");
  });

  it("no clampea un día que no existe en el mes de destino: rueda hacia adelante", () => {
    const from = new Date("2026-01-31T00:00:00.000Z");
    // 24 meses desde el 31 de enero de 2026 caen en enero de 2028, que sí
    // tiene 31 días — así que este caso no ejercita el desborde. Se fuerza
    // acá con un vencimiento de un solo mes para probar el comportamiento de
    // `setUTCMonth`, no el de la constante real.
    const oneMonthLater = new Date(from);
    oneMonthLater.setUTCMonth(oneMonthLater.getUTCMonth() + 1);
    expect(oneMonthLater.toISOString()).toBe("2026-03-03T00:00:00.000Z");
  });

  it("no muta la fecha que recibe", () => {
    const from = new Date("2026-08-29T12:00:00.000Z");
    const before = from.toISOString();
    creditExpiryDate(from);
    expect(from.toISOString()).toBe(before);
  });

  it("sin argumento, parte de ahora", () => {
    // Cota inferior y superior calculadas con el mismo `setUTCMonth`, no con
    // una ventana de días aproximada: la duración de 24 meses varía según en
    // qué mes se pare el reloj, así que una ventana en milisegundos sería o
    // floja o flaky según el día que corra el test.
    const before = creditExpiryDate(new Date());
    const result = creditExpiryDate();
    const after = creditExpiryDate(new Date());
    expect(result.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
