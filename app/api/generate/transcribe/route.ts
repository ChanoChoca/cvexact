import { NextResponse } from "next/server";
import { z } from "zod";

import { NO_TEXT, VisionFailure, transcribeImage } from "@/lib/ai/vision";
import type { GenerationTelemetry } from "@/lib/ai/pipeline";
import { failure, openRequest } from "@/lib/api/context";
import type { DenialReason } from "@/lib/api/client";
import { MAX_PHOTO_BASE64 } from "@/lib/import/photo-limits";

export const runtime = "nodejs";

/**
 * A photo or a scan of a CV, read into text by the model the person configured.
 *
 * The image arrives as base64 inside JSON, like everything else in this app: it was already made small in the browser
 * (`lib/import/photo.ts`), and it is not kept — it goes to the provider they chose with the request and is gone with it. What
 * comes back is text for them to look at against their photo before anything reads it into a profile.
 *
 * Only with their own key. A photo of a CV is full of what the product promises not to read — a document number, a birth date,
 * an address — and it cannot be struck out before it leaves, as text can, because nothing here knows where it is until it has
 * been read. So it is not something that goes to our own provider on anyone's behalf, and the screen says what goes, whole,
 * before it is asked for. The privacy policy says the same, in clause 5.
 */
const bodySchema = z.object({
  image: z
    .string()
    .min(200)
    .max(MAX_PHOTO_BASE64)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

export async function POST(request: Request) {
  const opened = await openRequest(request, "import");
  if (opened instanceof NextResponse) return opened;
  const { chain, grant, tier } = opened;

  try {
    if (tier !== "byok") {
      await grant.release("failure");
      return NextResponse.json(
        {
          error: "Leer una foto necesita tu propia key de un proveedor que lea imágenes —Google Gemini, por ejemplo—. Se configura en Ajustes.",
          reason: "byok_required" satisfies DenialReason,
        },
        { status: 403 },
      );
    }

    const body: unknown = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      await grant.release("failure");
      return NextResponse.json({ error: "No pudimos leer esa foto: la imagen no llegó como esperábamos. Probá con otra." }, { status: 400 });
    }

    const telemetry: GenerationTelemetry = {};
    const text = await transcribeImage(chain, { base64: parsed.data.image, mediaType: parsed.data.mediaType }, telemetry);

    await grant.release("success", telemetry);
    return NextResponse.json({ text: text === NO_TEXT ? "" : text });
  } catch (error) {
    await grant.release("failure");
    // The reading's own failures say what they are, with a way out; anything else is told the way every route tells it.
    if (error instanceof VisionFailure) return NextResponse.json({ error: error.message }, { status: error.status });
    return failure(error, { chain, tier });
  }
}
