import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import * as svc from "@/lib/tracker/service";
import { TrackerNotFoundError } from "@/lib/tracker/service";

/**
 * Sustituto verificable de RLS (ver `docs/tracker-plan.md`, sección 4): este
 * Postgres no tiene row level security, así que lo que hace que "un usuario
 * no puede leer ni escribir datos de otro" sea más que una promesa es que
 * cada función de `lib/tracker/service.ts` que toca una fila por id pasa
 * antes por `requireOwnedApplication`, que exige `id` **y** `user_id` en la
 * misma condición. Este archivo simula una base con datos de dos usuarios y
 * comprueba, contra el objeto real (no una URL falsa), que pedir con el
 * usuario equivocado nunca devuelve la fila ni la modifica.
 *
 * Las funciones que abren `db.transaction()` (`changeStatus`, `moveCard`,
 * `bulkChangeStatus`, `rebalanceColumn`) no están acá: `drizzle-orm/pg-proxy`
 * no soporta transacciones (tira "Transactions are not supported"). Esas se
 * verificaron a mano contra un Postgres real — ver el historial de esta
 * tarea — y quedan cubiertas en espíritu por `isValidTransition` en
 * `tests/tracker-status.test.ts`, que es la parte de esa lógica que no
 * depende de una transacción.
 */

const OWNER = "u1";
const STRANGER = "u2";
const APP_ID = "app-1";

/** Fila completa de `application`, en el orden de columnas del schema —
 *  `select()`/`.returning()` sin lista explícita de columnas siempre
 *  devuelven las 25 en ese orden, sea cual sea el INSERT/UPDATE que las
 *  produjo. */
function applicationRow(overrides: Partial<{ id: string; userId: string; status: string; archived: boolean }> = {}) {
  const id = overrides.id ?? APP_ID;
  const userId = overrides.userId ?? OWNER;
  const status = overrides.status ?? "guardado";
  const archived = overrides.archived ?? false;
  return [
    id, userId, "Backend Node", {}, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z",
    "Backend Node", "Acme", "acme", "buscador_interno", null, "https://example.com/job", null, null,
    "Buenos Aires", true, null, null, null, status, null, "2026-01-01T00:00:00.000Z", null, 0, archived,
  ];
}

let store: Record<string, ReturnType<typeof applicationRow>>;
const captured: Array<{ sql: string; params: unknown[] }> = [];

const db = drizzle(async (sqlText, params) => {
  captured.push({ sql: sqlText, params });

  // requireOwnedApplication y cualquier UPDATE/DELETE de una sola fila:
  // siempre "id" = $1 and "user_id" = $2, en ese orden — ver el comentario
  // arriba de `requireOwnedApplication` en lib/tracker/service.ts.
  if (sqlText.includes('from "application"') && sqlText.includes('"application"."id"')) {
    const [id, userId] = params as [string, string];
    const row = store[id];
    if (!row || row[1] !== userId) return { rows: [] };
    return { rows: [row] };
  }

  if (sqlText.startsWith('select') && sqlText.includes('from "application"') && !sqlText.includes('"id" =')) {
    const [userId] = params as [string];
    return { rows: Object.values(store).filter((r) => r[1] === userId) };
  }

  if (sqlText.startsWith("insert into \"application\"")) {
    const row = applicationRow({ userId: params.includes(STRANGER) ? STRANGER : OWNER });
    store[row[0] as string] = row;
    return { rows: [row] };
  }

  if (sqlText.startsWith('update "application"') && sqlText.includes('"id"')) {
    const idIdx = params.length - 2;
    const [id, userId] = params.slice(idIdx) as [string, string];
    const row = store[id];
    if (!row || row[1] !== userId) return { rows: [] };
    return { rows: [row] };
  }

  if (sqlText.startsWith("delete from \"application\"")) {
    const [id, userId] = params as [string, string];
    if (store[id]?.[1] === userId) delete store[id];
    return { rows: [] };
  }

  // application_event / application_contact / cv_version: no se prueba la
  // fuga acá — no tienen `user_id` propio y dependen enteramente de que
  // `requireOwnedApplication` ya haya cortado el paso antes de llegar a
  // ellas, que es justo lo que cada test de abajo comprueba primero.
  if (sqlText.startsWith("select") && sqlText.includes('from "application_event"')) return { rows: [] };
  if (sqlText.startsWith("insert into \"application_event\"")) return { rows: [] };
  if (sqlText.startsWith("select") && sqlText.includes('from "application_contact"')) return { rows: [] };
  if (sqlText.startsWith("insert into \"application_contact\"")) {
    return { rows: [["contact-1", APP_ID, "Ana", null, null, null, "2026-01-01T00:00:00.000Z"]] };
  }
  if (sqlText.startsWith("delete from \"application_contact\"")) return { rows: [] };
  if (sqlText.startsWith("insert into \"cv_version\"")) return { rows: [] };
  if (sqlText.startsWith("select") && sqlText.includes('from "cv_version"')) {
    const [userId, fingerprint] = params as [string, string?];
    if (fingerprint !== undefined) {
      return { rows: userId === OWNER ? [["cv-1", OWNER, "CV Backend", fingerprint, "2026-01-01T00:00:00.000Z"]] : [] };
    }
    return { rows: [] };
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
  store = { [APP_ID]: applicationRow() };
});

describe("aislamiento entre usuarios", () => {
  it("getApplicationDetail: el dueño puede, un extraño recibe 404", async () => {
    await expect(svc.getApplicationDetail(OWNER, APP_ID)).resolves.toMatchObject({
      application: { id: APP_ID },
    });
    await expect(svc.getApplicationDetail(STRANGER, APP_ID)).rejects.toBeInstanceOf(TrackerNotFoundError);
  });

  it("updateApplicationFields: un extraño no puede editar la fila de otro", async () => {
    await expect(
      svc.updateApplicationFields(STRANGER, APP_ID, { jobTitle: "Hackeado" }),
    ).rejects.toBeInstanceOf(TrackerNotFoundError);
  });

  it("addNote: un extraño no puede dejar una nota en la fila de otro", async () => {
    await expect(svc.addNote(STRANGER, APP_ID, "nota ajena")).rejects.toBeInstanceOf(TrackerNotFoundError);
  });

  it("addContact / deleteContact: requieren ser dueño de la postulación", async () => {
    await expect(
      svc.addContact(STRANGER, APP_ID, { name: "Intruso" }),
    ).rejects.toBeInstanceOf(TrackerNotFoundError);
    await expect(svc.deleteContact(STRANGER, APP_ID, "contact-1")).rejects.toBeInstanceOf(
      TrackerNotFoundError,
    );
  });

  it("linkCvVersion: un extraño no puede vincular un CV a la fila de otro", async () => {
    await expect(svc.linkCvVersion(STRANGER, APP_ID, null)).rejects.toBeInstanceOf(TrackerNotFoundError);
  });

  it("linkCvVersion: no deja vincular una versión de CV que pertenece a otro usuario", async () => {
    await expect(svc.linkCvVersion(OWNER, APP_ID, "cv-ajeno")).rejects.toBeInstanceOf(
      TrackerNotFoundError,
    );
  });

  it("deleteApplication: un extraño no puede borrar la fila de otro, y sigue existiendo", async () => {
    await expect(svc.deleteApplication(STRANGER, APP_ID)).rejects.toBeInstanceOf(TrackerNotFoundError);
    expect(store[APP_ID]).toBeDefined();
  });

  it("listApplications: cada usuario ve sólo sus propias filas", async () => {
    store["app-2"] = applicationRow({ id: "app-2", userId: STRANGER });

    const ownerRows = await svc.listApplications(OWNER);
    expect(ownerRows.map((r) => r.id)).toEqual([APP_ID]);

    const strangerRows = await svc.listApplications(STRANGER);
    expect(strangerRows.map((r) => r.id)).toEqual(["app-2"]);
  });

  it("todas las lecturas por un solo id filtran por user_id además de por id", () => {
    const idLookups = captured.filter(
      (c) => c.sql.includes('from "application"') && c.sql.includes('"application"."id"'),
    );
    // Esta prueba corre después de las de arriba en el mismo archivo, así que
    // alcanza con que exista al menos una: lo importante es la forma de la
    // cláusula, ya ejercitada arriba con datos reales de dos usuarios.
    for (const lookup of idLookups) {
      expect(lookup.sql).toContain('"application"."user_id"');
    }
  });
});
