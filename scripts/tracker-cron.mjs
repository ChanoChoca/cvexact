// Dispara la corrida diaria del tracker: un POST a /api/tracker/cron, que
// corre DENTRO del proceso de Next.js porque necesita lib/tracker/*.ts y
// lib/email/mailer.ts — TypeScript de la app, que este script no puede
// importar (misma restricción que documenta scripts/send-job-alerts.mjs,
// del que este archivo es casi una copia literal). Este script es sólo el
// disparador que el CronJob corre; toda la lógica real vive en la ruta.
//
// Mismas variables de entorno y mismo perímetro (x-origin-auth vía
// proxy.ts) que scripts/send-job-alerts.mjs — ver los comentarios ahí. Incluida
// la restricción de INTERNAL_APP_URL: tiene que ser el Service, no la URL
// pública, porque la ruta rechaza lo que pasó por Cloudflare.
const APP_URL = process.env.INTERNAL_APP_URL?.trim() || "http://localhost:3000";
const SECRET = process.env.ORIGIN_AUTH_SECRET?.trim();

try {
  const response = await fetch(`${APP_URL}/api/tracker/cron`, {
    method: "POST",
    headers: SECRET ? { "x-origin-auth": SECRET } : {},
    signal: AbortSignal.timeout(120_000),
  });

  const body = await response.text();
  if (!response.ok) {
    console.error(`/api/tracker/cron respondió ${response.status}: ${body.slice(0, 500)}`);
    process.exitCode = 1;
  } else {
    console.log(`Tracker: ${body}`);
  }
} catch (err) {
  console.error("No se pudo llamar a /api/tracker/cron:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
