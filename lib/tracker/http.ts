import "server-only";

import { NextResponse } from "next/server";
import { TrackerInvalidTransitionError, TrackerNotFoundError } from "./service";

/**
 * Traduce los dos errores que `lib/tracker/service.ts` tira a la respuesta
 * que cada route ya arma a mano para todo lo demás — mismo envoltorio
 * `{ error, reason? }` que `lib/api/guards.ts`. Un error que no es ninguno de
 * los dos se relanza: cada route decide qué hacer con lo inesperado, esto
 * sólo cubre lo esperado.
 */
export function trackerErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof TrackerNotFoundError) {
    return NextResponse.json({ error: error.message, reason: "not_found" }, { status: 404 });
  }
  if (error instanceof TrackerInvalidTransitionError) {
    return NextResponse.json(
      {
        error: `${error.message} Si estás seguro, forzalo.`,
        reason: "invalid_transition",
        from: error.from,
        to: error.to,
      },
      { status: 409 },
    );
  }
  return null;
}
