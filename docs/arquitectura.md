# Arquitectura y funcionamiento

> Documento técnico extendido. La puerta de entrada es [`../README.md`](../README.md).
> Las rutas de código se nombran relativas a la raíz del repositorio.

CVExact genera un CV adaptado a cada oferta laboral, responde las preguntas del formulario
de postulación, escribe el email de presentación, prepara la entrevista y escribe el guion
del video de presentación que algunas búsquedas piden grabar.

## Cómo funciona

El modelo **nunca emite HTML**. Emite JSON validado contra un esquema Zod, y un renderer
determinista lo convierte en el layout exacto de la plantilla de referencia
(`public/plantilla-cv.html`, especificada en `docs/plantilla-cv.md`). Eso es lo que
permite garantizar que el formato se respeta: el modelo decide _qué texto va_, el código
decide _cómo se ve_.

```
Oferta laboral ──► JobAnalysis ──┐                        ┌─► renderer HTML ──► Chromium ──► PDF
                                 ├──► CVDocument JSON ──► ┤
Perfil ──► ProfileInference ─────┤──► respuestas del      └─► renderer docx ──────────────► .docx
                                 │    formulario
                                 ├──► email de presentación
                                 └──► InterviewPrep JSON ──► renderer ──► Chromium ──► PDF
```

El mismo `CVDocument` alimenta los dos renderers del CV: el de HTML/CSS produce la pantalla
y el PDF, y el de `.docx` produce el archivo que piden los portales y ATS que rechazan PDF.
Si cambia el layout, tienen que cambiar los dos.

**El PDF se genera en el servidor**, no desde el diálogo del navegador: un Chromium
headless carga la misma página que ves en pantalla y la imprime con
`@page { size: A4; margin: 0 }`. Es la única forma de que el archivo no dependa de que el
usuario acierte con las casillas de márgenes y encabezados. Ver
[`lib/export/`](../lib/export/).

**Una hoja se promete midiendo, quitando por categorías y comprobando el archivo.** La medición
espera a las tres caras de STIX _para ese texto_ y monta el documento fuera de pantalla para leer su
altura natural —el `min-height` de la hoja se anula en línea, porque si no todo CV corto «llena» la
página— (`components/cv/measure.ts`). Con eso, el motor (`lib/cv/fit.ts`) clasifica cada línea
quitable por lo que el aviso pide —cuántas palabras clave respalda, si tiene cifras, si es la única
evidencia de un requisito— y quita en escalera: redundantes y sin coincidencias primero (`normal`,
automático), después lo cuantificado que no habla del aviso (`relaxed`, con recibo y «Deshacer»), y
al final, **solo con un consentimiento que nombra cada cosa**, los logros cuantificados, los estudios
viejos, el resumen y la única evidencia de un requisito excluyente (`extreme`). Nunca toca el
encabezado, la primera viñeta del primer puesto, el puesto actual ni el último estudio; un puesto
viejo puede omitirse entero —encabezado incluido, y el recibo lo dice con empresa y fechas— y al
terminar devuelve lo que ya no hace falta para que la hoja no quede a medias. El ajuste es solo de
la copia de esa postulación (el perfil no cambia), no marca «Editado por vos»
(`withFittedCV` en `lib/storage/applications/normalize.ts`), deja constancia en «Qué se dejó afuera
del CV» y guarda el CV anterior para deshacerlo, en el mismo registro y una sola vez. La sesión —el
nivel alcanzado, si la IA ya se usó, cuántas comprobaciones de PDF fallaron y qué CV no se vuelve a
pedir— vive en el `Application` (`fitSession`), así que recargar no regala un intento. Y lo que se
entrega se comprueba sobre el archivo: la ruta del PDF devuelve, junto con los bytes, si salió en una
hoja (`countPdfPages`), si el contenido se sale, y si el PDF _contiene_ las fuentes esperadas
incrustadas (`inspectPdfFonts`, que lee los `FontDescriptor`; distinguir «se usó STIX» de «el PDF la
lleva» importa porque `document.fonts.check` puede decir que sí mientras un glifo fuera de los
`unicode-range` cae en una fuente del sistema). Un PDF de dos hojas, recortado o con tipografía
sustituida no se guarda: se ajusta al nivel siguiente con el límite apretado por lo que el PDF midió
de más, y se pide volver a descargar (hash nuevo, confirmación nueva). Las comprobaciones son tres por
sesión —la primera cuenta, y las fallas de infraestructura no gastan ninguna—; agotadas, la salida es
explícita: «Descargarlo igual», con la consecuencia dicha. Limitación conocida: un PDF cuyo productor
no es Chromium (`unverifiable`) se acepta y se registra en el servidor, porque la garantía se apoya
en la comprobación de la página y en el entorno real de despliegue. **Word queda fuera de la
promesa** —su maquetación depende de la tipografía instalada— y la interfaz lo dice en una línea
junto al botón.

**Acortar antes de quitar, y solo con la key de cada persona.** Cuando el CV mide de más, antes de la
escalera se intenta lo más barato: pedirle a la IA de la persona que diga lo mismo con menos palabras
(`lib/cv/condense.ts`). Se ofrece solo si trajo su propia key —lo que va son sus propias líneas, y el
paso existe para no borrar material: nunca se paga con nuestra key ni manda el CV a un proveedor que no
eligió— y como mucho **una vez por sesión** (`fitSession.aiUsed`, escrito antes de llamar: si no se
puede guardar, no se llama). Eligen las candidatas la medición por viñeta —una última línea casi vacía
devuelve una línea entera por unas palabras— y la categoría; la única evidencia de un requisito
excluyente nunca se acorta. Cada reescritura pasa la guardia de `lib/cv/condense-guard.ts`: más corta y
dentro del tope, mismas cifras y fechas, mismas tecnologías y nombres, las mismas negaciones, los
matices de autoría intactos (un «colaboré» no se vuelve «lideré») y, como _señal_ y no como prueba, cuánto
del vocabulario original sobrevive: debajo del piso se descarta, en la banda se acepta **marcada**. El
resumen, además, tiene que dejar en pie las reglas del documento (no abrir con «busco»). Lo que falla un
invariante deja su viñeta exactamente como estaba. El recibo muestra el antes y el después con un diff
por palabras —lo que sobra tachado, lo que cambió resaltado— porque ningún control automático prueba que
una frase siga diciendo lo mismo, y «Qué se dejó afuera del CV» guarda el texto anterior. Si aun así no
entra, sigue el ajuste determinista, sin reintentar la llamada.

`JobAnalysis` e `ProfileInference` se calculan una vez por postulación y se reutilizan en
las cuatro salidas, así una postulación completa cuesta ~5 llamadas al modelo y no ~8.

### Los tres problemas difíciles

- **Conocimiento implícito.** Un paso propio deduce lo que el usuario sabe pero no
  escribió («React» implica JSX, npm, ES6+; «cajero» implica manejo de efectivo y trato
  con clientes). Cada deducción lleva la línea del perfil de la que se desprende, y el
  usuario puede vetarla.
- **Postulaciones fuera del rubro.** `JobAnalysis` clasifica la distancia entre la oferta
  y el perfil (`direct` / `adjacent` / `unrelated`). En `unrelated` la experiencia se
  reescribe en habilidades transferibles, se saca la jerga técnica y se reordenan las
  secciones. Es lo que evita el CV de tres líneas.
- **Honestidad.** Los prompts prohíben inventar, y además `lib/ai/verify.ts` comprueba
  estructuralmente que ninguna empresa, institución o año del CV falte en el perfil. Los
  hallazgos se le muestran al usuario.


### Perfil y generación

El perfil vive en el navegador y la IA es una capa opcional sobre un motor determinista. Los generadores reciben una proyección plana del perfil y nunca el documento completo; el detalle de importación, reconciliación y almacenamiento está en el código de `lib/profile/`, `lib/parse/` y `lib/storage/`.

### El seguimiento de postulaciones

`/postulaciones` es dos productos distintos según haya cuenta o no, y ninguno le pide el
otro a la persona.

**Sin cuenta**, es exactamente lo de siempre: el historial de CVs generados, guardado
sólo en este navegador (IndexedDB; `localStorage` donde no hay IndexedDB — ver «Almacenamiento
del navegador» en las notas de mantenimiento), con undo al borrar y el mismo aviso de "esto vive
en tu navegador" de cualquier otra pantalla.

**Con cuenta**, se suma un tablero kanban server-side (`app/api/tracker/`,
`lib/tracker/service.ts`): arrastrar una tarjeta entre estados con `@dnd-kit`, filtrar y
ordenar en una vista tabla, y dos botones en `/empleos` — "Guardar" y "Ya me postulé" —
que crean la postulación en un click, con el CV vinculado si `lib/tracker/match-local-cv.ts`
encuentra uno generado para ese mismo aviso en este navegador.

Dos decisiones sostienen todo lo demás:

- **El documento del CV nunca sale del navegador**, tenga cuenta o no. Lo que el servidor
  guarda es metadato del aviso y el estado del proceso; la versión de CV enviada se
  identifica por un fingerprint derivado en el cliente (`lib/tracker/cv-version.ts`), no
  por el contenido. Es lo que hace posible la métrica de conversión por versión de CV sin
  romper la promesa de la cláusula 3 de la política de privacidad.
- **Es imposible cambiar el estado sin dejar un evento.** Un trigger de Postgres
  (`lib/db/migrations/0017_application_status_event_trigger.sql`), no la disciplina de la
  capa de servicio, es quien escribe cada fila de `application_event` — hasta un `UPDATE`
  hecho a mano desde `psql` deja su rastro. Las métricas del embudo se calculan siempre
  sobre ese timeline, nunca sobre el estado actual de la tabla.

Dos deploys aparte, cada uno con su propio `package.json` y excluidos a propósito del
`tsconfig`/`eslint` de la raíz (`tsconfig.json`), completan el tracker:

- **`workers/tracker-email/`** (Fase 3): un Cloudflare Email Worker que recibe los
  correos que cada usuario reenvía a un alias propio y los manda a
  `POST /api/tracker/email/ingest` para clasificar — sin LLM, por dominio del remitente y
  palabras clave (`lib/tracker/email-classifier.ts`). El Worker no decide nada, sólo
  parsea el MIME y reenvía; ver `docs/tracker-email-fase3.md`.
- **`extension/`** (Fase 4): una extensión de navegador (WXT) que captura, con un click
  manual sobre la pestaña activa, el aviso que la persona está mirando —en cualquier
  sitio— a su seguimiento. Sin `content_scripts` ni `host_permissions`: lee la página sólo
  cuando se aprieta el botón (`activeTab` + `scripting`), y se autentica con un token
  propio (`lib/tracker/extension-auth.ts`) en vez de la cookie de sesión, porque corre en
  su propio origen de extensión. Ver `extension/README.md`.

## Desarrollo

```bash
pnpm install
pnpm dev
```

Arranca en `http://localhost:3000`. **Sin configurar nada** podés recorrer toda la app y
ver el formato del CV en `/cv/demo/print`, que renderiza la plantilla de referencia.

Para generar de verdad hace falta una API key. Dos opciones:

1. **Tu propia key** (nada que configurar en el servidor): entrá a `/ajustes`, elegí
   proveedor y pegá la key. Se guarda solo en el navegador.

   Los proveedores son Google Gemini, Cerebras, Cloudflare Workers AI, OpenRouter, Groq,
   Mistral, NVIDIA NIM, Requesty, BazaarLink, api.airforce, Cohere y LLM7.io. Todos menos
   Cohere tienen un tier gratuito que se recarga solo: el más amplio es **Cerebras**, con
   1 millón de tokens por día y 30.000 por minuto, que da para generar un CV entero sin
   caer a otro (Groq no llega, ver abajo). **Cloudflare Workers AI** es el otro que llega:
   10.000 «neurons» por día que se recargan a la medianoche UTC, sin tarjeta y sin
   vencimiento, y alcanzan para varios CV diarios. Es el único que pide **dos** datos —
   la API key y el Account ID, porque su URL lleva la cuenta adentro— y Ajustes muestra
   los dos campos cuando lo elegís. **NVIDIA NIM** renueva 1000 créditos por mes y trae
   más de 100 modelos abiertos con una sola key. **LLM7.io** da un token con solo un mail,
   sin consola ni tarjeta: 40 pedidos por minuto y un millón de tokens cada 24 horas, de
   los cuales sirven seis modelos (el resto de su catálogo consume saldo). **Requesty**
   (200 pedidos/día), **BazaarLink** (50/día) y **api.airforce** (1000/día, pero solo 1
   por minuto) son agregadores y aportan menos, pero sirven como eslabones extra de la
   cadena. La key de prueba de Cohere es gratuita pero solo para uso no comercial.

   BazaarLink, api.airforce y LLM7.io están marcados como **experimentales**: revenden
   acceso de otros proveedores y no hay forma de verificar de dónde sale. Ajustes muestra
   un aviso antes de que pegues la key, porque cada generación manda tu historial laboral
   completo. Cloudflare no está en esa lista aunque su tier gratuito sea de los más chicos:
   corre los modelos en su propio hardware y el operador se puede verificar, que es el
   criterio y no el tamaño. Está escrito en `EXPERIMENTAL_PROVIDERS`, en
   `lib/ai/provider-catalog.ts`.

   El campo "Modelo" puede
   quedar vacío para usar el default del proveedor; "Ver modelos disponibles" pregunta
   con tu key cuáles sirve hoy, que es lo que hay que hacer cuando el proveedor retira
   el default y las generaciones empiezan a fallar con "el modelo indicado no existe".

   Podés cargar **más de un proveedor**, en orden. Si el primero se queda sin cuota, sin
   crédito, rechaza la key o no acepta el pedido, la generación sigue con el siguiente sin
   cortarte. Es lo que hace usable el tier gratuito de Groq: sus 8000 tokens por minuto no
   alcanzan para un CV pero sí para el email y las respuestas, así que con otro proveedor
   debajo el CV cae solo en ese y el resto sigue saliendo por Groq.

2. **La key del servicio**: poné `SERVICE_API_KEY` en `.env`, y `SERVICE_PROVIDER` con el
   proveedor que la emite (por defecto `google`; en producción, `together`). El modelo sale
   de `SERVICE_MODEL`, y `SERVICE_PRO_MODEL` es el más grande que corren `pro` y `credits`
   donde se nota. `AI_FALLBACKS` —un array JSON de `{provider, apiKey, model?}`— le da al
   servicio una red: se prueban en orden cuando la key de arriba no puede atender el pedido.
   Repetir el mismo proveedor con otra key rota keys contra el límite diario; nombrar otro
   sobrevive a que el primero se caiga.

   Esta key **no la ve nadie que no pague**. Es de `pro` y `credits` y de nadie más.

La base de datos es opcional en desarrollo: sin `DATABASE_URL` la app funciona igual, el
contador de cuota vive en memoria y las cuentas quedan deshabilitadas.

El PDF también funciona en desarrollo sin configurar nada: si no hay `BROWSER_WS_URL`
(el sidecar de compose), `lib/export/pdf.ts` lanza el Chrome o Chromium que ya tenga la
máquina y lo reusa entre descargas. Si el binario está en un lugar raro, `CHROME_PATH`
manda. Sin ninguno de los dos, el botón lo dice y ofrece la vista de impresión.

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint
pnpm test        # vitest
pnpm build
```

### Base de datos en desarrollo

```bash
docker run -d --name cvc-db -p 5432:5432 \
  -e POSTGRES_USER=cvexact -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=cvexact \
  postgres:18

export DATABASE_URL='postgres://cvexact:dev@localhost:5432/cvexact'
pnpm db:migrate
```

Misma versión mayor que la instancia de producción, a propósito: las diferencias de
versión de Postgres se descubren en el despliegue y no acá.

`pnpm db:generate` crea una migración nueva después de tocar `lib/db/schema.ts`.

### Cuentas en desarrollo

Las cuentas necesitan la base de datos **y** dos variables más:

```bash
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
BETTER_AUTH_URL=http://localhost:3000
```

Hasta que estén las tres, `authConfigured` en `lib/auth.ts` es falso y
**`/api/auth/*` responde `503` a propósito** — vas a ver
`GET /api/auth/get-session 503` en la consola de `pnpm dev`. No es un fallo: es una
instalación sin cuentas, y la app funciona entera así, con todo en el navegador.

`BETTER_AUTH_URL` es opcional en desarrollo pero **obligatoria en producción**: de ahí
salen los `trustedOrigins` con los que Better Auth defiende de CSRF, y la decisión de
marcar la cookie de sesión como `__Secure-`. Sin ella queda `baseURL: undefined` y las
dos cosas pasan a depender de lo que infiera de cada request.

### Correo

Tres funciones de cuenta necesitan mandar un enlace, y sin servidor de correo se quedan
apagadas en vez de fingir que funcionan:

| Función                | Sin SMTP                                                    |
| ---------------------- | ----------------------------------------------------------- |
| Verificación de correo | No se pide. `requiresVerification` devuelve `false` siempre |
| Recuperar contraseña   | `/forget-password` no está habilitado                       |
| Borrar cuenta          | `deleteUser.enabled` es `false`                             |

El interruptor es `mailConfigured` en `lib/email/mailer.ts`: `SMTP_HOST` **y** `MAIL_FROM`.
En desarrollo alcanza con Mailpit, que no pide autenticación y muestra lo que sale en
`localhost:8025`:

```bash
docker run -d -p 1025:1025 -p 8025:8025 axllent/mailpit
# en .env:
SMTP_HOST=localhost
SMTP_PORT=1025
MAIL_FROM="cvexact <hola@localhost>"
```

En producción el SMTP es de **Resend** (`smtp.resend.com:465`, usuario `resend`,
contraseña la API key), con la región de despacho del dominio en `eu-west-1`. No una
cuenta de correo personal: esa cuenta no tiene DPA disponible para papelar la cláusula 5
de `/legales/privacidad`, y Resend firma uno del art. 28 del RGPD para toda cuenta, sin
trámite aparte. Elegir la región de despacho no cambia dónde vive la cuenta de Resend
—eso queda en Estados Unidos siempre, ver el comentario de cabecera de esa misma
cláusula 5— solo desde dónde se entrega el correo. El plan free de Resend tiene un tope
duro de 100 mensajes por día; `lib/email/budget.ts` fija `GLOBAL_DAILY_MAX` bien por
debajo de eso a propósito, para que el rechazo llegue como un mensaje descartado con
motivo en el log, no como un fallo silencioso de Resend cuando se llega al tope real.

`sendMail` **nunca tira**: cada llamada sale de un flujo de Better Auth que ya hizo lo
suyo —el usuario quedó creado, el token quedó guardado—, así que un SMTP caído tiene que
ser un problema de entrega y no un alta a medio hacer. Tampoco loguea el cuerpo, que lleva
un token de un solo uso.

**Verificar el correo no bloquea el login.** Bloquea sólo lo que es de la cuenta:
`/api/sync` (las dos direcciones) y el alta de suscripción. Comprar créditos y generar
documentos siguen abiertos a propósito — quien pagó tiene que poder usar lo que compró, y
un mail que cayó en spam no es motivo para frenar una compra. Cancelar la suscripción
tampoco se bloquea nunca.

### Rate limit y lockout

Dos mecanismos distintos, que responden preguntas distintas:

| Mecanismo          | Pregunta                        | Dónde                                                                         |
| ------------------ | ------------------------------- | ----------------------------------------------------------------------------- |
| Rate limit por IP  | ¿Esta dirección pide demasiado? | `rateLimit` en `lib/auth.ts` (`/api/auth/*`) y `lib/rate-limit.ts` (el resto) |
| Lockout por cuenta | ¿Esta cuenta está bajo ataque?  | `lib/auth-lockout.ts`                                                         |

El primero no ve a un atacante repartido en un pool de proxies; el segundo no ve a uno que
prueba una contraseña contra mil cuentas. Hacen falta los dos.

Los dos guardan en Postgres, no en memoria del proceso. El default de Better Auth es
memoria, que se reinicia en cada despliegue —o sea que publicar una versión le regala al
atacante un cupo nuevo— y le da a cada réplica su propia copia de un límite que debería ser
global. La tabla es `rate_limit`, compartida entre Better Auth (`storage: "database"`) y
`lib/rate-limit.ts`; las claves están namespaceadas (`app:` de un lado) así que no chocan.

Los techos propios están en las rutas que son caras y gratis: `/api/export/pdf` (un Chromium
por llamada, sin sesión), `/api/models` (una llamada saliente por vez) y el camino **BYOK**
de `openRequest`. Ese último es el único anónimo, sin cupo y con 180 s de presupuesto: la
key es del usuario, pero la máquina es nuestra. Los tiers medidos no llevan techo extra
porque `reserveQuota` ya los acota.

El lockout arranca al quinto fallo y duplica la espera en cada uno (1, 2, 4… minutos) con
techo de 30. El techo importa: sin él, cualquiera que sepa un correo podría dejar afuera a
su dueño para siempre, y el lockout se volvería el ataque. Los fallos se cuentan aunque la
cuenta no exista, para que el mensaje no delate qué direcciones están registradas.

## Autoalojamiento

El repositorio incluye lo necesario para levantar una instancia propia con Docker
Compose: `deploy/docker-compose.yml` (la app, Postgres y Chromium para el PDF) y
la guía [`docs/SELF-HOSTING.md`](SELF-HOSTING.md), con qué variables son
obligatorias, qué queda apagado cuando faltan y cómo se protege la instancia.

La instancia de `cvexact.com` corre en otra infraestructura, que no forma parte de
este repositorio.

## Licencia

cvexact se distribuye bajo la GNU Affero General Public License, versión 3 o
posterior (AGPL-3.0-or-later). El texto completo está en [`LICENSE`](../LICENSE).

Las contribuciones se aceptan con el Developer Certificate of Origin
(`git commit -s`), sin CLA: ver [`docs/CONTRIBUTING.md`](CONTRIBUTING.md).

Si operás una instancia modificada y la ofrecés por red, la AGPL pide que ofrezcas
el código fuente correspondiente a quienes lo usan. La app muestra ese enlace en el
pie cuando `NEXT_PUBLIC_SOURCE_URL` apunta al tag o commit desplegado. Es una
variable `NEXT_PUBLIC_*`: hay que definirla **antes de compilar**, porque Next la
inlinea en el artefacto y el runtime no la vuelve a leer. Ver la sección «Código
fuente y AGPL» de [`SELF-HOSTING.md`](SELF-HOSTING.md).

## Marcas y activos

La licencia del código no concede derechos sobre el nombre, los logos ni la
identidad visual: ver [`TRADEMARKS.md`](../TRADEMARKS.md). Los activos propios y los de
terceros, con su procedencia y licencia, están en [`ASSETS.md`](../ASSETS.md) y
[`THIRD_PARTY.md`](../THIRD_PARTY.md).

## Estructura

```
deploy/               compose para autoalojar (app, Postgres y Chromium)
docs/                 guías, especificaciones y documentación pública
app/(app)/            perfil, postular, postulaciones, ajustes
app/cv/[id]/print     preview del CV a tamaño real (aislada, sin chrome)
app/prep/[id]/print   ídem para la hoja de entrevista
app/video/[id]/print  ídem para el guion del video
app/cv/render         lo que carga el Chromium headless; el documento y nada más
app/prep/render       ídem para la hoja de entrevista
app/video/render      ídem para el guion del video
app/api/generate/*    los generadores
app/api/export/pdf    imprime un documento ya generado; no gasta cuota
app/api/models        qué modelos sirve la key del usuario; no gasta cuota
components/profile/   el hub: ficha editable por secciones (`hub/`), historial, menú de reimportación
components/cv/        renderer estricto de la plantilla + su CSS
components/prep/      documento de entrevista + su CSS
components/video/     guion del video + su CSS
lib/docx/             renderer .docx del CV, hermano del de HTML
lib/export/           PDF server-side: el handoff del JSON y el driver del navegador
lib/schemas/          contratos Zod (perfil, oferta, CV, salidas)
lib/ai/prompts/       prompts, todos en inglés; el idioma de salida es un parámetro
lib/ai/verify.ts      verificación anti-fabricación
lib/ai/model-list.ts  catálogo de cada proveedor, para el selector de Ajustes
lib/ai/cooldown.ts    qué proveedor está rechazando trabajo ahora, entre pedidos
lib/profile/          el perfil guardado (cada valor con procedencia y estado), su migración, la proyección plana y la edición
lib/quota.ts          niveles y medición
lib/storage/          el navegador: postulaciones en IndexedDB (store en memoria, motores, migración), lo chico en localStorage, hooks reactivos
lib/applications/     generar → registrar: resultado a postulación, claves de idempotencia, recuperación
lib/generation/       el servidor guarda un día, cifrado, el resultado de cada generación (idempotencia)
lib/import/           lectura de un archivo en el navegador: texto, posiciones del PDF, hash, ZIP de LinkedIn
lib/parse/            lectores deterministas (sin IA) de un CV, del PDF y del ZIP de LinkedIn
lib/onboarding/       el flujo de primer uso: pasos, revisión del esqueleto, formularios, procedencia
components/onboarding/ las pantallas de ese flujo (`/perfil/empezar`)
```

## Notas de mantenimiento

- **Un documento se lee sin IA, en el navegador, y lo leído entra como propuesta.** `readDocument`
  (`lib/import/extract.ts`) saca el texto y, de un PDF, cada fragmento con su posición y tamaño;
  `parseDocument` (`lib/parse/index.ts`) elige el lector y `applyParsedDocument`
  (`lib/parse/to-profile.ts`) lo vuelca al perfil. Cada valor conserva como procedencia el fragmento
  del documento del que salió (`source.quote`), así que «De tu CV» / «De LinkedIn» son ciertos y la
  revisión puede mostrar el original al lado. Un bloque leído con confianza alta entra `confirmed`;
  con menos, `proposed`, y la revisión pregunta solo por esos. Nada de esto sale del navegador
  (`tests` no lo prueban, pero se comprobó capturando la red durante una importación): si se agrega
  un paso que mande el texto a un proveedor, la pantalla tiene que decirlo.
- **El PDF de LinkedIn se lee por tamaño y posición, no por palabras.** Sale siempre de la misma
  plantilla: barra lateral a la izquierda (`x < 150`), nombre en el texto más grande, encabezados un
  escalón abajo, la empresa apenas más grande que el puesto, el resto cuerpo. Son los números de
  `lib/parse/linkedin-pdf.ts` (`SIDEBAR_MAX_X`, y clases de tamaño calculadas _relativas_ al cuerpo
  del propio documento, para que un cambio chico no lo rompa en silencio). Se reconoce por los
  metadatos del archivo (`Author: LinkedIn`); si faltan, por la forma del texto, y ahí exige el
  bloque «Top Skills» / «Aptitudes principales»: los encabezados genéricos están en cualquier CV y
  llamar «De LinkedIn» a algo que no lo es sería mentir. Si LinkedIn cambia la plantilla, el lector
  devuelve `null` y el general toma el relevo marcando lo que no puede afirmar. **Los fixtures de
  `tests/fixtures/linkedin-layout.ts` reproducen la plantilla según lo publicado; no son un export
  real.** Cuando haya PDFs reales conviene ponerlos en `tests/fixtures/linkedin/` y correrles el lector.
- **Lo que se sincroniza con una cuenta no incluye el rastro de las ediciones.** `forSync`
  (`lib/profile/sync.ts`) deja afuera el historial, lo archivado (lo que la persona borró) y los
  nombres de archivo, en el navegador antes de subir y otra vez en el servidor: borrar algo del
  perfil tiene que ser borrarlo también en la cuenta. Los originales de los documentos
  (`cvexact.sources.v1`) viven solo en el navegador y no se sincronizan nunca.
- **El perfil se guarda con procedencia, y lo que leen los generadores es una proyección plana.**
  `cvexact.profile.v2` guarda cada valor como `{ value, status, source }` (`lib/schemas/profile-v2.ts`):
  de dónde vino (`cv`, `linkedin_pdf`, `answer`, `manual`, `legacy`…) y si el usuario lo respalda
  (`proposed`, `confirmed`, `edited`). Los ~50 archivos que sólo _leen_ datos de carrera no cambiaron:
  `loadProfile()` y `useProfile()` siguen devolviendo el `Profile` plano, ahora derivado con
  `toPlainProfile`, y `saveProfile(plano)` lo aplica sobre el guardado con `reconcileFromPlain`
  (`lib/profile/`), que es lo que marca lo editado, conserva el original y archiva lo borrado en vez
  de perderlo. El guardado en sí (`loadStoredProfile`, `useStoredProfile`) es la fuente de verdad.
  Dos propiedades que `tests/profile-migrate.test.ts` y `tests/profile-reconcile.test.ts` sostienen:
  `toPlainProfile(migrateV1(p))` es `p`, y `toPlainProfile(reconcileFromPlain(prev, next))` es `next`.
  Si agregás un campo, dale un default y no hace falta subir la versión; un cambio que rompa el
  formato es `version: 3` con su migración, y `parseAnyProfile` rechaza una versión que no conoce en
  vez de leerla como un perfil vacío.
- **Un perfil ilegible nunca se pisa.** `migrateProfileToV2()` corre al cargar `lib/storage/local.ts`
  (al evaluarse el módulo): escribe el v2, copia el v1 a `cvexact.profile.v1.bak` y recién ahí
  borra la clave vieja, así que un fallo a mitad de camino reintenta desde cero. Lo que una pestaña
  vieja escriba en la clave v1 después se aplica como edición. Si lo guardado no se puede leer, se
  copia a `cvexact.profile.v2.corrupt` al cargar (los hooks no pueden escribir al renderizar) y
  `CorruptNotice` avisa; el perfil "vacío" que se ve no es lo que había, y la copia no se borra sola.
- **`/api/sync` habla los dos formatos.** Un navegador actual manda `profileV2`; uno de antes de la
  procedencia (una pestaña que quedó abierta durante el deploy) manda `profile` plano, que el servidor
  aplica sobre lo que la cuenta ya tiene. El `GET` devuelve `profileV2` y, al lado, `profile` plano;
  ese último se puede quitar cuando ya no quede ningún navegador con la versión anterior.

- **Almacenamiento del navegador.** Las postulaciones viven en IndexedDB (DB `cvexact`, con
  Dexie cargado con import dinámico), un registro por postulación; lo chico y de lectura síncrona
  (perfil, keys BYOK, borradores, notas, cachés) sigue en `localStorage`. Antes todo estaba en
  `localStorage`, y un historial de ~200 postulaciones llenó sus 5 MiB: un CV ya generado —y
  cobrado— no se podía guardar y la pantalla decía «Ocurrió un error inesperado». Hoy:
  - **Memoria primero** (`lib/storage/applications/store.ts`): guardar actualiza memoria al instante
    y escribe con una cola por registro que junta ráfagas. Un rechazo del navegador deja el registro
    `unsaved` (se ve en el Wizard, en `AppShell` y en la lista), con una copia de espera en
    `cvexact.unsaved.v1` (localStorage, o sessionStorage si no entra), y «Reintentar guardado»
    reintenta **sólo la escritura**. Nunca se vuelve a llamar a la IA por un problema de guardado.
  - **La generación y el guardado están separados** en `Wizard.tsx` y `ExtrasPanel.tsx`: el `try`
    sólo envuelve la llamada al modelo, y un error al guardar el perfil o el borrador tiene su
    propio aviso, sin el «Reintentar» que regenera. No volver a meter el guardado adentro.
  - **Migración única** (`migrate.ts`): una transacción `strict` con marcador (sin marcador = no
    pasó nada), verificación registro a registro, reversión si no coincide, y la clave vieja se
    borra sólo si nadie la cambió mientras tanto. Lo que escriba después una pestaña con la versión
    anterior se absorbe (gana el `updatedAt` más nuevo; nunca borra). Una copia cruda del historial
    anterior queda 14 días (se descarga desde Ajustes). Al liberar espacio se reintenta
    `migrateProfileToV2()` en la misma sesión.
  - **El perfil nunca rebota**: si el navegador rechaza guardarlo, queda como perfil actual en
    memoria (y en sessionStorage), `updateStoredProfile`/`transformStoredProfile` no lanzan, se
    reintenta al volver a la pestaña y cuando la migración libera `localStorage`, y un aviso global
    lo dice.
  - **Rollback de deploy**: la versión anterior no lee IndexedDB y muestra el historial vacío. No
    se pierde nada — al volver a desplegar esta, reaparece y se absorbe lo escrito entretanto — pero
    avisalo antes de volver atrás.
  - **Sin IndexedDB** (bloqueado, o `open` que no responde en 4 s) sigue todo sobre
    `localStorage`, como antes, con la compactación sin pérdida de `cvOriginal` (sólo se guarda al
    editar) y el mismo estado «sin guardar».
  - **Idempotencia** (`lib/generation/`): cada generación lleva una clave aleatoria
    (`x-cvp-idempotency-key`); el servidor guarda el resultado un día, cifrado con una clave
    derivada de ella (tabla `generation_result`, migración 0022, podada por `scripts/prune.mjs`), lo
    reproduce sin reservar crédito si el mismo pedido se repite, responde 409 a un pedido igual en
    curso, y `GET /api/generate/result` lo devuelve por clave. El navegador lo pide si el stream se
    cortó y al volver a abrir la app (`lib/applications/recovery.ts`). Cláusula 21 de la política.
  - Los tests que lo sostienen: `tests/cv-generation-persistence.test.ts` (el incidente),
    `tests/storage-idb-migration.test.ts`, `tests/storage-app-store.test.ts`,
    `tests/storage-capacity.test.ts` (450 postulaciones sin que crezca `localStorage`) y
    `tests/generation-result-cache.test.ts`.
- **Las claves de `localStorage` son `cvexact.*`** (sin acento: la marca lo lleva, un identificador no).
  Si renombrás una clave no hay red de compatibilidad: lo que quedó bajo el nombre anterior no se lee,
  y para el usuario es una app vacía. Las copias de seguridad se exportan como `cvexact-backup` y sólo
  se importan con ese nombre.
- **El rol y la base que crea el bootstrap del despliegue se llaman `cvexact`.** Contra una
  instancia cuyo rol o base tengan otro nombre hay que renombrarlos antes de migrar —
  `ALTER DATABASE <vieja> RENAME TO cvexact; ALTER ROLE <viejo> RENAME TO cvexact;`
  (la base no puede tener conexiones abiertas) — o el Job va a crear una base nueva y vacía
  al lado de la que tiene los datos, y `drizzle-kit migrate` va a partir de cero sin avisar.

- **No toques `components/cv/cv-document.css` sin volver a comparar** contra
  `public/plantilla-cv.html`. Los valores raros (32.2pt, 17.9pt, 10.5pt) son la plantilla,
  y están listados como hechos en `docs/plantilla-cv.md`. El chequeo es abrir `/cv/demo/print`
  y el espécimen de referencia uno al lado del otro.
- **Las fuentes de `public/fonts/` son instancias estáticas (400 y 700, recta y cursiva), no la STIX variable.**
  Chromium imprime una fuente variable como Type 3 y el texto del PDF pierde casi todos los espacios
  (`pdftotext -raw`: «Analistadedatos…»); la estática sale como CID TrueType y los conserva. Un archivo cambiado
  va con un nombre nuevo, así que ninguna caché sirve el corte viejo. Comprobación: `pdffonts` sobre un PDF
  descargado no debe listar «Type 3» (el test de `cv-pdf-print` lo mira con `npm run dev` arriba).
- **`lib/docx/cv-docx.ts` transcribe ese mismo CSS a OOXML** y hay que actualizarlo con él.
  Word no tiene flexbox ni fuentes embebidas: la columna derecha es un tab stop a 10770
  twips y STIX Two Text se sustituye por una serif del sistema. El chequeo es bajar el
  Word desde `/cv/demo/print` y compararlo con la misma página.
- **La columna derecha del .docx se verifica contra un renderizador, no contra Google
  Docs.** Un .docx nuestro abierto en Google Docs y re-exportado a HTML sale con la
  ubicación y la fecha separadas por corridas de `&nbsp;` en vez de alineadas a la
  derecha, que es exactamente lo que parece un tab stop perdido. No lo es: el exportador
  de Docs convierte el tab en espacios duros, y el round trip es lo que los produce.
  `tests/cv-docx.test.ts` fija las dos cosas que serían falsas si la culpa fuera nuestra
  (el `<w:tabs>` va en el `w:pPr` del mismo párrafo que el `<w:tab/>`, uno por línea, y
  `word/document.xml` no contiene ningún ` `). La comprobación end-to-end es
  `soffice --headless --convert-to pdf` sobre el .docx y mirar el PDF.
- El reset de ese CSS usa `:where()` a propósito: escrito como `.cv-document h1` tendría
  más especificidad que las clases de componente y se comería sus tamaños y márgenes.
- Los prompts se escriben en inglés porque los modelos siguen mejor las instrucciones en
  inglés. El idioma del CV es un parámetro (`outputLanguage`), no el del prompt.
- **Ninguna palabra fija de los documentos vive en los renderers.** Las etiquetas que
  imprimen alrededor del texto del modelo (`Honores:`, `No te olvides de`) las emite el
  propio modelo en `labels`, por la misma razón que ya emitía los títulos de sección: el
  documento puede salir en cualquier idioma. Los renderers igual tienen fallback en
  español, porque un CV guardado en el navegador antes de este campo no lo trae.
- La interfaz de la app, en cambio, **se queda en español** a propósito. Lo que es
  multi-idioma es el documento que se manda a la empresa, no la pantalla.
