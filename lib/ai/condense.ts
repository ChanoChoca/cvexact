import "server-only";

import { generate } from "./pipeline";
import type { GenerationTelemetry } from "./pipeline";
import {
  CONDENSE_CV_SYSTEM,
  buildCondenseCvPrompt,
  condenseCvSchema,
  type CondenseItem,
  type CondenseRewrite,
} from "./prompts/condense-cv";
import type { ModelChain } from "./provider";

/**
 * Shorter versions of the lines that were asked for, and nothing else.
 *
 * One call, capped: the first attempt and no repair (`maxGenerations: 1`,
 * `allowShortenRepair: false`). With two, `generate` could answer a schema
 * complaint by rewriting the lines again at another provider — sending the CV to
 * a second place for a retouch nobody asked for, which is the opposite of what a
 * step that only ever runs with the person's own key is for.
 *
 * The answer is closed here as well as in the route: an id nobody asked about,
 * an empty line or one over the ceiling it was given is not a rewrite, and
 * dropping it costs nothing — the line it was about stays as it was.
 */
export async function condenseCvLines(
  chain: ModelChain,
  input: { language: string; items: readonly CondenseItem[] },
  telemetry?: GenerationTelemetry,
): Promise<CondenseRewrite[]> {
  const ceilings = new Map(input.items.map((item) => [item.id, item.maxChars]));

  const result = await generate({
    chain,
    schema: condenseCvSchema(),
    schemaName: "CondenseCv",
    system: CONDENSE_CV_SYSTEM,
    prompt: buildCondenseCvPrompt(input.language, input.items),
    maxGenerations: 1,
    allowShortenRepair: false,
    ...(telemetry ? { telemetry } : {}),
  });

  const seen = new Set<string>();
  return result.rewrites.filter((rewrite) => {
    const ceiling = ceilings.get(rewrite.id);
    if (ceiling === undefined) return false;
    // One rewrite per id: a second one for the same line is a model deciding to
    // try again, and nothing here re-ranks two answers to one question.
    if (seen.has(rewrite.id)) return false;
    const text = rewrite.text.trim();
    if (text.length === 0 || text.length > ceiling) return false;
    seen.add(rewrite.id);
    return true;
  });
}
