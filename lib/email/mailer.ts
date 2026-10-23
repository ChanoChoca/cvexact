import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

import { reserveMailBudget } from "@/lib/email/budget";

/**
 * Outbound mail, over plain SMTP.
 *
 * SMTP rather than a vendor SDK because every account-security flow below needs
 * exactly one thing — deliver a link to an address — and that is the one thing
 * every provider speaks. Swapping Mailgun for Zoho for a container running
 * Postfix is then a change to the environment, not to this file.
 *
 * Like `authConfigured` and `mercadoPagoConfigured`, mail is optional and the
 * absence is a supported state rather than a misconfiguration: without SMTP the
 * app behaves exactly as it did before any of this existed. What must never
 * happen is a half-configured one — a signup that believes it sent a
 * verification mail that no one will ever receive — so every flow that depends
 * on delivery checks `mailConfigured` first.
 */

export const mailConfigured = Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);

function create(): Transporter {
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port,
    // Implicit TLS on 465, STARTTLS everywhere else. Declaring it beats guessing
    // wrong on a provider that only offers one of the two.
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    // A local relay (Mailpit in dev, a sidecar Postfix) usually wants no auth at
    // all, and handing nodemailer `{ user: undefined }` makes it try anyway.
    auth: user && pass ? { user, pass } : undefined,
  });
}

let cached: Transporter | null = null;

function getTransport(): Transporter {
  cached ??= create();
  return cached;
}

/**
 * Qué clase de mail es, para el presupuesto de envío (`lib/email/budget.ts`).
 *
 * - `unsolicited`: cualquiera puede dispararlo contra cualquier dirección sin
 *   probar que la controla — el alta y el reenvío de verificación. Es el vector
 *   de flood barato.
 * - `account`: exige una cuenta existente y un pedido que sólo su dueño puede
 *   hacer — reset de contraseña, confirmación de borrado, aviso de lockout.
 *   Es el correo que nunca debe faltarle a alguien real; el presupuesto lo
 *   protege con reserva propia.
 * - `job_alert`: exige cuenta, perfil sincronizado y un consentimiento propio
 *   (cláusula 14 de privacidad), pero no es un correo de seguridad — perderlo
 *   un día no deja a nadie sin poder entrar a su cuenta. Tiene su propia
 *   reserva, más chica que la de `account`, para que un día con muchas
 *   alertas para mandar nunca le saque presupuesto a un reset de contraseña.
 * - `tracker`: recordatorios de seguimiento y el aviso de ghosting
 *   (`scripts/tracker-cron.mjs`). Mismo trato que `job_alert` — exige cuenta
 *   y nace de algo que el usuario ya hizo (guardó una postulación, puso un
 *   recordatorio), nunca de una dirección elegida por un desconocido — con
 *   su propia reserva para que un día con muchos recordatorios vencidos no
 *   le saque presupuesto a un reset de contraseña.
 */
export type MailKind = "unsolicited" | "account" | "job_alert" | "tracker";

export type Mail = {
  to: string;
  kind: MailKind;
  subject: string;
  text: string;
  html: string;
};

/**
 * Sends a message, or gives up quietly.
 *
 * Before the transport sees anything, the send is booked against the mail
 * budget (`lib/email/budget.ts`). This being the single choke point is what
 * keeps that guarantee intact when the next flow that sends mail shows up —
 * a caller cannot bypass the budget because it cannot reach the transport
 * without passing through here. A message whose budget is refused drops
 * exactly like an SMTP failure does below: logged, never thrown.
 *
 * Deliberately never throws. Every caller before the tracker was inside a
 * Better Auth flow that had already done the thing the mail is about — the
 * user is created, the reset token is stored — so propagating an SMTP
 * failure would turn a delivery problem into a failed signup and leave the
 * account half-made. The user can ask for another mail; they cannot un-fail
 * a registration.
 *
 * Returns whether the message actually went out — `false` covers no SMTP
 * configured, budget refused, and a transport error alike, deliberately not
 * distinguished, since every existing caller only needs "did it happen" and
 * keeps ignoring the result exactly as when this returned `void`. The one
 * caller that *does* read it is `scripts/tracker-cron.mjs`'s route: a
 * recordatorio de seguimiento is not something to fabricate a fallback for —
 * it just has to not mark `sent_at` when this comes back `false`, so the
 * cron reintenta it tomorrow instead of losing it silently.
 *
 * Only the recipient and the error reach the log. The body carries a single-use
 * token, which is a credential: an attacker with the log would not need the
 * mailbox.
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  if (!mailConfigured) return false;

  try {
    // Dentro del try para que un fallo de la propia contabilidad nunca se
    // convierta en una excepción que reviente el alta de una cuenta ya creada.
    const allowed = await reserveMailBudget(mail.kind, mail.to);
    if (!allowed) return false;

    await getTransport().sendMail({
      from: process.env.MAIL_FROM!,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    return true;
  } catch (error) {
    console.error(
      `[email] could not deliver "${mail.subject}" to ${mail.to}:`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
