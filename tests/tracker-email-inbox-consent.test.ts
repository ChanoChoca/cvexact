import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";

/**
 * `activateEmailInbox`/`revokeEmailInbox` (`lib/tracker/email-inbox.ts`), con
 * foco en la constancia de consentimiento que dejó de vivir sólo en
 * `emailInbox.consentAt` — ver el comentario de `recordTrackerMailInboxConsent`
 * en `lib/legal/consent.ts` para el porqué: esa fila de `consent` es la única
 * prueba de que hubo base legal para procesar correspondencia de terceros ya
 * procesada, y tiene que sobrevivir a que la casilla se apague.
 *
 * `drizzle-orm/pg-proxy` contra el schema real, en vez de mocks de cadena —
 * mismo criterio que `tests/tracker-reminders.test.ts`: SQL real, sin una
 * Postgres detrás, y ambos módulos comparten la misma `db` de este mock, así
 * que la llamada real de `activateEmailInbox` a `recordTrackerMailInboxConsent`
 * (no mockeada aparte) se ve acá como el `insert into "consent"` que es.
 */

const captured: Array<{ sql: string; params: unknown[] }> = [];

/** `null` = sin fila todavía; si no, el array posicional que espera pg-proxy
 *  en el orden de columnas de `emailInbox`: id, user_id, alias, verified_at,
 *  consent_at, created_at. */
let existingInboxRow: unknown[] | null = null;
/** Filas de `application` que `revokeEmailInbox` encuentra para el usuario. */
let applicationRows: unknown[][] = [];

const db = drizzle(async (sqlText, params) => {
  captured.push({ sql: sqlText, params });

  if (sqlText.startsWith("select") && sqlText.includes('from "email_inbox"')) {
    return { rows: existingInboxRow ? [existingInboxRow] : [] };
  }
  if (sqlText.startsWith("update") && sqlText.includes('"email_inbox"')) {
    const updated = [...(existingInboxRow as unknown[])];
    updated[4] = params[0]; // consent_at es el único campo que setea el UPDATE
    return { rows: [updated] };
  }
  if (sqlText.startsWith("insert into \"email_inbox\"")) {
    // id, user_id, alias, verified_at, consent_at, created_at — el orden en
    // que `activateEmailInbox` arma `.values(...)`, más `created_at` por
    // default. Alcanza con que el shape sea el correcto: nada de este test
    // lee el valor de vuelta.
    return { rows: [[params[0], params[1], params[2], null, params[3], new Date()]] };
  }
  if (sqlText.startsWith("insert into \"consent\"")) {
    return { rows: [] }; // ON CONFLICT DO NOTHING, sin RETURNING
  }
  if (sqlText.startsWith("select") && sqlText.includes('from "application"')) {
    return { rows: applicationRows };
  }
  if (sqlText.startsWith("delete") && sqlText.includes('"application_event"')) {
    return { rows: [] };
  }
  if (sqlText.startsWith("delete") && sqlText.includes('"email_inbox"')) {
    return { rows: [] };
  }
  throw new Error(`consulta no esperada en el test: ${sqlText}`);
});

vi.mock("@/lib/db", async () => ({
  databaseConfigured: true,
  getDb: () => db,
  schema: await import("@/lib/db/schema"),
}));

const { activateEmailInbox, revokeEmailInbox } = await import("@/lib/tracker/email-inbox");
const { LEGAL_VERSION } = await import("@/lib/legal/operator");

beforeEach(() => {
  captured.length = 0;
  existingInboxRow = null;
  applicationRows = [];
  process.env.TRACKER_EMAIL_DOMAIN = "tracker.cvexact.com";
});

afterEach(() => {
  delete process.env.TRACKER_EMAIL_DOMAIN;
});

function consentInserts() {
  return captured.filter((c) => c.sql.startsWith("insert into \"consent\""));
}

describe("activateEmailInbox — alta nueva", () => {
  it("deja constancia versionada en consent, además de consentAt", async () => {
    await activateEmailInbox("u1");

    const inserts = consentInserts();
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params).toEqual(["u1", "tracker_mail_inbox", LEGAL_VERSION]);
  });
});

describe("activateEmailInbox — fila existente sin consentimiento todavía", () => {
  it("también deja constancia, en el mismo paso que actualiza consentAt", async () => {
    existingInboxRow = ["inbox-1", "u1", "u_abc123@tracker.cvexact.com", null, null, new Date("2026-08-01T00:00:00.000Z")];

    await activateEmailInbox("u1");

    expect(consentInserts()).toHaveLength(1);
    const update = captured.find((c) => c.sql.startsWith("update") && c.sql.includes('"email_inbox"'));
    expect(update).toBeDefined();
  });
});

describe("activateEmailInbox — ya estaba activa", () => {
  it("no vuelve a escribir nada: ni update ni una fila de consent nueva", async () => {
    existingInboxRow = [
      "inbox-1",
      "u1",
      "u_abc123@tracker.cvexact.com",
      null,
      new Date("2026-08-01T00:00:00.000Z"), // ya tiene consentAt
      new Date("2026-07-01T00:00:00.000Z"),
    ];

    await activateEmailInbox("u1");

    expect(consentInserts()).toHaveLength(0);
    expect(captured.some((c) => c.sql.startsWith("update"))).toBe(false);
  });
});

describe("revokeEmailInbox", () => {
  it("borra el alias, pero nunca toca la tabla consent", async () => {
    applicationRows = [];

    await revokeEmailInbox("u1");

    expect(captured.some((c) => c.sql.startsWith("delete") && c.sql.includes('"email_inbox"'))).toBe(
      true,
    );
    // La aserción central de este archivo: revocar la casilla no borra la
    // constancia de que el consentimiento existió.
    expect(captured.some((c) => c.sql.toLowerCase().includes("consent"))).toBe(false);
  });

  it("borra los eventos derivados de email, pero sigue sin tocar consent", async () => {
    applicationRows = [["app-1"], ["app-2"]];

    await revokeEmailInbox("u1");

    const eventDelete = captured.find(
      (c) => c.sql.startsWith("delete") && c.sql.includes('"application_event"'),
    );
    expect(eventDelete).toBeDefined();
    expect(eventDelete?.sql).toContain('"detected_from"');
    expect(captured.some((c) => c.sql.toLowerCase().includes("consent"))).toBe(false);
  });
});
