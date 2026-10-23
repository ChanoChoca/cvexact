import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Las rutas que sólo llaman los CronJobs no pueden ser alcanzables desde
 * internet.
 *
 * `/api/tracker/cron` y `/api/jobs/alerts/send` decían «internal-only» en un
 * comentario y no lo hacían cumplir con nada: `proxy.ts` sólo pide
 * `X-Origin-Auth`, y la Transform Rule de Cloudflare se lo agrega a TODO el
 * tráfico público. Comprobado contra producción el 2026-09-18: un GET público
 * devolvía 405 —llegaba a la ruta— en vez de 403.
 *
 * Por eso el pedido "de un visitante" de estas pruebas trae `x-origin-auth`
 * además de `cf-ray`: es lo que de verdad llega a la ruta cuando alguien la
 * llama por `https://cvexact.com`, y es justo el caso que el secreto solo no
 * frena. Lo que las diferencia del CronJob es el camino, no una credencial.
 */

const GHOSTED = [{ id: "app-1", userId: "u1", jobTitle: "Backend Node", company: "Acme" }];

const markGhostedApplications = vi.fn(async () => GHOSTED);
const listDueReminders = vi.fn(async () => []);
const markReminderSent = vi.fn(async () => {});
const sendMail = vi.fn(async () => true);
const hasTrackerMailConsent = vi.fn(async () => false);
const hasJobAlertsConsent = vi.fn(async () => false);

/** Sin alertas ni cuentas: lo que se mira es si se llegó a tocar la base. */
const getDb = vi.fn(() => ({
  select: () => ({
    from: () => Object.assign(Promise.resolve([]), { where: async () => [] }),
  }),
}));

vi.mock("@/lib/tracker/ghosting", () => ({ markGhostedApplications }));
vi.mock("@/lib/tracker/reminders", () => ({ listDueReminders, markReminderSent }));
vi.mock("@/lib/email/mailer", () => ({ sendMail }));
vi.mock("@/lib/legal/consent", () => ({ hasTrackerMailConsent, hasJobAlertsConsent }));
vi.mock("@/lib/email/templates", () => ({
  ghostingMail: (to: string) => ({ to, kind: "tracker", subject: "ghosting-stub", text: "", html: "" }),
  followUpMail: (to: string) => ({ to, kind: "tracker", subject: "followup-stub", text: "", html: "" }),
  jobAlertMail: (to: string) => ({ to, kind: "job_alert", subject: "alert-stub", text: "", html: "" }),
}));
vi.mock("@/lib/db", async () => ({
  databaseConfigured: true,
  schema: await import("@/lib/db/schema"),
  getDb,
}));

/** El pedido de un CronJob: por el Service del clúster, con el secreto y sin `cf-ray`. */
function fromCronJob(path: string) {
  return new Request(`http://cvexact${path}`, {
    method: "POST",
    headers: { "x-origin-auth": "el-secreto-compartido" },
  });
}

/** El pedido de un visitante: por Cloudflare, que le agrega el secreto Y el `cf-ray`. */
function fromTheInternet(path: string) {
  return new Request(`https://cvexact.com${path}`, {
    method: "POST",
    headers: { "x-origin-auth": "el-secreto-compartido", "cf-ray": "8a1b2c3d4e5f6789-EZE" },
  });
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("rejectIfViaPublicEdge", () => {
  it("deja pasar un pedido sin cf-ray", async () => {
    const { rejectIfViaPublicEdge } = await import("@/lib/api/internal-only");
    expect(rejectIfViaPublicEdge(fromCronJob("/api/tracker/cron"))).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("rechaza con 403 un pedido con cf-ray, aunque traiga el secreto correcto", async () => {
    const { rejectIfViaPublicEdge } = await import("@/lib/api/internal-only");

    const refused = rejectIfViaPublicEdge(fromTheInternet("/api/tracker/cron"));

    expect(refused?.status).toBe(403);
    // Sin nada que describa cómo se decide, igual que `proxy.ts`.
    expect(await refused?.text()).toBe("Forbidden");
  });

  it("deja rastro de quién golpeó, sin volcar headers", async () => {
    const { rejectIfViaPublicEdge } = await import("@/lib/api/internal-only");

    rejectIfViaPublicEdge(fromTheInternet("/api/jobs/alerts/send"));

    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("POST /api/jobs/alerts/send");
    // Ni el secreto ni el identificador del pedido van al log.
    expect(line).not.toContain("el-secreto-compartido");
    expect(line).not.toContain("8a1b2c3d4e5f6789");
  });

  it("no distingue mayúsculas en el nombre del header", async () => {
    const { rejectIfViaPublicEdge } = await import("@/lib/api/internal-only");
    const request = new Request("https://cvexact.com/api/tracker/cron", {
      method: "POST",
      headers: { "CF-RAY": "abc" },
    });
    expect(rejectIfViaPublicEdge(request)?.status).toBe(403);
  });
});

describe("POST /api/tracker/cron", () => {
  it("rechaza al visitante y no corre nada: ni la base, ni el ghosting, ni el correo", async () => {
    const { POST } = await import("@/app/api/tracker/cron/route");

    const response = await POST(fromTheInternet("/api/tracker/cron"));

    expect(response.status).toBe(403);
    expect(getDb).not.toHaveBeenCalled();
    expect(markGhostedApplications).not.toHaveBeenCalled();
    expect(listDueReminders).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("deja pasar al CronJob y corre la pasada diaria", async () => {
    const { POST } = await import("@/app/api/tracker/cron/route");

    const response = await POST(fromCronJob("/api/tracker/cron"));

    expect(response.status).toBe(200);
    expect(markGhostedApplications).toHaveBeenCalledTimes(1);
    expect(listDueReminders).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/jobs/alerts/send", () => {
  it("rechaza al visitante y no toca la base", async () => {
    const { POST } = await import("@/app/api/jobs/alerts/send/route");

    const response = await POST(fromTheInternet("/api/jobs/alerts/send"));

    expect(response.status).toBe(403);
    expect(getDb).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("deja pasar al CronJob y devuelve los contadores", async () => {
    const { POST } = await import("@/app/api/jobs/alerts/send/route");

    const response = await POST(fromCronJob("/api/jobs/alerts/send"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 0, due: 0, total: 0 });
    expect(getDb).toHaveBeenCalled();
  });
});
