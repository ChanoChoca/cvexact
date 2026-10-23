import type { MetadataRoute } from "next";
import { experimentOnServer } from "@/lib/experiments";
import { SHARE_ACTION } from "@/lib/notes/share";

/**
 * Lo que el navegador necesita para ofrecer «Agregar a la pantalla de inicio» (M45).
 *
 * El perfil vive en un solo navegador, y en Safari un sitio que no se visita en una semana puede perder lo que
 * guardó (`lib/storage/backup-reminder.ts`). Una aplicación en la pantalla de inicio recibe otro trato; cuánto otro, nadie lo
 * promete —ni esta página, ni las pantallas que la invitan—. Es una ayuda y no un reemplazo de la copia en un archivo.
 *
 * `start_url` es el perfil, que es a donde alguien que vuelve quiere llegar: si todavía no cargó nada, de ahí lo lleva a
 * empezar. `background_color` y `theme_color` son el fondo de la marca (`--color-paper` en `app/globals.css`), el mismo
 * negro azulado de los íconos: la pantalla de arranque no parpadea en blanco. El ícono «maskable» lleva la marca dentro
 * de la zona segura —el 80 % central, que es lo que ningún recorte (círculo, esquinas redondeadas) toca—: mide poco más de la mitad.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "cvexact",
    short_name: "cvexact",
    description: "Cargás tu perfil una vez y cvexact adapta tu CV a cada aviso.",
    lang: "es-AR",
    start_url: "/perfil",
    scope: "/",
    display: "standalone",
    background_color: "#01020c",
    theme_color: "#01020c",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Sharing to the app from another one, on Android (e5, O15): a POST that a service worker of this browser answers (`public/share-sw.js`), so that what is shared goes
    // to «Anotá algo» without passing through any server. Only when «Anotá algo» is on in the build: off, the manifest is the one it always was.
    ...(experimentOnServer("note_capture")
      ? { share_target: { action: SHARE_ACTION, method: "POST" as const, enctype: "application/x-www-form-urlencoded" as const, params: { title: "title", text: "text", url: "url" } } }
      : {}),
  };
}
