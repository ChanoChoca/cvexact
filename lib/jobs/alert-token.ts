import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Token de baja de alerta de empleo, para el `manageUrl` de `jobAlertMail`
 * (ver `app/api/jobs/alerts/send/route.ts`). Tiene que funcionar sin sesión
 * — quien hace clic viene de su cliente de correo, no de una pestaña logueada
 * — así que no reusa el mecanismo de Better Auth (su tabla `verification` es
 * interna a sus propios flujos, no un helper general para firmar cualquier
 * recurso).
 *
 * HMAC en vez de un valor guardado en la base: no hace falta una tabla nueva
 * ni una fecha de expiración — un link de baja tiene que seguir sirviendo
 * mientras la alerta exista, no vencer como una sesión.
 */

const PURPOSE = "job-alert-unsubscribe:";

function secret(): string {
  return process.env.BETTER_AUTH_SECRET!;
}

function hmac(userId: string): Buffer {
  return createHmac("sha256", secret()).update(PURPOSE + userId).digest();
}

export function signJobAlertUnsubscribeToken(userId: string): string {
  return hmac(userId).toString("base64url");
}

export function verifyJobAlertUnsubscribeToken(userId: string, token: string): boolean {
  let given: Buffer;
  try {
    given = Buffer.from(token, "base64url");
  } catch {
    return false;
  }
  const expected = hmac(userId);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
