import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import { resetRateLimitMemory } from "@/lib/rate-limit";

/**
 * `/api/tracker/applications` de punta a punta, sin una base real — mismo
 * patrón que `tests/jobs-feed-route.test.ts`. Cubre lo que las rutas en sí
 * mismas aportan por encima de `lib/tracker/service.ts` (ya probado a fondo
 * en `tests/tracker-scope.test.ts` y contra Postgres real durante esta
 * tarea): el orden de guardas, la validación de zod, y que sin sesión no se
 * llega ni a mirar la base.
 */

let sessionUser: { id: string; email: string; name: string; emailVerified: boolean } | null = {
  id: "u1",
  email: "user@example.com",
  name: "Usuaria",
  emailVerified: true,
};

vi.mock("@/lib/auth", () => ({
  getSessionUser: async () => sessionUser,
  requiresVerification: () => false,
}));

const captured: Array<{ sql: string; params: unknown[] }> = [];
let applicationRows: unknown[][] = [];
let rateLimitCount = 0;

const APPLICATION_ROW_TEMPLATE = [
  "a1", "u1", "Backend Node", {}, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z",
  "Backend Node", "Acme", "acme", "buscador_interno", null, "https://example.com/job", null, null,
  "CABA", true, null, null, null, "guardado", null, "2026-01-01T00:00:00.000Z", null, 0, false,
];

const db = drizzle(async (sqlText, params) => {
  captured.push({ sql: sqlText, params });
  if (sqlText.includes('insert into "app_rate_limit"')) {
    rateLimitCount += 1;
    return { rows: [[rateLimitCount, Date.now()]] };
  }
  if (sqlText.startsWith("insert into \"application\"")) {
    return { rows: [APPLICATION_ROW_TEMPLATE] };
  }
  if (sqlText.startsWith("select") && sqlText.includes('from "application"')) {
    return { rows: applicationRows };
  }
  return { rows: [] };
});

vi.mock("@/lib/db", async () => ({
  databaseConfigured: true,
  getDb: () => db,
  schema: await import("@/lib/db/schema"),
}));

beforeEach(() => {
  captured.length = 0;
  applicationRows = [APPLICATION_ROW_TEMPLATE];
  rateLimitCount = 0;
  resetRateLimitMemory();
  sessionUser = { id: "u1", email: "user@example.com", name: "Usuaria", emailVerified: true };
  vi.resetModules();
});

describe("GET /api/tracker/applications", () => {
  it("401 sin sesión, y no toca la base", async () => {
    sessionUser = null;
    const { GET } = await import("@/app/api/tracker/applications/route");
    const response = await GET(new Request("http://localhost/api/tracker/applications"));
    expect(response.status).toBe(401);
    expect(captured).toHaveLength(0);
  });

  it("200 con sesión, filtra por user_id en el SQL generado", async () => {
    const { GET } = await import("@/app/api/tracker/applications/route");
    const response = await GET(new Request("http://localhost/api/tracker/applications?status=guardado,postulado"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applications).toHaveLength(1);
    const listQuery = captured.find((c) => c.sql.startsWith("select"));
    expect(listQuery?.sql).toContain('"application"."user_id"');
  });
});

describe("POST /api/tracker/applications", () => {
  it("400 con un body inválido", async () => {
    const { POST } = await import("@/app/api/tracker/applications/route");
    const response = await POST(
      new Request("http://localhost/api/tracker/applications", {
        method: "POST",
        body: JSON.stringify({ salaryMin: -5 }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("201 crea la postulación y la asocia al usuario de la sesión", async () => {
    const { POST } = await import("@/app/api/tracker/applications/route");
    const response = await POST(
      new Request("http://localhost/api/tracker/applications", {
        method: "POST",
        body: JSON.stringify({ jobTitle: "Backend Node", company: "Acme", status: "guardado" }),
      }),
    );
    expect(response.status).toBe(201);
    const insertQuery = captured.find((c) => c.sql.startsWith("insert into \"application\""));
    expect(insertQuery).toBeDefined();
    expect(insertQuery?.params).toContain("u1");
  });
});
