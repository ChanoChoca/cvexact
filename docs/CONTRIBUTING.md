# Cómo contribuir

Gracias por tomarte el tiempo. Este documento explica cómo proponer un cambio y qué
se espera de un pull request.

## Antes de escribir código

- **Bugs**: abrí un issue con la plantilla de bug. Incluí la versión o el commit, los
  pasos para reproducirlo y qué esperabas que pasara.
- **Cambios grandes o de comportamiento**: abrí un issue primero y acordá el alcance.
  Un PR de dos mil líneas sin discusión previa es difícil de revisar y se puede
  cerrar sin mergear.
- **Seguridad**: no abras un issue público. Seguí [`SECURITY.md`](../SECURITY.md).
- **Datos personales**: no subas CVs, perfiles, exports ni capturas con datos de
  personas reales, ni siquiera dentro de un test. Los fixtures usan datos ficticios
  y `tests/fixtures-no-pii.test.ts` lo verifica.

## Entorno

Requisitos: Node.js 20.9 o superior y pnpm 11.21.0, el que declara `packageManager`.

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

`pnpm dev` y `pnpm build` copian a `public/` el worker de pdf.js, el runtime de ONNX,
los datos de OCR y el worker del embedder semántico. Esos archivos están en
`.gitignore`: no se commitean.

## Antes de abrir el pull request

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Los tres tienen que pasar. Además:

- Todo cambio de comportamiento lleva un test. Los tests no tocan la red ni una base
  de datos real: mockean el cliente, como el resto de `tests/`.
- Si tocás el layout del CV, corré la suite completa: los tests comparan el HTML y el
  PDF contra el espécimen de `public/plantilla-cv.html`.
- Si agregás una dependencia, mirá su licencia: tiene que ser compatible con la del
  proyecto. Actualizá `THIRD_PARTY.md` y `THIRD_PARTY_LICENSES/` si distribuye
  fuentes, modelos o datos.
- Los comentarios y la documentación van en español; los identificadores, en inglés.
- No desactives reglas de ESLint ni de TypeScript sin explicar por qué en el PR.
- Antes de un release, `pnpm audit:publication` revisa los archivos que se
  publicarían y las reglas críticas de `.gitignore`; ver
  [`PUBLISHING.md`](PUBLISHING.md).

### Build sin servicios reales

`pnpm build` no necesita una base ni credenciales. Con valores de prueba alcanza:

```bash
DATABASE_URL='postgres://test:test@127.0.0.1:5432/test' \
BETTER_AUTH_SECRET='ci-only-not-a-real-secret' \
BETTER_AUTH_URL='http://localhost:3000' \
NEXT_PUBLIC_SITE_URL='http://localhost:3000' \
LEGAL_OPERATOR_NAME='Test Operator' \
LEGAL_CONTACT_EMAIL='test@example.com' \
pnpm build
```

El job `build` de la CI corre exactamente esto. `LEGAL_OPERATOR_*` existe para que
`verify-build-legal` no encuentre un `[pendiente de carga]` horneado; las páginas
legales son dinámicas y no se prerenderizan.

## Commits y DCO

Cada commit lleva su línea `Signed-off-by:`; se agrega con `git commit -s`:

```bash
git commit -s -m "jobs: no repetir el aviso cuando falta la fecha"
```

Con esa línea certificás el [Developer Certificate of Origin
1.1](https://developercertificate.org/): que escribiste el cambio, o que tenés
derecho a aportarlo, y que aceptás que se distribuya bajo la licencia del proyecto
—AGPL-3.0-or-later, ver [`LICENSE`](../LICENSE)—. **No hace falta firmar un CLA.**

El workflow de CI verifica que todos los commits del PR estén firmados. Un PR sin
`Signed-off-by` no se mergea.

## Estilo de los commits

- Un commit por cambio coherente; que compile y pase los tests por sí solo.
- Mensaje en imperativo y en español, con el área adelante cuando ayuda:
  `cv:`, `jobs:`, `tracker:`, `auth:`, `docs:`.
- Referenciá el issue con `#123` cuando exista.

## Revisión

Una persona mantiene el proyecto y revisa los PR cuando puede; no hay un SLA. Si tu
PR queda sin respuesta por más de dos semanas, mencioná a la persona mantenedora en
el hilo. Los cambios que no encajan con el alcance del producto se cierran con una
explicación, no con silencio.
