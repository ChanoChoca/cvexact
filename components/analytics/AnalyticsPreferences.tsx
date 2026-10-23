"use client";

import { setAnalyticsChoice } from "./consent";

/**
 * «Preferencias de analítica», en el pie: vuelve a mostrar el aviso para cambiar
 * la elección. Sin este botón, aceptar sería irrevocable desde la interfaz —hay
 * que poder retirar el consentimiento tan fácil como se dio— y la cláusula 21
 * promete justamente eso.
 *
 * Lo renderiza cada pie sólo si `gaMeasurementId()` da un ID: con GA apagado no
 * hay nada que preferir. Ojo al usarlo en una ruta prerenderizada, que hornea la
 * ausencia de la variable; todas las que llevan pie son `force-dynamic`.
 */
export function AnalyticsPreferences({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => setAnalyticsChoice(null)}>
      Preferencias de analítica
    </button>
  );
}
