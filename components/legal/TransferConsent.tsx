"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Checkbox } from "@/components/ui";
import { GENERATE, NEVER_SENT, READ } from "@/lib/legal/data-flow";

/**
 * El consentimiento a la transferencia internacional de datos.
 *
 * Aparece una sola vez, antes de la primera generación de un tier pago, porque
 * es ahí donde el perfil está por salir del país: pedirlo después de haberlo
 * mandado no sería pedirlo. Lo dispara un 403 del servidor
 * (`lib/api/context.ts`), no una comprobación del cliente — un permiso que el
 * navegador puede decidir que ya tiene no es un control.
 *
 * Tres decisiones sobre cómo está escrito, que son el motivo de que sea un
 * componente propio y no una línea en los términos:
 *
 * Nombra al proveedor y al país. El art. 12 de la Ley 25.326 se apoya en el
 * consentimiento del titular, y un consentimiento sólo vale si es informado:
 * «proveedores de inteligencia artificial» no informa nada. Si alguien no quiere
 * que su CV vaya a China, tiene que poder saberlo acá y no en la cláusula 5 de
 * un documento que no abrió.
 *
 * La casilla arranca vacía y el botón está deshabilitado hasta que se marca.
 * Un consentimiento premarcado no es consentimiento, y el «específico y
 * destacado» que pide el art. 33 inc. IX de la LGPD brasileña —el mismo texto
 * nos sirve para los dos países— es incompatible con darlo por dado.
 *
 * Ofrece la salida. Quien no quiera aceptar no queda sin producto: con su propia
 * key elige proveedor y país. Esconder esa alternativa acá convertiría el
 * consentimiento en un peaje, que es justamente lo que lo invalida.
 *
 * Dice lo que de verdad va a pasar, y eso depende de qué se esté por hacer
 * (`kind`): al generar un documento el nombre viaja como un token y el contacto
 * no viaja; al leer un texto que la persona cargó —importar un CV, contar su
 * recorrido, separar una respuesta—, va el texto sin su nombre, su correo, su
 * teléfono ni los enlaces de su perfil, que el navegador reemplaza por marcas
 * antes (`lib/parse/mask-contact.ts`), y sin los datos personales que el
 * producto no usa. Lo que cuenta de su experiencia sí viaja: es lo que se
 * lee. Un permiso que describe la mitad de las cosas que autoriza no es
 * informado. Las frases son las de `lib/legal/data-flow.ts`, las mismas que
 * repiten los demás avisos y que la cláusula 5 de la política.
 */
export function TransferConsent({ onAccepted, kind = "generate" }: { onAccepted?: () => void; kind?: "generate" | "read" }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    if (!checked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/legales/consentimiento", { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "No pudimos registrar tu consentimiento.",
        );
      }
      onAccepted?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No pudimos registrar tu consentimiento.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="text-[19px] leading-snug font-normal tracking-[-0.01em] text-ink">
        Un permiso antes de empezar
      </h2>
      <p className="mt-2 max-w-prose text-[14.5px] leading-relaxed text-pretty text-ink-2">
        {kind === "read"
          ? "Para leer lo que cargaste hace falta mandarle ese texto a un modelo de lenguaje, y ese modelo no corre en nuestros servidores."
          : "Para escribir tu CV hace falta mandarle tu perfil y el aviso a un modelo de lenguaje, y ese modelo no corre en nuestros servidores."}{" "}
        En los planes pagos el proveedor es{" "}
        <strong className="text-ink">DeepSeek</strong>, una empresa de la{" "}
        <strong className="text-ink">República Popular China</strong>, así que tus datos se
        procesan fuera de la Argentina.
      </p>

      <div className="mt-5 border-t border-rule pt-5">
        <h3 className="text-[15px] text-ink">Qué se envía</h3>
        <p className="mt-1.5 max-w-prose text-[13.5px] leading-relaxed text-ink-2">
          {kind === "read" ? (
            <>
              {READ.sent} <strong className="text-ink">{READ.covered}</strong>
              {READ.coveredWhy} {READ.travels} <strong className="text-ink">{READ.left}</strong>
              {READ.leftWhy} {NEVER_SENT}
            </>
          ) : (
            <>
              {GENERATE.sent} <strong className="text-ink">{GENERATE.nameStays}</strong>
              {GENERATE.nameStaysWhy} <strong className="text-ink">{GENERATE.contactStays}</strong>
              {GENERATE.contactStaysWhy} {NEVER_SENT}
            </>
          )}
        </p>
        <p className="mt-3 max-w-prose text-[13.5px] leading-relaxed text-ink-2">
          China no integra la lista de países con protección adecuada de la Disposición
          60-E/2016 de la Agencia de Acceso a la Información Pública, su legislación puede
          obligar a las empresas locales a colaborar con sus autoridades, y la política de
          DeepSeek admite usar lo que se le envía para entrenar sus propios modelos. El
          detalle está en la cláusula 5 de la{" "}
          <Link
            href="/legales/privacidad"
            className="underline underline-offset-4 hover:text-ink"
          >
            política de privacidad
          </Link>
          .
        </p>
      </div>

      <div className="mt-6 border-t border-rule pt-5">
        {/*
          * `Checkbox` ya trae su propio `<label>` envolviendo al input, así que
          * agregarle otro alrededor anida dos labels: HTML inválido, y un clic
          * que el navegador puede resolver activando el control dos veces.
          * `items-start` en vez del `items-center` que trae por defecto, porque
          * este texto ocupa cuatro líneas y una casilla centrada contra un
          * bloque de cuatro líneas queda flotando en el medio.
          */}
        <Checkbox
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
          className="max-w-prose items-start gap-3 text-[14px] leading-relaxed"
          label={
            "Presto mi consentimiento para que mis datos personales se transfieran a " +
            "DeepSeek, en la República Popular China, con la única finalidad de generar " +
            "los documentos que pida y de leer los textos que le pida leer. Sé que puedo " +
            "retirarlo cuando quiera."
          }
        />

        {error ? (
          <div className="mt-4">
            <Alert tone="bad" title="No pudimos registrarlo">
              {error}
            </Alert>
          </div>
        ) : null}

        <Button className="mt-5" disabled={!checked || busy} onClick={accept}>
          {busy ? "Registrando…" : "Acepto y sigo"}
        </Button>
      </div>

      <div className="mt-6 border-t border-rule pt-5">
        <h3 className="text-[15px] text-ink">O evitá la transferencia por completo</h3>
        <p className="mt-1.5 max-w-prose text-[13.5px] leading-relaxed text-ink-2">
          Con tu propia API key elegís vos el proveedor y el país donde se procesan tus
          datos, y el producto es entero y sin tope. Se configura en{" "}
          <Link href="/ajustes" className="underline underline-offset-4 hover:text-ink">
            Ajustes
          </Link>
          .
        </p>
      </div>
    </Card>
  );
}
