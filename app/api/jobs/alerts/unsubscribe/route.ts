import { enforceRateLimit } from "@/lib/api/guards";
import { verifyJobAlertUnsubscribeToken } from "@/lib/jobs/alert-token";
import { deactivateJobAlert } from "@/lib/jobs/alerts";

export const runtime = "nodejs";

/**
 * Baja de un clic para `jobAlertMail` — el único correo publicitario del
 * sistema (art. 27, Ley 25.326). A propósito sin sesión: quien hace clic
 * viene de su cliente de correo, no de una pestaña logueada, así que el
 * link mismo tiene que poder apagar la alerta, autenticado por el token de
 * `lib/jobs/alert-token.ts` en vez de por una cookie.
 *
 * Actúa directamente en el `GET`, sin paso de confirmación intermedio — es
 * lo que "un clic" (RFC 8058) significa. Devuelve HTML autocontenido, no
 * JSON: la respuesta la ve una persona en su navegador, no otro código.
 */

const RATE_LIMIT = { window: 3600, max: 30 };

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>${title}</title></head>` +
      `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;">` +
      `<h1 style="font-size:1.25rem;">${title}</h1><p>${body}</p>` +
      `<p><a href="/empleos">Volver a cvexact</a></p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(request: Request) {
  const limited = await enforceRateLimit("jobs-alerts-unsubscribe", request.headers, RATE_LIMIT);
  if (limited) {
    return page(
      "Demasiadas solicitudes",
      "Estás haciendo demasiadas solicitudes seguidas. Esperá un momento y probá de nuevo.",
    );
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("u");
  const token = searchParams.get("t");

  if (!userId || !token || !verifyJobAlertUnsubscribeToken(userId, token)) {
    return page(
      "Link inválido",
      "Este link de baja no es válido. Iniciá sesión y desactivá la alerta desde /empleos.",
      400,
    );
  }

  await deactivateJobAlert(userId);

  return page(
    "Alerta desactivada",
    "Tu alerta de empleo fue desactivada. No vas a recibir más correos de esta alerta.",
  );
}
