import { NextResponse } from "next/server";
import { z } from "zod";

import { splitNarrative } from "@/lib/ai/pipeline";
import type { GenerationTelemetry } from "@/lib/ai/pipeline";
import { failure, openRequest } from "@/lib/api/context";

export const runtime = "nodejs";

/**
 * Separates one narrative answer into the statements it makes — "Separar con
 * tu IA", offered beside the deterministic sentence-split every such answer
 * already gets. Billed as `intake`: this is help with the profile, not a
 * document, and the smallest of the three AI extraction points.
 */
const bodySchema = z.object({
  answer: z.string().min(1).max(1500),
});

export async function POST(request: Request) {
  const opened = await openRequest(request, "intake");
  if (opened instanceof NextResponse) return opened;
  const { chain, grant, tier } = opened;

  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      await grant.release("failure");
      return NextResponse.json({ error: "Petición inválida." }, { status: 400 });
    }

    const telemetry: GenerationTelemetry = {};
    const result = await splitNarrative(chain, parsed.data.answer, telemetry);

    await grant.release("success", telemetry);
    return NextResponse.json(result);
  } catch (error) {
    await grant.release("failure");
    return failure(error, { chain, tier });
  }
}
