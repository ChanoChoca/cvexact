import { NextResponse } from "next/server";
import { z } from "zod";

import { chooseFollowUp } from "@/lib/ai/followup";
import type { GenerationTelemetry } from "@/lib/ai/pipeline";
import { NO_FOLLOW_UP } from "@/lib/ai/prompts/followup";
import { failure, openRequest } from "@/lib/api/context";
import type { DenialReason } from "@/lib/api/client";

export const runtime = "nodejs";

/**
 * Which of a few fixed questions to ask next, chosen by the model the person configured — an experiment they turn on.
 *
 * What goes is what they just answered (with the details the product does not use struck out first, in the browser) and, for each
 * of the few kinds of question the engine could ask about that job, a line of ours on what it would draw out — never the sentence
 * itself, which names their company; what comes back is one of those ids or `none`, and nothing else: the
 * schema is built from the ids, and the route checks it again. Only with a key of their own, like a photo: it sends a person's
 * own words to a model, and the experiment is not something that spends ours or sends them to our provider.
 */
const bodySchema = z.object({
  answer: z.string().min(10).max(1500),
  options: z
    .array(z.object({ id: z.string().min(1).max(120), about: z.string().min(1).max(300) }))
    .min(2)
    .max(6)
    .refine((options) => new Set(options.map((option) => option.id)).size === options.length),
});

export async function POST(request: Request) {
  const opened = await openRequest(request, "intake");
  if (opened instanceof NextResponse) return opened;
  const { chain, grant, tier } = opened;

  try {
    if (tier !== "byok") {
      await grant.release("failure");
      return NextResponse.json(
        { error: "Esto necesita tu propia key. Se configura en Ajustes.", reason: "byok_required" satisfies DenialReason },
        { status: 403 },
      );
    }

    const body: unknown = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      await grant.release("failure");
      return NextResponse.json({ error: "No pudimos elegir la pregunta: el pedido no tiene la forma esperada." }, { status: 400 });
    }

    const telemetry: GenerationTelemetry = {};
    const choice = await chooseFollowUp(chain, parsed.data.answer, parsed.data.options, telemetry);
    await grant.release("success", telemetry);
    // Whatever the model said, only an id that was on the list, or none, goes back.
    const known = new Set(parsed.data.options.map((option) => option.id));
    return NextResponse.json({ choice: known.has(choice) ? choice : NO_FOLLOW_UP });
  } catch (error) {
    await grant.release("failure");
    return failure(error, { chain, tier });
  }
}
