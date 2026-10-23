import { defineConfig } from "wxt";

/**
 * La extensión de la Fase 4 — ver docs/tracker-plan.md y el README de este
 * directorio. Permisos deliberadamente mínimos:
 *
 * - `storage`: guardar el token de la cuenta (chrome.storage.local, nunca
 *   una cookie ni algo compartido con las páginas que visitás).
 * - `activeTab`: acceso a la pestaña activa, pero sólo por el instante en
 *   que abrís el popup — no un permiso permanente de "leer todo lo que
 *   navegás".
 * - `scripting`: para leer el HTML de la página actual cuando apretás
 *   "Capturar este aviso" — nunca corre solo, siempre en respuesta a ese
 *   click.
 *
 * Sin `host_permissions`: el fetch hacia la API de cvexact desde el popup
 * no lo necesita (no es una restricción de MV3 para llamadas salientes de
 * una extensión, sólo para leer contenido de otras páginas), y sin declarar
 * ningún dominio ahí, Chrome no le muestra a nadie el aviso de "puede leer
 * y modificar datos en todos los sitios que visitás" al instalarla.
 */
export default defineConfig({
  manifest: {
    name: "cvexact — Seguimiento de postulaciones",
    // Chrome Web Store exige <= 132 caracteres acá — verificado con
    // `printf '%s' "..." | wc -m` antes de este valor.
    description:
      "Guardá el aviso que estás mirando en tu seguimiento de postulaciones con un click. No lee páginas por su cuenta.",
    permissions: ["storage", "activeTab", "scripting"],
    action: {},
    // Firefox/AMO pide un id estable para poder actualizar la extensión
    // entre versiones sin que cuente como una nueva — cambiar esto después
    // de la primera publicación en addons.mozilla.org rompe las
    // actualizaciones automáticas de quien ya la tiene instalada.
    browser_specific_settings: {
      gecko: { id: "tracker@cvexact.app" },
    },
  },
});
