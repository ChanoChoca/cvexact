# Activos del repositorio

Este archivo separa los activos propios de los de terceros. El código y los textos
se rigen por `LICENSE`; las fuentes, modelos y datos de terceros, por
`THIRD_PARTY.md`.

## Propios

| Activo | Autoría / procedencia | Notas |
|---|---|---|
| `public/logo-*.svg`, `public/favicon-*.svg` | Propios | Geometría simple en dos colores; sin metadatos |
| `public/icon-*.png` | Propios | Derivados del logo; sin metadatos |
| `app/apple-icon.png`, `app/opengraph-image.png` | Propios | Metadatos XMP/C2PA de la herramienta de IA eliminados durante la preparación de publicación; no se conservan metadatos de autoría. La procedencia exacta de la generación no está documentada en el repositorio. |
| `extension/public/icon/*.png` | Propios | Derivados del logo |
| `extension/store-assets/*.png` | Propios | Capturas de la extensión con datos ficticios; el token aparece enmascarado |
| `public/plantilla-cv.html` | Propio | Espécimen del CV; contenido ficticio |
| `public/website/flashpage.svg` | Propio | Diseño vectorial original creado para este proyecto: un globo terráqueo con líneas de latitud y longitud y un cursor. Sin metadatos, sin referencias externas, sin imágenes embebidas y sin recursos de terceros. Se usa como máscara del enlace a FlashPage en el pie. |
| `components/landing/solar/scenes/*.tsx`, `components/landing/solar/composition.tsx`, `components/landing/solar/parts.tsx`, `components/landing/solar/RunwayTrack.tsx` | Propio; escenas creadas por el responsable del proyecto con asistencia de IA, según su declaración expresa | Implementaciones React basadas en referencias de diseño locales del proyecto (`CVExact hero design/*.html`, no versionadas). El código de composición menciona el canvas de Claude Design como origen del modelo de animación; la herramienta exacta y sus condiciones no están documentadas de forma verificable. No se afirma exclusividad, registrabilidad ni ausencia de similitudes. |

El diseño de `flashpage.svg` y las escenas de la landing no afirman exclusividad
marcaria ni registrabilidad: son activos propios del proyecto, pero cualquier uso
como marca o reclamo de exclusividad requiere la verificación que corresponda. Las
fuentes, modelos y datos de terceros se documentan en `THIRD_PARTY.md`.

## De terceros

- **Fuentes:** STIX Two Text, Barlow Semi Condensed, IBM Plex Mono y IBM Plex Sans,
  bajo SIL OFL 1.1. Ver `THIRD_PARTY.md` y los `OFL*.txt`.
- **Modelos y datos:** `multilingual-e5-small` (MIT), `tesseract.js` y
  `tesseract.js-core` (Apache-2.0), datos `spa` (MIT sobre tessdata Apache-2.0),
  ONNX Runtime (MIT) y pdf.js (Apache-2.0). Ver `THIRD_PARTY.md`.

## Marcas

La licencia del código no concede derechos sobre el nombre, los logos ni la
identidad visual. Ver `TRADEMARKS.md`.
