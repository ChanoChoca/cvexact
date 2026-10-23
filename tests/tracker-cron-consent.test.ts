import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/tracker/cron` — el gate de consentimiento del aviso de
 * ghosting por correo (`docs/tracker-plan.md`, sección 8). Mockea todo lo
 * que la ruta orquesta (`markGhostedApplications`, `listDueReminders`,
 * `sendMail`, `hasTrackerMailConsent`) para aislar una sola cosa: que el
 * correo de ghosting respeta el consentimiento y el de recordatorio no, y
 * que la detección en sí (`markGhostedApplications`) corre siempre, con o
 * sin consentimiento — el gate es sólo el canal de correo.
 */

const GHOSTED = [{ id: "app-1", userId: "u1", jobTitle: "Backend Node", company: "Acme" }];
const DUE_REMINDERS = [
  { id: "rem-1", userId: "u1", applicationId: "app-1", kind: "follow_up", message: null, jobTitle: "Backend Node", company: "Acme" },
];

let ghostedResult: typeof GHOSTED = [];
let dueRemindersResult: typeof DUE_REMINDERS = [];
let trackerMailConsent = false;

const markGhostedApplications = vi.fn(async () => ghostedResult);
const listDueReminders = vi.fn(async () => dueRemindersResult);
const markReminderSent = vi.fn(async () => {});
const sendMail = vi.fn(async (mail: { to: string; kind: string; subject: string }) => Boolean(mail));
const hasTrackerMailConsent = vi.fn(async () => trackerMailConsent);

vi.mock("@/lib/tracker/ghosting", () => ({ markGhostedApplications }));
vi.mock("@/lib/tracker/reminders", () => ({ listDueReminders, markReminderSent }));
vi.mock("@/lib/email/mailer", () => ({ sendMail }));
vi.mock("@/lib/legal/consent", () => ({ hasTrackerMailConsent }));
vi.mock("@/lib/email/templates", () => ({
  ghostingMail: (to: string) => ({ to, kind: "tracker", subject: "ghosting-stub", text: "", html: "" }),
  followUpMail: (to: string) => ({ to, kind: "tracker", subject: "followup-stub", text: "", html: "" }),
}));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  return {
    databaseConfigured: true,
    schema,
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: async () => [{ id: "u1", email: "user@example.com", emailVerified: true }],
        }),
      }),
    }),
  };
});

/**
 * Como lo llama el CronJob: por el Service del clúster, sin `cf-ray`. Con uno,
 * la ruta se niega — ver tests/internal-only-routes.test.ts.
 */
const cronRequest = () =>
  new Request("http://cvexact/api/tracker/cron", { method: "POST", headers: { "x-origin-auth": "secreto" } });

beforeEach(() => {
  ghostedResult = [];
  dueRemindersResult = [];
  trackerMailConsent = false;
  markGhostedApplications.mockClear();
  listDueReminders.mockClear();
  markReminderSent.mockClear();
  sendMail.mockClear();
  hasTrackerMailConsent.mockClear();
});

describe("POST /api/tracker/cron — consentimiento del aviso de ghosting", () => {
  it("sin consentimiento, no manda el correo de ghosting pero sí detecta y marca", async () => {
    ghostedResult = GHOSTED;
    trackerMailConsent = false;

    const { POST } = await import("@/app/api/tracker/cron/route");
    const response = await POST(cronRequest());
    const body = await response.json();

    expect(markGhostedApplications).toHaveBeenCalledTimes(1);
    expect(body.ghosted).toBe(1);
    expect(body.ghostedMailed).toBe(0);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("con consentimiento, manda el correo de ghosting", async () => {
    ghostedResult = GHOSTED;
    trackerMailConsent = true;

    const { POST } = await import("@/app/api/tracker/cron/route");
    const response = await POST(cronRequest());
    const body = await response.json();

    expect(body.ghosted).toBe(1);
    expect(body.ghostedMailed).toBe(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({ subject: "ghosting-stub" });
  });

  it("el recordatorio se manda sin importar el consentimiento del aviso de ghosting", async () => {
    dueRemindersResult = DUE_REMINDERS;
    trackerMailConsent = false;

    const { POST } = await import("@/app/api/tracker/cron/route");
    const response = await POST(cronRequest());
    const body = await response.json();

    expect(body.dueReminders).toBe(1);
    expect(body.remindersSent).toBe(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({ subject: "followup-stub" });
    expect(markReminderSent).toHaveBeenCalledWith("rem-1");
  });
});
