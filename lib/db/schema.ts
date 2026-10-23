import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Server-side state. Everything here is optional to the product: an anonymous
 * user with their own API key never touches this database. It exists for
 * accounts, subscriptions, and the free-tier quota counter.
 */

// --- Better Auth core tables --------------------------------------------------
// Shapes required by better-auth's Drizzle adapter.

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  /** Mirrors the active subscription so tier checks are a single row read. */
  subscriptionStatus: text("subscription_status"),
  subscriptionCurrentPeriodEnd: timestamp("subscription_current_period_end"),
  /**
   * Which gateway holds the subscription, and its id there.
   *
   * Mercado Pago has no billing portal — the cancellation is an API call we
   * have to make ourselves, against this id. Without the pair, a subscriber
   * could see a "cancel" button with nothing behind it.
   */
  subscriptionGateway: text("subscription_gateway"),
  subscriptionExternalId: text("subscription_external_id"),
  /**
   * Credits bought outright, in the same units as `ACTION_COST`.
   *
   * A column on the user rather than a derived sum over `creditPurchase`,
   * because it is read on every generation and spent under concurrency: a
   * conditional UPDATE against one integer is atomic on its own, where a sum
   * would need a transaction and a lock to be safe. `creditPurchase` is the
   * audit trail behind it, not the source of truth.
   */
  creditBalance: integer("credit_balance").notNull().default(0),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// --- Application data ---------------------------------------------------------

/** One row per signed-in user. The browser copy stays authoritative until sync. */
export const profile = pgTable("profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const application = pgTable(
  "application",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    label: text("label").notNull().default(""),
    /** The whole Application object from lib/storage/local.ts — the generated
     *  CV, answers, interview prep, video script. Stays the only copy of any
     *  of that; the tracker columns below never duplicate it. */
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),

    // --- Tracker: el aviso -------------------------------------------------
    // Metadato del puesto, nunca el CV. Todo nullable porque una fila puede
    // llegar de un import manual sin la mitad de estos datos.
    jobTitle: text("job_title"),
    company: text("company"),
    /**
     * Empresa normalizada, para deduplicar y agrupar sin que "Mercado Libre"
     * y "MercadoLibre S.A." cuenten como cosas distintas. `generatedAlwaysAs`
     * en vez de escribirla desde la capa de servicio: así también queda
     * correcta para una fila que un `update` a mano en `psql` deja con la
     * empresa mal cargada.
     */
    companyNorm: text("company_norm").generatedAlwaysAs(
      sql`lower(regexp_replace(coalesce(company, ''), '[^a-zA-Z0-9]', '', 'g'))`,
    ),
    /** 'buscador_interno' | 'url' | 'manual' | 'csv' | el `source` de
     *  `jobPosting` cuando vino de ahí. Texto y no enum, por lo mismo que
     *  `gateway` en `credit_purchase`. */
    source: text("source"),
    /** Si se guardó desde `/empleos`, el id de `jobPosting` de origen — sólo
     *  trazabilidad, `onDelete: "set null"` porque `job_posting` se poda con
     *  el tiempo y perder el vínculo no debe borrar la postulación. */
    jobPostingId: text("job_posting_id").references(() => jobPosting.id, {
      onDelete: "set null",
    }),
    jobUrl: text("job_url"),
    jdText: text("jd_text"),
    /** JSON-LD crudo cuando el import fue por URL — auditoría de qué se leyó. */
    jdJsonld: jsonb("jd_jsonld"),
    location: text("location"),
    remote: boolean("remote"),
    salaryMin: integer("salary_min"),
    salaryMax: integer("salary_max"),
    currency: text("currency"),

    // --- Tracker: el proceso ------------------------------------------------
    /** Ver `lib/tracker/status.ts` para los nueve valores y sus transiciones
     *  válidas. Texto y no enum, por lo mismo que el resto del repo. */
    status: text("status").notNull().default("guardado"),
    appliedAt: timestamp("applied_at"),
    /**
     * Cuándo fue el último movimiento real del proceso — no `updatedAt`, que
     * también se mueve con una edición de notas o de contacto. Es la columna
     * que el cron de ghosting recorre (`lib/tracker/ghosting.ts`) y por eso
     * tiene su propio índice: sin él, esa consulta diaria sería un full scan.
     */
    lastActivityAt: timestamp("last_activity_at").notNull().defaultNow(),
    /** La versión de CV que se mandó — ver el comentario de `cvVersion` para
     *  por qué es una variante derivada y no el documento en sí. */
    cvVersionId: text("cv_version_id").references(() => cvVersion.id, {
      onDelete: "set null",
    }),
    /** Posición fraccional dentro de la columna del kanban — ver
     *  `lib/tracker/board.ts`. Insertar entre dos tarjetas es escribir un
     *  número entre las dos, nunca reindexar la columna entera. */
    boardPosition: doublePrecision("board_position").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
  },
  (t) => [
    index("application_user_id_idx").on(t.userId),
    index("application_user_status_idx")
      .on(t.userId, t.status)
      .where(sql`not ${t.archived}`),
    index("application_user_last_activity_idx").on(t.userId, t.lastActivityAt),
    index("application_user_company_title_idx").on(t.userId, t.companyNorm, t.jobTitle),
    /**
     * Sólo para el cron de ghosting (`lib/tracker/ghosting.ts`), que es la
     * única consulta de todo el tracker que cruza cuentas — todo lo demás
     * arranca de `user_id` y ya usa los índices de arriba. Sin este índice
     * parcial esa consulta diaria sería un recorrido secuencial de toda la
     * tabla en cada corrida, el "full scan" que la restricción de eficiencia
     * pide evitar explícitamente en los jobs programados.
     */
    index("application_ghosting_candidates_idx")
      .on(t.lastActivityAt)
      .where(sql`${t.status} in ('postulado', 'en_revision') and not ${t.archived}`),
  ],
);

/**
 * Una variante de CV, para la métrica de conversión por versión — el
 * diferenciador del tracker: acá se genera el CV por aviso, así que ninguna
 * postulación de la competencia puede vincularse con la versión exacta que se
 * mandó.
 *
 * No hashea el documento completo. Cada CV está adaptado al aviso al que
 * responde, así que un hash de contenido daría una fila nueva por
 * postulación y la métrica sería inútil — puro n=1. `fingerprint` es un hash
 * de un subconjunto estable (título profesional, ids ordenados de las
 * experiencias incluidas, conjunto de aptitudes) calculado en el navegador
 * por `lib/tracker/cv-version.ts`, para que las adaptaciones de un mismo CV
 * base colapsen en una sola fila. El servidor nunca recibe el documento: la
 * cláusula de privacidad de que el CV vive en el navegador sigue siendo
 * cierta con el tracker activado.
 */
export const cvVersion = pgTable(
  "cv_version",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Editable por el usuario — "CV backend Node", por ejemplo. */
    label: text("label").notNull().default(""),
    fingerprint: text("fingerprint").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("cv_version_user_id_idx").on(t.userId),
    // Única, no sólo índice: `ensureCvVersion` en `lib/tracker/service.ts`
    // hace upsert sobre este par para que dos postulaciones con el mismo
    // fingerprint de CV compartan la misma versión en vez de crear una fila
    // por postulación — sin esto la métrica estrella (conversión por
    // versión) nunca tendría más de una postulación por fila.
    uniqueIndex("cv_version_user_fingerprint_idx").on(t.userId, t.fingerprint),
  ],
);

/**
 * Fuente de verdad de las métricas — nunca el estado actual de `application`.
 * Una postulación que pasó por entrevista y terminó rechazada tiene que
 * seguir contando como "llegó a entrevista" en la conversión por etapa, y el
 * estado actual ya no lo dice una vez que cambió de nuevo.
 *
 * Es imposible insertar acá sin que un cambio de estado haya ocurrido de
 * verdad: el trigger `application_status_event` (migración 0016) es el único
 * escritor para eventos `to_status` no nulo. La capa de servicio
 * (`lib/tracker/service.ts`) nunca hace `insert into application_event`
 * directamente para esos casos — sólo declara, con
 * `set local app.event_detected_from`, de dónde viene el cambio antes de
 * hacer el `update` sobre `application.status`. Ver el comentario del
 * trigger en la migración para el resto del mecanismo.
 */
export const applicationEvent = pgTable(
  "application_event",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    /** 'creada' | 'cambio_manual' | 'ghosting_detectado' | 'follow_up_enviado'
     *  | 'nota' | los que llegue a escribir la Fase 3 ('confirmacion',
     *  'invitacion_entrevista', 'evaluacion', 'oferta', 'rechazo'). */
    eventType: text("event_type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    /** 'manual' | 'email' | 'sistema'. Ver el comentario de la tabla. */
    detectedFrom: text("detected_from").notNull().default("manual"),
    /** 0..1, sólo cuando viene del clasificador de email (Fase 3). */
    confidence: real("confidence"),
    /** Auditoría del clasificador — nunca el cuerpo del correo. Fase 3. */
    rawSender: text("raw_sender"),
    rawSubject: text("raw_subject"),
    /** Texto libre de una nota manual del usuario. */
    body: text("body"),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("application_event_application_occurred_idx").on(t.applicationId, t.occurredAt)],
);

export const applicationContact = pgTable(
  "application_contact",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    name: text("name"),
    email: text("email"),
    role: text("role"),
    linkedinUrl: text("linkedin_url"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("application_contact_application_id_idx").on(t.applicationId)],
);

export const applicationReminder = pgTable(
  "application_reminder",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    dueAt: timestamp("due_at").notNull(),
    /** 'follow_up' | 'entrevista' | 'custom'. */
    kind: text("kind").notNull(),
    message: text("message"),
    sentAt: timestamp("sent_at"),
    dismissed: boolean("dismissed").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // El cron recorre "vencidos y no enviados" una vez por día — sin este
    // índice parcial sería un full scan de una tabla que sólo crece.
    index("application_reminder_due_idx")
      .on(t.dueAt)
      .where(sql`${t.sentAt} is null and not ${t.dismissed}`),
  ],
);

/**
 * Fase 3 (detección de estados por email) — creada ahora, sin lector todavía.
 * Ver `docs/tracker-email-fase3.md` para el diseño completo.
 *
 * `consentAt` es obligatorio antes de procesar nada: sin esa fecha, ningún
 * correo reenviado a `alias` se lee. `alias` es la dirección única del tipo
 * `u_7f3a9b@track.<dominio>` — generada una sola vez, nunca derivada del
 * email real de la cuenta, para poder rotarla sin tocar la cuenta.
 */
export const emailInbox = pgTable("email_inbox", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  alias: text("alias").notNull().unique(),
  verifiedAt: timestamp("verified_at"),
  consentAt: timestamp("consent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Fase 4 (extensión de navegador) — un token por cuenta, para que la
 * extensión pueda llamar a `POST /api/tracker/applications` y
 * `POST /api/tracker/parse-html` sin depender de la cookie de sesión.
 *
 * La cookie no sirve acá: la extensión corre en su propio origen
 * (`chrome-extension://…`), y aunque MV3 puede leer cookies de otro dominio
 * con el permiso justo, eso es más superficie de permisos ("leé las cookies
 * de cvexact.com") de la que hace falta para lo que la extensión necesita
 * (crear una postulación, nada de leer la sesión web entera). Un token con
 * scope propio, generado una vez desde `/postulaciones` y pegado a mano en
 * la extensión, es el patrón estándar para esto — mismo motivo por el que
 * un CLI usa un personal access token y no reutiliza la cookie del browser.
 *
 * Sólo el hash se guarda (`tokenHash`, sha256 — ver
 * `lib/tracker/extension-auth.ts`), mismo trato que las claves de API: el
 * valor crudo se muestra una sola vez, al generarlo, y no hay forma de
 * recuperarlo después, sólo de rotarlo.
 *
 * Uno por cuenta (`userId` único): generar uno nuevo invalida el anterior.
 * No hace falta más de uno — es un dispositivo, la propia extensión, no un
 * ecosistema de integraciones con permisos distintos entre sí.
 */
export const extensionToken = pgTable("extension_token", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
});

/**
 * Deleted application ids, per user. Sync uploads are additive (the server
 * never removes rows the snapshot does not mention), so without this a delete
 * on one device would resurrect on the next "Bajar". Tombstones are kept
 * indefinitely: they are small, idempotent, and only a re-upload of the same
 * id retires one.
 */
export const applicationTombstone = pgTable(
  "application_tombstone",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    applicationId: text("application_id").notNull(),
    deletedAt: timestamp("deleted_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.applicationId] }),
    index("application_tombstone_user_id_idx").on(t.userId),
  ],
);

/**
 * One completed credit purchase.
 *
 * The primary key is the whole point of the table. Every payment gateway
 * retries its webhook until it gets a 2xx, so without a uniqueness constraint
 * on something the gateway itself supplies, a retry credits the pack twice.
 * Inserting here and incrementing `user.creditBalance` in the same transaction
 * is what makes the credit exactly-once.
 *
 * Composite, over `(gateway, externalId)`, so a payment id is only unique
 * within its own gateway — a single-column key would let one gateway's id
 * collide with another's and silently swallow a real purchase. Only Mercado
 * Pago sells the pack today, but the key does not assume that stays true.
 */
export const creditPurchase = pgTable(
  "credit_purchase",
  {
    /** Which gateway took the money — "mercadopago" today. */
    gateway: text("gateway").notNull(),
    /** Its own id for the payment. */
    externalId: text("external_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credits: integer("credits").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    /**
     * Cuándo dejan de contar estos créditos, o `NULL` si no vencen.
     *
     * `NULL` es el valor de todo lo comprado antes de que esto existiera —
     * "las ya vendidas quedan como están" — y `grantCredits` sólo lo completa
     * en compras nuevas, con `CREDIT_EXPIRY_MONTHS` (`lib/quota.ts`).
     */
    expiresAt: timestamp("expires_at"),
    /**
     * Cuánto de `credits` se dio de baja por vencimiento, sin gastarse.
     *
     * `credits` queda intacto como el monto que de verdad se pagó — es el
     * registro de auditoría, y truncarlo borraría la respuesta a "¿cuánto
     * otorgaba esta compra?". `scripts/prune.mjs` es el único que escribe
     * acá, y sólo hacia arriba: usa `credits - forfeited_credits` en vez de
     * `credits` a secas en su simulación de consumo FIFO, así que una fila ya
     * cerrada no se vuelve a evaluar como si tuviera saldo disponible en la
     * corrida siguiente. Sin esto, restar del balance sin dejar ningún rastro
     * en la compra hacía que la próxima corrida recalculara todo desde cero
     * contra el mismo `credits` original y confundiera ese descuento con
     * gasto real del titular — encontrado corriendo el script dos veces
     * seguidas contra datos de prueba antes de que esto existiera.
     */
    forfeitedCredits: integer("forfeited_credits").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.gateway, t.externalId] })],
);

/**
 * Un comprobante fiscal, uno por pago acreditado.
 *
 * Desde el 1/7/2026 la factura electrónica es obligatoria por cada venta de
 * un monotributista, sin piso — ver `lib/fiscal/`. La clave primaria es la
 * misma que `credit_purchase`, `(gateway, external_id)`, y por la misma
 * razón: un mismo pago no puede facturarse dos veces aunque el webhook de
 * Mercado Pago reintregue la notificación.
 *
 * `status` empieza en `"pending"` y lo mueve `lib/fiscal/invoice.ts` después
 * de acreditar el pago — nunca antes, y nunca revierte el crédito si falla.
 * Facturar es una obligación aparte de acreditar, no una condición: un error
 * de ARCA no puede convertirse en un pago cobrado sin créditos entregados.
 * Una fila en `"failed"` o `"pending"` por más de un rato es lo que
 * `pnpm legal:overdue` — o su propio chequeo — debería poder señalar.
 */
export const invoice = pgTable(
  "invoice",
  {
    /** Igual criterio que `credit_purchase`: "mercadopago" hoy. */
    gateway: text("gateway").notNull(),
    /** El id del pago en ese gateway — el mismo que referencia `credit_purchase`. */
    externalId: text("external_id").notNull(),
    /**
     * A diferencia de `credit_purchase`, esta columna NO cascadea con la
     * cuenta: `onDelete: "set null"`, y por eso es nullable. La cláusula 9 de
     * privacidad promete que el comprobante fiscal se conserva 10 años
     * (Ley 11.683) "aunque borres la cuenta" — una fila que desaparece con el
     * `DELETE` de `user` rompería esa promesa en el mismo commit que la
     * escribe. El comprobante ya está emitido ante ARCA con el CUIT del
     * emisor; no necesita seguir apuntando a una cuenta que ya no existe para
     * seguir siendo lo que la ley exige guardar.
     */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    /** Punto de venta Web Services autorizado en ARCA. */
    ptoVta: integer("pto_vta").notNull(),
    /** 11 = Factura C. Columna y no constante: si algún día se factura a un
     *  Responsable Inscripto, cambia por comprobante, no por deploy. */
    cbteTipo: integer("cbte_tipo").notNull(),
    /** Asignado sólo tras la respuesta de ARCA; null mientras está `pending`. */
    cbteNro: integer("cbte_nro"),
    cae: text("cae"),
    caeVto: timestamp("cae_vto"),
    /** En pesos, con hasta dos decimales — lo que de verdad cobró el gateway. */
    importe: numeric("importe", { precision: 12, scale: 2, mode: "number" }).notNull(),
    /** "pending" | "issued" | "failed". Texto y no enum, por lo mismo que `gateway`. */
    status: text("status").notNull().default("pending"),
    /** La última respuesta de ARCA, para depurar un `failed` sin tener que
     *  volver a preguntarle. Nunca se muestra al titular tal cual. */
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    issuedAt: timestamp("issued_at"),
  },
  (t) => [primaryKey({ columns: [t.gateway, t.externalId] })],
);

/**
 * What the models actually cost, aggregated.
 *
 * Deliberately not one row per generation. The question this exists to answer
 * is "what does a complete application cost to produce", which is a question
 * about totals — and a per-generation log would grow without bound, need
 * pruning, and carry a timeline of one person's activity for no additional
 * answer. Rolling up on the primary key gives the same numbers, bounded by the
 * number of (day, action, tier, model) combinations, and holds nothing that
 * points at a user.
 */
export const generationUsage = pgTable(
  "generation_usage",
  {
    day: text("day").notNull(),
    action: text("action").notNull(),
    tier: text("tier").notNull(),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    calls: integer("calls").notNull().default(0),
    // bigint, not integer: these are sums over a whole day for one combination,
    // and a 32-bit column tops out around two billion tokens. Widening a column
    // in place later is an outage; picking the right one now is free.
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    reasoningTokens: bigint("reasoning_tokens", { mode: "number" }).notNull().default(0),
    /** How many of those calls came back through a destructive repair. */
    repairs: integer("repairs").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.day, t.action, t.tier, t.provider, t.modelId] })],
);

/**
 * Metering for `pro`'s daily abuse cap, and a plain call-count for BYOK.
 * `subject` is the user id when signed in, otherwise a salted hash of the
 * client IP — never the raw address. `day` is a UTC YYYY-MM-DD string, so a
 * row is naturally scoped to one day and the counter resets without a cron job.
 *
 * Increments run as INSERT ... ON CONFLICT DO UPDATE against the primary key,
 * which makes them atomic under concurrency without an explicit transaction.
 */
export const usageCounter = pgTable(
  "usage_counter",
  {
    subject: text("subject").notNull(),
    day: text("day").notNull(),
    used: integer("used").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.subject, t.day] }),
    uniqueIndex("usage_counter_subject_day_idx").on(t.subject, t.day),
  ],
);

/**
 * The result of each document generation, kept for `RESULT_TTL_MS` (a day) under
 * the idempotency key the browser sent with it — see
 * `lib/generation/result-cache.ts` for the whole mechanism and why it exists: a
 * CV the server finished, and charged for, must not be lost because the
 * connection dropped or the browser could not store it, and must not be
 * generated a second time to get it back.
 *
 * The one table here an anonymous BYOK user's request writes to, which the
 * header of this file used to rule out. What makes that acceptable is what is
 * stored: never the key itself (only its SHA-256), and the result encrypted with
 * a key derived from it — so neither this database nor its backups can read a
 * row without the browser that asked for it. No `user_id`, by the same logic:
 * nothing here identifies anyone to whoever can read the table.
 *
 * `running` rows are the idempotency lock: a second request with the same key
 * while the first is still generating is answered 409 instead of paying for a
 * second CV. One older than `RUNNING_STALE_MS` belongs to a request that died
 * and is taken over.
 */
export const generationResult = pgTable(
  "generation_result",
  {
    keyHash: text("key_hash").primaryKey(),
    kind: text("kind").notNull(),
    /** SHA-256 of the request body: a key reused for a different request never replays the old answer. */
    bodyHash: text("body_hash").notNull(),
    /** `running` | `done`. */
    status: text("status").notNull(),
    /** base64 of AES-256-GCM ciphertext followed by its tag. Null while running. */
    ciphertext: text("ciphertext"),
    iv: text("iv"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => [index("generation_result_expires_idx").on(t.expiresAt)],
);

// --- Abuse control ------------------------------------------------------------

/**
 * Better Auth's rate limit buckets, keyed by `<subject>|<path>`.
 *
 * Better Auth owns this table outright: with `rateLimit.storage: "database"` it
 * reads and writes it through the Drizzle adapter, under the model name
 * `rateLimit`. Nothing else may write here — see `appRateLimit` below for why
 * sharing it turned out to be a mistake.
 *
 * In Postgres rather than in memory on purpose. The in-memory default resets on
 * every deploy — which is to say, an attacker gets a fresh allowance whenever we
 * ship — and gives each replica its own copy of a limit that is supposed to be
 * global.
 */
export const rateLimit = pgTable("rate_limit", {
  /**
   * Better Auth's Drizzle adapter requires an `id` on every model it owns and
   * refuses to start without one, so the natural key gets a unique index
   * instead of the primary key. Better Auth still upserts on `key`, which is
   * what keeps it one row per bucket — and what makes its own read-then-create
   * path safe when two requests race to open the same window.
   */
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull().default(0),
  /** Epoch millis. bigint because it does not fit in a 32-bit integer. */
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/**
 * Rate limit buckets for the routes Better Auth never sees — `lib/rate-limit.ts`
 * is the only writer. Same shape as `rate_limit` above, deliberately not that
 * table: Better Auth prunes it on every request with a cutoff of
 * `max(window, 10, 60)` seconds and no awareness of `customRules`
 * (`better-auth/dist/api/rate-limiter/index.mjs`, `deleteExpiredRows`), so any
 * bucket sharing it that outlives 60 seconds gets wiped under it. A rule with a
 * multi-hour window — the email-sending endpoints in `lib/auth.ts`, the email
 * budget in `lib/email/budget.ts` — would silently reset every minute.
 */
export const appRateLimit = pgTable("app_rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull().default(0),
  /** Epoch millis. bigint because it does not fit in a 32-bit integer. */
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/**
 * Failed sign-ins per account, for the lockout in `lib/auth-lockout.ts`.
 *
 * Separate from `rate_limit` because it answers a different question. That one
 * asks "is this address asking too often", which a distributed attacker defeats
 * by spreading the guesses across addresses. This one asks "is this account
 * under attack", which does not care where the guesses come from.
 *
 * Keyed by email rather than user id: the attempt has to be counted before we
 * know whether the account exists, and counting only the ones that resolve would
 * turn the lockout itself into an account-enumeration oracle.
 */
export const loginAttempt = pgTable("login_attempt", {
  /** Lowercased, so `A@b.com` and `a@b.com` share a bucket. */
  email: text("email").primaryKey(),
  failures: integer("failures").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
  /** Whether the owner has already been told about this run of failures. */
  notifiedAt: timestamp("notified_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Las solicitudes de arrepentimiento y de baja, tal como entran.
 *
 * Existe por una razón registral antes que funcional: la Res. SCI 424/2020 pide
 * que el botón de arrepentimiento deje constancia, y la constancia sirve de poco
 * si vive únicamente en la casilla del que la pidió. Esta tabla es la otra mitad
 * — la que permite responder «cuándo se pidió, y qué se hizo» meses después, que
 * es exactamente lo que pregunta una inspección.
 *
 * Sin `userId` y sin clave foránea, a propósito. El formulario es público y no
 * pide iniciar sesión, porque obligar a recordar una contraseña para poder
 * arrepentirse es justamente la fricción que la resolución vino a prohibir. Eso
 * implica que el email puede no corresponder a ninguna cuenta —un error de
 * tipeo, alguien que compró con otra dirección— y una FK convertiría ese caso en
 * un error en vez de en una solicitud que hay que atender igual.
 *
 * `status` se mueve a mano por ahora: no hay reintegro automático, y fingir que
 * lo hay con un estado que nadie actualiza sería peor que una fila que un humano
 * cierra cuando devolvió la plata.
 */
export const legalRequest = pgTable(
  "legal_request",
  {
    /** El código que se le informa al solicitante, para que pueda citarlo. */
    id: text("id").primaryKey(),
    /** "arrepentimiento" | "baja". Texto y no enum, por lo mismo que `gateway`. */
    kind: text("kind").notNull(),
    /** Lowercased, como en `login_attempt`, para que la búsqueda no dependa del tipeo. */
    email: text("email").notNull(),
    /** Lo que el solicitante quiera agregar. Opcional: no hay que expresar causa. */
    details: text("details").notNull().default(""),
    /** "pendiente" | "resuelta". Lo mueve una persona. */
    status: text("status").notNull().default("pendiente"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
  },
  (t) => [
    index("legal_request_email_idx").on(t.email),
    index("legal_request_status_idx").on(t.status),
  ],
);

/**
 * El consentimiento del titular a la transferencia internacional de sus datos.
 *
 * Generar un CV implica mandarle el perfil a un modelo que corre fuera del país
 * — hoy DeepSeek, en China. El art. 12 de la Ley 25.326 prohíbe transferir datos
 * personales a países sin nivel de protección adecuado, y China no integra la
 * lista de la Disp. AAIP 60-E/2016. La vía que sostiene esa transferencia es el
 * consentimiento del titular, y el consentimiento que no se puede probar es
 * equivalente a no haberlo pedido: esta tabla es la prueba.
 *
 * La clave primaria incluye la `version` a propósito, en vez de ser sólo
 * `(userId, kind)` con la versión como columna. Un upsert sobre la versión
 * pisaría el consentimiento anterior, y lo que hay que poder responder es «a qué
 * texto consintió, y cuándo», no «a qué consiente ahora». Cada versión de la
 * política aceptada deja su propia fila, y ninguna se borra por el paso del
 * tiempo.
 *
 * Se va con la cuenta (`onDelete: "cascade"`): quien borró sus datos no dejó un
 * consentimiento vigente para transferirlos.
 */
export const consent = pgTable(
  "consent",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /**
     * "terms" | "transfer" | "job_alerts" | "tracker_mail" |
     * "tracker_mail_inbox". Texto y no enum, por lo mismo que `gateway`.
     *
     * "tracker_mail" y "tracker_mail_inbox" son cláusulas distintas pese al
     * nombre parecido: "tracker_mail" es el aviso de ghosting del tracker
     * (cláusula 16, `hasTrackerMailConsent`); "tracker_mail_inbox" es el
     * reenvío de correspondencia de terceros a la casilla del tracker
     * (cláusula 17, `recordTrackerMailInboxConsent`) — ver el comentario de
     * esa función en `lib/legal/consent.ts` para por qué es la única de las
     * cinco sin una función de retiro que borre la fila.
     */
    kind: text("kind").notNull(),
    /** El `LEGAL_VERSION` de `lib/legal/operator.ts` vigente al aceptar. */
    version: text("version").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.kind, t.version] }),
    index("consent_user_id_idx").on(t.userId),
  ],
);

// --- Job discovery --------------------------------------------------------

/**
 * One listing pulled from a public job board's own feed or API — Get on
 * Board, Himalayas, Remotive, Arbeitnow, Jobicy (see `scripts/ingest-jobs.mjs`),
 * Jooble (`scripts/ingest-jooble.mjs`), and the ATS job boards of a seed list
 * of companies — Greenhouse, Lever, Ashby, Recruitee, Workable,
 * SmartRecruiters (`scripts/ingest-ats.mjs`, `scripts/jobs/companies.json`).
 *
 * Deliberately anonymous: this table never joins to `user`. Matching a
 * listing against a candidate happens in the browser, against the profile
 * `useProfile()` already holds — `lib/jobs/score.ts` — so the server never
 * receives, and this table never stores, anything about who is looking. That
 * is not a simplification made for later; it is the reason `/api/jobs/feed`
 * needs no session and the privacy policy needs no new clause 5 entry for it
 * (see the plan this table shipped with).
 *
 * `id` is `${source}:${externalId}` rather than a generated uuid (ATS rows use
 * `${ats}:${companyToken}:${externalId}`, since the same external id can
 * repeat across companies on the same ATS), so a re-ingested listing upserts
 * onto the same row instead of duplicating — `scripts/ingest-jobs.mjs` runs
 * on a schedule and will see the same posting on every run until it drops
 * off the source's own feed. `scripts/ingest-jooble.mjs` writes the same way
 * but far less often — see the comment on `jobSourceBudget` below for why —
 * and `scripts/ingest-ats.mjs` skips the write entirely when the ATS answers
 * 304 to its `If-None-Match` — see `jobSourceEtag` below.
 *
 * Different listings for the same role posted through more than one source
 * are not merged into one row — each source's listing stays a row of its
 * own, deep-linking to that source's own apply page — but they do share a
 * `dedupGroupId`, which is what lets `/api/jobs/feed` collapse them into one
 * result instead of showing the same role twice.
 *
 * No raw-payload `jsonb` column, unlike `application`/`profile`. Those hold
 * one row per user by design; this holds every listing every source has
 * right now, on the same 5Gi disk `scripts/prune.mjs` already watches the
 * headroom of (shared with an unrelated CRM) — see its `PVC_WARN_FRACTION`
 * comment. A raw copy of everything a source returns multiplies the size of
 * this table for no reader that exists yet; the columns below are what
 * `/api/jobs/feed` and `lib/jobs/score.ts` actually read.
 */
export const jobPosting = pgTable(
  "job_posting",
  {
    /** `${source}:${externalId}` — see the table comment. */
    id: text("id").primaryKey(),
    /** "getonbrd" | "himalayas" | "remotive" | "arbeitnow" | "jobicy" |
     *  "jooble" | "greenhouse" | "lever" | "ashby" | "recruitee" |
     *  "workable" | "smartrecruiters" today. Texto y no enum, por lo mismo
     *  que `gateway` en `credit_purchase`. */
    source: text("source").notNull(),
    /** Where "Postular" sends the candidate — the source's own listing page,
     *  never a page this app renders. */
    url: text("url").notNull(),
    title: text("title").notNull(),
    company: text("company").notNull().default(""),
    location: text("location").notNull().default(""),
    /**
     * ISO-3166 alpha-2 of the listing's country when the ingester has
     * positive evidence of exactly one, `""` otherwise. Evidence is either
     * the request itself being scoped to a country (`country_code=AR` for Get
     * on Board, `location: "Argentina"` for Jooble), a structured country
     * field the source returns, or an unambiguous country/city name in the
     * location text (`resolveCountry` in `scripts/jobs/shared.mjs`) — and a
     * text that names two countries resolves to `""`, never to one of them.
     * Never inferred from "remote"/"worldwide".
     *
     * Two consumers. `app/api/jobs/feed/route.ts` sorts listings matching the
     * visitor's country (`CF-IPCountry`) first. And it requires this to equal
     * `"AR"` whenever `workMode` is `"onsite"` or `"hybrid"`, because both
     * require physical presence and this product is exclusively for Argentina
     * (términos, cláusula 2). That second use is the reason the column
     * exists: before it, Arbeitnow — "mayormente Alemania" per its own
     * comment — set `workMode: "onsite"` on any non-remote listing with
     * *some* location text, and a "Presencial" filter surfaced mostly German
     * listings. Filling in other countries does not weaken it: only `"AR"`
     * passes that filter, and ingesters only mark `onsite` when they
     * resolved `"AR"`. A future source would need to lie about `country` too,
     * not just about `workMode`.
     */
    country: text("country").notNull().default(""),
    /**
     * Same enum as `JobAnalysis.workMode` in `lib/schemas/job.ts`
     * ("onsite" | "hybrid" | "remote" | "unknown") — `lib/jobs/score.ts`
     * reads both through the same `MatchInput` shape, so a raw listing and
     * one that has been through `analyzeJob` score identically.
     */
    workMode: text("work_mode").notNull().default("unknown"),
    /** Same enum as `JobAnalysis.seniority`. Most sources do not state this;
     *  "unknown" is the honest default, not a guess. */
    seniority: text("seniority").notNull().default("unknown"),
    /** BCP-47-ish, e.g. "es" | "en" — same shape as `JobAnalysis.language`.
     *  Empty when the source does not say and it was not worth guessing. */
    language: text("language").notNull().default(""),
    /**
     * Named terms and categories the source itself attaches to the listing.
     * `jsonb`, not a native pg array: nothing here needs an index into it,
     * and every other free-form list in this schema (`data` on `profile` and
     * `application`) already uses jsonb, so a reader never has to remember
     * which storage a list column uses.
     */
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    /** Plain text or light HTML, exactly as the source wrote it — never
     *  rewritten. `lib/jobs/score.ts` and `hardTermsIn` read it as prose. */
    description: text("description").notNull().default(""),
    salaryMin: integer("salary_min"),
    salaryMax: integer("salary_max"),
    salaryCurrency: text("salary_currency"),
    /** When the source published it — `null` when the source does not say. */
    publishedAt: timestamp("published_at"),
    /** When `scripts/ingest-jobs.mjs` last saw this listing. Drives
     *  `scripts/prune.mjs`'s retention, the same way `usage_counter.day`
     *  drives its own. */
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
    /**
     * Whether "Postular" may prefill the wizard's job text from `description`
     * directly, or must send the candidate to `url` instead.
     *
     * True for the sources `scripts/ingest-jobs.mjs` and `scripts/
     * ingest-ats.mjs` write — each hands back a full description with no
     * redistribution restriction, ATS job boards existing specifically to be
     * read by third parties like this one. `scripts/ingest-jooble.mjs`
     * writes `false`: Jooble is paid on click-through and its response
     * carries only a title and a snippet (`job.snippet`, not the posting
     * itself), so prefilling from it would both under-deliver the traffic
     * Jooble is paid for and hand the wizard a posting too thin for
     * `analyzeJob` to read. `scripts/jobs/ats/smartrecruiters.mjs` is the one
     * exception among the ATS adapters: its listing endpoint does not always
     * carry a full description, so it sets this per-row on whether one
     * actually came back, not a blanket `true`. Talent.com, planned next, is
     * the Jooble shape of problem. A column instead of a hardcoded source
     * list, so each ingester
     * declares its own answer once rather than every reader re-deriving it
     * from `source`.
     */
    canPrefill: boolean("can_prefill").notNull().default(true),
    /**
     * Groups listings for the same role posted through more than one
     * source — `normalize(title)|normalize(company)`, computed by each
     * ingester (`dedupGroupId` in `scripts/jobs/shared.mjs`) at write time,
     * never here. `""` when the ingester had no company to anchor the group
     * on; `/api/jobs/feed` treats an empty string as "its own group of one"
     * rather than grouping every company-less listing together — grouping by
     * title alone would fold two different companies' "Desarrollador
     * Backend" into one, hiding a real listing.
     *
     * Not unique and not a foreign key to anything: it is purely a grouping
     * key `/api/jobs/feed` partitions by (newest `published_at` wins as the
     * representative) — see the window-function query there.
     */
    dedupGroupId: text("dedup_group_id").notNull().default(""),
  },
  (t) => [
    index("job_posting_published_at_idx").on(t.publishedAt),
    index("job_posting_source_idx").on(t.source),
    index("job_posting_dedup_group_id_idx").on(t.dedupGroupId),
  ],
);

/**
 * How many calls a metered job-listing API has spent, lifetime — today, just
 * Jooble.
 *
 * Jooble's free key is not a daily quota like everything else this app
 * meters (`usage_counter`, `app_rate_limit`): it is a flat 500 requests for
 * the life of the key, ever, full stop. Running it on the same 30-minute
 * cadence as `scripts/ingest-jobs.mjs` would spend that in under two weeks
 * and then deliver nothing for as long as the deployment runs — worse than
 * not integrating the source at all, because nothing would say so. This
 * table is what lets `scripts/ingest-jooble.mjs` refuse to make a call
 * rather than find out the key is spent from a 403.
 *
 * One row per source, `used` incremented by exactly the number of calls a
 * run actually made — never reset, never estimated. `scripts/prune.mjs`
 * does not touch this table, for the same reason it does not touch
 * `consent`: deleting the row would not free any budget back from Jooble, it
 * would only make the script forget how much it already spent and burn past
 * 500 believing it still had room.
 */
export const jobSourceBudget = pgTable("job_source_budget", {
  /** "jooble" today. Texto y no enum, por lo mismo que `gateway`. */
  source: text("source").primaryKey(),
  used: integer("used").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * ETag por empresa/fuente ATS — `scripts/ingest-ats.mjs` la lee antes de cada
 * request (`If-None-Match`) y la escribe después de una respuesta 200. Un
 * ATS que responde 304 no vuelve a upsertear nada esa corrida: con ~10+
 * empresas en la lista semilla (`scripts/jobs/companies.json`) corriendo
 * cada 3 horas, la mayoría de las corridas no tiene avisos nuevos por
 * empresa, y sin esto cada una igual reescribiría la misma fila.
 *
 * `key` es `"${ats}:${token}"` — no `source` a secas, porque a diferencia de
 * `job_posting.source` (un ATS por fila) acá hace falta identificar la
 * empresa además del ATS: dos empresas en Greenhouse tienen ETags distintos.
 *
 * No se poda, igual que `job_source_budget` y por el mismo motivo: un ETag
 * viejo no ocupa nada, y perderlo sólo cuesta una corrida completa en vez de
 * un 304.
 */
export const jobSourceEtag = pgTable("job_source_etag", {
  key: text("key").primaryKey(),
  etag: text("etag").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Configuración de alertas de empleo por correo — una fila por usuario, como
 * `profile`. Existe sólo mientras la alerta está activa; desactivarla borra
 * la fila (ver `app/api/jobs/alerts/route.ts`), y por eso no necesita un
 * campo `active` propio.
 *
 * Requiere el consentimiento `"job_alerts"` en `consent` — otorgado aparte
 * del de transferencia internacional, porque acá no hay transferencia: el
 * puntaje se calcula en este mismo servidor contra `job_posting`, con
 * `lib/jobs/score.ts`, nunca contra un proveedor de modelos de lenguaje. Ver
 * la cláusula 14 de la política de privacidad.
 *
 * También requiere `profile` sincronizado: sin perfil server-side no hay
 * contra qué puntuar un aviso fuera de una sesión de navegador, y el envío
 * de correo corre en un cron, no en una request del usuario.
 */
export const jobAlert = pgTable("job_alert", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Palabras clave libres, opcional — vacío significa "cualquier aviso". */
  query: text("query").notNull().default(""),
  /** "" | "remote" | "hybrid" | "onsite" — mismo enum que `jobPosting.workMode`, "" = todas. */
  workMode: text("work_mode").notNull().default(""),
  /** Piso del puntaje de `lib/jobs/score.ts` para que un aviso dispare el correo. */
  minScore: integer("min_score").notNull().default(60),
  /** "daily" | "weekly". Cuánto tiene que pasar desde `lastSentAt` para volver a mandar. */
  frequency: text("frequency").notNull().default("daily"),
  lastSentAt: timestamp("last_sent_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
