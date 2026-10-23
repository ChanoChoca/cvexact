# Textos de licencias de terceros

Este directorio conserva los textos que no viajan dentro de los paquetes
instalados o que conviene tener a mano al distribuir una imagen. No relicencia
ningún componente: cada archivo pertenece a su titular.

| Archivo | Componente | Licencia | Se distribuye en… |
|---|---|---|---|
| `MPL-2.0.txt` | `lightningcss` 1.32.0 / `lightningcss-linux-x64-gnu` 1.32.0 | MPL-2.0 | Build (Tailwind/Next); no en el runtime de la app |
| `MPL-2.0.txt` | `cairo`, dentro de `@img/sharp-libvips-linux-x64` y `@img/sharp-libvips-linuxmusl-x64` | MPL-2.0 | Imagen Docker `standalone` |
| `MPL-2.0.txt` | `axe-core` 4.13.0 | MPL-2.0 | Sólo desarrollo (`eslint-config-next`) |
| `LGPL-3.0.txt` + `GPL-3.0.txt` | `@img/sharp-libvips-linux-x64` y `@img/sharp-libvips-linuxmusl-x64` 1.2.4 / 1.3.2 y las bibliotecas LGPL que empaquetan | LGPL-3.0-or-later | Imagen Docker `standalone` de la app, vía `sharp` (Alpine usa musl) |
| `sharp-libvips-linux-x64-README.md` | `@img/sharp-libvips-linux-x64` | Tabla de licencias de sus dependencias | Variante glibc |
| `sharp-libvips-linuxmusl-x64-README.md` | `@img/sharp-libvips-linuxmusl-x64` | Tabla de licencias de sus dependencias | Imagen Docker `standalone` (Alpine) |
| `Apache-2.0-sharp.txt` | `sharp` 0.34.5 / 0.35.x | Apache-2.0 | Imagen Docker `standalone` |
| `MIT-mercadopago.txt` | `mercadopago` 3.4.0 | MIT | Runtime de la app |
| `axe-core-LICENSE-3RD-PARTY.txt` | `axe-core` 4.13.0 | Avisos de terceros | Sólo desarrollo |

## Nota sobre la imagen Docker

El repositorio no versiona `node_modules`. La imagen que produce el `Dockerfile`
sí incluye `sharp` y su paquete precompilado de libvips, que a su vez empaqueta
bibliotecas bajo LGPL-3.0-or-later (libvips, glib, pango, librsvg, libheif,
libexif, fribidi, proxy-libintl) y MPL-2.0 (cairo), entre otras. Si se publica
esa imagen, hay que incluir este aviso y ofrecer el código fuente correspondiente
de las bibliotecas LGPL en los términos de la licencia, o reemplazar `sharp` por
una alternativa con obligaciones compatibles con la forma de distribución.

Las tablas de `sharp-libvips-linux-x64-README.md` y
`sharp-libvips-linuxmusl-x64-README.md` son la fuente upstream de ese inventario.
La imagen Docker se construye sobre Alpine y contiene la variante **musl**; la
variante glibc corresponde a instalaciones sobre una distribución Linux con glibc.
Este directorio no sustituye una revisión legal de la distribución.
