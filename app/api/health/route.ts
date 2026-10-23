import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { databaseConfigured, getDb } from "@/lib/db";
import { operatorConfigured, rnbdStatus } from "@/lib/legal/operator";
import { mailConfigured } from "@/lib/email/mailer";

export const runtime = "nodejs";
// A cached "ok" would keep a pod with a dead database in the Service rotation.
export const dynamic = "force-dynamic";

/**
 * Readiness probe. Without a database configured the app is whole on its own
 * and always answers ok; with one configured, an unreachable database answers
 * 503 so the pod leaves the Service instead of serving 500s (the same job the
 * actuator datasource check does for the CRM's backend).
 *
 * `legal` informa si los datos de IDENTIDAD del titular (`lib/legal/operator.ts`
 * — nombre, correo, y CUIT/domicilio si se vende) están cargados, `rnbd` el
 * estado de la inscripción en el Registro Nacional de Bases de Datos
 * (`"inscripto"` o `"en trámite"` — nunca un booleano: "en trámite" es un
 * estado honesto para publicar, no una falta, así que no vive dentro de
 * `legal`), y `mail` si hay mailer configurado — deliberadamente **ninguno
 * de los tres** afecta el estado ni el código HTTP: un CUIT sin poner o un
 * SMTP sin setear son un problema de cumplimiento, no de disponibilidad, y
 * sacar el pod de rotación por eso dejaría el sitio caído para arreglar algo
 * que se arregla editando un Secret. Están acá para que después de un
 * despliegue se pueda comprobar de un `curl` que el pie del sitio no salió
 * con «[pendiente de carga]» y que el borrado de cuenta (`lib/auth.ts` —
 * `enabled: mailConfigured`) no quedó apagado en silencio, que es la clase
 * de cosa que si no se puede consultar no se mira.
 *
 * Importante: esto es un chequeo de RUNTIME, sobre el pod que responde al
 * `curl` — no confirma que el HTML que un visitante recibe muestre lo mismo.
 * `next build` prerenderiza varias rutas (`/`, `/legales/*`, `/apoyar`, …),
 * y ese HTML queda grabado con lo que `process.env` tenía en el momento del
 * build, no del request — un desajuste real que costó la auditoría legal de
 * 2026-09 (la auditoría legal interna): este endpoint decía `legal: true`
 * mientras `/legales/privacidad` seguía sirviendo «[pendiente de carga]».
 * Por eso esas rutas ahora fuerzan `dynamic = "force-dynamic"` (ver
 * `app/page.tsx`) y `scripts/verify-build-legal.mjs` revisa el HTML
 * generado, en vez de confiar en que este endpoint alcance para probarlo.
 */
export async function GET() {
  if (!databaseConfigured) {
    return NextResponse.json({
      status: "ok",
      db: false,
      legal: operatorConfigured(),
      rnbd: rnbdStatus(),
      mail: mailConfigured,
    });
  }
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({
      status: "ok",
      db: true,
      legal: operatorConfigured(),
      rnbd: rnbdStatus(),
      mail: mailConfigured,
    });
  } catch {
    return NextResponse.json({ status: "unavailable", db: false }, { status: 503 });
  }
}
