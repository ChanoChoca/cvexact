import PostalMime from "postal-mime";

/**
 * El Worker de la Fase 3 (docs/tracker-email-fase3.md). Deliberadamente
 * tonto: no clasifica nada, no decide nada, no toca ninguna base de datos.
 * Sólo parsea el MIME, saca lo mínimo (remitente, destinatario, asunto,
 * texto plano), y se lo pasa a POST /api/tracker/email/ingest, que es
 * donde vive toda la lógica real (lib/tracker/email-ingest.ts) — la misma
 * razón por la que esa lógica está en TypeScript testeable en el repo
 * principal y no duplicada acá en JS sin tests.
 *
 * Tope de tamaño del texto: coincide con el límite que ya valida la propia
 * route (bodySchema en app/api/tracker/email/ingest/route.ts) — cortarlo acá
 * además evita mandar de más por la red si el correo es enorme.
 */

const MAX_BODY_CHARS = 20_000;

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const worker = {
  async email(message, env) {
    try {
      const parsed = await PostalMime.parse(message.raw);
      const bodyText = (parsed.text || stripHtml(parsed.html || "")).slice(0, MAX_BODY_CHARS);

      const response = await fetch(`${env.APP_URL}/api/tracker/email/ingest`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-origin-auth": env.ORIGIN_AUTH_SECRET ?? "",
        },
        body: JSON.stringify({
          // El destinatario del sobre (a qué alias llegó), no lo que diga el
          // header "To:" — es lo único confiable para saber de qué cuenta es.
          alias: message.to,
          from: parsed.from?.address || message.from,
          subject: parsed.subject || "",
          bodyText,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        // Sin el cuerpo del correo en el log — nunca. Sólo el resultado.
        console.error(`tracker-email: ingest respondió ${response.status}`);
      }
    } catch (err) {
      // Nunca relanza: un fallo acá no debe rebotar el correo (setReject)
      // ni bloquear a un remitente que no tiene ninguna culpa de que
      // nuestro procesamiento haya fallado. Se pierde ese correo puntual,
      // que es preferible a que alguien reciba un bounce por nuestra culpa.
      console.error("tracker-email: no se pudo procesar el correo:", err instanceof Error ? err.message : err);
    }
  },
};

export default worker;
