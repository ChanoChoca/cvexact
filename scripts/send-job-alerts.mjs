// Dispara el envío diario de alertas de empleo: un POST a
// /api/jobs/alerts/send, que corre DENTRO del proceso de Next.js porque
// necesita lib/jobs/score.ts y lib/email/mailer.ts — TypeScript de la app,
// que este script no puede importar (misma restricción, en el sentido
// contrario, que scripts/ingest-jobs.mjs documenta en su cabecera). Este
// archivo es sólo el disparador que el CronJob corre; toda la lógica real
// vive en la ruta.
//
// INTERNAL_APP_URL tiene que apuntar al Service del Deployment
// (la URL interna del servicio de la app),
// no al default de lib/export/pdf.ts (127.0.0.1): ese código corre DENTRO del
// pod de la app; este CronJob corre en un pod aparte, así que "localhost" no
// llega a ningún lado.
//
// INTERNAL_APP_URL no puede ser la URL pública: la ruta rechaza con 403 todo
// pedido que haya pasado por Cloudflare (lib/api/internal-only.ts), y eso es lo
// que la hace interna. Este script entra por el Service, que no pasa por ahí.
//
// x-origin-auth es el mismo secreto que ya protege el resto del perímetro
// (proxy.ts) — no hay nada bespoke acá a propósito, ver el comentario de
// app/api/jobs/alerts/send/route.ts. Sin ORIGIN_AUTH_SECRET configurado la
// llamada funciona igual, porque proxy.ts deja pasar todo en ese caso — el
// mismo estado que desarrollo y compose.
const APP_URL = process.env.INTERNAL_APP_URL?.trim() || "http://localhost:3000";
const SECRET = process.env.ORIGIN_AUTH_SECRET?.trim();

try {
  const response = await fetch(`${APP_URL}/api/jobs/alerts/send`, {
    method: "POST",
    headers: SECRET ? { "x-origin-auth": SECRET } : {},
    signal: AbortSignal.timeout(120_000),
  });

  const body = await response.text();
  if (!response.ok) {
    console.error(`/api/jobs/alerts/send respondió ${response.status}: ${body.slice(0, 500)}`);
    process.exitCode = 1;
  } else {
    console.log(`Alertas de empleo: ${body}`);
  }
} catch (err) {
  console.error(
    "No se pudo llamar a /api/jobs/alerts/send:",
    err instanceof Error ? err.message : err,
  );
  process.exitCode = 1;
}
