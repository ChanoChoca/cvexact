import { useSyncExternalStore } from "react";
import {
  ANALYTICS_CONSENT_KEY,
  gaCookieNames,
  parseAnalyticsChoice,
  type AnalyticsChoice,
} from "@/lib/analytics";
import { readRaw, subscribeToStorage, write } from "@/lib/storage/local";

/**
 * La elección sobre Google Analytics, guardada en el navegador con el resto de
 * las preferencias (`lib/storage/local.ts`). No viaja al servidor ni queda
 * atada a la cuenta: quien no inicia sesión también elige, y el servidor no
 * tiene nada que decidir, porque GA se carga desde el navegador.
 *
 * Una constancia de que la persona aceptó no se guarda en ningún otro lado. Eso
 * es una decisión, no un olvido: guardar una constancia por persona sería un
 * dato personal nuevo para poder analizar datos que no son personales, y la
 * prueba de que el aviso existe y qué dice está en el código y en la política.
 */

export function getAnalyticsChoice(): AnalyticsChoice | null {
  return parseAnalyticsChoice(readRaw(ANALYTICS_CONSENT_KEY));
}

/** `pending` es el servidor y el primer render: ver `analyticsMode`. */
export function useAnalyticsChoice(): AnalyticsChoice | null | "pending" {
  return useSyncExternalStore(subscribeToStorage, getAnalyticsChoice, () => "pending" as const);
}

/**
 * Borra las cookies de GA. No se sabe con qué dominio las puso la etiqueta
 * (`auto` usa el dominio más alto que el navegador acepte, no siempre el
 * del host), así que se prueba el host, cada padre y el caso sin dominio.
 */
export function clearGaCookies(): void {
  if (typeof document === "undefined") return;
  const parts = window.location.hostname.split(".");
  const domains = [undefined, ...parts.map((_, i) => `.${parts.slice(i).join(".")}`)];
  for (const name of gaCookieNames(document.cookie)) {
    for (const domain of domains) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${
        domain ? `; domain=${domain}` : ""
      }`;
    }
  }
}

/**
 * Guarda la elección. `null` la borra, para volver a preguntar: es lo que hace
 * el enlace «Preferencias de analítica» del pie.
 *
 * Rechazar borra siempre las cookies de GA y, si `gtag.js` está en memoria,
 * recarga la página: seguiría mandando eventos hasta que se descargue. Se decide
 * por el estado real de la página y no por la elección anterior, porque para
 * cuando se rechaza esa ya pasó por `null` —«Preferencias» la borra para mostrar
 * de nuevo el aviso— y «antes había aceptado» ya no se sabe. Sin `gtag` en
 * memoria no hay nada que descargar y no hace falta recargar.
 */
export function setAnalyticsChoice(choice: AnalyticsChoice | null): void {
  // `null` se guarda como tal: `parseAnalyticsChoice` lo lee como «sin elegir», y
  // pasar por `write` es lo que avisa a los suscriptores de esta pestaña.
  write(ANALYTICS_CONSENT_KEY, choice);
  if (choice !== "denied") return;
  clearGaCookies();
  if (typeof (window as { gtag?: unknown }).gtag === "function") window.location.reload();
}
