import { NextResponse } from "next/server";
import { z } from "zod";

import { prepareInterview } from "@/lib/ai/pipeline";
import type { GenerationTelemetry } from "@/lib/ai/pipeline";
import { restoreCandidateName } from "@/lib/ai/prompts/shared";
import { failureMessage, openRequest } from "@/lib/api/context";
import {
  busyResponse,
  claim,
  forget,
  parseBody,
  readIdempotentRequest,
  remember,
  replayOf,
  replayStream,
} from "@/lib/generation/idempotent-route";
import type { CandidateAttempt } from "@/lib/api/context";
import { profileSchema } from "@/lib/schemas/profile";
import { jobAnalysisSchema } from "@/lib/schemas/job";
import { cvDocumentSchema } from "@/lib/schemas/cv";

export const runtime = "nodejs";

/**
 * The interview prep, written as NDJSON so the wait cannot be cut by the proxy.
 *
 * This was the one generation that still answered a single JSON body, and it is
 * the single most expensive one: up to three candidates, each allowed
 * `LARGE_ATTEMPT_TIMEOUT_MS` (90s), under a `REQUEST_BUDGET_MS` of 180s — and
 * the first byte of a JSON answer only leaves after *all* of it. HAProxy's
 * server timeout (~50s; measured from production: the browser saw the 504 at
 * 50.05s) cut the connection with zero bytes written, while the pod kept
 * working. In local there is no proxy in between, which is exactly why the
 * generation succeeded there and 504'd in production with identical
 * credentials.
 *
 * The fix is the one `app/api/generate/cv/route.ts` and intake already run on:
 * open the stream immediately and narrate it — and keep narrating it. The
 * headers alone do not buy the 24h `timeout-tunnel` this header used to claim:
 * that key is a ConfigMap option, not an Ingress annotation in this controller,
 * so what applies to the body is the same ~50s `timeout server` inactivity
 * timeout. Measured again on the CV route: the stream was cut mid-generation
 * while the pod kept working and logged no failure at all. The keepalive frame
 * below is what paces the silence, and the CV route now carries the same one
 * for its up-to-90s document call.
 *
 * The error contract is the one every streaming route here has: anything that
 * fails *before* the stream opens is an ordinary HTTP error, and anything after
 * it is an `error` frame under a 200 that the client has to look for.
 */

const bodySchema = z.object({
  profile: profileSchema,
  analysis: jobAnalysisSchema,
  cv: cvDocumentSchema.optional(),
  /** Format, interviewer, anything the user knows about the interview. */
  context: z.string().max(4000).default(""),
  outputLanguage: z.string().max(10).optional(),
});

type Frame =
  | { type: "stage"; stage: "writing" }
  | { type: "switch"; to: string; reason: string }
  /**
   * Written while a candidate is still thinking, so no proxy in between can
   * call the connection dead. The client's reader forwards it to `onFrame`,
   * where the UI ignores it — its job is the wire, not the screen.
   */
  | { type: "keepalive" }
  /** The terminal frame, carrying exactly what the JSON body used to. */
  | { type: "done"; value: { interview: unknown } }
  /**
   * `attempts`/`untried` are the BYOK-only structured twin of `message` — see
   * `failureMessage` in `@/lib/api/context`.
   */
  | { type: "error"; message: string; attempts?: CandidateAttempt[]; untried?: number };

export async function POST(request: Request) {
  // See `app/api/generate/cv/route.ts`: the body read once for its hash, and a
  // request already answered under this key answered again with no grant and
  // no model call.
  const idem = await readIdempotentRequest(request, "interview");
  const replay = await replayOf(idem);
  if (replay !== null) return replayStream(replay);

  const opened = await openRequest(request, "interview");
  if (opened instanceof NextResponse) return opened;
  const { chain, grant, tier } = opened;

  // Everything that can still be answered with a status code happens up here.
  // Once the stream opens the response is a 200 and it is too late.
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

  /**
   * The reservation is released exactly once.
   *
   * Both the body below and `cancel` can reach it: a user who presses Parar
   * aborts the request while a generation is still running, which makes the
   * pending await throw and sends the body down its failure path too. Without
   * this the same generation would be refunded and then charged, in that order.
   */
  let settled = false;
  const settle = async (
    outcome: "success" | "failure",
    telemetry?: GenerationTelemetry,
  ) => {
    if (settled) return;
    settled = true;
    await grant.release(outcome, telemetry);
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (frame: Frame) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
        } catch {
          // The reader is gone — the user pressed Parar or closed the tab.
          // Nothing left to tell them, and the work is already unwinding.
        }
      };

      /** `done` is kept under the idempotency key before it goes out — see the CV route. */
      let doneSent: Promise<void> | null = null;
      const send = (frame: Frame) => {
        if (frame.type !== "done") {
          enqueue(frame);
          return;
        }
        doneSent = remember(idem, frame.value).then(() => enqueue(frame));
      };

      // A fallback the user can see is a delay with a reason; the same fallback
      // unseen is a hang. Same wiring as the CV route.
      chain.onSwitch = (event) => send({ type: "switch", to: event.to, reason: event.message });

      // One frame every 15s sits far inside any proxy's inactivity timeout and
      // is small enough not to matter: the interval exists for the wire, and
      // its frames are noise to the reader.
      const heartbeat = setInterval(() => send({ type: "keepalive" }), 15_000);

      try {
        send({ type: "stage", stage: "writing" });

        const telemetry: GenerationTelemetry = {};
        const interview = await prepareInterview(
          chain,
          {
            ...parsed.data,
            outputLanguage: parsed.data.outputLanguage || parsed.data.analysis.language,
          },
          telemetry,
        );

        await settle("success", telemetry);
        // El modelo nunca vio el nombre real — ver `restoreCandidateName`.
        send({
          type: "done",
          value: {
            interview: restoreCandidateName(interview, parsed.data.profile.fullName),
          },
        });
      } catch (error) {
        await settle("failure");
        await forget(idem);
        const failed = failureMessage(error, { chain, tier });
        send({
          type: "error",
          message: failed.message,
          attempts: failed.attempts,
          untried: failed.untried,
        });
      } finally {
        clearInterval(heartbeat);
        // The chain outlives this handler by way of the closure; leaving the
        // callback attached would have a later switch enqueue onto a closed
        // controller.
        chain.onSwitch = undefined;
        if (doneSent) await doneSent;
        controller.close();
      }
    },
    cancel() {
      // The user pressed Parar or navigated away. Nothing was delivered.
      void settle("failure");
      void forget(idem);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // Same reason the CV route sends it: a proxy in between must not hold the
      // whole body and deliver it at once, which is exactly what streaming avoids.
      "x-accel-buffering": "no",
    },
  });
}
