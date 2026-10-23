import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { invoiceMail } from "@/lib/email/templates";
import { sendMail } from "@/lib/email/mailer";
import { fiscalConfig, CBTE_TIPO_FACTURA_C } from "./config";
import { getTicket } from "./wsaa";
import { ultimoAutorizado, solicitarCAE, ArcaError } from "./wsfev1";

/**
 * Emite el comprobante de un pago ya acreditado, o no hace nada si esta
 * instalación no tiene la facturación configurada.
 *
 * Se llama **después** de `grantCredits` en el webhook de Mercado Pago, nunca
 * antes, y nunca puede hacer que ese webhook falle: facturar es una
 * obligación aparte de acreditar, no una condición para acreditar. Un usuario
 * que pagó tiene que recibir sus créditos aunque ARCA esté caído; lo que
 * puede esperar es el comprobante, no el servicio. Por eso esta función
 * nunca tira: cualquier error queda en la fila `invoice` como `"failed"`, con
 * el detalle en `lastError`, para que se reintente después — a mano, o desde
 * un chequeo futuro en el estilo de `scripts/legal-requests-overdue.mjs`.
 *
 * Se llama en cada entrega del webhook, no sólo cuando `grantCredits` acredita
 * de verdad: un reintento de Mercado Pago después de que el proceso se cayó
 * entre acreditar y facturar tiene que poder completar lo que faltó. La
 * idempotencia la da la fila `invoice` misma — `status: "issued"` corta acá
 * mismo, antes de gastar un pedido a ARCA de más.
 */
export async function ensureInvoice(input: {
  userId: string;
  gateway: "mercadopago";
  externalId: string;
  importe: number;
}): Promise<void> {
  const config = fiscalConfig();
  if (!config) return;

  const db = getDb();

  const [existing] = await db
    .select({ status: schema.invoice.status })
    .from(schema.invoice)
    .where(
      and(
        eq(schema.invoice.gateway, input.gateway),
        eq(schema.invoice.externalId, input.externalId),
      ),
    )
    .limit(1);

  if (existing?.status === "issued") return;

  if (!existing) {
    await db
      .insert(schema.invoice)
      .values({
        gateway: input.gateway,
        externalId: input.externalId,
        userId: input.userId,
        ptoVta: config.ptoVta,
        cbteTipo: CBTE_TIPO_FACTURA_C,
        importe: input.importe,
        status: "pending",
      })
      .onConflictDoNothing();
  }

  try {
    const ticket = await getTicket("wsfe", config);

    /**
     * Serializa la numeración por punto de venta con un advisory lock de
     * Postgres, con alcance a esta transacción (`pg_advisory_xact_lock`, se
     * libera solo al terminar).
     *
     * Sin esto, dos webhooks de pagos distintos entregados a la vez podrían
     * leer el mismo `FECompUltimoAutorizado` y pedir el mismo `CbteNro` — que
     * ARCA rechazaría con el error 10016 en uno de los dos, así que no
     * corrompería la numeración, pero perdería esa factura sin necesidad. El
     * lock se calcula sobre `(cuit, ptoVta)` y no sobre un id fijo: dos
     * instalaciones o dos puntos de venta nunca deberían bloquearse entre sí.
     */
    const { cbteNro, resultado, cae, caeVto, observaciones } = await db.transaction(
      async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${config.cuit + ":" + config.ptoVta}))`,
        );

        const ultimo = await ultimoAutorizado(ticket, config);
        const nro = ultimo + 1;
        const factura = await solicitarCAE(ticket, config, {
          cbteNro: nro,
          importe: input.importe,
          fecha: new Date(),
        });

        return { cbteNro: nro, ...factura };
      },
    );

    if (resultado === "A" && cae) {
      await db
        .update(schema.invoice)
        .set({
          cbteNro,
          cae,
          caeVto,
          status: "issued",
          issuedAt: new Date(),
          lastError: observaciones.length > 0 ? observaciones.join("; ") : null,
        })
        .where(
          and(
            eq(schema.invoice.gateway, input.gateway),
            eq(schema.invoice.externalId, input.externalId),
          ),
        );

      /**
       * Best-effort, en su propio try/catch: la factura ya quedó `"issued"`
       * arriba, y nada de lo que pase de acá en adelante puede pisar ese
       * estado. `sendMail` en sí nunca tira (ver su propio comentario), pero
       * la búsqueda del email sí podría — y sin este aislamiento, ese error
       * se iba al `catch` de afuera, que vuelve a escribir la fila como
       * `"failed"` y borra el CAE que se acababa de conseguir. Encontrado por
       * un test que mockeaba mal la segunda consulta y dejaba `user`
       * `undefined`: el resultado real habría sido una factura emitida de
       * verdad en ARCA pero marcada `"failed"` en nuestra propia base.
       */
      try {
        const [user] = await db
          .select({ email: schema.user.email })
          .from(schema.user)
          .where(eq(schema.user.id, input.userId))
          .limit(1);
        if (user?.email && caeVto) {
          await sendMail(
            invoiceMail(user.email, {
              ptoVta: config.ptoVta,
              cbteNro,
              cae,
              caeVto,
              importe: input.importe,
            }),
          );
        }
      } catch (mailError) {
        console.error(
          `[fiscal] factura ${input.gateway}/${input.externalId} emitida (CAE ${cae}), pero no se pudo mandar el comprobante:`,
          mailError instanceof Error ? mailError.message : String(mailError),
        );
      }
      return;
    }

    await db
      .update(schema.invoice)
      .set({
        status: "failed",
        lastError: observaciones.length > 0 ? observaciones.join("; ") : "ARCA rechazó el comprobante.",
      })
      .where(
        and(
          eq(schema.invoice.gateway, input.gateway),
          eq(schema.invoice.externalId, input.externalId),
        ),
      );
  } catch (error) {
    const detail =
      error instanceof ArcaError && error.details.length > 0
        ? `${error.message} ${error.details.join("; ")}`
        : error instanceof Error
          ? error.message
          : String(error);

    console.error(`[fiscal] no se pudo facturar ${input.gateway}/${input.externalId}:`, detail);

    await db
      .update(schema.invoice)
      .set({ status: "failed", lastError: detail.slice(0, 2000) })
      .where(
        and(
          eq(schema.invoice.gateway, input.gateway),
          eq(schema.invoice.externalId, input.externalId),
        ),
      );
  }
}
