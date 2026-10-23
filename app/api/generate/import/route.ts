import { NextResponse } from "next/server";
import { z } from "zod";

import { extractDocument } from "@/lib/ai/pipeline";
import type { GenerationTelemetry } from "@/lib/ai/pipeline";
import { failure, openRequest } from "@/lib/api/context";
import { IMPORT_TEXT_MAX, IMPORT_TEXT_MIN, importTextProblem } from "@/lib/ai/import-limits";

export const runtime = "nodejs";

/**
 * A document arrives as text, not as a file — either a CV, or what someone
 * typed freely about their own career ("Contámelo a mi manera").
 *
 * Extraction happens in the browser first (`lib/import/extract.ts`, or nothing
 * at all for a typed answer), so a file itself never leaves the user's
 * machine — the same bargain the BYOK keys get. It also keeps every route in
 * this app on JSON: a multipart upload would be the first one, and the first
 * of anything is where the bugs live.
 *
 * No profile travels with the request, unlike the retired `importCV`: this
 * route only transcribes the document into entities
 * (`lib/ai/prompts/extract.ts`), and matching them against what the profile
 * already has is `lib/onboarding/merge.ts`'s job, on the client, after every
 * quote here has been checked against the text that produced it
 * (`lib/parse/verify-extraction.ts`).
 */
const bodySchema = z.object({
  /**
   * Long enough to be worth a call and short enough to be one document. Under
   * the floor this is not a CV nor a real answer; over the ceiling the prompt
   * would cost more than the extraction it wraps.
   */
  text: z.string().min(IMPORT_TEXT_MIN).max(IMPORT_TEXT_MAX),
  kind: z.enum(["cv", "dump"]),
});

export async function POST(request: Request) {
  const opened = await openRequest(request, "import");
  if (opened instanceof NextResponse) return opened;
  const { chain, grant, tier } = opened;

  try {
    const body: unknown = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      await grant.release("failure");
      // Too short and too long are not the same problem, and the way out of one is the opposite of the other's.
      const text = typeof (body as { text?: unknown } | null)?.text === "string" ? (body as { text: string }).text : "";
      return NextResponse.json(
        { error: importTextProblem(text) ?? "No pudimos leer ese documento: el pedido no tiene la forma esperada." },
        { status: 400 },
      );
    }

    const telemetry: GenerationTelemetry = {};
    const result = await extractDocument(chain, parsed.data.text, parsed.data.kind, telemetry);

    await grant.release("success", telemetry);
    return NextResponse.json(result);
  } catch (error) {
    await grant.release("failure");
    return failure(error, { chain, tier });
  }
}
