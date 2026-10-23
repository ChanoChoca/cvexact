import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regresión del punto que hizo separar `app_rate_limit` de `rate_limit`.
 *
 * Better Auth poda su tabla en cada request con un cutoff de
 * `max(window, 10, 60)` segundos y sin mirar `customRules`
 * (`better-auth/dist/api/rate-limiter/index.mjs`, `deleteExpiredRows`). Cuando
 * los buckets propios vivían en esa tabla compartida, cualquier ventana propia
 * mayor a un minuto — las reglas de correo de 3600 s, los buckets de 600 s de
 * `export-pdf` o `/api/sync` — se borraba bajo sus pies apenas un pedido
 * disparaba la poda: lo que decía "5 por hora" era 5 por minuto.
 *
 * Lo que fija este archivo es exactamente el escenario que antes no cumplía:
 * borrar las filas viejas de `rate_limit` NO reabre un bucket propio de ventana
 * larga. Contra Postgres real, el equivalente manual es consumir un bucket de
 * 3600 s, correr `DELETE FROM rate_limit WHERE last_request < ...`, y comprobar
 * que el bucket sigue negando.
 *
 * El mock reemplaza Postgres por dos Maps, uno por tabla, elegidos por la
 * identidad del objeto de tabla que `consumeInDatabase` le pasa a `.insert()`:
 * es justo esa elección — y no la semántica de la ventana, cubierta en
 * tests/rate-limit.test.ts contra memoria — lo que se quiere fijar.
 */

vi.mock("@/lib/db", async () => {
  const authRows = new Map<string, { count: number; lastRequest: number }>();
  const appRows = new Map<string, { count: number; lastRequest: number }>();

  /** Sustitutos mínimos de los objetos pgTable: consumeInDatabase accede a
   *  `.lastRequest` para armar el SQL, y acá nunca se ejecuta. */
  const authTable = Symbol("rate_limit");
  const appTable = Symbol("app_rate_limit");
  const stores = new Map<unknown, typeof authRows>([
    [appTable, appRows],
    [authTable, authRows],
  ]);

  function insert(table: unknown) {
    // Fallar ruidosamente ante una tabla desconocida: sería un fourth writer
    // apareciendo de la nada.
    const rows = stores.get(table);
    if (!rows) throw new Error("upsert contra una tabla que no era ninguna de las dos");

    let key = "";
    let freshCount = 1;
    return {
      values(value: { id: string; key: string; count: number }) {
        key = value.key;
        freshCount = value.count;
        return this;
      },
      onConflictDoUpdate() {
        return this;
      },
      async returning() {
        const existing = rows.get(key);
        // Todos los consumes caen en el mismo milisegundo (la ventana no pasa),
        // así que replicar el case-when completo es incrementar a secas.
        rows.set(key, {
          count: (existing?.count ?? 0) + freshCount,
          lastRequest: existing?.lastRequest ?? Date.now(),
        });
        const row = rows.get(key)!;
        return [{ count: row.count, lastRequest: row.lastRequest }];
      },
    };
  }

  return {
    databaseConfigured: true,
    getDb: () => ({ insert }),
    // rate-limit.ts sólo lee schema.appRateLimit — lo demás no interfiere.
    schema: { appRateLimit: appTable },
    /** Costura de test: las filas que Better Auth tendría en SU tabla. */
    __betterAuthRows: authRows,
    /** Y las filas propias, para verificar dónde cayeron. */
    __appRows: appRows,
  };
});

describe("consume contra la base", () => {
  /** El mock añade estas costuras; el módulo real no las tiene. */
  type FakeDbModule = typeof import("@/lib/db") & {
    __betterAuthRows: Map<string, { count: number; lastRequest: number }>;
    __appRows: Map<string, { count: number; lastRequest: number }>;
  };

  // La factory de vi.mock corre una sola vez por archivo: sin esta limpieza,
  // los buckets del primer caso se cuelan en el segundo.
  beforeEach(async () => {
    const db = (await import("@/lib/db")) as FakeDbModule;
    db.__appRows.clear();
    db.__betterAuthRows.clear();
  });

  it("usa app_rate_limit, nunca rate_limit de Better Auth", async () => {
    const db = (await import("@/lib/db")) as FakeDbModule;
    const { consume } = await import("@/lib/rate-limit");

    await consume("k", { window: 3600, max: 1 });

    expect(db.__appRows.size).toBe(1);
    // Si algún bucket propio volviera a caer en la tabla podada, este es el
    // primer lugar donde se nota.
    expect(db.__betterAuthRows.size).toBe(0);
  });

  it("una ventana de 3600 s sigue negando después de podar rate_limit", async () => {
    const db = (await import("@/lib/db")) as FakeDbModule;
    const { consume } = await import("@/lib/rate-limit");
    const rule = { window: 3600, max: 1 };

    expect(await consume("k", rule)).toEqual({ ok: true });
    expect((await consume("k", rule)).ok).toBe(false);

    // La poda de Better Auth: borra de SU tabla toda fila con más de 60 s...
    db.__betterAuthRows.clear();
    // ...y mientras tanto otro pedido repuebla esa misma tabla.
    db.__betterAuthRows.set("user-alguien|/sign-in/email", {
      count: 1,
      lastRequest: Date.now(),
    });

    // El bucket propio está intacto, así que sigue negando. Con la tabla
    // compartida de antes, esta tercera llamada habría vuelto count=1 y pasado.
    expect((await consume("k", rule)).ok).toBe(false);
    expect(db.__appRows.get("k")?.count).toBe(3);
  });
});

