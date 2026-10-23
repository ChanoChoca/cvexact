import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import { listDueReminders, markReminderSent } from "@/lib/tracker/reminders";

/**
 * `markGhostedApplications` no está acá — abre una transacción, que
 * `drizzle-orm/pg-proxy` no soporta (ver el comentario de
 * `tests/tracker-scope.test.ts`). Se verificó a mano contra un Postgres
 * real durante esta tarea: sólo marca lo realmente viejo, deja el evento
 * con `detected_from = 'sistema'`, y no toca lo que no corresponde.
 */

const captured: Array<{ sql: string; params: unknown[] }> = [];
const REMINDER_ROW = ["rem-1", "u1", "app-1", "follow_up", "Escribirle a RRHH", "Backend", "Acme"];

const db = drizzle(async (sqlText, params) => {
  captured.push({ sql: sqlText, params });
  if (sqlText.startsWith("select") && sqlText.includes('from "application_reminder"')) {
    return { rows: [REMINDER_ROW] };
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
});

describe("listDueReminders", () => {
  it("hace join con application y filtra por vencido, no enviado, no descartado", async () => {
    const due = await listDueReminders(new Date("2026-01-01T00:00:00.000Z"));
    expect(due).toEqual([
      {
        id: "rem-1",
        userId: "u1",
        applicationId: "app-1",
        kind: "follow_up",
        message: "Escribirle a RRHH",
        jobTitle: "Backend",
        company: "Acme",
      },
    ]);
    const query = captured[0].sql;
    expect(query).toContain('inner join "application"');
    expect(query).toContain('"due_at"');
    expect(query).toContain('"sent_at" is null');
    expect(query).toContain('"dismissed" = $');
  });
});

describe("markReminderSent", () => {
  it("actualiza sent_at por id", async () => {
    await markReminderSent("rem-1", new Date("2026-01-02T00:00:00.000Z"));
    const update = captured.find((c) => c.sql.startsWith('update "application_reminder"'));
    expect(update?.sql).toContain('"id" = $');
    expect(update?.params).toContain("rem-1");
  });
});
