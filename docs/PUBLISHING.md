# Publicar el repositorio

Esta lista es para quien mantiene el proyecto. No ejecuta Git ni crea el repositorio:
deja explícito qué hay que revisar y qué configurar a mano antes de hacerlo público.

## Antes de inicializar Git

1. **Procedencia de las escenas de la landing.** El titular confirmó que las creó
   personalmente con asistencia de IA. `CVExact hero design/*.html` son referencias
   de diseño locales del proyecto, no un bundle de terceros. Queda como limitación
   documental que no se registró de forma verificable la herramienta exacta ni sus
   condiciones; no se afirma exclusividad, registrabilidad ni ausencia de
   similitudes. No es un bloqueante por titularidad desconocida.
2. **Revisar la distribución de la imagen Docker.** `THIRD_PARTY.md` documenta
   MPL-2.0 y LGPL-3.0-or-later en dependencias transitivas; `sharp`/libvips viaja en
   la imagen `standalone`. Si se publica la imagen, hay que incluir los avisos y
   ofrecer la fuente de las bibliotecas LGPL, o reemplazar `sharp`. Ver
   `THIRD_PARTY_LICENSES/`.
3. **Definir la licencia definitiva.** Hoy es AGPL-3.0-or-later. Si el modelo de
   negocio necesita mantener componentes cerrados, decidirlo antes de aceptar
   contribuciones; relicenciar después requiere el permiso de todos los
   contribuyentes.
4. **Definir propietario, repositorio y rama.** No hay URLs activas con datos de
   ejemplo en el repo. Cuando existan los datos reales, completar
   `.github/ISSUE_TEMPLATE/config.yml` y `SECURITY.md` si hace falta. La rama por
   defecto debería ser `main`.
5. **Configurar `NEXT_PUBLIC_SOURCE_URL` en el build.** Tiene que apuntar al
   código de la versión desplegada (tag o commit), no a la rama de desarrollo. Si
   está vacía, el enlace «Código fuente» no se muestra; para una instancia pública
   bajo AGPL hay que ofrecerlo. No inventar propietario, repositorio ni tag: la URL
   definitiva se completa cuando exista la versión pública identificada.
   `NEXT_PUBLIC_*` se inlinea durante `next build`; ver
   [«Cómo pasar la variable al build»](#cómo-pasar-la-variable-al-build).
6. **Rotar secretos si alguna vez se compartió `.env`.** El archivo está ignorado,
   pero si se copió fuera de la máquina, conviene rotar las claves antes de publicar.
7. **Revisar el inventario.** `pnpm audit:publication --list` incluye 1.157 archivos:
   `.env` no está, los generados grandes (`public/ocr`, `public/ort`, workers de
   PDF/embedder) tampoco, y no aparecen secretos. Sí incluye `AGENTS.md` y
   `CLAUDE.md`, que son instrucciones de desarrollo sin secretos; si no querés
   publicarlas, excluirlas antes del primer commit. Los documentos de planificación
   técnica de `docs/` también están inventariados y conviene revisarlos.

## Cómo pasar la variable al build

`NEXT_PUBLIC_SOURCE_URL` **no se lee del entorno del contenedor en runtime**: Next
la reemplaza en el bundle cuando corre `next build`. Hay que pasarla en el
artefacto que se publica, no en el pod, el `env_file` ni el manifiesto de
Kubernetes.

| Mecanismo | Cómo pasarla | Nota |
|---|---|---|
| Build local/CI con Next | `NEXT_PUBLIC_SOURCE_URL='...' pnpm build` | El artefacto queda en `.next/`. |
| Imagen Docker | `docker build --build-arg NEXT_PUBLIC_SOURCE_URL='...' -t <imagen> .` | El `Dockerfile` la recibe en el stage `builder`; no queda en el entorno del `runner`. |
| Docker Compose de ejemplo | Definirla en `.env` y ejecutar `docker compose -f deploy/docker-compose.yml --env-file .env build app` | El compose la pasa como `build.args`; el `env_file` del runtime no alcanza. |
| Kubernetes / orquestador | Pasarla en el pipeline que construye y publica la imagen | El clúster sólo descarga la imagen; definirla en el Deployment o Secret no cambia el HTML. |
| `next start` sobre un `.next` existente | No hay forma de cambiarla | El valor ya está horneado; hay que reconstruir. |

La URL tiene que apuntar al **tag o commit de esa imagen**. Si el pipeline
reutiliza una imagen construida para otra versión, el enlace queda apuntando al
código equivocado aunque el Deployment tenga otra variable.

Los builds de desarrollo y de CI pueden construirse con la variable vacía: el
enlace se oculta y el warning de arranque lo recuerda. Eso no sirve para publicar
una instancia pública. Para un build de publicación, usar una URL real y
verificarla:

```bash
NEXT_PUBLIC_SOURCE_URL='https://.../tree/<tag-o-commit>' pnpm build
NEXT_PUBLIC_SOURCE_URL='https://.../tree/<tag-o-commit>' pnpm verify:publication-source
```

## Comprobaciones automáticas

```bash
pnpm lint
pnpm typecheck
pnpm test
NEXT_PUBLIC_SOURCE_URL='https://.../tree/<tag-o-commit>' pnpm build
NEXT_PUBLIC_SOURCE_URL='https://.../tree/<tag-o-commit>' pnpm verify:publication-source
pnpm audit:publication
```

`pnpm audit:publication` lista qué archivos entrarían en la publicación, exige las
reglas críticas de `.gitignore` y busca secretos evidentes sin usar el índice de Git.
No reemplaza una revisión manual del primer commit.

## Estado de verificación local (2026-10-23)

- `pnpm lint`: 0 errores; queda un warning preexistente de `<img>` en
  `components/billing/DonationWallet.tsx`.
- `pnpm typecheck`, `pnpm test`, `pnpm build` y `pnpm audit:publication`: OK.
  `pnpm test`: 316 archivos pasados / 3 omitidos; 5150 tests pasados / 13
  omitidos. `pnpm audit:publication` inventarió 1.157 archivos, 31/31 reglas
  críticas y 0 coincidencias de secretos.
- `NEXT_PUBLIC_SOURCE_URL`: se construyó localmente con una URL real ajena al
  proyecto (sólo como valor de ejercicio) y `pnpm verify:publication-source`
  encontró el enlace horneado en las 3 rutas. También falla, como corresponde, si
  la variable está vacía, si es `example.com` o si apunta a `main`. Ese `.next`
  se descartó: **no es un artefacto de producción**.
- `docker build --check --target builder --build-arg NEXT_PUBLIC_SOURCE_URL=...`
  y `docker compose ... config` con la variable: OK. También se construyó el
  target `builder` completo con el argumento: el valor apareció en
  `.next/server/chunks/...` y no se construyó ni ejecutó el target `runner`. La
  imagen temporal de verificación se eliminó; no se desplegó nada.
- `tests/cv-pdf-print.test.ts`: **8/8** con `pnpm dev` en `:3000`, Chromium
  `/usr/bin/chromium`, `pdftotext` y `pdffonts`. No se agregó un job de CI para PDF:
  instalar Chromium, poppler y levantar el servidor en GitHub Actions agrega una
  dependencia frágil; queda como comando manual reproducible hasta que se decida
  un workflow separado.
- `docker compose -f deploy/docker-compose.yml --env-file .env.example config
  --quiet` (con `POSTGRES_PASSWORD=test`): OK, sin iniciar servicios.
- `docker build --target runner -t cvexact:local .`: OK en una verificación
  anterior. La imagen resultante contiene `THIRD_PARTY_LICENSES`, `sharp` y la
  variante **musl** de libvips (`@img/sharp-libvips-linuxmusl-x64`), y no contiene
  `.env` ni manifiestos YAML. La imagen local midió ~417 MB; el tamaño no es una
  obligación de publicación. **Esa imagen es anterior a los ajustes de assets y a
  este cambio del `Dockerfile`; hay que reconstruirla antes de distribuirla.**
- No se ejecutó ningún despliegue ni se iniciaron servicios de producción.

## Cumplimiento AGPL de la instancia desplegada

La instancia pública ya está desplegada: no alcanza con publicar el repositorio
después. Antes de un despliegue normal, `NEXT_PUBLIC_SOURCE_URL` tiene que estar
definida **al construir la imagen** y apuntar al **tag o commit** del código que
corre en esa instancia, no a `main` ni a una rama móvil. Definirla sólo en el
runtime no alcanza: Next ya reemplazó el valor en el bundle. Ver
[«Cómo pasar la variable al build»](#cómo-pasar-la-variable-al-build).

Verificá el artefacto, no sólo el entorno del pod:

```bash
NEXT_PUBLIC_SOURCE_URL='https://.../tree/<tag-o-commit>' pnpm verify:publication-source
```

El verificador arranca el standalone sin la variable en runtime, rechaza URLs
ficticias y ramas móviles, y exige el texto y el `href` en `/`,
`/legales/privacidad` y `/legales/terminos`. El pie de la aplicación logueada se
revisa a mano. Si el build se hizo con la variable vacía, `sourceUrl()` devuelve
`null`, el enlace se oculta y el warning de arranque lo registra; no despliegues
así una instancia pública.

## Repositorio fuente e imagen Docker

Publicar el **repositorio fuente** no requiere construir ni distribuir la imagen
Docker. Distribuir una **imagen** activa además las obligaciones de aviso y de
acceso al código fuente de las bibliotecas LGPL/MPL que viajan con `sharp`/libvips;
ver `THIRD_PARTY.md` y `THIRD_PARTY_LICENSES/`. No se declara cumplimiento jurídico
pleno de esa distribución: la oferta de fuente LGPL sigue siendo una decisión
operativa/legal pendiente.

## Primera publicación

1. Crear el repositorio **privado** y subir la rama `main`.
2. Revisar en GitHub la lista de archivos y el historial. Confirmar que no estén
   `.env`, manifiestos de despliegue, `public/ort`, `public/ocr`, `pdf.worker.min.mjs`,
   `embedder.worker.js`, `node_modules`, exports de perfil ni archivos internos.
3. Recién entonces cambiar la visibilidad a pública. Si algo se filtró, borrar el
   repositorio y recrearlo es más barato que purgar el historial.

## Configuración manual de GitHub

- **Settings → Code security**: activar *Private vulnerability reporting* (lo usa
  `SECURITY.md`), *Secret scanning* y *Push protection*.
- **Dependabot**: activar alertas y actualizaciones de seguridad.
- **Actions**: dejar el `GITHUB_TOKEN` con permisos de sólo lectura; revisar que los
  workflows no pidan permisos de escritura.
- **Ruleset de `main`**: exigir los checks `CI` (`dco`, `checks`, `build`), bloquear
  force-push y exigir pull request para cambios de terceros.
- **Descripción y temas**: describir el producto y agregar temas como `nextjs`,
  `resume`, `job-search`, `typescript`, `privacy`.
- **Licencia detectada**: verificar que GitHub detecte AGPL-3.0 y que muestre
  `SECURITY.md`, `CONTRIBUTING.md` y `CODE_OF_CONDUCT.md`.

## Después de publicar

- Revisar que el enlace «Código fuente» del sitio apunte al tag/commit desplegado.
- Mantener `THIRD_PARTY.md` al día si se agrega una dependencia con obligaciones de
  aviso o distribución.
- No aceptar capturas, CVs, exports ni issues con datos personales reales.
