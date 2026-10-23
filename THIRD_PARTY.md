# Componentes de terceros

Este archivo inventaría lo que se distribuye con el repositorio o se sirve desde la
aplicación y no es código propio. Los activos propios y su procedencia están en
`ASSETS.md`; las marcas, en `TRADEMARKS.md`. Las dependencias declaradas en
`package.json` conservan sus propias licencias y no se relicencian acá: ver
«Dependencias de software», al final. Los textos completos de las licencias que
no viajan dentro de un paquete están en `THIRD_PARTY_LICENSES/`.

## Fuentes

### STIX Two Text

- **Archivos:** `public/fonts/stix-two-text-*.woff2` y `public/fonts/OFL.txt`.
- **Titulares:** STI Pub Companies y otros; ver la cabecera de `OFL.txt`.
- **Licencia:** SIL Open Font License 1.1. Permite usar, estudiar, modificar y
  redistribuir las fuentes —incluida su incrustación en documentos— siempre que la
  licencia viaje con ellas y no se vendan por separado. `OFL.txt` se sirve junto a
  los archivos.
- **Instancias estáticas:** los `.woff2` son cortes de 400 y 700, rectos y cursivos,
  generados con `fontTools.varLib.instancer` a partir del archivo variable de Google
  Fonts. La licencia no declara Reserved Font Names para STIX Two Text, y la app usa
  el nombre de familia `STIX Two Text CV`.

### Barlow Semi Condensed

- **Archivos:** `extension/public/fonts/barlow-semi-condensed-600.woff2` y
  `barlow-semi-condensed-700.woff2`. En la app la carga `next/font/google`
  (`app/layout.tsx`), que la autoaloja en el build.
- **Titular:** The Barlow Project Authors (https://github.com/jpt/barlow).
- **Licencia:** SIL Open Font License 1.1, incluida en
  `extension/public/fonts/OFL-Barlow.txt`. Son copias sin modificar: no se usa
  ningún Reserved Font Name en derivados porque no hay derivados.
- **Uso:** titulares del sitio y de la extensión.

### IBM Plex Mono e IBM Plex Sans

- **Archivos:** `extension/public/fonts/ibm-plex-mono-300.woff2` y
  `ibm-plex-mono-400.woff2`. En la app las carga `next/font/google`
  (`app/layout.tsx` y `components/landing/solar/fonts.ts`), que las autoaloja en el
  build.
- **Titular:** IBM Corp., con Reserved Font Name «Plex».
- **Licencia:** SIL Open Font License 1.1, incluida en
  `extension/public/fonts/OFL-IBM-Plex.txt`. Copias sin modificar, así que el
  nombre reservado no se toca: la restricción aplica a versiones modificadas.
- **Uso:** etiquetas y micro-tipografía.

## Modelos y datos que la aplicación descarga o sirve

Ninguno de estos archivos se versiona en el repositorio: se copian desde
`node_modules` en `predev`/`prebuild` (`scripts/copy-*.mjs`,
`scripts/build-embedder-worker.mjs`) o los descarga el navegador. Se sirven desde el
propio origen para que la CSP no tenga que abrir un CDN de terceros.

- **multilingual-e5-small** (`Xenova/multilingual-e5-small`), licencia MIT sobre
  `intfloat/multilingual-e5-small`. Lo descarga el navegador desde Hugging Face sólo
  si la persona prende «afinidad semántica» en `/empleos`
  (`app/(app)/empleos/embedder.worker.ts`).
- **tesseract.js** 7.0.0 y **tesseract.js-core** 7.0.0, Apache-2.0: el worker y el
  motor WASM que leen la foto de una credencial en el navegador.
- **Datos de idioma español de Tesseract** (`@tesseract.js-data/spa`, paquete MIT;
  los datos provienen de `tessdata`, Apache-2.0).
- **ONNX Runtime Web** 1.26, MIT: el motor WASM que ejecuta el modelo de afinidad.
- **pdf.js** (`pdfjs-dist` 6.2, Apache-2.0): el worker que renderiza y cuenta
  páginas de PDF.

## Resto del repositorio

- El diseño descrito en `docs/plantilla-cv.md`, el espécimen
  `public/plantilla-cv.html`, el fixture `lib/fixtures/template-cv.ts` y el contenido
  de ejemplo forman parte de este repositorio. Todo el contenido del espécimen y del
  fixture es ficticio: nombres, empresas, instituciones, teléfono y direcciones.
- Los fixtures de `tests/fixtures/jsonld/` reproducen la estructura de páginas de
  portales de empleo. Los datos personales que traían esas páginas (nombres, correos,
  perfiles) se sustituyeron por ficticios; ver `tests/fixtures/jsonld/README.md`.
- No se incluyen textos, ilustraciones ni plantillas de terceros **en el producto**.
  El Código de Conducta es la excepción documentada: es una adaptación de
  Contributor Covenant 2.1 bajo CC BY 4.0, con su atribución en «Documentos».
- No se usa ninguna fuente propietaria: la tipografía del CV es STIX Two Text y su
  respaldo es `serif`; la del resto de la interfaz es Barlow Semi Condensed e IBM
  Plex, todas bajo SIL OFL 1.1.

## Documentos

- **Contributor Covenant 2.1** (`docs/CODE_OF_CONDUCT.md`), licencia CC BY 4.0;
  el texto canónico en inglés está en
  <https://www.contributor-covenant.org/version/2/1/code_of_conduct.html>.

## Dependencias de software

Las dependencias declaradas en `package.json` conservan sus propias licencias; la
versión efectiva de cada una está en `pnpm-lock.yaml`. **El árbol instalado no es
homogéneamente permisivo.** Las dependencias directas de runtime son MIT,
Apache-2.0, BSD-2-Clause, BSD-3-Clause o ISC; `mercadopago` 3.4.0 no declara
`license` en su `package.json`, pero su archivo `LICENSE` es MIT (texto en
`THIRD_PARTY_LICENSES/MIT-mercadopago.txt`).

Casos que no son permisivos y que conviene mirar al distribuir:

- **MPL-2.0** — `lightningcss` 1.32.0 y `lightningcss-linux-x64-gnu` 1.32.0
  (build de Tailwind/Next), `axe-core` 4.13.0 (sólo desarrollo, vía
  `eslint-config-next`) y `cairo` dentro de `sharp-libvips` (ver el inventario
  upstream). Los primeros no se distribuyen como código en el runtime de la app;
  el texto estándar está en `THIRD_PARTY_LICENSES/MPL-2.0.txt`.
- **LGPL-3.0-or-later** — `@img/sharp-libvips-linux-x64` 1.2.4/1.3.2 (glibc) y
  `@img/sharp-libvips-linuxmusl-x64` 1.2.4/1.3.2 (Alpine/musl), transitivas de
  `sharp` 0.34.5/0.35.x. La imagen Docker `standalone` **sí** incluye `sharp` y,
  al construirse sobre Alpine, el paquete **musl**. Si se publica la imagen, hay
  que incluir el aviso, el texto LGPL y ofrecer el código fuente correspondiente
  de las bibliotecas LGPL, o reemplazar `sharp`. Los inventarios upstream están
  en `THIRD_PARTY_LICENSES/sharp-libvips-linux-x64-README.md` y
  `THIRD_PARTY_LICENSES/sharp-libvips-linuxmusl-x64-README.md`; los textos en
  `THIRD_PARTY_LICENSES/LGPL-3.0.txt` y `THIRD_PARTY_LICENSES/GPL-3.0.txt`.
- **Apache-2.0** — `sharp` y varias dependencias directas de runtime. Ver
  `THIRD_PARTY_LICENSES/Apache-2.0-sharp.txt` para `sharp`.

El proyecto se distribuye bajo AGPL-3.0-or-later (ver `LICENSE`). Que MPL-2.0 y
LGPL-3.0-or-later sean generalmente compatibles con obras GPL/AGPL no exime de
las obligaciones de aviso y de acceso a la fuente que dependen de **cómo** se
distribuya el binario. Esta descripción no es asesoría legal ni una declaración
de cumplimiento: la distribución de una imagen Docker o de un servicio modificado
debe revisarse con la licencia de cada componente y, si hace falta, con asesoría
externa.
