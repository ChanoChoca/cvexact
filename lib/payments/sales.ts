/**
 * Si esta instalación vende algo.
 *
 * Espejo de los flags de `lib/payments/mercadopago.ts` —`mercadoPagoConfigured`
 * y `mercadoPagoSubscriptionConfigured`— en un módulo aparte por una razón
 * concreta: aquél es `server-only`, y este flag lo tienen que leer
 * `lib/legal/operator.ts` y el `Footer` de `components/landing/parts.tsx`, que
 * deliberadamente NO son server-only (ver el comentario de cabecera de
 * `operator.ts`). Importar el módulo de Mercado Pago desde ahí convertiría a
 * todo ese árbol en server-only de rebote.
 *
 * Solo se consume desde componentes de SERVIDOR. En el navegador `process.env`
 * lee `undefined` y esto da `false`, que es el lado seguro del error: oculta la
 * venta, no la muestra de más.
 *
 * Qué apaga estar en `false`, además de lo que ya apagan los flags finos: el
 * botón de arrepentimiento y la baja de suscripción (que son obligaciones que
 * nacen de vender, no de existir), y la identidad fiscal —CUIT, domicilio,
 * condición frente al IVA— al pie de cada página.
 */
export const salesEnabled = Boolean(
  process.env.MP_ACCESS_TOKEN &&
    (process.env.MP_PACK_PRICE_ARS || process.env.MP_SUB_PRICE_ARS),
);
