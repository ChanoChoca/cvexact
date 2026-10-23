import { describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";

/**
 * The Postgres path of `consume()`, driven through a proxy driver that records
 * SQL instead of running it — same technique as `tests/sync-scope.test.ts`.
 *
 * This exists because of a real incident: `consumeInDatabase` used to write to
 * Better Auth's own `rate_limit` table. Better Auth prunes that table on every
 * request with a cutoff of `max(window, 10, 60)` seconds, blind to any rule
 * living alongside it (`better-auth/dist/api/rate-limiter/index.mjs`,
 * `deleteExpiredRows`) — so a multi-hour window written there was deleted out
 * from under itself within a minute of any request landing anywhere in the
 * app. The fix is a table of our own, `app_rate_limit`; this test is the
 * regression guard for that separation.
 */

const captured: Array<{ sql: string; params: unknown[] }> = [];

const db = drizzle(async (sql, params) => {
  captured.push({ sql, params });
  return { rows: [] };
});

vi.mock("@/lib/db", async () => ({
  databaseConfigured: true,
  getDb: () => db,
  schema: await import("@/lib/db/schema"),
}));

describe("consume, contra Postgres", () => {
  it("escribe en app_rate_limit, no en la tabla de Better Auth", async () => {
    captured.length = 0;
    const { consume } = await import("@/lib/rate-limit");

    await consume("un-sujeto|una-ruta", { window: 3600, max: 5 });

    const statements = captured.map((c) => c.sql).join("\n");
    expect(statements).toContain('"app_rate_limit"');
    // La sub-cadena sin comillas de apertura aparecería igual dentro de
    // "app_rate_limit"; lo que no debe aparecer es el identificador propio de
    // Better Auth, entrecomillado.
    expect(statements).not.toContain('"rate_limit"');
  });
});
