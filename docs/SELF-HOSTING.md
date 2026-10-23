# Autoalojar cvexact

Esta guía levanta una instancia propia con Docker Compose. No describe la
infraestructura de `cvexact.com`: esa es interna y no forma parte del repositorio.

## Requisitos

- Docker 24 o superior, con el plugin `docker compose`.
- 4 GB de RAM libres (Next, Postgres y Chromium para el PDF).
- Un dominio y un proxy con HTTPS delante (Caddy, nginx, Traefik o el que uses).

## Puesta en marcha

```bash
cp .env.example .env
# Editar .env: POSTGRES_PASSWORD, BETTER_AUTH_SECRET, BETTER_AUTH_URL y
# NEXT_PUBLIC_SITE_URL son lo mínimo para que la app arranque con cuentas.
# NEXT_PUBLIC_SOURCE_URL, si la usás, tiene que estar acá ANTES del build:
# Next la inlinea y `--build` la pasa como build arg (ver «Código fuente y AGPL»).
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
```

El servicio `migrate` aplica las migraciones y sale; `app` no arranca hasta que
termina. La salud se comprueba en `GET /api/health`:

```bash
curl -fsS http://localhost:3000/api/health
# {"status":"ok","db":true}
```

## Qué es obligatorio, qué es opcional y qué está apagado

| Bloque | Variables | Sin ellas |
|---|---|---|
| Base y cuentas | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | `/api/auth/*` responde 503 |
| URL pública | `NEXT_PUBLIC_SITE_URL` | El sitemap y los enlaces absolutos salen con `localhost` |
| Código fuente | `NEXT_PUBLIC_SOURCE_URL` (definirla al compilar) | No se muestra el enlace «Código fuente» del pie (AGPL §13) |
| Correo | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | No hay verificación de correo, recuperación de contraseña ni borrado de cuenta |
| IA con key propia | — | Es el modo por defecto: cada persona trae su key |
| IA con key del servicio | `SERVICE_API_KEY` | Sólo se usa si además hay un plan pago |
| Pagos | `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_PACK_PRICE_ARS`, `MP_SUB_PRICE_ARS` | La venta queda apagada; `/precios` muestra una sola columna |
| Facturación | `FISCAL_*` | No se emite comprobante; los créditos se acreditan igual |
| Analítica | `GA_MEASUREMENT_ID` | GA no se carga |
| Alertas y tracker por correo | `TRACKER_EMAIL_DOMAIN`, `JOOBLE_AR_API_KEY` | Esas funciones quedan apagadas |
| Captcha | `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Los flujos funcionan sin captcha |

Todo lo que está apagado no deja rastro: no hay una pantalla que lo muestre ni un
pedido que lo dispare.

## El PDF y Chromium

`lib/export/pdf.ts` usa un Chromium aparte y se conecta por CDP con
`BROWSER_WS_URL` (en el compose, `http://chromium:9222`). Sin esa variable, busca
un Chrome o Chromium instalado en la máquina (`CHROME_PATH` o las rutas habituales)
y, si no hay ninguno, la descarga del PDF responde con un error explicativo.

No publiques el puerto 9222: Chromium sólo tiene que ser alcanzable desde la app.

## HTTPS, IP del cliente y proxy

Poné la app detrás de un proxy con TLS y configurá:

- `BETTER_AUTH_URL` y `NEXT_PUBLIC_SITE_URL` con el dominio público y `https://`.
- `CLIENT_IP_HEADERS` con los headers que agrega tu proxy, en orden. Si el proxy
  no está, no los declares: un cliente podría elegir su propia clave de rate limit.
- `TRUSTED_PROXIES` sólo si el proxy es propio y su IP es fija.

No expongas Postgres (`5432`) ni Chromium (`9222`) fuera de la red de compose.

## Datos, copias y bajas

- Los datos de la app viven en el volumen `postgres-data`.
- `scripts/backup.mjs` corre con la imagen `migrator` (tiene `pg_dump`) y escribe
  una copia cifrada con `BACKUP_ENCRYPTION_KEY`. Programalo con el scheduler que
  uses (cron del host, un timer de systemd o el CronJob de tu orquestador).
- «Borrar los datos de este navegador» y el borrado de cuenta funcionan igual; el
  perfil vive en el navegador de la persona y la copia en la cuenta es opcional.

## Código fuente y AGPL

La app muestra un enlace «Código fuente» en el pie cuando
`NEXT_PUBLIC_SOURCE_URL` está definida. Tiene que apuntar al código de la versión
que efectivamente corre (un tag o commit), no a la rama de desarrollo. Si operás
un fork modificado y lo ofrecés por red, la AGPL §13 pide ofrecer el código
correspondiente a quienes lo usan; el enlace es la forma visible de hacerlo. Sin
la variable, el enlace no se muestra y esa obligación queda sin cumplir en la
interfaz.

**Definila antes de compilar.** Es una variable `NEXT_PUBLIC_*`: Next reemplaza
su valor en el bundle durante `next build`, y el servidor no vuelve a leerla del
entorno. Si construís con la variable vacía y la agregás después al contenedor,
el enlace sigue oculto. Después de cada cambio de URL hay que reconstruir la
imagen.

Con Docker Compose, el `deploy/docker-compose.yml` la pasa como build arg desde
el archivo indicado con `--env-file`:

```bash
# En .env o en el entorno del comando; la misma URL que el código desplegado.
NEXT_PUBLIC_SOURCE_URL='https://.../tree/<tag-o-commit>' \
  docker compose -f deploy/docker-compose.yml --env-file .env build app
docker compose -f deploy/docker-compose.yml --env-file .env up -d
```

Con `docker build` directo:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SOURCE_URL='https://.../tree/<tag-o-commit>' \
  -t cvexact:local .
```

Con un build de Next sin Docker (`pnpm build`), exportala en el mismo comando:

```bash
NEXT_PUBLIC_SOURCE_URL='https://.../tree/<tag-o-commit>' pnpm build
```

Para verificar el artefacto ya construido, con la misma variable en el entorno:

```bash
pnpm verify:publication-source
```

El verificador arranca `node .next/standalone/server.js` sin la variable en
runtime (para probar que quedó horneada), rechaza URLs ficticias o que apunten a
`main`/`master`, y comprueba el `href` y el texto «Código fuente» en `/`,
`/legales/privacidad` y `/legales/terminos`. El pie de la aplicación logueada se
revisa a mano porque requiere sesión y base de datos.

## Legal y datos personales

Cada instancia autoalojada es un tratamiento distinto: quien la opera es el
responsable, no el proyecto. Antes de abrirla al público:

- Completá `LEGAL_OPERATOR_NAME`, `LEGAL_CONTACT_EMAIL` y, si vendés,
  `LEGAL_OPERATOR_TAX_ID` y `LEGAL_OPERATOR_ADDRESS`. Vacíos se muestran como
  «[pendiente de carga]» a propósito.
- Revisá la política de privacidad y los términos con tu propia situación.
- La política publicada en `cvexact.com` no cubre tu instancia.

## Actualizar

```bash
git pull
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
```

El servicio `migrate` vuelve a correr antes de que arranque la app. Si una versión
sube `LEGAL_VERSION`, las alertas y los recordatorios quedan en pausa hasta que
cada persona vuelva a aceptar desde la app.

## Problemas frecuentes

- **`db:false` en `/api/health`**: `DATABASE_URL` no está definida o no llega al
  contenedor. En compose, la variable de `environment` pisa la del `.env`.
- **El PDF falla con «No pudimos conectarnos al navegador»**: Chromium no arrancó
  o `BROWSER_WS_URL` no apunta al servicio. Revisá `docker compose logs chromium`.
- **Los enlaces absolutos salen con `localhost`**: falta `NEXT_PUBLIC_SITE_URL`.
- **El correo no llega**: sin `SMTP_HOST` y `MAIL_FROM` el mailer queda apagado a
  propósito, en vez de fingir que funciona.
