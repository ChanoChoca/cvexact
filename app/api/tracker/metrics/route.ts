import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/api/guards";
import { databaseConfigured } from "@/lib/db";
import { getMetrics } from "@/lib/tracker/service";

export const runtime = "nodejs";

const RATE_LIMIT = { window: 60, max: 30 };

export async function GET(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const limited = await enforceRateLimit("tracker-metrics", request.headers, RATE_LIMIT, user.id);
  if (limited) return limited;

  if (!databaseConfigured) {
    return NextResponse.json({ error: "Esta instalación no tiene base de datos configurada." }, { status: 503 });
  }

  const metrics = await getMetrics(user.id);
  return NextResponse.json(metrics);
}
