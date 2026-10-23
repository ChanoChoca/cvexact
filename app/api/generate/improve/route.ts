import { NextResponse } from "next/server";
import { z } from "zod";

import { improveText, improveTexts } from "@/lib/ai/pipeline";
import type { GenerationTelemetry } from "@/lib/ai/pipeline";
import { IMPROVE_BATCH, IMPROVE_LIMIT, IMPROVE_MANY_LIMIT, type ImproveManyKind } from "@/lib/ai/prompts/improve";
import { failure, openRequest } from "@/lib/api/context";

export const runtime = "nodejs";

/**
 * Says what a person wrote about their own work better — "Mejorar con IA". Billed as `intake` like `split`: this is help with the profile, not a document.
 * What comes back is a proposal and nothing more: the browser checks it against what the person wrote and shows both before anything is changed.
 *
 * Two forms of the same call. One text — a line of a job, the description of a project — is the button on that line. Many texts — `items`, each with its kind —
 * is the button at the top of a section of the profile: one use of the plan's allowance for all that the section holds, and not one for each line.
 */
const bodySchema = z
  .object({
    text: z.string().min(1).max(IMPROVE_LIMIT.project),
    kind: z.enum(["task", "project"]),
  })
  // A fact holds 600 characters and a description 800: the text must be one the field it came from could hold.
  .refine(({ text, kind }) => text.length <= IMPROVE_LIMIT[kind]);

const KINDS = Object.keys(IMPROVE_MANY_LIMIT) as [ImproveManyKind, ...ImproveManyKind[]];

const manySchema = z
  .object({
    items: z
      .array(
        z
          .object({ id: z.string().min(1).max(20), kind: z.enum(KINDS), text: z.string().min(1).max(IMPROVE_MANY_LIMIT.about) })
          .refine(({ text, kind }) => text.length <= IMPROVE_MANY_LIMIT[kind]),
      )
      .min(1)
      .max(IMPROVE_BATCH.items),
  })
  // The answer is found by id: two texts with one id would be answered as one.
  .refine(({ items }) => new Set(items.map((item) => item.id)).size === items.length)
  .refine(({ items }) => items.reduce((sum, item) => sum + item.text.length, 0) <= IMPROVE_BATCH.chars);

export async function POST(request: Request) {
  const opened = await openRequest(request, "intake");
  if (opened instanceof NextResponse) return opened;
  const { chain, grant, tier } = opened;

  try {
    const body: unknown = await request.json();
    const telemetry: GenerationTelemetry = {};
    const asksMany = typeof body === "object" && body !== null && "items" in body;
    const parsed = asksMany ? manySchema.safeParse(body) : bodySchema.safeParse(body);
    if (!parsed.success) {
      await grant.release("failure");
      return NextResponse.json({ error: "Petición inválida." }, { status: 400 });
    }

    const result =
      "items" in parsed.data ? await improveTexts(chain, parsed.data.items, telemetry) : await improveText(chain, parsed.data.text, parsed.data.kind, telemetry);

    await grant.release("success", telemetry);
    return NextResponse.json(result);
  } catch (error) {
    await grant.release("failure");
    return failure(error, { chain, tier });
  }
}
