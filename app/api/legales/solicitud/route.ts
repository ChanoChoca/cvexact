import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/api/guards";
import { databaseConfigured, getDb, schema } from "@/lib/db";
import { sendMail } from "@/lib/email/mailer";
import { legalRequestMail, type LegalRequestKind } from "@/lib/email/templates";
import { salesEnabled } from "@/lib/payments/sales";

export const runtime = "nodejs";

const bodySchema = z.object({
  kind: z.enum(["arrepentimiento", "baja"]),
  /*
   * `.trim().toLowerCase()` ANTES de `.email()`, no después.
   *
   * Al revés, un correo pegado con un espacio al final —que es la mitad de los
   * que se pegan— no pasa la validación y el formulario responde 400. En
   * cualquier otro lado eso es una molestia; acá es rechazarle a alguien el
   * ejercicio de un derecho de orden público por un carácter invisible.
   *
   * Normalizar en el esquema y no en el handler también es lo que hace que la
   * fila y el correo no puedan discrepar: hay un solo lugar donde la dirección
   * toma su forma final.
   */
  email: z.string().trim().toLowerCase().email().max(160),
  /** Opcional: no hay que expresar causa, y el formulario lo dice. */
  details: z.string().max(2000).optional(),
});

/**
 * El código que se le informa al solicitante.
 *
 * Corto y legible en voz alta, porque el uso previsto es dictarlo por teléfono o
 * copiarlo a un reclamo. Sin `l`, `1`, `O` ni `0`: un código de trámite que se
 * transcribe mal es un código que no sirve para lo único que hace.
 */
function requestCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const raw = randomUUID().replace(/-/g, "");
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    code += alphabet[parseInt(raw.slice(i * 2, i * 2 + 2), 16) % alphabet.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Recibe una solicitud de arrepentimiento o de baja, y deja constancia.
 *
 * Público y sin sesión, que es el punto entero: la Res. SCI 424/2020 exige que
 * arrepentirse y darse de baja sean accesibles desde la página de inicio, y
 * exigir una contraseña para poder ejercer el derecho de revocación es la
 * fricción que la norma vino a eliminar. Alguien que compró hace once meses y no
 * recuerda su contraseña tiene el mismo derecho que alguien recién logueado.
 *
 * Eso tiene dos consecuencias que este handler tiene que sostener a mano.
 *
 * La primera es que **la respuesta es siempre la misma**, exista o no una cuenta
 * con esa dirección. Un 404 para "no hay nadie con ese mail" convertiría a este
 * endpoint en un oráculo de enumeración de cuentas, que es exactamente lo que
 * `login_attempt` evita del otro lado. Se registra la solicitud igual: un tipeo
 * en el mail es un caso que hay que atender, no un error que hay que rechazar.
 *
 * La segunda es que es un caño para mandar correo a direcciones ajenas. Contra
 * eso hay tres capas: el límite por IP de acá abajo, el presupuesto por
 * destinatario de `lib/email/budget.ts`, y el `kind: "unsolicited"` de la
 * plantilla, que es lo que hace que ese presupuesto lo trate como lo que es.
 *
 * La constancia se manda pero **no se espera para responder**: `sendMail` no
 * lanza nunca y una falla de SMTP no puede hacer que una solicitud registrada se
 * le reporte al usuario como fallida. La fila ya está; el correo es la copia.
 */
export async function POST(request: Request) {
  // Las dos páginas que apuntan acá (`/arrepentimiento`, `/baja`) ya dan 404
  // sin venta; este endpoint es el trámite de una compra, así que sigue el
  // mismo gate en vez de quedar alcanzable por quien pegue la URL a mano.
  if (!salesEnabled) {
    return NextResponse.json(
      { error: "Esta instalación no vende nada por ahora." },
      { status: 503 },
    );
  }

  // Cinco por hora y por dirección. Un formulario que se manda una vez en la
  // vida no necesita más, y esto es lo único que separa al botón de
  // arrepentimiento de ser un remitente abierto.
  const limited = await enforceRateLimit("legal-request", request.headers, {
    window: 3600,
    max: 5,
  });
  if (limited) return limited;

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Revisá el correo que pusiste: no parece una dirección válida." },
      { status: 400 },
    );
  }

  const email = parsed.email;
  const code = requestCode();

  if (databaseConfigured) {
    try {
      await getDb().insert(schema.legalRequest).values({
        id: code,
        kind: parsed.kind,
        email,
        details: parsed.details?.trim() ?? "",
      });
    } catch (error) {
      // Acá sí falla el pedido: la constancia es la obligación, y decirle al
      // usuario que quedó registrado algo que no se guardó es peor que pedirle
      // que reintente.
      console.error(
        "[legal] could not record request:",
        error instanceof Error ? error.message : String(error),
      );
      return NextResponse.json(
        { error: "No pudimos registrar tu solicitud. Probá de nuevo en un momento." },
        { status: 503 },
      );
    }
  }

  await sendMail(legalRequestMail(email, parsed.kind as LegalRequestKind, code));

  return NextResponse.json({ code });
}
