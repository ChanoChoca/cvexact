import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/api/guards";
import { recordTransferConsent, withdrawTransferConsent } from "@/lib/legal/consent";
import { LEGAL_VERSION } from "@/lib/legal/operator";

export const runtime = "nodejs";

/**
 * Registra el consentimiento a la transferencia internacional de datos.
 *
 * Exige sesión, al revés que `../solicitud`. No es una inconsistencia: aquel
 * recibe el ejercicio de un derecho y no puede poner condiciones para ejercerlo;
 * este otorga un permiso sobre datos de una persona concreta, y un permiso que
 * cualquiera puede dar en nombre de otro no es un permiso. El `userId` sale de
 * la sesión y nunca del cuerpo del pedido, por la misma razón por la que la baja
 * de la suscripción saca el id de la fila del usuario: si viniera en el body,
 * alguien podría consentir por otro.
 *
 * La versión tampoco se recibe: la fija el servidor con `LEGAL_VERSION`. Un
 * cliente que eligiera qué versión está aceptando podría declarar aceptada una
 * que nunca vio.
 */
export async function POST(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) {
    return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });
  }

  const limited = await enforceRateLimit(
    "legal-consent",
    request.headers,
    { window: 3600, max: 20 },
    user.id,
  );
  if (limited) return limited;

  try {
    await recordTransferConsent(user.id);
  } catch (error) {
    console.error(
      "[legal] could not record consent:",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { error: "No pudimos registrar tu consentimiento. Probá de nuevo." },
      { status: 503 },
    );
  }

  return NextResponse.json({ version: LEGAL_VERSION });
}

/**
 * Retira el consentimiento a la transferencia internacional.
 *
 * Mismo `userId` de sesión que arriba y por la misma razón: nadie puede
 * retirar el consentimiento de otro. La consecuencia real vive en
 * `lib/api/context.ts`, que vuelve a exigirlo antes de la próxima generación
 * en un tier pago — este endpoint sólo borra la constancia.
 */
export async function DELETE(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) {
    return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });
  }

  const limited = await enforceRateLimit(
    "legal-consent",
    request.headers,
    { window: 3600, max: 20 },
    user.id,
  );
  if (limited) return limited;

  try {
    await withdrawTransferConsent(user.id);
  } catch (error) {
    console.error(
      "[legal] could not withdraw consent:",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { error: "No pudimos retirar tu consentimiento. Probá de nuevo." },
      { status: 503 },
    );
  }

  return NextResponse.json({ withdrawn: true });
}
