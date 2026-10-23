import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";

/**
 * El flujo completo (generar, rotar, revocar, `getApiUser` de punta a
 * punta) se verificó contra un Postgres real durante esta tarea. Acá sólo
 * los casos borde que no necesitan una base real: un header ausente, uno
 * mal formado, y un token con el prefijo equivocado nunca llegan a
 * consultar nada.
 */

const captured: Array<{ sql: string; params: unknown[] }> = [];

const db = drizzle(async (sqlText, params) => {
  captured.push({ sql: sqlText, params });
  return { rows: [] };
});

vi.mock("@/lib/db", async () => ({
  databaseConfigured: true,
  getDb: () => db,
  schema: await import("@/lib/db/schema"),
}));

vi.mock("@/lib/auth", () => ({ getSessionUser: async () => null }));

beforeEach(() => {
  captured.length = 0;
});

describe("getApiUser", () => {
  it("sin header authorization, no consulta la base", async () => {
    const { getApiUser } = await import("@/lib/tracker/extension-auth");
    const user = await getApiUser(new Headers());
    expect(user).toBeNull();
    expect(captured).toHaveLength(0);
  });

  it("un header authorization que no es Bearer, no consulta la base", async () => {
    const { getApiUser } = await import("@/lib/tracker/extension-auth");
    const user = await getApiUser(new Headers({ authorization: "Basic abc123" }));
    expect(user).toBeNull();
    expect(captured).toHaveLength(0);
  });

  it("un token sin el prefijo esperado, no consulta la base", async () => {
    const { getApiUser } = await import("@/lib/tracker/extension-auth");
    const user = await getApiUser(new Headers({ authorization: "Bearer no-tiene-el-prefijo" }));
    expect(user).toBeNull();
    expect(captured).toHaveLength(0);
  });

  it("un token con el prefijo correcto pero que no existe, sí consulta y no encuentra nada", async () => {
    const { getApiUser } = await import("@/lib/tracker/extension-auth");
    const user = await getApiUser(new Headers({ authorization: "Bearer cvt_algoquenoexiste" }));
    expect(user).toBeNull();
    expect(captured.some((c) => c.sql.includes('from "extension_token"'))).toBe(true);
  });
});
