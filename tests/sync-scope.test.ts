import { readFileSync, readdirSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import { emptyProfile } from "@/lib/schemas/profile";

/**
 * Every write in `/api/sync` has to be scoped to the account that made the
 * request.
 *
 * The upload path was the one exception: its `onConflictDoUpdate` targeted the
 * bare primary key, so an uploaded application whose id collided with someone
 * else's row would overwrite that row's `data` and `label` while it stayed
 * owned by the victim. Ids are `crypto.randomUUID()`, which makes hitting one
 * blindly impractical — but unguessability is not access control, and the
 * deletes right below it were already scoped correctly.
 *
 * This drives the real route through a proxy driver that records SQL instead of
 * running it, so what is pinned is what the route emits, not a copy of the
 * query rewritten in the test.
 */

const captured: Array<{ sql: string; params: unknown[] }> = [];

const db = drizzle(async (sql, params) => {
  captured.push({ sql, params });
  return { rows: [] };
});

vi.mock("@/lib/db", async () => ({
  databaseConfigured: false,
  getDb: () => db,
  schema: await import("@/lib/db/schema"),
}));

const user = { id: "user-propio", email: "yo@ejemplo.com", name: "Yo", emailVerified: true };

vi.mock("@/lib/auth", () => ({
  getSessionUser: async () => user,
  requiresVerification: () => false,
  authConfigured: true,
}));

function upload(applications: Array<Record<string, unknown>>) {
  return new Request("http://localhost/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify({ profile: emptyProfile(), applications }),
  });
}

/** The single statement that upserts one application. */
function upsertStatement() {
  const found = captured.find((q) => q.sql.includes('insert into "application"'));
  if (!found) throw new Error(`no upsert emitted; got:\n${captured.map((q) => q.sql).join("\n")}`);
  return found;
}

beforeEach(() => {
  captured.length = 0;
  vi.resetModules();
});

describe("subir postulaciones", () => {
  it("acota el DO UPDATE al dueño de la fila", async () => {
    const { POST } = await import("@/app/api/sync/route");
    await POST(upload([{ id: "app-1", label: "Una" }]));

    const { sql, params } = upsertStatement();
    const doUpdate = sql.slice(sql.indexOf("do update"));

    // Sin este `where`, el update alcanza cualquier fila con ese id, sea de
    // quien sea.
    expect(doUpdate).toContain("where");
    expect(doUpdate).toContain('"user_id"');
    expect(params).toContain(user.id);
  });

  it("el id del dueño sale de la sesión, no del cuerpo", async () => {
    const { POST } = await import("@/app/api/sync/route");
    // Un atacante que manda `userId` en la postulación no debería poder
    // atribuirse ni cederle la fila a nadie.
    await POST(upload([{ id: "app-1", label: "Una", userId: "victima" }]));

    const { params } = upsertStatement();
    expect(params).toContain(user.id);
    expect(params).not.toContain("victima");
  });

  it("las bajas siguen acotadas al dueño", async () => {
    const { POST } = await import("@/app/api/sync/route");
    const request = new Request("http://localhost/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile: emptyProfile(),
        applications: [],
        deletedIds: ["app-de-otro"],
      }),
    });
    await POST(request);

    const del = captured.find((q) => q.sql.includes('delete from "application"'));
    expect(del).toBeDefined();
    expect(del?.sql).toContain('"user_id"');
    expect(del?.params).toContain(user.id);
  });
});

describe("bajar postulaciones", () => {
  it("filtra por el usuario de la sesión", async () => {
    const { GET } = await import("@/app/api/sync/route");
    await GET(new Request("http://localhost/api/sync"));

    const reads = captured.filter((q) => q.sql.startsWith("select"));
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.sql, read.sql).toContain('"user_id"');
      expect(read.params).toContain(user.id);
    }
  });
});

describe("el esquema", () => {
  it("borra en cascada todo lo que cuelga de una cuenta", () => {
    // Borrar una cuenta no tiene hook propio: se apoya entera en estas
    // constraints. Si alguna perdiera el `cascade`, el borrado fallaría con un
    // error de clave foránea — o, con `set null`, dejaría los datos huérfanos
    // en la base después de haberle dicho al usuario que los borramos.
    const sql = readdirSync("lib/db/migrations")
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(`lib/db/migrations/${name}`, "utf8"))
      .join("\n");

    for (const table of [
      "profile",
      "application",
      "application_tombstone",
      "session",
      "account",
      "credit_purchase",
    ]) {
      const constraint = new RegExp(
        `alter table "${table}"[^;]*foreign key \\("user_id"\\)[^;]*on delete cascade`,
        "i",
      );
      expect(sql, `${table} debería borrarse junto con su usuario`).toMatch(constraint);
    }
  });
});
