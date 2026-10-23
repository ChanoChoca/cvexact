# Tracker de postulaciones — plan de encaje

Cómo entra el tracker en la arquitectura que ya existe, qué convenciones sigue y qué
asume. Escrito antes de tocar código, y actualizado si algo cambia al implementarlo.

Alcance original: Fases 0, 1 y 2, con la Fase 3 (detección de estados por email)
sólo especificada en [`tracker-email-fase3.md`](./tracker-email-fase3.md) y la Fase 4
(extensión de navegador) fuera de alcance. Las cuatro fases terminaron implementadas
—la 3 a pedido explícito, y la 4 con una decisión de alcance que no era mía (qué sitios
puede capturar la extensión, ver el AskUserQuestion de esa tarea) resuelta con el
usuario antes de escribir código—; ver `tracker-email-fase3.md` para el detalle de la 3
y `extension/README.md` para la 4.

---

## 1. Con qué se encuentra el tracker

El repo **no es** lo que asume el spec. Las diferencias que importan:

| El spec asume | Acá hay |
|---|---|
| Supabase, RLS, `auth.users`, `uuid` | Postgres plano, Drizzle, Better Auth, ids `text` |
| `pgEnum` para el pipeline | Convención explícita: los enums son `text` con comentario |
| Server Actions | Cero. Route handlers con orden fijo de guardas |
| TanStack Query / Table | Cero dependencias de UI. Primitivas a mano en `components/ui` |
| GitHub Actions / Cloudflare para el cron | CronJobs de Kubernetes ya desplegados |
| Resend SDK | nodemailer sobre el SMTP de Resend, con presupuesto propio |

Ninguna de esas diferencias es accidental — cada una tiene su razón escrita en el
código. El tracker se adapta a todas.

Lo que sí está listo para reusar:

- `getSessionUser(headers)` en `lib/auth.ts`, y las guardas `requireVerifiedEmail` /
  `enforceRateLimit` de `lib/api/guards.ts`.
- `getDb()` / `databaseConfigured` de `lib/db`. **Toda** lectura o escritura se guarda
  detrás de `databaseConfigured`: un despliegue sin base tiene que degradar, no tirar 500.
- `sendMail` + `reserveMailBudget`, que ya resuelven la degradación por cuota agotada.
- El patrón de cron: script `.mjs` fino que le pega a una route interna protegida por
  `x-origin-auth` en `proxy.ts` (`app/api/jobs/alerts/send/route.ts` es el modelo).
- Las primitivas de UI, el `useToast` y el `useConfirm` ya montados en el layout raíz.
- El feed de empleos: `job_posting`, `lib/jobs/feed-query.ts`, `lib/jobs/score.ts`.

---

## 2. La decisión central: fusionar, no agregar

Hoy la palabra "postulación" nombra dos cosas distintas: el `Application` de
`lib/storage/local.ts` (aviso + CV generado + respuestas + prep + guion + un `status` de
cuatro valores) y su espejo `application` en Postgres, que sólo existe si el usuario
apretó "Subir" en Ajustes.

Agregar una tabla `tracked_application` al lado dejaría al usuario con dos listas que
dicen lo mismo y no coinciden. Así que **la fila de `application` pasa a ser la columna
vertebral del tracker**, con columnas nuevas para el aviso y el pipeline. El `id` es el
mismo de los dos lados: el `crypto.randomUUID()` que ya genera `newApplication()`.

Los artefactos pesados y personales — el documento del CV, las respuestas, la
preparación de entrevista, el guion — **siguen en el navegador**. Eso no es una
limitación técnica sino la identidad del producto, y lo dice la política de privacidad.
Lo que sube al servidor es el metadato del aviso y el estado del proceso, que es lo
mínimo que un cron necesita para detectar ghosting y mandar un recordatorio.

### Qué pasa con quien no tiene cuenta

Sigue funcionando igual que hoy. `/postulaciones` detecta la sesión:

- **Sin cuenta** → la lista local de siempre, con su ventana de undo y su aviso
  local-only, más una tarjeta que explica que el kanban, el ghosting y los recordatorios
  necesitan cuenta porque corren en un servidor.
- **Con cuenta** → el tracker completo, y la primera vez, un botón para importar de una
  las postulaciones que ya están en este navegador. Explícito, nunca automático: es la
  misma regla que hace que el sync de hoy tenga dos botones y diga cuál pisa a cuál.

### Un solo vocabulario de estados

Los nueve estados del spec reemplazan a los cuatro actuales, también en localStorage. La
migración corre al leer, con el mecanismo que ya existe para los renombres de claves:

| Antes | Ahora |
|---|---|
| `borrador` | `guardado` |
| `enviada` | `postulado` |
| `entrevista` | `entrevista` |
| `cerrada` | `rechazado` |

`cerrada → rechazado` es una apuesta, no un hecho: es cómo termina la enorme mayoría de
los procesos, y el usuario puede corregirlo en un click desde la UI.

---

## 3. Modelo de datos

Convenciones del repo, no las del spec: nombres de tabla en singular, columnas SQL en
snake_case declaradas explícitamente, índices `<tabla>_<columnas>_idx`, ids `text`,
enums como `text` con comentario, y comentarios largos que expliquen la razón.

### `application`, extendida

Las columnas viejas (`label`, `data jsonb`) quedan intactas para que el sync no se rompa.
Se agregan las del aviso (`job_title`, `company`, `company_norm` generada, `source`,
`job_posting_id`, `job_url`, `jd_text`, `jd_jsonld`, `location`, `remote`, `salary_min`,
`salary_max`, `currency`) y las del pipeline (`status`, `applied_at`,
`last_activity_at`, `cv_version_id`, `board_position`, `archived`).

Índices: `(user_id, status) where not archived`, `(user_id, last_activity_at)`,
`(user_id, company_norm, job_title)`.

### Tablas nuevas

`cv_version`, `application_event`, `application_contact`, `application_reminder`, y
`email_inbox` (creada para la Fase 3, sin lector todavía).

### La regla de integridad

El criterio 5 pide que sea **imposible** cambiar el estado sin generar el evento. Una
capa de servicio única no lo garantiza: garantiza que el código que hoy existe lo
respeta. Un trigger sí.

`application_status_event()` es un trigger `after insert or update of status on
application` y es el **único** escritor de eventos de cambio de estado. La capa de
servicio no inserta esas filas; abre una transacción, declara de dónde viene el cambio
con `set local app.event_detected_from = 'sistema'` (o `'email'`; el default es
`'manual'`), y el trigger lo lee con `current_setting('app.event_detected_from', true)`.

Así un `update` a mano desde `psql` también deja su evento.

### Las métricas se calculan sobre `application_event`

Nunca sobre el estado actual de `application`. Una postulación que pasó por entrevista y
terminó rechazada tiene que contar como entrevista en la conversión, y el estado actual
ya no lo dice.

### `cv_version`: la métrica estrella, con una salvedad honesta

El diferenciador es la conversión por versión de CV. Pero como acá **cada CV es adaptado
por aviso**, un hash del contenido daría una versión distinta por postulación y la
métrica no diría nada: todo sería n=1.

Lo que agrupa de verdad es la **variante**. El fingerprint se deriva en el navegador de
un subconjunto estable del CV — el título profesional, los ids ordenados de las
experiencias incluidas, y el conjunto de aptitudes — de modo que las adaptaciones de un
mismo CV base colapsen en una sola versión. El usuario puede renombrarla.

**El servidor nunca recibe el contenido del CV.** Sólo `{ id, user_id, label,
fingerprint }`. La métrica se puede calcular igual, y la promesa de que el CV vive en el
navegador se mantiene.

Y como pide el spec: con menos de 10 postulaciones enviadas con una versión, la métrica
se marca como no significativa en vez de mostrar un porcentaje que engaña.

---

## 4. Aislamiento entre usuarios

El spec pide RLS. Este Postgres no tiene RLS en ninguna tabla, y no por descuido: la app
se conecta con un único rol que además es dueño de las tablas, y un dueño **bypassea**
las políticas salvo que se declare `force row level security`. Hacerlo de verdad
significa un rol de aplicación separado, grants nuevos en el despliegue, y un
`set local app.user_id` por request envolviendo cada query del repo, no sólo las del
tracker.

Se hace lo mismo que ya hacen `profile`, `application` y `job_alert`: filtrar por
`user_id` en cada query. Lo que se agrega para que eso sea verificable y no una promesa:

- Un helper de scoping en `lib/tracker/service.ts` que toda query del tracker usa.
- `tests/tracker-scope.test.ts`, que recorre cada función exportada del servicio y afirma
  que el SQL generado lleva el filtro por `user_id`.

Cumple el espíritu del criterio 11, no su letra. Está anotado como desvío a propósito.

---

## 5. Costo cero, verificado

- **Sin Gmail API**, ni como opción. Los scopes de lectura son restricted y arrastran una
  evaluación CASA anual paga.
- **Sin auto-apply, sin autofill, sin credenciales de portales, sin scraping** de
  LinkedIn ni Indeed. El import por URL es un fetch puntual a una URL que el propio
  usuario pegó, con User-Agent identificable y timeout de 10 s. No hay crawler.
- **Sin LLM** en el import: si no hay JSON-LD, se cae a `<title>`/`og:title`/meta
  description y se presenta un formulario prellenado.
- **Sin dependencias pagas.** La única nueva es dnd-kit.

Límites verificados el 2026-09-03:

| Servicio | Free tier | Nota |
|---|---|---|
| Resend | 3.000/mes, 100/día, 1 dominio | Ya en uso vía SMTP |
| Brevo | 300/día | Alternativa, no se adopta |
| Cloudflare Email Routing | Inbound sin límite de volumen, 200 reglas, 25 MiB | Fase 3 |
| Cloudflare Workers | 100.000 requests/día | Fase 3 |

`@dnd-kit/core@6.3.1` declara `react >=16.8.0`, compatible con el React 19.2.8 del repo.

**Supabase no aplica**: la base es Postgres propio en Hostinger, sin política de pausado
por inactividad. El riesgo que el spec anticipaba no existe acá.

---

## 6. Correo y degradación

`sendMail` pasa a devolver `Promise<boolean>`. Hoy devuelve `void` y se traga los
errores, lo cual está bien para un link de verificación pero no para un recordatorio: el
cron necesita saber si salió para decidir si marca `sent_at`. Sin eso, un recordatorio
que cae con la cuota agotada se pierde en silencio, que es exactamente lo que el
criterio 9 prohíbe. El cron no marca `sent_at` si el envío falló, y lo reintenta al día
siguiente.

Se agrega un `MailKind = "tracker"` con su propio tope diario. Para no romper la
invariante de que a los correos de cuenta (reset de contraseña) siempre les quedan al
menos 10 envíos diarios dentro del tope global de 90, se baja `UNSOLICITED_GATE_MAX` de
60 a 45 y se agrega `TRACKER_GATE_MAX = 15` — 45 + 20 + 15 = 80. Es un tradeoff real:
menos correos de verificación por día.

---

## 7. Cron

Un CronJob más, `cvexact-tracker`, corriendo `scripts/tracker-cron.mjs`, que le pega a
`POST /api/tracker/cron`. Sigue la regla que el repo ya tiene escrita: una tarea que
necesita TypeScript de la app (las plantillas de correo, los schemas) va como route con
un script fino adelante, porque la imagen `migrator` no compila TS.

Una corrida por día hace dos cosas, ambas por deltas y con índice, nunca full scan:

1. **Ghosting.** Postulaciones en `postulado` o `en_revision` con `last_activity_at`
   anterior a 21 días pasan a `sin_respuesta` con un evento `ghosting_detectado`. No en
   silencio: se avisa por correo y se puede revertir.
2. **Recordatorios vencidos.** `due_at` pasado, sin `sent_at`, sin descartar.

El copy del ghosting no culpabiliza. "Sin respuesta hace 21 días. Es lo más común: la
mayoría de los procesos terminan así, sin aviso." Eso es parte del posicionamiento, no
decoración.

---

## 8. Privacidad

El tracker cambia un hecho que la política de privacidad afirma hoy en la cláusula 3:
que las postulaciones viven sólo en el navegador. Para quien lo use, deja de ser cierto.

- Se corrige la cláusula 3 y se agrega una nueva: qué se guarda en el servidor, por qué,
  por cuánto tiempo, y cómo se exporta y se borra.
- **No se toca `LEGAL_VERSION`** para guardar el aviso y el estado del proceso en el
  servidor. Eso no es distinto, en naturaleza, de lo que `profile`/`application` ya hacen
  al sincronizar — mismo servidor, mismo destinatario, nada que se transfiera a un
  tercero — y ninguno de esos dos pide un consentimiento aparte del de los Términos que
  ya se acepta al crear la cuenta. Pedirle uno nuevo sólo al tracker sería inconsistente
  con ese precedente, no más seguro.
- **Decisión tomada: sí hace falta un `consent.kind` nuevo, pero sólo para el correo de
  ghosting.** El precedente que importa acá no es `profile`, es `job_alerts`: un envío
  recurrente, iniciado por el sistema, en un horario que el usuario nunca pidió. El aviso
  de ghosting por correo es exactamente eso, así que se lo trata igual —
  `consent.kind = "tracker_mail"`, chequeado por `hasTrackerMailConsent` en cada corrida
  del cron (`app/api/tracker/cron/route.ts`), no sólo al activarlo — con una tarjeta de
  opt-in explícito en `/postulaciones` (`GhostingMailCard.tsx`) que empieza destildada,
  igual que `JobAlertCard.tsx` y `EmailInboxCard.tsx`.

  El recordatorio de seguimiento **no** entra en este gate, a pesar de que esta misma
  sección lo agrupaba con el ghosting cuando sólo estaba especificada. La diferencia es
  que el recordatorio lo crea el usuario a mano, eligiendo fecha y mensaje por
  postulación — esa elección ya es la solicitud del correo, no hace falta un
  consentimiento aparte para algo que el usuario pidió explícitamente. Gatearlo también
  habría dejado recordatorios vencidos sin marcar como enviados para siempre en
  `listDueReminders` mientras el consentimiento no llegue, haciendo crecer esa cola sin
  techo — la restricción de eficiencia (sección 5 del requerimiento) pesa más que la
  simetría con el ghosting acá.

  La detección de abandono en sí (`markGhostedApplications`, el cambio a `sin_respuesta`
  y su evento) **no** depende de este consentimiento: corre igual para todas las cuentas,
  y el aviso sigue visible en el tablero y en el detalle de la postulación sin él. El
  consentimiento gobierna únicamente si además se manda un correo.
- El export de cuenta (`GET /api/sync?export=account`, art. 14 de la Ley 25.326) incluye
  las tablas nuevas. Si no, la promesa de la cláusula 8 — "te descarga todo lo que
  tenemos tuyo" — deja de ser cierta.
- El export a CSV y JSON del tracker es sin límites y sin plan pago. Decisión de
  producto: la portabilidad es una señal de confianza, y contrarresta el lock-in de la
  competencia.

---

## 9. Asunciones

1. El servidor recibe metadato del aviso y estado del proceso, nunca el contenido del CV.
2. `cerrada → rechazado` en la migración de estados, corregible desde la UI.
3. La agrupación de versiones de CV es por variante derivada, no por hash exacto.
4. `pg_trgm` se puede instalar en el Postgres de producción. Si el rol no tiene permiso
   para `create extension`, el fallback es Levenshtein sobre `company_norm`.
5. El camino anónimo se preserva entero; el tracker es una capa sobre él, no un reemplazo.
