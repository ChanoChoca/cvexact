// Qué arrepentimientos y bajas siguen sin resolver, y desde cuándo.
//
// `lib/db/schema.ts` deja anotado que `legal_request.status` "se mueve a mano
// por ahora: no hay reintegro automático" — y una solicitud que nadie mueve no
// avisa de ningún otro modo. Los términos y condiciones (cláusula 6) prometen
// el reintegro "dentro de los diez días hábiles de recibida la solicitud"; sin
// nada que lo vigile, ese plazo es una promesa que sólo se rompe en silencio.
//
// Este script no cierra nada — sólo lista lo pendiente, ordenado por
// antigüedad, marcando lo que ya superó el plazo. Es de sólo lectura a
// propósito: cerrar una solicitud significa haber devuelto la plata o dado la
// baja de verdad, y eso lo hace una persona, no un cron.
//
// Corre a demanda (`pnpm legal:overdue`), no como CronJob: es una consulta que
// alguien mira, no un job que actúa. Depende sólo de `pg`, como
// scripts/prune.mjs y scripts/migrate.mjs.
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

/**
 * Diez días hábiles, aproximados a catorce corridos.
 *
 * Un cálculo exacto de días hábiles necesita un calendario de feriados
 * argentinos, que es más máquina de la que esta alerta necesita: catorce
 * corridos cubren diez hábiles incluso con dos fines de semana de por medio,
 * así que una fila marcada acá está vencida de verdad y no por el margen del
 * cálculo. Lo que importa es que nunca marque vencido antes de tiempo.
 */
const REFUND_CALENDAR_DAYS = 14;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(
    `select id, kind, email, created_at,
            extract(day from now() - created_at)::int as days_open
     from legal_request
     where status = 'pendiente'
     order by created_at asc`,
  );

  if (rows.length === 0) {
    console.log("Sin solicitudes pendientes.");
    return;
  }

  const overdue = rows.filter((r) => r.days_open > REFUND_CALENDAR_DAYS);

  for (const r of rows) {
    const flag = r.days_open > REFUND_CALENDAR_DAYS ? "  ⚠ VENCIDA" : "";
    console.log(
      `${r.id}  ${r.kind.padEnd(14)}  ${r.email}  ${r.days_open}d${flag}`,
    );
  }

  console.log(`\n${rows.length} pendiente(s), ${overdue.length} vencida(s) (>${REFUND_CALENDAR_DAYS}d).`);

  // Código de salida distinto de cero cuando hay vencidas, para que esto
  // también sirva de chequeo en un pipeline que no imprime nada si no hace
  // falta mirar — sin convertir esto en un job que actúa por su cuenta.
  if (overdue.length > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("No se pudo consultar legal_request:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
