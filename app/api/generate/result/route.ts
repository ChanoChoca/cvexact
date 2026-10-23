import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/api/guards";
import { idempotencyKeyOf } from "@/lib/generation/idempotency";
import { readForRecovery } from "@/lib/generation/result-cache";

export const runtime = "nodejs";

/**
 * A generation's result, by the idempotency key it was requested under — for
 * the browser that asked for it and never managed to store it (see
 * `lib/generation/result-cache.ts` and `lib/applications/recovery.ts`).
 *
 * The key is the only credential, on purpose: it is 122 random bits the browser
 * made and kept, and it is also what decrypts the row, so there is nothing else
 * this could check that would add anything. Rate-limited per address all the
 * same, so the endpoint cannot be used to hammer the database.
 *
 * 404: nothing kept (never finished, refused, expired). 409: still being
 * generated — ask again in a moment.
 */
export async function GET(request: Request) {
  const limited = await enforceRateLimit("generate-result", request.headers, { window: 600, max: 120 });
  if (limited) return limited;

  const key = idempotencyKeyOf(request.headers);
  if (!key) {
    return NextResponse.json({ error: "Falta la clave de la generación." }, { status: 400 });
  }

  const found = await readForRecovery(key);
  if (!found) {
    return NextResponse.json(
      { error: "No hay un resultado guardado para esa generación." },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  if (found.status === "running") {
    return NextResponse.json(
      { error: "Todavía se está generando." },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
  }
  return NextResponse.json(
    { kind: found.kind, value: found.payload.value, jobText: found.payload.jobText },
    { headers: { "cache-control": "no-store" } },
  );
}
