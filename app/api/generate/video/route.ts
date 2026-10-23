import { NextResponse } from "next/server";
import { z } from "zod";

import { writeVideoScript } from "@/lib/ai/pipeline";
import type { GenerationTelemetry } from "@/lib/ai/pipeline";
import { restoreCandidateName } from "@/lib/ai/prompts/shared";
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
import { VIDEO_MAX_SECONDS, VIDEO_MIN_SECONDS } from "@/lib/schemas/outputs";

export const runtime = "nodejs";

const bodySchema = z.object({
  profile: profileSchema,
  analysis: jobAnalysisSchema,
  cv: cvDocumentSchema.optional(),
  /** The topics or questions the employer wants the video to cover. */
  topics: z.string().max(4000).default(""),
  durationSeconds: z
    .number()
    .int()
    .min(VIDEO_MIN_SECONDS)
    .max(VIDEO_MAX_SECONDS)
    .default(120),
  outputLanguage: z.string().max(10).optional(),
});

export async function POST(request: Request) {
  // See `app/api/generate/cv/route.ts`: the body read once for its hash, and a
  // request already answered under this key answered again with no grant and
  // no model call.
  const idem = await readIdempotentRequest(request, "video");
  const replay = await replayOf(idem);
  if (replay !== null) return replayJson(replay);

  /** The answer, kept under the idempotency key before it goes out. */
  const respond = async (value: unknown) => {
    await remember(idem, value);
    return NextResponse.json(value);
  };

  const opened = await openRequest(request, "video");
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
    const video = await writeVideoScript(
      chain,
      {
        ...parsed.data,
        outputLanguage: parsed.data.outputLanguage || parsed.data.analysis.language,
      },
      telemetry,
    );

    await grant.release("success", telemetry);
    // El modelo nunca vio el nombre real — ver `restoreCandidateName`.
    return await respond({
      video: restoreCandidateName(video, parsed.data.profile.fullName),
    });
  } catch (error) {
    await forget(idem);
    await grant.release("failure");
    return failure(error, { chain, tier });
  }
}
