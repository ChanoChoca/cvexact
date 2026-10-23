import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";

/**
 * `GET /api/sync?export=account` es lo que hace cierta la cláusula 8 de la
 * política de privacidad: «Bajar de mi cuenta te descarga todo lo que tenemos
 * tuyo». Este archivo fija dos cosas.
 *
 * Que estén todas las secciones: en la auditoría legal del 2026-09-18 faltaban
 * la configuración de alertas de empleo, los recordatorios (con su texto libre),
 * el estado de la extensión y los contadores de uso, y el seguimiento no traía
 * el texto del aviso ni la ubicación ni el salario. Cada tabla nueva con
 * `user_id` tiene que sumarse acá o figurar como excepción en la cláusula 8.
 *
 * Y que no salgan las credenciales: ni el hash de la contraseña ni el del token
 * de la extensión. Sirven para autenticar, no son «datos tuyos», y un archivo
 * descargable es justo donde no deben aparecer.
 *
 * Se maneja la ruta real con un driver proxy que registra el SQL (mismo recurso
 * que tests/sync-scope.test.ts): lo que se fija es lo que la ruta consulta, no
 * una copia de la consulta escrita en el test.
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

const user = { id: "user-propio", email: "yo@ejemplo.com", name: "Yo", emailVerified: true };

vi.mock("@/lib/auth", () => ({
  getSessionUser: async () => user,
  requiresVerification: () => false,
  authConfigured: true,
}));

function exportRequest() {
  return new Request("http://localhost/api/sync?export=account", {
    headers: { "x-forwarded-for": "203.0.113.9" },
  });
}

/** El SELECT que lee una tabla, buscado por el identificador entrecomillado. */
function selectFrom(table: string): string {
  const found = captured.find((q) => q.sql.includes(`from "${table}"`));
  if (!found) throw new Error(`no se consultó "${table}"; se consultó:\n${captured.map((q) => q.sql).join("\n")}`);
  return found.sql;
}

beforeEach(() => {
  captured.length = 0;
  vi.resetModules();
});

describe("export de cuenta", () => {
  it("trae todas las secciones, también las que antes faltaban", async () => {
    const { GET } = await import("@/app/api/sync/route");
    const response = await GET(exportRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    for (const section of [
      "account",
      "sessions",
      "creditPurchases",
      "consents",
      "legalRequests",
      "trackerApplications",
      "trackerEvents",
      "trackerContacts",
      "trackerReminders",
      "cvVersions",
      "emailInbox",
      "jobAlert",
      "extensionToken",
      "usageCounters",
    ]) {
      expect(body, `falta la sección ${section}`).toHaveProperty(section);
    }
  });

  it("lee las tablas que la cláusula 8 promete entregar", async () => {
    const { GET } = await import("@/app/api/sync/route");
    await GET(exportRequest());

    for (const table of ["job_alert", "application_reminder", "extension_token", "usage_counter"]) {
      expect(() => selectFrom(table), `no se consulta ${table}`).not.toThrow();
    }
  });

  it("el seguimiento incluye el texto del aviso, la ubicación y el salario", async () => {
    const { GET } = await import("@/app/api/sync/route");
    await GET(exportRequest());

    // El SELECT del tracker es el que pide `job_title`; el de `pull()` sólo `data`.
    const tracker = captured.find(
      (q) => q.sql.includes('from "application"') && q.sql.includes('"job_title"'),
    );
    expect(tracker, "no se consultó el seguimiento").toBeDefined();
    for (const column of ["jd_text", "location", "salary_min", "salary_max", "currency"]) {
      expect(tracker!.sql).toContain(`"${column}"`);
    }
  });

  it("no entrega credenciales: ni el hash de la contraseña ni el del token de la extensión", async () => {
    const { GET } = await import("@/app/api/sync/route");
    await GET(exportRequest());

    const everything = captured.map((q) => q.sql).join("\n");
    expect(everything).not.toContain('"token_hash"');
    expect(everything).not.toContain('"password"');
    // Y del token de la extensión sí se lee cuándo se creó y se usó.
    const extension = selectFrom("extension_token");
    expect(extension).toContain('"created_at"');
    expect(extension).toContain('"last_used_at"');
  });

  it("los contadores cubren las cuatro formas de subject, las mismas que borra la baja", async () => {
    const { GET } = await import("@/app/api/sync/route");
    await GET(exportRequest());

    const counters = captured.find((q) => q.sql.includes('from "usage_counter"'));
    expect(counters, "no se consultó usage_counter").toBeDefined();
    // Lo que va como parámetro es lo que se compara: las cuatro formas que
    // `purgeUsageCounterForUser` borra (tests/quota.test.ts).
    expect(counters!.params).toEqual(
      expect.arrayContaining([
        "user:user-propio",
        "user:user-propio:%",
        "byok:user:user-propio",
        "byok:user:user-propio:%",
      ]),
    );
  });
});
