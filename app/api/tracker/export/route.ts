import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/api/guards";
import { databaseConfigured } from "@/lib/db";
import { exportRows } from "@/lib/tracker/service";
import { applicationsToCsv, applicationsToJson } from "@/lib/tracker/export";

export const runtime = "nodejs";

/**
 * Export sin límites, en un click — ver `docs/tracker-plan.md`, sección 8.
 * `?format=csv` (default) o `?format=json`, con el timeline completo.
 */
const RATE_LIMIT = { window: 3600, max: 20 };

export async function GET(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const limited = await enforceRateLimit("tracker-export", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  if (!databaseConfigured) {
    return NextResponse.json({ error: "Esta instalación no tiene base de datos configurada." }, { status: 503 });
  }

  const format = new URL(request.url).searchParams.get("format") === "json" ? "json" : "csv";
  const { applications, events } = await exportRows(user.id);

  if (format === "json") {
    return new NextResponse(applicationsToJson(applications, events), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": 'attachment; filename="postulaciones.json"',
      },
    });
  }

  return new NextResponse(applicationsToCsv(applications), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="postulaciones.csv"',
    },
  });
}
