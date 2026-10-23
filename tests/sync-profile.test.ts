import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import { storedProfileSchema } from "@/lib/schemas/profile-v2";
import { migrateV1 } from "@/lib/profile/migrate";
import { toPlainProfile } from "@/lib/profile/project";
import { devProfile } from "./fixtures";

/**
 * The profile crosses to the server in two shapes and must be able to come back
 * in both: current browsers speak the stored profile, and a tab left open across
 * a deploy still speaks the plain one. Neither may lose the other's data, and a
 * plain upload must not throw away the provenance the account already holds.
 *
 * Drives the real route through a proxy driver that records SQL, like
 * `sync-scope.test.ts`; here the `profile` row it answers with is configurable.
 */

const captured: Array<{ sql: string; params: unknown[] }> = [];
let profileRow: unknown[][] = [];

const db = drizzle(async (sql, params) => {
  captured.push({ sql, params });
  if (sql.startsWith("select") && sql.includes('from "profile"')) return { rows: profileRow };
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

const post = (body: unknown) =>
  new Request("http://localhost/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify(body),
  });

/** The profile document the route wrote, parsed back out of the insert's parameters. */
type StoredDocument = {
  version: number;
  contact: Record<string, { value: string; status: string; original?: string; source?: { kind: string } }>;
};

function storedDocument(): StoredDocument {
  const insert = captured.find((q) => q.sql.includes('insert into "profile"'));
  if (!insert) throw new Error(`no profile upsert emitted; got:\n${captured.map((q) => q.sql).join("\n")}`);
  const json = insert.params.find((p) => typeof p === "string" && p.startsWith('{"version"'));
  if (typeof json !== "string") throw new Error("no profile document among the parameters");
  return JSON.parse(json);
}

beforeEach(() => {
  captured.length = 0;
  profileRow = [];
  vi.resetModules();
});

describe("subir el perfil", () => {
  it("guarda el perfil con procedencia tal como llega", async () => {
    const { POST } = await import("@/app/api/sync/route");
    const stored = migrateV1(devProfile);
    stored.contact.fullName.source = { kind: "cv", at: "2026-09-21T00:00:00.000Z" };

    const response = await POST(post({ profileV2: stored, applications: [] }));

    expect(response.status).toBe(200);
    const doc = storedDocument();
    expect(doc.version).toBe(2);
    expect(doc.contact.fullName).toMatchObject({ value: "Juan Pérez", source: { kind: "cv" } });
  });

  it("acepta el perfil plano de un navegador viejo y lo guarda en el formato actual", async () => {
    const { POST } = await import("@/app/api/sync/route");
    const response = await POST(post({ profile: devProfile, applications: [] }));

    expect(response.status).toBe(200);
    const doc = storedDocument();
    expect(doc.version).toBe(2);
    expect(doc.contact.fullName.value).toBe("Juan Pérez");
    expect(toPlainProfile(storedProfileSchema.parse(doc))).toEqual(devProfile);
  });

  it("aplica un perfil plano como edición sobre el que ya hay, sin perder la procedencia", async () => {
    const existing = migrateV1(devProfile);
    existing.contact.fullName.source = { kind: "cv", at: "2026-09-21T00:00:00.000Z" };
    profileRow = [[existing]];

    const { POST } = await import("@/app/api/sync/route");
    await POST(post({ profile: { ...devProfile, city: "Córdoba" }, applications: [] }));

    const doc = storedDocument();
    // Lo que no cambió conserva de dónde vino…
    expect(doc.contact.fullName.source?.kind).toBe("cv");
    // …y lo que cambió queda como editado, con el original.
    expect(doc.contact.city).toMatchObject({ value: "Córdoba", status: "edited", original: "Rosario" });
  });

  it("no guarda el historial, lo archivado ni los nombres de archivo: borrar es borrar", async () => {
    const { POST } = await import("@/app/api/sync/route");
    const stored = migrateV1(devProfile);
    stored.history.push({ id: "h1", at: "2026-09-21T00:00:00.000Z", op: "set", path: ["contact", "city"] });
    stored.archive.push({ id: "a1", at: "2026-09-21T00:00:00.000Z", kind: "skill", parentPath: ["skills"], entity: { id: "s", name: { value: "Borrada" } }, label: "Borrada" });
    stored.sources.push({ id: "s1", kind: "cv", name: "juan-perez-cv-2026.pdf", fileHash: "abc", pasted: false, chars: 10, importedAt: "2026-09-21T00:00:00.000Z" });

    const response = await POST(post({ profileV2: stored, applications: [] }));

    expect(response.status).toBe(200);
    const written = JSON.stringify(storedDocument());
    expect(written).not.toContain("Borrada");
    expect(written).not.toContain("juan-perez-cv-2026.pdf");
    const doc = storedDocument() as unknown as { history: unknown[]; archive: unknown[]; sources: Array<{ name: string; fileHash: string }> };
    expect(doc.history).toEqual([]);
    expect(doc.archive).toEqual([]);
    // What identifies the file survives, so the same one is not read twice on the next device.
    expect(doc.sources).toEqual([expect.objectContaining({ name: "", fileHash: "abc" })]);
  });

  it("tampoco lo guarda si llega por el camino del navegador viejo", async () => {
    const existing = migrateV1(devProfile);
    existing.archive.push({ id: "a1", at: "2026-09-21T00:00:00.000Z", kind: "skill", parentPath: ["skills"], entity: { id: "s", name: { value: "Borrada" } }, label: "Borrada" });
    profileRow = [[existing]];
    const { POST } = await import("@/app/api/sync/route");
    await POST(post({ profile: { ...devProfile, city: "Córdoba" }, applications: [] }));
    expect(JSON.stringify(storedDocument())).not.toContain("Borrada");
  });

  it("rechaza un cuerpo sin perfil", async () => {
    const { POST } = await import("@/app/api/sync/route");
    const response = await POST(post({ applications: [] }));
    expect(response.status).toBe(400);
    expect(captured.some((q) => q.sql.includes('insert into "profile"'))).toBe(false);
  });

  it("rechaza un perfil que no es de ninguna versión conocida, sin vaciar el de la cuenta", async () => {
    const { POST } = await import("@/app/api/sync/route");
    const response = await POST(post({ profileV2: { version: 9, contact: {} }, applications: [] }));
    expect(response.status).toBe(400);
    expect(captured.some((q) => q.sql.includes('insert into "profile"'))).toBe(false);
  });

  it("rechaza un perfil plano roto", async () => {
    const { POST } = await import("@/app/api/sync/route");
    const response = await POST(post({ profile: { experience: "no es una lista" }, applications: [] }));
    expect(response.status).toBe(400);
  });
});

describe("bajar el perfil", () => {
  it("entrega una fila del formato de antes en el formato actual, y también en el plano", async () => {
    profileRow = [[JSON.parse(JSON.stringify(devProfile))]];
    const { GET } = await import("@/app/api/sync/route");

    const payload = await (await GET(new Request("http://localhost/api/sync"))).json();

    expect(payload.profileV2.version).toBe(2);
    expect(payload.profileV2.contact.fullName.value).toBe("Juan Pérez");
    expect(payload.profile).toEqual(devProfile);
  });

  it("entrega una fila del formato actual, y su proyección plana para un navegador viejo", async () => {
    const stored = migrateV1(devProfile);
    profileRow = [[JSON.parse(JSON.stringify(stored))]];
    const { GET } = await import("@/app/api/sync/route");

    const payload = await (await GET(new Request("http://localhost/api/sync"))).json();

    expect(payload.profileV2).toEqual(stored);
    expect(payload.profile).toEqual(devProfile);
  });

  it("no manda un perfil cuando la cuenta no tiene uno", async () => {
    const { GET } = await import("@/app/api/sync/route");
    const payload = await (await GET(new Request("http://localhost/api/sync"))).json();
    expect(payload.profileV2).toBeNull();
    expect(payload.profile).toBeNull();
  });

  it("no manda un perfil que no se puede leer, en vez de mandar uno vacío", async () => {
    profileRow = [[{ version: 9, contact: {} }]];
    const { GET } = await import("@/app/api/sync/route");
    const payload = await (await GET(new Request("http://localhost/api/sync"))).json();
    expect(payload.profileV2).toBeNull();
    expect(payload.profile).toBeNull();
  });
});

describe("preguntar solo por el perfil", () => {
  // Quien ingresa y abre la entrada o su perfil pregunta si la cuenta tiene uno para traer: no necesita el historial
  // entero —hasta 500 postulaciones y lo borrado— para eso, y lo pregunta cada vez.
  it("con `?only=profile` entrega el perfil y nada más, sin ir a buscar las postulaciones", async () => {
    const stored = migrateV1(devProfile);
    profileRow = [[JSON.parse(JSON.stringify(stored))]];
    const { GET } = await import("@/app/api/sync/route");

    const response = await GET(new Request("http://localhost/api/sync?only=profile"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(payload)).toEqual(["profileV2"]);
    expect(payload.profileV2).toEqual(stored);
    expect(captured.some((query) => /application/.test(query.sql))).toBe(false);
  });

  it("con `?only=profile`, una cuenta sin perfil o con uno ilegible da `null`, igual que la consulta completa", async () => {
    const { GET } = await import("@/app/api/sync/route");
    expect(await (await GET(new Request("http://localhost/api/sync?only=profile"))).json()).toEqual({ profileV2: null });

    profileRow = [[{ version: 9, contact: {} }]];
    expect(await (await GET(new Request("http://localhost/api/sync?only=profile"))).json()).toEqual({ profileV2: null });
  });

  it("con cualquier otro valor, o sin él, entrega todo como siempre", async () => {
    const { GET } = await import("@/app/api/sync/route");
    for (const url of ["http://localhost/api/sync", "http://localhost/api/sync?only=applications"]) {
      const payload = await (await GET(new Request(url))).json();
      expect(Object.keys(payload).sort()).toEqual(["applications", "deletedIds", "profile", "profileV2"]);
    }
  });
});
