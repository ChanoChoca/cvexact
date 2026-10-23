import { NextResponse } from "next/server";
import { z } from "zod";

import { analyzeJob, buildCV, inferSkills, sumTelemetry } from "@/lib/ai/pipeline";
import type { GenerationTelemetry } from "@/lib/ai/pipeline";
import { composeFromProfile } from "@/lib/ai/profile-sources";
import { restoreCandidateName, undecidedSkills } from "@/lib/ai/prompts/shared";
import { blockingExclusions } from "@/lib/ai/preflight";
import { cvGaps, gapCount, hasGaps, verifyCV } from "@/lib/ai/verify";
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
import { jobAnalysisSchema, inferredSkillSchema } from "@/lib/schemas/job";
import { normalizeForComparison } from "@/lib/text/normalize";

export const runtime = "nodejs";

/**
 * The CV, written as NDJSON so the wait can be narrated.
 *
 * Not because a CV can be shown while it is being written — it cannot: a
 * half-finished document is worthless, and a spinner is the honest UI for one.
 * What was wrong with the spinner was never its length. It was that thirty
 * seconds of analysis, a
 * silent fallback to a second provider and a silent second attempt at the
 * document all looked identical from outside — so a slow generation was
 * indistinguishable from a hung one, and the reasonable thing to do about a
 * hung one is reload and pay for it again.
 *
 * So the *stages* stream and the document does not. `buildCV` keeps running
 * through `generateObject`, which is what gives it the `repairText` hook that
 * `unwrapEnvelope`, `clipToLimits` and the truncation repair all hang off;
 * `streamObject` has no such hook, and trading those away for a progress bar
 * would buy a nicer wait and a worse CV.
 *
 * Streaming the headers is also what keeps a slow generation alive: HAProxy's
 * `timeout server` counts *inactivity* and defaults to 50s, so a route that
 * sits silent through a whole 90s CV call is cut mid-flight — headers out are
 * not enough, frames have to keep arriving. See the `keepalive` interval below.
 *
 * The error contract is the one every streaming route here has: anything that
 * fails *before* the stream opens is an ordinary HTTP error, and anything after
 * it is an `error` frame under a 200 that the client has to look for.
 */

const bodySchema = z.object({
  profile: profileSchema,
  jobText: z.string().min(30, "Pegá el texto de la oferta completo."),
  /** Reused when present so a regeneration does not pay for the analysis twice. */
  analysis: jobAnalysisSchema.optional(),
  inferredSkills: z.array(inferredSkillSchema).optional(),
  /** Skills the user vetoed in the review step. */
  rejectedSkills: z.array(z.string()).default([]),
  /** Overrides the language detected from the posting. */
  outputLanguage: z.string().max(10).optional(),
  /**
   * How the previous attempt measured once rendered, sent on a regeneration so
   * the retry is told what the estimate got wrong. See `PreviousFit`.
   */
  previousFit: z.literal("over").optional().catch(undefined),
  /** Two when the person allowed a second sheet (`Application.sheets`); anything else is one. */
  sheets: z.literal(2).optional().catch(undefined),
  /**
   * Set by "Generar igual" after the user has been shown the excluding
   * requirements their profile does not answer. See the pre-flight below.
   */
  acknowledgeExclusions: z.boolean().default(false),
  /**
   * Set once the person has been asked about the skills the posting wants that were deduced rather than written — and
   * on every regeneration of an application that already went through it. See the review below.
   */
  skillsReviewed: z.boolean().default(false),
});

/**
 * What the generation is doing right now.
 *
 * `checking` is the one worth naming separately. `cvGaps` can send the document
 * back to be written a second time, which doubles the longest part of the wait
 * — and until this frame existed it did so in complete silence, so the request
 * that most looked like it had hung was the one working hardest.
 */
type Stage = "analyzing" | "writing" | "checking";

type Frame =
  | { type: "stage"; stage: Stage }
  | { type: "switch"; to: string; reason: string }
  /**
   * Not for the reader: a frame whose only job is to be a byte on the wire
   * every 15s, so no proxy in between decides the connection is dead. See the
   * interval that emits it.
   */
  | { type: "keepalive" }
  /**
   * The terminal frame, carrying exactly what the JSON body used to. Both of
   * its shapes travel as `done` — a blocked posting is a complete answer to the
   * request, not a failure, and giving it a frame type of its own would leave
   * the reader in `lib/api/stream-client.ts` waiting for a `done` that is never
   * coming.
   */
  | { type: "done"; value: unknown }
  /**
   * `attempts`/`untried` are the BYOK-only structured twin of `message` — see
   * `failureMessage` in `@/lib/api/context`. Absent for metered tiers and for
   * a lone-candidate chain, exactly as they are on the non-streaming routes.
   */
  | { type: "error"; message: string; attempts?: CandidateAttempt[]; untried?: number };

export async function POST(request: Request) {
  // Read once, as text: its hash is what tells a retry of this very request
  // from a different one (see `lib/generation/result-cache.ts`).
  const idem = await readIdempotentRequest(request, "cv");

  // A request the server already answered, sent again under the same key —
  // the stream cut after the credit was spent, say. The same answer, with no
  // grant reserved and no model asked.
  const replay = await replayOf(idem);
  if (replay !== null) return replayStream(replay);

  const opened = await openRequest(request, "cv");
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

  const { profile, jobText, rejectedSkills, outputLanguage, previousFit } = parsed.data;

  if (!profile.fullName.trim()) {
    await grant.release("failure");
    return NextResponse.json(
      { error: "Completá al menos tu nombre en el perfil antes de generar." },
      { status: 400 },
    );
  }

  // Another request is generating under this same key right now — a double
  // click, a retry racing the original. It gets a 409 and waits for that one's
  // result instead of paying for a second CV.
  if (!(await claim(idem))) {
    await grant.release("failure");
    return busyResponse();
  }

  /**
   * The reservation is released exactly once.
   *
   * Both the body below and `cancel` can reach it: a user who presses Cancel
   * aborts the request while a generation is still running, which makes the
   * pending await throw and sends the body down its failure path too. Without
   * this the same CV would be refunded and then charged, in that order.
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
          // The reader is gone — the user pressed Cancel or closed the tab.
          // Nothing left to tell them, and the work is already unwinding.
        }
      };

      /**
       * The final frame is kept first — encrypted, under the request's
       * idempotency key — and sent once that is done (the `finally` below
       * waits for it before closing). By then `settle("success")` has spent the
       * credit; this is what lets a browser that never receives the frame, or
       * cannot store it, ask for the same answer instead of paying again.
       */
      let doneSent: Promise<void> | null = null;
      const send = (frame: Frame) => {
        if (frame.type !== "done") {
          enqueue(frame);
          return;
        }
        doneSent = remember(idem, frame.value, { jobText }).then(() => enqueue(frame));
      };

      // Narrated as it happens rather than only collected into `meta`: a
      // fallback the user can see is a delay with a reason, and the same
      // fallback unseen is a hang.
      chain.onSwitch = (event) => send({ type: "switch", to: event.to, reason: event.message });

      /**
       * A frame every 15s, for the wire rather than for the reader.
       *
       * This route's longest silence is one whole CV call — 90s,
       * `LARGE_ATTEMPT_TIMEOUT_MS` — and HAProxy's `timeout server` is an
       * *inactivity* timeout of 50s by default, not a time-to-first-byte one:
       * response headers being out does not exempt the body. Measured from
       * production twice already (the interview route saw the 504 at 50.05s
       * before it streamed, and the CV route lost the stream mid-generation
       * while the pod kept working and logged no failure at all).
       *
       * The client ignores this frame, and that is the point: nothing about it
       * is worth rendering. It keeps going while the finished result is being
       * kept under the idempotency key (`send` above), which is bounded but
       * not instant.
       */
      const heartbeat = setInterval(() => send({ type: "keepalive" }), 15_000);

      try {
        send({ type: "stage", stage: "analyzing" });

        // Both steps depend only on their own input, so they run concurrently.
        // Either may already be cached client-side from an earlier generation.
        //
        // Only one of them is load-bearing. `analyzeJob` decides what the CV is
        // written against, so its failure is the whole request's; inferred skills
        // are enrichment the user can veto item by item, and a CV without them is
        // merely a slightly weaker CV. Letting `Promise.all` reject on the second
        // one threw away a successful analysis and 25 seconds of the user's wait
        // over a model that wrote one over-long `derivedFrom`.
        // Stay empty when the client supplied a cached `analysis`/`inferredSkills`
        // instead of calling the model — nothing to add to the credit's cost then.
        const analysisTelemetry: GenerationTelemetry = {};
        const inferTelemetry: GenerationTelemetry = {};
        const [analysis, allInferred] = await Promise.all([
          parsed.data.analysis ?? analyzeJob(chain, jobText, profile, analysisTelemetry),
          parsed.data.inferredSkills ??
            inferSkills(chain, profile, inferTelemetry).catch((error: unknown) => {
              console.warn(
                "[cv] inferSkills failed; continuing without inferred skills:",
                error instanceof Error ? error.message : String(error),
              );
              return [];
            }),
        ]);

        const vetoed = new Set(rejectedSkills.map(normalizeForComparison));
        const inferredSkills = allInferred.filter((s) => !vetoed.has(normalizeForComparison(s.skill)));

        /**
         * Stop before writing a CV for a posting the applicant cannot pass.
         *
         * The waiting job this was built for says "Experiencia previa en el puesto
         * (excluyente)" against a profile with no hospitality history: the CV was
         * written anyway, the coverage panel said 6 of 8, and the one thing the ad
         * refused to negotiate was the thing that was missing.
         *
         * Deliberately not a separate route. Analysis and CV are one call so a
         * generation costs one credit, and splitting them to ask this question would
         * turn the free tier's 6 CVs a day into 3 applications a day. Instead the
         * analysis — which is real work, and is returned — is released as a success,
         * and "Generar igual" resends it through the cached-analysis path that
         * `bodySchema` already supports. The normal posting still costs one credit;
         * only a blocked one costs two, and that one is paid with information first.
         */
        if (!parsed.data.acknowledgeExclusions) {
          const blocked = blockingExclusions(profile, analysis);
          if (blocked.length > 0) {
            // The analysis (and, when it ran, the skill inference) still spent
            // real tokens even though the CV itself never got written.
            await settle("success", sumTelemetry(analysisTelemetry, inferTelemetry));
            send({
              type: "done",
              // The model never saw the real name — see `restoreCandidateName`.
              value: restoreCandidateName(
                {
                  blocked,
                  analysis,
                  inferredSkills: allInferred,
                  meta: {
                    tier,
                    model: chain.used.describe,
                    provider: chain.used.provider,
                    modelId: chain.used.modelId,
                  },
                },
                profile.fullName,
              ),
            });
            return;
          }
        }

        /**
         * Stop before the first CV for the skills it would lean on that nobody confirmed.
         *
         * A skill deduced from the profile ("Git", from a GitHub Actions line) is a guess about the person, and a printed
         * CV is something they sign. The prompt used to call these «reviewed by the candidate» when no one had seen them,
         * and the one that got through, "Control de versiones con Git", was on a CV whose profile never says it. So the
         * ones this posting asks for are put to the person first — «Sí» makes it a skill of their profile, «No» vetoes
         * it — and what is left undecided is shown to the model only to choose and order by, never to write.
         *
         * The same move as the exclusions above, for the same reason: the analysis and the inferred skills are real
         * work and are returned, so the answer comes back through the cached-analysis path with `skillsReviewed` set and
         * no model call is repeated.
         */
        if (!parsed.data.skillsReviewed) {
          const skillReview = undecidedSkills(inferredSkills, analysis, profile);
          if (skillReview.length > 0) {
            await settle("success", sumTelemetry(analysisTelemetry, inferTelemetry));
            send({
              type: "done",
              value: restoreCandidateName(
                {
                  skillReview,
                  analysis,
                  inferredSkills: allInferred,
                  meta: {
                    tier,
                    model: chain.used.describe,
                    provider: chain.used.provider,
                    modelId: chain.used.modelId,
                  },
                },
                profile.fullName,
              ),
            });
            return;
          }
        }

        const first: GenerationTelemetry = {};
        const input = {
          profile,
          analysis,
          inferredSkills,
          outputLanguage: outputLanguage || analysis.language,
          jobText,
          previousFit,
          sheets: parsed.data.sheets,
        };

        /**
         * The fields that are copied from the profile rather than written.
         *
         * Contact details are not a generation problem: every way the model can touch
         * them is a way to lose them. The practical rows are not either, and are
         * worse when lost — measured over the applications in this repo's export, 4
         * of 5 CVs from one model answered "Disponibilidad" with the posting's hours
         * instead of the candidate's, which is a commitment they never made. See
         * `withProfilePractical`.
         *
         * `withoutOffFieldCredentials` joins them for the same reason: outside the
         * candidate's field, a pairs row naming a stray technical credential (an AWS
         * certification the posting never asked about, on a camera-installer CV) is
         * safe to delete outright rather than merely warn about, so it is fixed here
         * rather than left to `verifyJargon`'s warning or `cvGaps`'s retry.
         *
         * `withProfileHistory`, `withProfileProjects` and `withinProfileBullets` are the
         * same move for what the model may only point at or fit inside: a job or a study
         * is the profile's own employer, title, place and dates, found again by its name;
         * a project is its own name, description and link, found by its label; and a job
         * keeps no more bullets than the profile gave it — see each, and
         * `composeFromProfile` for the order.
         *
         * Applied before `cvGaps` and before `verifyCV`, so neither spends a retry or
         * an error on something already fixed here.
         */
        const fromProfile = (generated: Awaited<ReturnType<typeof buildCV>>) => composeFromProfile(generated, profile, analysis);

        send({ type: "stage", stage: "writing" });
        let { cv, findings: composed } = fromProfile(await buildCV(chain, input, first));
        // Whose telemetry describes the CV that ships. A truncation on the attempt
        // that gets thrown away is not something to warn the user about, and one on
        // the attempt that ships is.
        let telemetry = first;

        /**
         * One retry, for the failures a retry can actually fix.
         *
         * The test each one passes is that there is a right answer to hand. Some
         * are the model dropping something it was handed rather than adding
         * something it was not — a figure the candidate typed, or the education
         * section — and told which one, a second attempt lands it. The rest are
         * the model skipping a step it was given the material for: shipping the
         * profile's bullets unrewritten, writing the skills section as a word
         * list, opening the summary on what the candidate wants. A fabricated
         * technology has no right answer, so retrying it produces a different
         * fabrication and it stays a finding.
         *
         * Measured over 69 real applications: 85% of the figures in the profile
         * never reached the CV, and education went missing on 45% of `adjacent`
         * postings against none of the `direct` ones. The tailoring checks were
         * reported to the user from the day they were written and cost the model
         * nothing until now, which is how a run came back with 7 of 7 bullets
         * copied. It costs a second call and no extra quota — the grant is
         * released after, exactly as the schema repairs inside `generate()` are
         * free.
         */
        send({ type: "stage", stage: "checking" });
        const gaps = cvGaps(cv, profile, analysis);
        // Kept outside the block below so the cost of a retry that did NOT ship
        // is still counted further down — the call happened either way.
        let retryTelemetry: GenerationTelemetry | undefined;
        if (hasGaps(gaps)) {
          const retry: GenerationTelemetry = {};
          retryTelemetry = retry;
          const second = fromProfile(await buildCV(chain, { ...input, gaps }, retry));
          // Keep whichever lost less. A retry that fixes the figures by dropping
          // education has not helped, and one that comes back worse on both should
          // not replace a CV that was merely imperfect.
          const remaining = cvGaps(second.cv, profile, analysis);
          if (gapCount(remaining) < gapCount(gaps)) {
            ({ cv, findings: composed } = second);
            telemetry = retry;
          }
        }

        /*
         * What actually gets billed to `generation_usage` is every call this
         * credit paid for — analysis, skill inference, the first CV attempt and,
         * when it ran, the retry, whichever one shipped — not only the attempt
         * that shipped. `telemetry` above stays the shipped attempt's own flags
         * (`repaired`, used for the finding below); this is the sum used only
         * for cost accounting. Recording just the attempt that shipped used to
         * understate a CV's real cost by close to half.
         */
        await settle("success", sumTelemetry(analysisTelemetry, inferTelemetry, first, retryTelemetry));

        // What `composeFromProfile` took out comes first: it explains a CV with fewer jobs than the model wrote.
        const findings = [...composed, ...verifyCV(cv, profile, analysis)];

        // A truncation repair asks the model for a shorter answer, so what comes
        // back may be missing material rather than merely tighter. The completeness
        // checks above catch the structural cases; this says why it happened, for
        // the ones they cannot see.
        if (telemetry.repaired === "truncation") {
          findings.push({
            severity: "warning",
            field: "sections",
            detail:
              "La respuesta del modelo se cortó y hubo que acortarla, así que puede " +
              "faltar contenido. Revisá el CV y volvé a generar si lo ves incompleto.",
          });
        }

        send({
          type: "done",
          // The model never saw the real name — see `restoreCandidateName`. The
          // header already carries it via `headerFromProfile`, applied above;
          // this catches the rest of the document in case the model referred
          // to the candidate by name anywhere in the body.
          value: restoreCandidateName(
            {
              cv,
              analysis,
              inferredSkills: allInferred,
              // Structural anti-fabrication check; surfaced to the user, not fatal.
              findings,
              meta: {
                tier,
                // The candidate that actually wrote this CV, which is not necessarily
                // the one the request started with — see `ModelChain`.
                model: chain.used.describe,
                // Stored with the application so the eval harness can group a corpus by
                // the model that produced it.
                provider: chain.used.provider,
                modelId: chain.used.modelId,
                repaired: telemetry.repaired,
                /**
                 * Empty on the ordinary path. When it is not, a provider refused
                 * partway through and another one finished the job: worth saying,
                 * because a rejected key or a retired model will keep costing a failed
                 * call on every request until someone fixes it in Ajustes.
                 */
                switches: chain.switches.length > 0 ? chain.switches : undefined,
              },
            },
            profile.fullName,
          ),
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
        // First, so nothing is written after the last frame.
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
      // The user pressed Cancel or navigated away. Nothing was delivered.
      void settle("failure");
      void forget(idem);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // Caddy sits in front of this; without it the proxy can hold the whole
      // body and deliver it at once, which is exactly what streaming avoids.
      "x-accel-buffering": "no",
    },
  });
}
