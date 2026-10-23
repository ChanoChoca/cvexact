/**
 * Google Analytics 4 (gtag.js): qué ID usar, dónde no cargarlo y qué script
 * inyectar. `components/analytics/GoogleAnalytics.tsx` lo monta desde el layout
 * raíz.
 *
 * Apagado salvo que exista `GA_MEASUREMENT_ID`, y aun con ella, apagado hasta
 * que la persona acepta (`analyticsMode`). Las dos condiciones son legales, no
 * de despliegue: GA suma las cookies `_ga` y `_ga_<ID>` y un destinatario nuevo
 * en un país sin protección adecuada (Google, EE. UU.), y la política de
 * privacidad, sin asesoramiento legal que confirme otra vía, se apoya en el
 * consentimiento expreso (cláusula 21). La variable se carga después de
 * publicar el texto; `docs/metricas.md` tiene el orden.
 *
 * El ID se lee de una variable SIN prefijo `NEXT_PUBLIC_` a propósito. Con el
 * prefijo, un bundler puede grabar el valor en el build, y en el build no hay
 * entorno (`.dockerignore` excluye `.env`): GA quedaría apagado para siempre y
 * sin aviso, el mismo mecanismo que documenta `scripts/verify-build-legal.mjs`.
 * Sin prefijo se lee del pod, en cada request de una ruta `force-dynamic`. Por
 * lo mismo `gaMeasurementId` es una función y no un `const` de módulo.
 *
 * Sin `server-only`, igual que `lib/site.ts`: no protege nada y volvería el
 * módulo imposible de importar desde los tests.
 */

/**
 * `G-` seguido de alfanuméricos en mayúscula (`G-H4LGP85PBY`). El ID se
 * interpola en un `<script>` en línea, así que se valida el formato en vez de
 * confiar en el entorno: un valor con comillas o `</script>` no llega a ninguna
 * página. También atrapa el error más probable —pegar un ID viejo `UA-…` o la
 * URL del script en vez del ID— que de otro modo apagaría GA sin decir nada.
 */
const MEASUREMENT_ID = /^G-[A-Z0-9]{6,20}$/;

let warned = false;

/** El ID de medición configurado, o `null` si GA tiene que quedar apagado. */
export function gaMeasurementId(): string | null {
  const raw = process.env.GA_MEASUREMENT_ID?.trim();
  if (!raw) return null;
  if (MEASUREMENT_ID.test(raw)) return raw;

  // Una vez por proceso: esto corre en cada render del layout raíz. No se
  // imprime el valor, por si alguien pegó otra cosa en el campo.
  if (!warned) {
    warned = true;
    console.warn("[analytics] GA_MEASUREMENT_ID no tiene el formato G-XXXXXXXXXX: Google Analytics queda apagado.");
  }
  return null;
}

/**
 * Rutas donde GA no se carga.
 *
 * - `/cuenta/reset`: el token de recuperación viaja en `?token=`
 *   (`ResetPasswordForm.tsx`), una credencial que sirve una hora, y GA manda la
 *   URL completa —con su query— como `page_location`.
 * - `/cv`, `/prep`, `/video`: las rutas de impresión y de render. `/…/render` es
 *   lo que abre el Chromium sin cabeza que arma el PDF, con el documento entero
 *   inyectado como global (`lib/export/handoff.ts`) y esperando `networkidle`
 *   (`lib/export/pdf.ts`): un script de terceros ahí correría al lado de un CV
 *   completo, sumaría red a la espera y contaría cada exportación como una
 *   visita.
 *
 * Es un prefijo por segmento y no un `startsWith("/cv")`: `/cv-ats` es una
 * página pública prevista en `docs/seo-palabras-clave.md`, y esa sí se mide.
 */
const EXCLUDED = ["/cuenta/reset", "/cv", "/prep", "/video"];

export function isAnalyticsExcluded(pathname: string): boolean {
  return EXCLUDED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** El `<script src>` de Google, con el ID en la query. */
export function gtagSrc(measurementId: string): string {
  return `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
}

/**
 * El bloque de inicialización del snippet oficial de Google, tal cual, con el ID
 * como literal de JS. Antes de `gtag/js` o después da igual: los comandos quedan
 * en `dataLayer` y el script los procesa al cargar.
 */
export function gtagInitScript(measurementId: string): string {
  return [
    "window.dataLayer = window.dataLayer || [];",
    "function gtag(){dataLayer.push(arguments);}",
    "gtag('js', new Date());",
    `gtag('config', ${JSON.stringify(measurementId)});`,
  ].join("\n");
}

/** Dónde se guarda la elección: en el navegador, como todo lo demás de la app. */
export const ANALYTICS_CONSENT_KEY = "cvexact.analyticsConsent.v1";

export type AnalyticsChoice = "granted" | "denied";

/**
 * La elección guardada, o `null` si no hay ninguna válida. Un valor ilegible o
 * desconocido cuenta como «no eligió»: ante la duda se vuelve a preguntar, nunca
 * se carga GA.
 */
export function parseAnalyticsChoice(raw: string | null): AnalyticsChoice | null {
  if (raw === null) return null;
  let value: unknown = raw;
  try {
    value = JSON.parse(raw);
  } catch {
    // `write` guarda JSON, pero un valor pegado a mano se lee igual.
  }
  return value === "granted" || value === "denied" ? value : null;
}

/**
 * Qué hacer en una ruta según la elección: `load` carga GA, `ask` muestra el
 * aviso y `off` no hace nada. `pending` es el render del servidor y el primero
 * de la hidratación, cuando todavía no se leyó el navegador: no se muestra ni se
 * carga nada, así el aviso no aparece en el HTML de quien ya eligió.
 *
 * Las rutas excluidas (`isAnalyticsExcluded`) nunca preguntan ni cargan, ni con
 * consentimiento dado: un aviso sobre un CV impreso o sobre el enlace de
 * recuperación estorba y, en el Chromium del PDF, saldría en el documento.
 */
export function analyticsMode(
  choice: AnalyticsChoice | null | "pending",
  pathname: string,
): "load" | "ask" | "off" {
  if (choice === "pending" || isAnalyticsExcluded(pathname)) return "off";
  if (choice === "granted") return "load";
  if (choice === null) return "ask";
  return "off";
}

/** Los nombres de las cookies de GA presentes en un `document.cookie`. */
export function gaCookieNames(cookieHeader: string): string[] {
  return cookieHeader
    .split(";")
    .map((pair) => pair.split("=")[0].trim())
    .filter((name) => name === "_ga" || name.startsWith("_ga_"));
}
