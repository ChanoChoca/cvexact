# cvexact — extensión de navegador (Fase 4)

Captura, con un click, el aviso que estás mirando —en cualquier sitio,
incluidos LinkedIn e Indeed— a tu seguimiento de postulaciones en cvexact.

**Nunca lee ni recorre páginas por su cuenta.** No hay `content_scripts`
declarado en el manifest ni nada corriendo en segundo plano: la extensión
sólo lee el HTML de la pestaña activa cuando vos apretás "Capturar este
aviso", con permiso `activeTab` (acceso puntual a esa pestaña, no un permiso
permanente sobre todo lo que navegás). Es la misma restricción dura del
resto del producto — nada de scraping, nada de recorrer avisos solo — llevada
al extremo que permiten los permisos de una extensión.

Este directorio es un deploy separado (WXT / Chrome Web Store / Firefox
Add-ons) — no es parte del `pnpm install`/`build` del repo principal, y usa
su propio `package.json`.

## Cómo funciona, en una frase por pieza

- **El HTML nunca sale de tu navegador hacia LinkedIn/Indeed/lo que sea** —
  lo lee tu propio browser, como cualquier página que abrís. Lo único que
  viaja es ese HTML hacia `POST /api/tracker/parse-html` de tu propia cuenta
  de cvexact, para interpretarlo con la misma función que ya usa el import
  por URL (`lib/tracker/jsonld.ts`).
- **Autenticación por token, no por cookie** — la extensión corre en su
  propio origen (`chrome-extension://…`) y no comparte la sesión del sitio.
  Generás un token una vez desde **Postulaciones** en la app (tarjeta
  "Extensión de navegador"), lo pegás en el popup, y se guarda sólo en
  `chrome.storage.local` de tu perfil de navegador — nunca en una cookie, ni
  accesible a las páginas que visitás.
- **El badge de estado** se actualiza al abrir el popup, no en segundo
  plano — abrir el popup es lo que activa `activeTab`, así que es también el
  único momento en que tiene sentido (y permiso) para consultarlo.
- **Publicaciones del feed de LinkedIn** (búsqueda de contenido, `/feed/…`)
  también se pueden capturar, sin ningún permiso nuevo: como ahí no hay un
  único aviso identificable por la URL, la señal de "cuál de las varias
  publicaciones visibles" es la que ya tenías seleccionada al apretar
  "Capturar" — el mismo gesto de seleccionar el texto del puesto que ya
  hacías a mano para copiarlo. El texto llega editable a la pantalla de
  revisión (`renderReview`), y el link "Generar CV con este aviso →" de la
  pantalla final abre `/postular` ya prellenado.

## Desarrollo

```bash
npm install       # no pnpm — este directorio no es parte del workspace
npm run dev       # Chrome, con recarga en caliente
npm run dev:firefox
```

`npm run dev` abre una instancia de Chrome con la extensión ya cargada,
apuntando por defecto a `https://cvexact.com` (cambiala en el popup si tu
entorno de desarrollo usa otra URL — el campo "URL de la app" sólo aparece en
`npm run dev`, no hace falta recompilar). Los builds de producción
(`npm run build`, `npm run zip`) no muestran ese campo y usan siempre
`https://cvexact.com`.

## Cargarla sin publicarla (uso personal, o para probar)

```bash
npm run build            # deja el resultado en .output/chrome-mv3
```

Chrome: `chrome://extensions` → activar "Modo de desarrollador" → "Cargar
descomprimida" → elegir `.output/chrome-mv3`.

Firefox: `npm run build:firefox`, después `about:debugging#/runtime/this-firefox`
→ "Cargar complemento temporal" → elegir cualquier archivo dentro de
`.output/firefox-mv2`.

## Publicar de verdad (Chrome Web Store / Firefox Add-ons)

Esto sí requiere cuentas y pasos manuales que no se pueden hacer desde acá:

1. `npm run zip` / `npm run zip:firefox` — genera el `.zip` que cada tienda
   pide. Los íconos de `public/icon/` ya son los definitivos (no placeholders
   de un solo color) — nada que reemplazar acá.
2. **Chrome Web Store**: cuenta de desarrollador (pago único de USD 5),
   subir el zip en el [Developer Dashboard](https://chrome.google.com/webstore/devconsole),
   completar la ficha (capturas, política de privacidad — enlazar
   `/legales/privacidad`, categoría). Revisión manual de Google, puede tardar
   días.
3. **Firefox Add-ons (AMO)**: cuenta de developer, subir en
   [addons.mozilla.org/developers](https://addons.mozilla.org/developers/).
   Desde el 3/11/2025 exige declarar categorías de datos recolectados
   (`data_collection_permissions`) — completar eso con la práctica real (acá:
   ninguna recolección propia de la extensión más allá de lo que ya cubre la
   cláusula 18 de la política de privacidad del sitio, específica de la
   extensión) antes de enviarla a revisión. `browser_specific_settings.gecko.id`
   en `wxt.config.ts` ya está
   fijado (`tracker@cvexact.app`) — no cambiarlo después de la primera
   publicación, rompe las actualizaciones automáticas de quien ya la tiene.

## Verificar antes de depender

Los pasos y requisitos de ambas tiendas cambian con el tiempo — confirmar
contra la documentación oficial vigente antes de asumir que lo de arriba
sigue siendo exacto.
