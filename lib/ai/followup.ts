import "server-only";

import { generate } from "./pipeline";
import type { GenerationTelemetry } from "./pipeline";
import { FOLLOW_UP_SYSTEM, buildFollowUpPrompt, followUpSchema, type FollowUpOption } from "./prompts/followup";
import type { ModelChain } from "./provider";

/**
 * Which of the questions on `options` a model would ask next, or `none` — never more than that. Capped like the other readings of
 * a text a person wrote (`extractDocument`, `splitNarrative`): the first attempt and one more, in whatever form, and no repair
 * that asks for something different from what was asked.
 */
export async function chooseFollowUp(chain: ModelChain, answer: string, options: readonly FollowUpOption[], telemetry?: GenerationTelemetry): Promise<string> {
  const result = await generate({
    chain,
    schema: followUpSchema(options.map((option) => option.id)),
    schemaName: "FollowUp",
    system: FOLLOW_UP_SYSTEM,
    prompt: buildFollowUpPrompt(answer, options),
    maxGenerations: 2,
    allowShortenRepair: false,
    ...(telemetry ? { telemetry } : {}),
  });
  return result.choice;
}
