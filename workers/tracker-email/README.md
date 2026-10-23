# tracker-email-worker

El Worker de la Fase 3 del tracker de postulaciones — ver
[`docs/tracker-email-fase3.md`](../../docs/tracker-email-fase3.md) para el diseño completo.
Recibe los correos que cada usuario reenvía a su alias
(`u_xxxxxxxx@<TRACKER_EMAIL_DOMAIN>`), los parsea con `postal-mime`, y le pasa
remitente + asunto + texto plano a `POST /api/tracker/email/ingest` de la app
principal, que es quien de verdad clasifica y escribe en Postgres.

Este directorio es un deploy separado (Cloudflare Workers, no Next.js) — no es
parte del `pnpm install`/`pnpm build` del resto del repo, y no corre en el
Docker Compose de `deploy/docker-compose.yml` ni en la infraestructura privada
del operador (ver `docs/SELF-HOSTING.md`).

## Qué falta configurar (fuera de este repo)

Nada de esto se puede hacer desde acá — son pasos manuales en el dashboard de
Cloudflare y la CLI de `wrangler`, con una cuenta y un dominio reales:

1. **El dominio de `TRACKER_EMAIL_DOMAIN` tiene que estar en Cloudflare** (DNS
   gestionado por Cloudflare, no sólo un CNAME externo) — Email Routing lo
   exige.
2. **Activar Email Routing** para ese dominio: Cloudflare dashboard → el
   dominio → Email → Email Routing → Get started. Cloudflare agrega los
   registros MX solo.
3. **Publicar este Worker**:
   ```bash
   cd workers/tracker-email
   pnpm install   # o npm install — no es parte del workspace del repo principal
   npx wrangler login
   npx wrangler secret put ORIGIN_AUTH_SECRET   # el mismo valor que el Secret de k8s
   ```
   Editar `wrangler.toml` y poner el `APP_URL` real (la URL pública de la
   app) antes de desplegar. Después:
   ```bash
   npx wrangler deploy
   ```
4. **Reglas de Email Routing → catch-all**: dashboard → el dominio → Email →
   Email Routing → Routing rules → Catch-all address → Action: "Send to a
   Worker" → elegir `tracker-email-worker`. Catch-all porque cada usuario
   tiene un alias distinto (`u_xxxxxxxx@...`) generado dinámicamente — no hay
   una lista fija de direcciones para dar de alta una por una.
5. **`TRACKER_EMAIL_DOMAIN`** en el entorno de la app principal (Secret de
   k8s / `.env`) tiene que ser el mismo dominio que se activó acá — es lo que
   usa `lib/tracker/email-inbox.ts` para generar los alias.

## Verificar antes de depender

Los límites del free tier de Cloudflare Email Routing y Workers cambian —
revisar la documentación oficial vigente antes de asumir los números que cita
`docs/tracker-email-fase3.md` (inbound sin límite de volumen, 200 reglas,
25 MiB por mensaje, SPF/DKIM exigido en el dominio de origen desde el
30/6/2025 al momento de escribir esto; Workers: 100.000 requests/día).

## Probar en local

`wrangler dev --test-scheduled` no simula bien el trigger de email —
la forma real de probar sin mandar un correo real es escribir un test que
invoque `export default.email(...)` directamente con un `message` armado a
mano (`raw` como un `ReadableStream`/`Blob` de un `.eml` de prueba) y un
`env` con `APP_URL` apuntando a `http://localhost:3000`. No hay un test así
en este directorio todavía — la lógica que vale la pena testear
exhaustivamente (clasificación, matching, qué se aplica y qué se propone)
ya está cubierta en `tests/tracker-email-*.test.ts`, contra
`lib/tracker/email-classifier.ts`/`email-match.ts`/`email-ingest.ts`; este
Worker es deliberadamente el tramo más fino y menos interesante del camino.
