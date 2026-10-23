import { NextResponse } from "next/server";
import { z } from "zod";

import { writeEmail } from "@/lib/ai/pipeline";
import type { GenerationTelemetry } from "@/lib/ai/pipeline";
import { restoreCandidateName } from "@/lib/ai/prompts/shared";
import { withSignOff } from "@/lib/ai/prompts/write-email";
import { failure, openRequest } from "@/lib/api/context";
import {
  busyResponse,
  claim,
  forget,
  parseBody,
  readIdempotentRequest,
  remember,
  replayJson,
  replayOf,
} from "@/lib/generation/idempotent-route";
import { profileSchema } from "@/lib/schemas/profile";
import { jobAnalysisSchema } from "@/lib/schemas/job";
import { cvDocumentSchema } from "@/lib/schemas/cv";
import { emailLengthSchema, emailToneSchema } from "@/lib/schemas/outputs";

export const runtime = "nodejs";

const bodySchema = z.object({
  profile: profileSchema,
  analysis: jobAnalysisSchema,
  cv: cvDocumentSchema.optional(),
  tone: emailToneSchema.default("neutral"),
  length: emailLengthSchema.default("short"),
  outputLanguage: z.string().max(10).optional(),
});

export async function POST(request: Request) {
  // See `app/api/generate/cv/route.ts`: the body read once for its hash, and a
  // request already answered under this key answered again with no grant and
  // no model call.
  const idem = await readIdempotentRequest(request, "email");
  const replay = await replayOf(idem);
  if (replay !== null) return replayJson(replay);

  /** The answer, kept under the idempotency key before it goes out. */
  const respond = async (value: unknown) => {
    await remember(idem, value);
    return NextResponse.json(value);
  };

  const opened = await openRequest(request, "email");
  if (opened instanceof NextResponse) return opened;
  const { chain, grant, tier } = opened;

  try {
    const parsed = bodySchema.safeParse(parseBody(idem));
    if (!parsed.success) {
      await grant.release("failure");
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Petición inválida." },
        { status: 400 },
      );
    }

    // Another request generating under this key right now waits for that one.
    if (!(await claim(idem))) {
      await grant.release("failure");
      return busyResponse();
    }

    const telemetry: GenerationTelemetry = {};
    const email = await writeEmail(
      chain,
      {
        ...parsed.data,
        outputLanguage: parsed.data.outputLanguage || parsed.data.analysis.language,
      },
      telemetry,
    );

    await grant.release("success", telemetry);
    /*
     * La firma se pega acá y no la escribe el modelo, igual que el header del CV
     * en `../cv/route.ts`. Así el nombre, el correo y el teléfono del candidato
     * salen exactos por construcción en vez de por obediencia — y, sobre todo,
     * no hace falta mandárselos al proveedor para que los devuelva copiados.
     * Ver `IDENTITY_WITHHELD` en `lib/ai/prompts/shared.ts`.
     *
     * El cuerpo sí pudo haber usado el placeholder si el modelo se nombró a sí
     * mismo en el texto (p. ej. "Saludos, [CANDIDATE_NAME]"); se repone antes
     * de pegar la firma real.
     */
    const restored = restoreCandidateName(email, parsed.data.profile.fullName);
    return await respond({
      email: { ...restored, body: withSignOff(restored.body, parsed.data.profile) },
    });
  } catch (error) {
    await forget(idem);
    await grant.release("failure");
    return failure(error, { chain, tier });
  }
}
