import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/api/guards";
import { databaseConfigured } from "@/lib/db";
import { ingestEmail } from "@/lib/tracker/email-ingest";

export const runtime = "nodejs";

/**
 * Un correo por request, ya parseado — lo llama el Worker de
 * `workers/tracker-email/`, nunca un navegador. Sin sesión: quien llama es
 * un servicio, no una persona. `x-origin-auth` (`proxy.ts`) sólo asegura que
 * el pedido no llegó directo al nodo: la Transform Rule de Cloudflare se lo
 * agrega a todo el tráfico público, así que esta ruta ES alcanzable desde
 * internet (comprobado el 2026-09-18). El Worker manda el header él mismo,
 * porque corre fuera del clúster.
 *
 * A diferencia de `/api/tracker/cron` y `/api/jobs/alerts/send`, no puede
 * llevar `rejectIfViaPublicEdge` (`lib/api/internal-only.ts`): el Worker entra
 * por la URL pública (`APP_URL` en su `wrangler.toml`), o sea por el mismo
 * camino que un visitante, y no hay con qué distinguirlos sin un secreto
 * propio. Lo que la protege hoy es que el alias (`u_` + 12 hex, 48 bits) no es
 * adivinable y que, sin un alias válido y con consentimiento, `ingestEmail` no
 * escribe nada (`no_inbox`). Cerrar el resto pide un secreto distinto del que
 * agrega Cloudflare, en el Secret y en el Worker (`wrangler secret put`, con
 * redeploy) — riesgo residual anotado en `INCIDENTES.md`.
 *
 * `bodyText` es el único dato "pesado" que cruza acá, y nunca se guarda —
 * `lib/tracker/email-ingest.ts` lo usa para clasificar en memoria y tira el
 * resto. Tope de tamaño generoso pero real: un correo de ATS normal no se
 * acerca, y esto evita que un mensaje enorme (o malicioso) se procese
 * entero.
 */
const bodySchema = z.object({
  alias: z.string().trim().min(1).max(320),
  from: z.string().trim().min(1).max(320),
  subject: z.string().trim().max(998).default(""),
  bodyText: z.string().max(20_000).default(""),
});

/**
 * Un tope por IP de quien llama, y nada más: sin sesión no hay otra cosa a qué
 * atarlo. Es defensa en profundidad, no la protección — esa sigue siendo que el
 * alias no se puede adivinar, y cerrar el resto pide el secreto propio del Worker
 * de arriba. Sirve para que un pedido sin autenticar que consulta la base en cada
 * vuelta no pueda repetirse sin freno.
 *
 * El número tiene que quedar muy por encima de lo legítimo. El Worker corre en
 * Cloudflare, así que lo que manda puede compartir cubo entre todas las cuentas,
 * y un 429 no se reintenta: el Worker registra el error y ese correo se pierde
 * (`workers/tracker-email/src/index.js`). 120 por minuto está muy por encima del
 * volumen de hoy; si el producto crece hasta acercarse, subirlo antes de que
 * empiece a tirar correos.
 */
const RATE_LIMIT = { window: 60, max: 120 };

export async function POST(request: Request) {
  // Antes de leer el cuerpo: un pedido con basura también cuenta.
  const limited = await enforceRateLimit("tracker-email-ingest", request.headers, RATE_LIMIT);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Payload inválido." }, { status: 400 });

  if (!databaseConfigured) return NextResponse.json({ outcome: "no_inbox" });

  const result = await ingestEmail(parsed.data);
  return NextResponse.json(result);
}
