import { NextResponse } from "next/server";
import { z } from "zod";

import { answerQuestions, sumTelemetry } from "@/lib/ai/pipeline";
import type { GenerationTelemetry } from "@/lib/ai/pipeline";
import { restoreCandidateName } from "@/lib/ai/prompts/shared";
import { answerGaps, answerLimitFindings, answerLimitGaps, verifyAnswers } from "@/lib/ai/verify";
import { attachQuestionLimits } from "@/lib/ai/question-limits";
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
import { inferredSkillSchema, jobAnalysisSchema } from "@/lib/schemas/job";
import { cvDocumentSchema } from "@/lib/schemas/cv";

export const runtime = "nodejs";

const bodySchema = z.object({
  profile: profileSchema,
  analysis: jobAnalysisSchema,
  cv: cvDocumentSchema.optional(),
  /** Reused from the CV step when the client has them; the block degrades to "None supplied". */
  inferredSkills: z.array(inferredSkillSchema).optional(),
  questions: z.array(z.string().min(1)).min(1).max(30),
  /** Typed next to each question in the UI; overrides a limit parsed from its text. */
  questionLimits: z.array(z.number().int().positive().max(100000).nullable()).max(30).optional(),
  outputLanguage: z.string().max(10).optional(),
});

export async function POST(request: Request) {
  // See `app/api/generate/cv/route.ts`: the body read once for its hash, and a
  // request already answered under this key answered again with no grant and
  // no model call.
  const idem = await readIdempotentRequest(request, "answers");
  const replay = await replayOf(idem);
  if (replay !== null) return replayJson(replay);

  /** The answer, kept under the idempotency key before it goes out. */
  const respond = async (value: unknown) => {
    await remember(idem, value);
    return NextResponse.json(value);
  };

  const opened = await openRequest(request, "answers");
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

    const { profile, analysis, cv } = parsed.data;
    const input = {
      ...parsed.data,
      outputLanguage: parsed.data.outputLanguage || analysis.language,
    };

    const first: GenerationTelemetry = {};
    let answers = await answerQuestions(chain, input, first);

    /**
     * One retry, for the failures a retry can actually fix.
     *
     * Every gap `answerGaps` reports is an answer the profile's own dates
     * contradict — the model underclaimed against material it was handed, so a
     * second attempt told which answer and by how much lands it. The form
     * limits add the other kind a retry fixes: an answer longer than the
     * employer's input box accepts (`answerLimitGaps`), counted the same way
     * the prompt's `[limit: …]` tag and the panel's counter count it. Same
     * shape as the CV route's `cvGaps` retry, including the free grant: the
     * reintento costs a call and no extra quota, exactly as the schema repairs
     * inside `generate()` do.
     */
    const audit = { answers, profile, cv, keywords: analysis.keywords };
    const rawQuestions = parsed.data.questions;
    const questionLimits = parsed.data.questionLimits;
    const limitGaps = (current: typeof answers) =>
      answerLimitGaps({ answers: current, questions: rawQuestions, questionLimits });
    const gaps = [...answerGaps(audit), ...limitGaps(answers)];
    let retry: GenerationTelemetry | undefined;
    if (gaps.length > 0) {
      retry = {};
      const second = await answerQuestions(chain, { ...input, gaps }, retry);
      // Keep whichever contradicts the profile less and fits the form better. A
      // retry that fixes the number by inventing a technology has not helped.
      const remaining = [...answerGaps({ ...audit, answers: second }), ...limitGaps(second)];
      if (remaining.length < gaps.length) answers = second;
    }

    // Both attempts spent real tokens even when the retry didn't ship — see
    // `sumTelemetry`.
    await grant.release("success", sumTelemetry(first, retry));

    // The model never saw the real name — see `restoreCandidateName` — so it
    // is swapped back in here, over the finished response, after every check
    // above ran against the placeholder-bearing text those checks don't care
    // about names either way.
    return await respond(
      restoreCandidateName(
        {
          // The limits the pasted questions stated, attached here because the
          // model's own shape does not carry them — so a reopened application
          // can still show the count next to every answer.
          answers: attachQuestionLimits(answers, rawQuestions, questionLimits),
          // Structural check that the answers did not sell the candidate short
          // or overclaim; surfaced to the user, not fatal. The limit findings
          // cover whatever is still over a form limit after the retry above.
          findings: [
            ...verifyAnswers({ ...audit, answers }),
            ...answerLimitFindings({ answers, questions: rawQuestions, questionLimits }),
          ],
        },
        profile.fullName,
      ),
    );
  } catch (error) {
    await forget(idem);
    await grant.release("failure");
    return failure(error, { chain, tier });
  }
}
