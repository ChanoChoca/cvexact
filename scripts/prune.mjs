// Retención de lo que crece solo. Sin esto, cuatro tablas crecen para siempre:
// `verification` y `session` acumulan filas vencidas que nadie borra (Better
// Auth no poda ninguna de las dos), `login_attempt` suma una fila por cada
// dirección tecleada en el login — un millón de emails inventados son un millón
// de filas permanentes — y `app_rate_limit` guarda un bucket por (límite,
// sujeto). En un disco de 5Gi compartido con el CRM y con `volumeClaimTemplates`
// inmutable (ver el motor de base que uses), llenarlo tira las dos aplicaciones.
//
// El corte por tabla:
//
//   verification    expires_at < now()
//   session         expires_at < now()
//   login_attempt   updated_at < now() - 7 días y sin lock vigente (la fila de
//                   una cuenta bloqueada o recién fallada se queda: es el
//                   estado del lockout de lib/auth-lockout.ts, no basura)
//   app_rate_limit  last_request < now() - 2 días (los buckets se reconstruyen
//                   solos al primer request de su ventana)
//   rate_limit      last_request < now() - 2 días. Es la tabla de Better Auth y
//                   ya nadie escribe en ella (lib/auth-rate-limit.ts): se sigue
//                   barriendo para llevarse las direcciones IP en claro que
//                   guardó antes de ese cambio.
//   usage_counter,  day más viejo que 90 días (texto YYYY-MM-DD)
//   generation_usage
//   legal_request   resueltas y con más de 3 años (ver LEGAL_REQUEST_DAYS)
//   application_contact,
//   application_event (raw_sender y raw_subject)
//                   datos de terceros —reclutadores— de una postulación sin
//                   movimiento hace más de THIRD_PARTY_DAYS: los contactos se
//                   borran, y del evento se borra sólo el remitente y el asunto
//                   (el evento en sí es el historial del usuario y se queda)
//   job_posting     fetched_at más viejo que 3 días (ver JOB_POSTING_DAYS) para
//                   getonbrd/himalayas/remotive/arbeitnow — un aviso que
//                   scripts/ingest-jobs.mjs dejó de ver en su fuente en las
//                   últimas ~144 corridas (cada 30 min) ya no está publicado.
//                   Para "jooble" el corte es otro y más largo
//                   (JOOBLE_POSTING_DAYS): scripts/ingest-jooble.mjs corre
//                   semanal, no cada 30 min, así que la misma regla de 3 días
//                   borraría cada aviso de Jooble a mitad de semana y dejaría
//                   la fuente vacía la mayor parte del tiempo entre corridas.
//   generation_result
//                   expires_at < now() (un día después de cada generación;
//                   ver lib/generation/result-cache.ts). Ya no se lee pasado
//                   ese plazo, pero se borra: es el resultado cifrado de una
//                   generación, y lo que la política de privacidad promete es
//                   que dura un día, no que deja de mostrarse.
//
// `consent` y `job_source_budget` NO se podan, y es a propósito. Sobre
// `consent`: Cada fila —"transfer" para la
// transferencia internacional (Ley 25.326 art. 12), "terms" para la
// aceptación de términos y privacidad al crear la cuenta— es la prueba de
// que el titular aceptó algo puntual: una fila borrada por antigüedad es un
// consentimiento que ya no se puede acreditar, que es lo mismo que no
// haberlo pedido. Se va sola cuando se borra la cuenta, por el ON DELETE
// CASCADE, que es la única condición bajo la cual deja de hacer falta.
//
// `job_source_budget` tampoco se poda: es el contador de cuánto gastó
// scripts/ingest-jooble.mjs del límite de 500 requests de por vida de la key
// gratuita de Jooble. Borrar la fila no le devuelve presupuesto a la cuenta
// del lado de Jooble — sólo haría que el script olvidara cuánto gastó ya y
// terminara pidiendo de más creyendo que tenía margen.
//
// El vencimiento de créditos (CREDIT_EXPIRY_MONTHS en lib/quota.ts) no borra
// ninguna fila: reconcilia `user.credit_balance` contra `credit_purchase`,
// simulando un consumo FIFO —la compra más vieja se gasta primero— para saber
// cuánto de una compra vencida seguía sin usarse, y descontarlo del saldo. No
// hay una columna de "créditos restantes" por compra: se deriva en la consulta
// de abajo, y sólo puede bajar el saldo, nunca subirlo.
//
// Además deja fijos, para el ROL de cvexact y no globalmente, los timeouts que
// un flood de queries lentas convertiría en otro camino para saturar la base:
// un statement_timeout global en el Postgres de producción se lo comería también el CRM y
// podría romperle una migración larga.
//
// Corre como CronJob diario (ver los CronJobs de tu despliegue) con la imagen migrator y
// DATABASE_URL del Secret. Depende sólo de `pg`, como scripts/migrate.mjs.
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const LOGIN_ATTEMPT_DAYS = 7;
const RATE_LIMIT_DAYS = 2;
const USAGE_DAYS = 90;
/**
 * Cuánto vive un aviso en `job_posting` sin que `scripts/ingest-jobs.mjs`
 * vuelva a verlo. Esa corrida trae sólo la primera página o dos de cada
 * fuente, ordenada por lo más reciente que publica cada una — no es un
 * espejo completo, es una ventana. Tres días a un ritmo de corrida cada 30
 * minutos (ver el CronJob) son ~144 chances de reaparecer antes de que se
 * borre; un aviso real sigue entrando en esa ventana mientras la fuente lo
 * sigue mostrando entre los primeros resultados.
 */
const JOB_POSTING_DAYS = 3;
/**
 * Lo mismo que `JOB_POSTING_DAYS`, pero para la única fuente que no corre
 * cada 30 minutos. `scripts/ingest-jooble.mjs` está pensado para un CronJob
 * semanal (ver los CronJobs de tu despliegue) — tres días de ventana borraría cada
 * aviso de Jooble bastante antes de la corrida siguiente, y la fuente
 * quedaría vacía la mayor parte de cada semana. Diez días da margen incluso
 * si una corrida semanal se salta una vez.
 */
const JOOBLE_POSTING_DAYS = 10;
/**
 * Cuánto se guardan las solicitudes de arrepentimiento y baja ya resueltas.
 *
 * Tres años: es el plazo de prescripción de las acciones del consumidor, o sea
 * el tiempo durante el cual todavía puede haber que probar que la solicitud se
 * recibió y se atendió. Antes de eso, borrarlas sería destruir la constancia que
 * la Res. SCI 424/2020 obliga a dejar; después, la fila es un correo electrónico
 * guardado sin finalidad, que es lo que la cláusula 9 de la política de
 * privacidad promete no hacer.
 *
 * Sólo las resueltas. Una solicitud vieja y todavía pendiente es un incumplimiento
 * en curso, no basura: tiene que seguir a la vista.
 *
 * (En la auditoría legal del 2026-09-18 se evaluó podar también las pendientes
 * por `created_at`, para que ninguna fila fuera eterna, y se descartó por eso
 * mismo. Además, sin venta `POST /api/legales/solicitud` responde 503, así que
 * hoy no entra ninguna fila nueva. Si se enciende la venta, `pnpm legal:overdue`
 * es lo que las vigila — no este script.)
 */
const LEGAL_REQUEST_DAYS = 3 * 365;

/**
 * Cuánto se guardan los datos de otras personas dentro del seguimiento: los
 * contactos que el usuario cargó (nombre, correo, cargo, LinkedIn de un
 * reclutador) y el remitente y el asunto de los correos que detectó la
 * casilla. La cláusula 9 de la política de privacidad cita este plazo — si
 * cambia acá, cambia allá, no después.
 *
 * Un año, contado desde el último movimiento real de la postulación
 * (`last_activity_at`, no `updated_at`, que también se mueve con editar una
 * nota) y, para no borrarle a nadie algo que acaba de cargar en una postulación
 * vieja, también desde que el dato se registró: se borra cuando pasaron los dos.
 * Un proceso que lleva un año quieto está cerrado de hecho, y el correo de un
 * reclutador que nunca aceptó nada deja de tener finalidad — el art. 4 de la
 * Ley 25.326 pide destruir el dato cuando ya no hace falta. Antes de esto no
 * había ningún plazo: sólo caían al borrar la postulación o la cuenta.
 *
 * Lo del usuario no se toca: la postulación, sus notas y su historial quedan.
 * Es ese historial el que justifica no borrar el evento entero.
 */
const THIRD_PARTY_DAYS = 365;

/** Uso del PVC que dispara la alarma. 5 Gi inmutables, 70% de margen. */
const PVC_BYTES = 5 * 1024 ** 3;
const PVC_WARN_FRACTION = 0.7;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function prune(label, sql, params) {
  const result = await pool.query(sql, params);
  console.log(`${label}: ${result.rowCount} fila(s) borradas.`);
}

try {
  const now = Date.now();

  await prune("verification", "DELETE FROM verification WHERE expires_at < now()");
  await prune("session", "DELETE FROM session WHERE expires_at < now()");
  await prune("generation_result", "DELETE FROM generation_result WHERE expires_at < now()");

  await prune(
    "login_attempt",
    `DELETE FROM login_attempt
     WHERE updated_at < now() - ($1::text)::interval
       AND (locked_until IS NULL OR locked_until < now())`,
    [`${LOGIN_ATTEMPT_DAYS} days`],
  );

  await prune("app_rate_limit", "DELETE FROM app_rate_limit WHERE last_request < $1::bigint", [
    String(now - RATE_LIMIT_DAYS * DAY_MS),
  ]);

  // La tabla propia de Better Auth. Desde `lib/auth-rate-limit.ts` nadie escribe
  // acá, pero las filas de antes guardan la dirección del cliente en claro
  // (`<ip>|<ruta>`) y este barrido es lo que las saca. Se queda después a
  // propósito: no cuesta nada y cubre una vuelta atrás a `storage: "database"`.
  await prune("rate_limit", "DELETE FROM rate_limit WHERE last_request < $1::bigint", [
    String(now - RATE_LIMIT_DAYS * DAY_MS),
  ]);

  // `day` es un texto YYYY-MM-DD: el orden lexicográfico es el orden temporal.
  const dayCutoff = new Date(now - USAGE_DAYS * DAY_MS).toISOString().slice(0, 10);
  await prune("usage_counter", "DELETE FROM usage_counter WHERE day < $1", [dayCutoff]);
  await prune("generation_usage", "DELETE FROM generation_usage WHERE day < $1", [dayCutoff]);

  await prune(
    "legal_request",
    `DELETE FROM legal_request
     WHERE status = 'resuelta'
       AND resolved_at IS NOT NULL
       AND resolved_at < now() - ($1::text)::interval`,
    [`${LEGAL_REQUEST_DAYS} days`],
  );

  // Datos de terceros dentro del seguimiento (cláusulas 17 y 19). Ver
  // THIRD_PARTY_DAYS para el criterio. Se recorre `application` sin índice por
  // `last_activity_at` a secas: a la escala de esta base es una pasada diaria
  // barata, y agregar un índice sólo para esto no se justifica.
  await prune(
    "application_contact",
    `DELETE FROM application_contact c
     USING application a
     WHERE c.application_id = a.id
       AND a.last_activity_at < now() - ($1::text)::interval
       AND c.created_at < now() - ($1::text)::interval`,
    [`${THIRD_PARTY_DAYS} days`],
  );

  // Del evento se borra sólo lo de un tercero. `raw_sender` y `raw_subject` son
  // la auditoría del clasificador de correo; el resto de la fila —qué estado
  // cambió y cuándo— es el historial del usuario y alimenta sus métricas.
  const anonymized = await pool.query(
    `UPDATE application_event e
     SET raw_sender = NULL, raw_subject = NULL
     FROM application a
     WHERE e.application_id = a.id
       AND (e.raw_sender IS NOT NULL OR e.raw_subject IS NOT NULL)
       AND a.last_activity_at < now() - ($1::text)::interval
       AND e.created_at < now() - ($1::text)::interval`,
    [`${THIRD_PARTY_DAYS} days`],
  );
  console.log(
    `application_event (remitente y asunto): ${anonymized.rowCount} fila(s) anonimizadas.`,
  );

  await prune(
    "job_posting",
    `DELETE FROM job_posting
     WHERE (source <> 'jooble' AND fetched_at < now() - ($1::text)::interval)
        OR (source = 'jooble' AND fetched_at < now() - ($2::text)::interval)`,
    [`${JOB_POSTING_DAYS} days`, `${JOOBLE_POSTING_DAYS} days`],
  );

  /**
   * Vencimiento de créditos: cierra cada compra vencida por lo que le quedaba
   * sin gastar, y le resta esa misma cantidad al saldo — nunca escribe un
   * valor absoluto sobre `credit_balance`.
   *
   * Todo el cálculo usa `credits - forfeited_credits` ("lo vivo") en vez de
   * `credits` a secas, en las tres CTEs de lectura: es lo que hace que
   * correr esto dos veces seguidas no vuelva a evaluar como disponible una
   * compra que la corrida anterior ya cerró. La primera versión de este
   * script no tenía esa columna y escribía `credit_balance` con un valor
   * absoluto recalculado desde cero cada vez — probado contra una base real
   * con `docker run postgres` y datos sintéticos, la segunda corrida le
   * vaciaba el saldo a una compra sin vencimiento (`expires_at IS NULL`)
   * sólo porque una compra vencida ya se había descontado en la corrida
   * anterior. `forfeited_credits` es lo que evita que eso vuelva a pasar: una
   * vez cerrada una porción de una compra, esa porción desaparece de "lo
   * vivo" para siempre, en vez de recalcularse contra el gasto total del
   * historial cada vez.
   *
   * `ordered` numera las compras de cada usuario por antigüedad y acumula un
   * total corrido sobre lo vivo. `spent` deriva cuánto gastó ese usuario en
   * total: `total_granted - credit_balance` es exacto sin necesitar una
   * columna aparte, porque todo lo que sale del saldo sale por un gasto real
   * (puede volver por un reintegro de una generación fallida) o por este
   * mismo cierre, y ambos bajan `total_granted` (lo vivo) en la misma medida
   * que bajan el saldo. `forfeits` aplica ese gasto a las compras en
   * orden —la más vieja absorbe primero— y sólo escribe sobre las que además
   * están vencidas: lo que le sobra a una vencida es lo que "vencer"
   * significa. Las dos escrituras —cerrar la compra y descontar el saldo—
   * van en un único statement con CTEs de escritura encadenadas, así que
   * Postgres las hace atómicas sin necesitar un BEGIN/COMMIT aparte.
   */
  const expired = await pool.query(`
    WITH candidatos AS (
      SELECT DISTINCT user_id FROM credit_purchase
      WHERE expires_at IS NOT NULL AND expires_at <= now()
        AND credits > forfeited_credits
    ),
    ordered AS (
      SELECT
        cp.user_id,
        cp.gateway,
        cp.external_id,
        (cp.credits - cp.forfeited_credits) AS live_credits,
        cp.expires_at,
        SUM(cp.credits - cp.forfeited_credits) OVER (
          PARTITION BY cp.user_id
          ORDER BY cp.created_at, cp.gateway, cp.external_id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS running_total
      FROM credit_purchase cp
      JOIN candidatos c ON c.user_id = cp.user_id
    ),
    granted AS (
      SELECT user_id, SUM(credits - forfeited_credits) AS total_granted
      FROM credit_purchase
      WHERE user_id IN (SELECT user_id FROM candidatos)
      GROUP BY user_id
    ),
    spent AS (
      SELECT u.id AS user_id, g.total_granted - u.credit_balance AS net_spent
      FROM "user" u
      JOIN granted g ON g.user_id = u.id
    ),
    forfeits AS (
      SELECT
        o.user_id,
        o.gateway,
        o.external_id,
        GREATEST(
          0,
          o.live_credits - GREATEST(0, s.net_spent - (o.running_total - o.live_credits))
        ) AS amount
      FROM ordered o
      JOIN spent s ON s.user_id = o.user_id
      WHERE o.expires_at IS NOT NULL AND o.expires_at <= now()
    ),
    closed AS (
      UPDATE credit_purchase cp
      SET forfeited_credits = cp.forfeited_credits + f.amount
      FROM forfeits f
      WHERE cp.gateway = f.gateway AND cp.external_id = f.external_id AND f.amount > 0
      RETURNING cp.user_id, f.amount
    )
    UPDATE "user" u
    SET credit_balance = GREATEST(0, u.credit_balance - agg.total_forfeit)
    FROM (SELECT user_id, SUM(amount) AS total_forfeit FROM closed GROUP BY user_id) agg
    WHERE u.id = agg.user_id
    RETURNING u.id
  `);
  console.log(`Vencimiento de créditos: ${expired.rowCount} cuenta(s) ajustada(s).`);

  // Timeouts por rol: el rol sale de DATABASE_URL, así que el script no hardcodea
  // un nombre que puede cambiar. Sólo afecta a las conexiones de esta app; el
  // CRM, compartiendo instancia, no ve el cambio.
  const role = new URL(process.env.DATABASE_URL).username;
  await pool.query(`ALTER ROLE ${JSON.stringify(role)} SET statement_timeout = '30s'`);
  await pool.query(
    `ALTER ROLE ${JSON.stringify(role)} SET idle_in_transaction_session_timeout = '60s'`,
  );
  console.log(`Timeouts aplicados al rol ${role}.`);

  // Alerta temprana de disco. pg_database_size cubre sólo esta base — el CRM
  // comparte el volumen y su tamaño no es visible desde acá —, así que es un
  // piso del uso real, no el total. Sirve para enterarse antes de la caída, no
  // para reemplazar un df del nodo.
  const { rows } = await pool.query("SELECT pg_database_size(current_database()) AS bytes");
  const bytes = Number(rows[0]?.bytes ?? 0);
  const warnAt = PVC_BYTES * PVC_WARN_FRACTION;
  console.log(
    `cvexact ocupa ${(bytes / 1024 ** 3).toFixed(2)} GiB de los ${(
      PVC_BYTES / 1024 ** 3
    ).toFixed(0)} GiB del volumen (piso: no incluye al CRM).`,
  );
  if (bytes >= warnAt) {
    // Este log es la señal de alerta: el CronJob lo escribe en la salida del pod,
    // que es donde hoy vive la observabilidad del cluster.
    console.error(
      `[disk-alert] la base pasó el ${(PVC_WARN_FRACTION * 100).toFixed(0)}% del volumen — ` +
        "el disco es inmutable (volumeClaimTemplates): achicar tablas o migrar antes de que se llene.",
    );
  }

  console.log("Poda terminada.");
} catch (err) {
  console.error("Prune failed:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
