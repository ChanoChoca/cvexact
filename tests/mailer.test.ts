import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The mailer's contract is mostly about what it must *not* do.
 *
 * Every caller is inside a Better Auth flow that has already committed — the
 * user is created, the reset token is stored — so an SMTP failure that
 * propagated would turn a delivery problem into a half-made account. And
 * without SMTP configured the whole thing has to stay inert rather than
 * pretending to send, because `lib/auth.ts` decides whether to *offer*
 * verification and password reset by the same flag.
 *
 * Además del SMTP, `sendMail` consulta el presupuesto de correo antes de tocar
 * el transporte (`lib/email/budget.ts`) — ese punto único de estrangulamiento
 * es lo que impide que el próximo flujo que mande correo se olvide del tope.
 */

const sendMailMock = vi.fn();

vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}));

import { resetPasswordMail, verificationMail } from "@/lib/email/templates";

/**
 * Carga mailer y rate-limit contra el MISMO grafo de módulos recién reseteado,
 * así el `resetRateLimitMemory` de acá abajo limpia exactamente las memorias
 * que va a usar `sendMail`.
 */
async function loadMailer() {
  vi.resetModules();
  const [mailer, rateLimit] = await Promise.all([
    import("@/lib/email/mailer"),
    import("@/lib/rate-limit"),
  ]);
  rateLimit.resetRateLimitMemory();
  return { ...mailer, rateLimit };
}

const letter = {
  to: "alguien@ejemplo.com",
  kind: "unsolicited",
  subject: "Confirmá tu correo",
  text: "https://ejemplo.com/verificar?token=secreto",
  html: "<a>ir</a>",
} as const;

beforeEach(() => {
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ messageId: "1" });
  process.env.SMTP_HOST = "smtp.ejemplo.com";
  process.env.MAIL_FROM = "cvexact <hola@ejemplo.com>";
});

afterEach(() => {
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_FROM;
  delete process.env.SMTP_PORT;
  vi.restoreAllMocks();
});

describe("mailConfigured", () => {
  it("es verdadero con host y remitente", async () => {
    expect((await loadMailer()).mailConfigured).toBe(true);
  });

  it("es falso sin host", async () => {
    delete process.env.SMTP_HOST;
    expect((await loadMailer()).mailConfigured).toBe(false);
  });

  it("es falso sin remitente: un envío sin `from` lo rebota cualquier servidor", async () => {
    delete process.env.MAIL_FROM;
    expect((await loadMailer()).mailConfigured).toBe(false);
  });
});

describe("sendMail", () => {
  it("manda cuando está configurado", async () => {
    const { sendMail } = await loadMailer();
    await expect(sendMail(letter)).resolves.toBe(true);

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0]).toMatchObject({
      to: letter.to,
      subject: letter.subject,
      from: "cvexact <hola@ejemplo.com>",
    });
  });

  it("no intenta nada sin configuración", async () => {
    delete process.env.SMTP_HOST;
    const { sendMail } = await loadMailer();
    await expect(sendMail(letter)).resolves.toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("se traga el error de un SMTP caído", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendMailMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const { sendMail } = await loadMailer();
    // Si esto tirara, un servidor de correo caído haría fallar el alta de una
    // cuenta que ya quedó creada en la base. `false` — no entregado — es la
    // señal que el cron del tracker necesita para no marcar `sent_at`.
    await expect(sendMail(letter)).resolves.toBe(false);
  });

  it("no escribe el cuerpo en el log: lleva un token de un solo uso", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    sendMailMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const { sendMail } = await loadMailer();
    await sendMail(letter);

    const output = logged.mock.calls.flat().join(" ");
    // Quien tenga el log no debería necesitar la casilla.
    expect(output).not.toContain("secreto");
    expect(output).not.toContain(letter.text);
  });
});

describe("presupuesto de envío", () => {
  it("manda tres correos por destinatario en una hora y corta el cuarto", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendMail } = await loadMailer();
    const to = "repetido@ejemplo.com";

    await sendMail(verificationMail(to, "https://ejemplo.com/uno"));
    await sendMail(verificationMail(to, "https://ejemplo.com/dos"));
    await sendMail(verificationMail(to, "https://ejemplo.com/tres"));
    expect(sendMailMock).toHaveBeenCalledTimes(3);

    await sendMail(verificationMail(to, "https://ejemplo.com/cuatro"));
    // Como un SMTP caído: descartado sin tirar ni fingir envío.
    expect(sendMailMock).toHaveBeenCalledTimes(3);
  });

  it("pasada la reserva diaria, la verificación se descarta y el reset sale", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendMail } = await loadMailer();

    // Agotar todo lo que el correo "unsolicited" puede gastar del presupuesto
    // compartido: 45 al día (bajó de 60 cuando se sumó el gate de "tracker" —
    // ver lib/email/budget.ts, el tope duro del plan free de Resend son 100).
    // Cada uno a una dirección distinta para que sea exactamente el gate
    // compartido lo que corte después, no el tope por casilla.
    for (let i = 0; i < 45; i += 1) {
      await sendMail(verificationMail(`persona${i}@ejemplo.com`, "https://ejemplo.com/v"));
    }
    expect(sendMailMock).toHaveBeenCalledTimes(45);

    // El correo 46 no solicitado NO pasa: su clase se quedó sin parte.
    await sendMail(verificationMail("verificacion@ejemplo.com", "https://ejemplo.com/v"));
    expect(sendMailMock).toHaveBeenCalledTimes(45);
    // La señal para alertar es el log: tipo de mail y tope alcanzado, nunca
    // la dirección.
    const output = logged.mock.calls.flat().join(" ");
    expect(output).toContain("unsolicited");
    expect(output).not.toContain("verificacion@ejemplo.com");
    expect(output).not.toContain("persona44@ejemplo.com");

    // En cambio el de cuenta sale: es lo que la reserva existe para proteger.
    // Que alguien llene el alta de direcciones inventadas no le saca a un
    // usuario real el reset de contraseña.
    await sendMail(resetPasswordMail("reseteo@ejemplo.com", "https://ejemplo.com/reset"));
    expect(sendMailMock).toHaveBeenCalledTimes(46);
  });
});
