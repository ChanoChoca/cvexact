/**
 * El vocabulario de rechazos, del lado que las dos mitades pueden leer.
 *
 * Existe por la misma razón que `lib/ai/provider-catalog.ts` existe al lado de
 * `lib/ai/provider.ts`: quien produce estos valores es `lib/quota.ts`, que es
 * `server-only` y no puede llegar al bundle del navegador, pero quien tiene que
 * ramificar sobre ellos es `components/billing/LimitReached.tsx`, que corre en
 * el navegador.
 *
 * Hasta acá eso se resolvía con dos definiciones idénticas —una en
 * `lib/quota.ts`, otra en `lib/api/client.ts`— y nada que las obligara a
 * coincidir. El costo real apareció al sumar `transfer_consent`: el servidor
 * empezó a emitir un motivo que el tipo del cliente no admitía, los `Record<
 * DenialReason, string>` de `LimitReached` siguieron compilando porque miraban
 * la copia vieja, y el rechazo habría llegado al navegador para caer en un
 * `HEADLINE[reason]` sin entrada. Un tipo compartido convierte eso en un error
 * de compilación, que es donde tiene que aparecer.
 */

/** Por qué se rechazó un pedido, para que la interfaz ofrezca la salida correcta. */
export type DenialReason =
  | "daily_limit"
  | "monthly_limit"
  | "no_credits"
  /**
   * El único que no sale de `reserveQuota`: lo emite `openRequest` en
   * `lib/api/context.ts` cuando un tier pago todavía no aceptó la transferencia
   * internacional de datos (Ley 25.326 art. 12).
   */
  | "transfer_consent"
  /**
   * Tampoco sale de `reserveQuota`: lo emite `openRequest` cuando el pedido
   * cae en tier `free` — sin key propia, sin suscripción, sin créditos. Sin
   * venta habilitada este es el camino de todo usuario nuevo, así que necesita
   * su propia salida en vez de reventar como un error genérico del proveedor.
   */
  | "byok_required";
