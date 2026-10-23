import { NextResponse } from "next/server";
import { z } from "zod";

import { condenseCvLines } from "@/lib/ai/condense";
import type { GenerationTelemetry } from "@/lib/ai/pipeline";
import { failure, openRequest } from "@/lib/api/context";
import type { DenialReason } from "@/lib/api/client";

export const runtime = "nodejs";

/**
 * Shorter versions of a few CV lines, so the document fits on one sheet
 * (to-do «ajuste a una hoja», Etapa 2).
 *
 * Only with a key of their own, like the follow-up choice and a photo: what goes
 * is the person's own lines, written about their own jobs, and the step exists to
 * avoid *removing* material — it must never be the reason ours is spent or their
 * CV reaches a provider they did not choose. Anyone else gets `byok_required`,
 * which the client reads as «no AI» and carries on with the deterministic fit.
 *
 * What comes back is checked against what was asked for: only ids that were sent,
 * only one per line, and never over the ceiling each line was given (`maxChars`).
 * The rest of the checks — figures, dates, names, negations, who did what — are in
 * `lib/cv/condense-guard.ts`, in the browser, where the profile they are compared
 * against already lives.
 */
const bodySchema = z.object({
  language: z.string().min(2).max(10),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        /** A CV bullet or a sentence of the summary; the schema's own ceilings are 400 and 600. */
        text: z.string().min(20).max(600),
        maxChars: z.number().int().min(20).max(600),
        hint: z.enum(["short-tail", "long-line", "summary"]),
      }),
    )
    .min(1)
    .max(12)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length),
});

export async function POST(request: Request) {
  const opened = await openRequest(request, "condense");
  if (opened instanceof NextResponse) return opened;
  const { chain, grant, tier } = opened;

  try {
    if (tier !== "byok") {
      await grant.release("failure");
      return NextResponse.json(
        {
          error: "Para acortar el CV con IA necesitás tu propia key. Se configura en Ajustes.",
          reason: "byok_required" satisfies DenialReason,
        },
        { status: 403 },
      );
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      await grant.release("failure");
      return NextResponse.json(
        { error: "No pudimos acortar el CV: el pedido no tiene la forma esperada." },
        { status: 400 },
      );
    }

    const telemetry: GenerationTelemetry = {};
    const rewrites = await condenseCvLines(chain, parsed.data, telemetry);
    await grant.release("success", telemetry);
    return NextResponse.json({ rewrites });
  } catch (error) {
    await grant.release("failure");
    return failure(error, { chain, tier });
  }
}
