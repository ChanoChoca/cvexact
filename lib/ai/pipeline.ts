import "server-only";

import {
  APICallError,
  generateObject,
  JSONParseError,
  NoObjectGeneratedError,
  TypeValidationError,
} from "ai";
import type { LanguageModel, Schema } from "ai";
import { z } from "zod";

import { redactKeys } from "./provider";
import { dailyQuota } from "./quota";
import type { ModelChain, ModelChoice } from "./provider";
import type { GenerationErrorKind } from "./error-kind";
import { markCooldown, onCooldown } from "./cooldown";
import { degradedKeys, latencyOf, recordOutcome } from "./health";
import { relaxedSchema } from "./cohere-schema";
import { PROVIDER_LABEL, type ProviderId } from "./provider-catalog";
import { jobAnalysisSchema, inferredSkillsSchema } from "@/lib/schemas/job";
import { cvDocumentSchema } from "@/lib/schemas/cv";
import {
  answersSchema,
  coverEmailDraftSchema,
  interviewPrepGenerationSchema,
  videoScriptSchema,
  type CoverEmail,
} from "@/lib/schemas/outputs";
import type { InferredSkill } from "@/lib/schemas/job";
import type { Profile } from "@/lib/schemas/profile";

import { ANALYZE_JOB_SYSTEM, buildAnalyzeJobPrompt } from "./prompts/analyze-job";
import { INFER_SKILLS_SYSTEM, buildInferSkillsPrompt } from "./prompts/infer-skills";
import { BUILD_CV_SYSTEM, CV_REPAIR_FLOOR, buildCVPrompt } from "./prompts/build-cv";
import { ANSWER_QUESTIONS_SYSTEM, buildAnswersPrompt } from "./prompts/answer-questions";
import {
  WRITE_EMAIL_SYSTEM,
  buildEmailPrompt,
  resolveEmailSubject,
  stripSubjectFromBody,
} from "./prompts/write-email";
import {
  INTERVIEW_PREP_SYSTEM,
  INTERVIEW_REPAIR_FLOOR,
  buildInterviewPrepPrompt,
} from "./prompts/interview-prep";
import {
  VIDEO_REPAIR_FLOOR,
  VIDEO_SCRIPT_SYSTEM,
  buildVideoScriptPrompt,
} from "./prompts/video-script";
import { EXTRACT_SYSTEM, extractionSchema, buildExtractPrompt } from "./prompts/extract";
import { SPLIT_SYSTEM, splitSchema, buildSplitPrompt } from "./prompts/split";
import {
  IMPROVE_MANY_SYSTEM,
  IMPROVE_SYSTEM,
  buildImproveManyPrompt,
  buildImprovePrompt,
  improveManySchema,
  improveSchema,
  keepProposed,
  type ImproveItem,
  type ImproveKind,
} from "./prompts/improve";

export class GenerationError extends Error {
  constructor(
    message: string,
    /**
     * The situation this failure is, from the closed set in `./error-kind.ts`.
     * Required rather than defaulted: every construction site has to state
     * which one it is, so a new branch cannot be added without deciding — and
     * `unclassified` is then a decision, not an omission. `status` remains the
     * key every policy is written against (`./cooldown.ts`, `./health.ts`,
     * `@/lib/storage/local`); `kind` is what the UI names, without inferring
     * meaning from an HTTP code two different failures can share.
     */
    readonly kind: GenerationErrorKind,
    readonly status: number = 502,
    /**
     * Whether another provider or model could plausibly succeed where this one
     * failed, which is what lets `generate` below move down the chain instead
     * of giving up. True for the failures that belong to the account or the
     * configuration — an exhausted rate limit, an empty balance, a per-minute
     * budget smaller than the request, a rejected key, a retired model — every
     * one of which already answered the user with some version of "pick a
     * different model in Ajustes".
     *
     * False by default, and false in particular for a response that broke the
     * schema: that one has already spent `unwrapEnvelope`, `clipToLimits` and
     * a full repair round-trip, and re-spending all three against every
     * remaining candidate would turn one bad response into four.
     */
    readonly switchable: boolean = false,
  ) {
    super(redactKeys(message));
  }
}

/**
 * `createOpenAICompatible` clients (Groq, OpenRouter) default to
 * `supportsStructuredOutputs: false`. In that mode `generateObject` falls back
 * to plain `response_format: { type: "json_object" }` and forwards *no*
 * schema at all — the API rejects the call outright unless the literal word
 * "json" appears somewhere in the messages, and the model gets no shape
 * information beyond prose. This reminder satisfies the former; `schemaHint`
 * below addresses the latter. Appending both is a no-op for providers that
 * don't have the requirement.
 */
const JSON_MODE_REMINDER =
  "Respond with a single valid JSON object only — no markdown, no commentary, no explanation.";

/**
 * With no native schema forwarded, the model has to guess field names,
 * nesting and enum spellings from prose alone. Zod v4's `toJSONSchema` lets
 * us put the real wire format in the prompt itself, which every provider
 * sees regardless of what it does with the structured `schema` argument.
 */
function schemaHint(schema: z.ZodType, schemaName: string): string {
  return (
    `Respond with a single JSON object that conforms exactly to the following JSON Schema ` +
    `for "${schemaName}" — return its fields directly at the top level; do NOT wrap the ` +
    `object in an outer "${schemaName}" key or any other envelope. Field names, nesting, ` +
    `enum values and required fields are all significant; do not rename, flatten, or ` +
    `restructure them:\n${JSON.stringify(z.toJSONSchema(schema, { io: "input" }))}`
  );
}

/**
 * Without an explicit cap, providers that don't set their own sane default
 * (e.g. OpenRouter, which falls back to the target model's raw maximum —
 * 65535 for gemini-2.5-flash) will request far more than any of these
 * schemas realistically need. 8192 covers every schema here except the CV's.
 */
const MAX_OUTPUT_TOKENS = 8192;

/**
 * The CV needs its own, larger ceiling.
 *
 * A `CVDocument` is by far the biggest thing generated here: across the 53 CVs
 * in the saved corpus it averages ~8k characters and reaches 12.3k, which is
 * roughly 4.5k output tokens. That would fit under 8192 on its own — but on a
 * thinking model the reasoning tokens are billed against the *same* ceiling, so
 * a run that thinks for 4-5k tokens has the JSON cut off mid-string. That is
 * exactly how a generation ends up in `repairSchemaViolation` below.
 *
 * Raising this is close to free: `maxOutputTokens` is a ceiling, not a
 * reservation, so a response that doesn't need the room is never charged for
 * it. The low-balance BYOK concern the 8192 default exists for is about what
 * gets *spent*, and nothing here spends more than it writes.
 */
export const CV_MAX_OUTPUT_TOKENS = 16384;

/**
 * The video script needs the same headroom, for the same reason.
 *
 * A ten-minute script is ~1400 words of speech, and the blocks, key points and
 * tips around them push the response past 3.5k output tokens — comfortably
 * under 8192 on its own, and comfortably *over* it once a thinking model's
 * reasoning is billed against the same ceiling. Not scaled by the requested
 * duration on purpose: by the argument above a ceiling costs nothing unused, so
 * a thirty-second script is not charged for the room a ten-minute one needs,
 * and branching would buy only a condition to get wrong.
 */
export const VIDEO_MAX_OUTPUT_TOKENS = 16384;

/**
 * The interview prep sheet needs the same headroom, for the same reason.
 *
 * Up to 8 sections of up to 12 questions each, with a 3-6 sentence answer,
 * keyPoints and followUps apiece, comfortably passes 8192 output tokens once a
 * thinking model's reasoning is billed against that same ceiling — which is
 * exactly how a run ends up in `repairSchemaViolation` and, without a floor
 * protecting category coverage, can collapse to whichever section is cheapest
 * to write.
 */
export const INTERVIEW_MAX_OUTPUT_TOKENS = 16384;

/** How much of a rejected response to keep when logging or echoing it back. */
const MAX_ECHOED_TEXT = 20_000;
const MAX_LOGGED_CAUSE = 2_000;

/**
 * How long one candidate may take before the chain gives up on it.
 *
 * The failure this exists for is the one a cooldown can never catch. Every
 * status `asGenerationError` classifies is a provider *refusing* work, and a
 * refusal is fast; a free endpoint that accepts the call and then takes two
 * minutes never refuses anything, so before this there was nothing to fall back
 * *from* — `generateObject` was called with no `abortSignal`, the route declared
 * no `maxDuration`, and the proxy in front of it allows a day. The request
 * simply waited, and a user with several keys configured was more likely to
 * land on one of these first, not less.
 *
 * Generous rather than tight: the point is to catch a provider that has stopped
 * being useful, not to race a slow one that is going to answer.
 */
const ATTEMPT_TIMEOUT_MS = 25_000;

/** For the three generations that legitimately take much longer. */
const LARGE_ATTEMPT_TIMEOUT_MS = 90_000;

/**
 * Below this much of the request budget left, the next candidate is not asked
 * at all. Starting a call that the deadline will cut off partway spends the
 * user's tokens on an answer nobody will ever see.
 */
const MIN_ATTEMPT_MS = 8_000;

/**
 * What the last candidate standing gets instead of `ATTEMPT_TIMEOUT_MS`.
 *
 * Waiting longer is only a bargain when there is nobody left to fall back to.
 * With a standby behind it, holding a slow candidate for forty seconds delays
 * an answer that was already available — that is the case
 * `ATTEMPT_TIMEOUT_MS` exists for. As the last candidate the same wait is the
 * difference between a response and a failed request, and nothing is delayed
 * by granting it: there is no fallback left to slow down. The user with one
 * slow key and no alternatives wants the answer; the user with five fast keys
 * wants the quick fallback; the position in the chain is what tells the two
 * apart, which is why this is not a second, larger `ATTEMPT_TIMEOUT_MS`.
 *
 * Sized from evidence where there is any: `latencyOf` in `./health.ts`
 * reports what this exact key has actually been taking to answer
 * successfully, and a candidate that has been finishing at ~50s earns a leash
 * long enough to finish again. One whose history is timeouts — or that has
 * never finished — gets the floor rather than a guess, so a genuinely dead
 * last candidate still costs seconds, not minutes. Capped at
 * `LARGE_ATTEMPT_TIMEOUT_MS`, the budget the long documents already run at,
 * so no attempt can outgrow what the request deadline in `./provider.ts` was
 * sized to hold.
 */
const LAST_RESORT_TIMEOUT_MS = 40_000;

/**
 * How much of a margin over the observed round-trip the last candidate gets.
 * Latency varies between calls — a candidate that averages 30s regularly
 * needs 45 — so the extension is the observation and a half, clamped into
 * [`LAST_RESORT_TIMEOUT_MS`, `LARGE_ATTEMPT_TIMEOUT_MS`] by
 * `lastResortBudgetMs` below.
 */
const LAST_RESORT_LATENCY_MARGIN = 1.5;

/**
 * How many candidates one generation may try before giving up.
 *
 * A chain is meant to be a safety net, and someone who has pasted six keys into
 * Ajustes has not asked to wait for six providers. Three is enough for the
 * failure this exists for — the primary is out of credit, the standby answers —
 * and bounds what a long chain can cost.
 *
 * Per *generation*, not per request: `chain.failed` carries across the
 * generations in one request, so a CV whose analysis burnt three candidates
 * writes its document against the next three rather than re-testing the same
 * ones. The overall bound is `deadlineAt`, not this.
 */
const MAX_CANDIDATES_PER_GENERATION = 3;

/**
 * A short string repeated at least 20 times in a row — the shape a model's
 * repetition loop leaves behind ("Nombre Nombre Nombre…", "0000000…").
 * Checked against the rejected response before deciding whether to echo it
 * back into a repair prompt.
 */
const DEGENERATE_REPETITION = /(.{1,20}?)\1{19,}/;

/**
 * Reasoning effort for generations whose model supports it.
 *
 * These are extraction and writing tasks against a long, highly prescriptive
 * prompt; they benefit from some planning but not from an open-ended budget.
 * Left unset, a thinking model decides for itself how much of the output
 * ceiling to spend before writing any JSON, which is unbounded from here and
 * competes directly with the answer.
 *
 * This is the AI SDK's portable setting: `@ai-sdk/google` maps it to
 * `thinkingLevel` on Gemini 3.x and to a `thinkingBudget` on 2.5. But
 * `@ai-sdk/openai-compatible` (Groq, OpenRouter) forwards it verbatim as
 * `reasoning_effort`, which those providers reject outright on a model that
 * doesn't support it — so it is only sent when the caller's `ModelChoice`
 * says the model is reasoning-capable (see `supportsReasoningEffort` in
 * `./provider-catalog.ts`).
 */
const REASONING = "low" as const;

/**
 * What actually happened on a generation, filled in by `generate`.
 *
 * A repair that succeeds is otherwise invisible: the caller gets a valid object
 * back and cannot tell it apart from a clean first response. That distinction
 * matters, because the truncation repair asks the model for a *shorter* answer
 * and a CV that came back through it may be missing whole sections. Recording
 * it lets the route surface the fact instead of shipping a mutilated CV that
 * looks, structurally, exactly like a deliberately concise one.
 */
export type GenerationTelemetry = {
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  /** Which repair path ran, if any. `truncation` is the destructive one. */
  repaired?: "envelope" | "clipped" | "truncation" | "schema";
};

/**
 * Adds up the token counts of every model call one credit actually paid for.
 *
 * `/api/generate/cv` is the one route that can make two to four of these calls
 * — `analyzeJob`, `inferSkills`, a `buildCV` attempt and, on a retry, a second
 * one — behind a single credit and a single `recordUsage` row. Recording only
 * the attempt that shipped understated a CV's real cost by close to half: the
 * discarded attempts and the analysis step still spent real tokens against the
 * same key. This does not touch `repaired` or `finishReason` — those describe
 * one specific attempt, not a sum, and the caller keeps whichever attempt's
 * flags it already tracks for its own findings.
 */
export function sumTelemetry(...parts: (GenerationTelemetry | undefined)[]): GenerationTelemetry {
  const sum: GenerationTelemetry = {};
  for (const part of parts) {
    if (!part) continue;
    if (part.inputTokens) sum.inputTokens = (sum.inputTokens ?? 0) + part.inputTokens;
    if (part.outputTokens) sum.outputTokens = (sum.outputTokens ?? 0) + part.outputTokens;
    if (part.reasoningTokens) sum.reasoningTokens = (sum.reasoningTokens ?? 0) + part.reasoningTokens;
  }
  return sum;
}

/**
 * Which candidates are worth asking, in order.
 *
 * `chain.failed` is this request's own experience — a call was spent proving
 * that candidate cannot serve it — so it is a verdict, and removes the
 * candidate outright. Everything else only *demotes*, because it is second-hand
 * news from an earlier request and the alternative is failing over a memory:
 *
 *   1. Healthy, or unknown. Unknown counts as healthy on purpose — a candidate
 *      the user put first has to be given the chance to earn its place, and one
 *      bad call is not evidence. See `MIN_SAMPLES` in `./health.ts`.
 *   2. Degraded: failing often, or markedly slower than its own standbys. This
 *      is the tier that catches the slow-but-alive provider, which is otherwise
 *      invisible — it never refuses anything, so nothing else here demotes it.
 *   3. Cooling down, from `./cooldown.ts`.
 *
 * Stable within each tier, which is what keeps the user's order meaningful.
 * They put their best model first, and that is a judgement about *quality*;
 * sorting the whole chain by latency would quietly overrule it with whichever
 * cheap model answers fastest. Only demonstrably bad behaviour moves anything.
 */
function candidateOrder(chain: ModelChain): ModelChoice[] {
  const live = chain.candidates.filter((c) => !chain.failed.has(c.cooldownKey));
  const warm = live.filter((c) => !onCooldown(c.cooldownKey));
  const cooling = live.filter((c) => onCooldown(c.cooldownKey));

  const degraded = degradedKeys(warm.map((c) => c.cooldownKey));

  return [
    ...warm.filter((c) => !degraded.has(c.cooldownKey)),
    ...warm.filter((c) => degraded.has(c.cooldownKey)),
    ...cooling,
  ].slice(0, MAX_CANDIDATES_PER_GENERATION);
}

/**
 * The attempt budget the last candidate standing gets, from what its key has
 * actually been taking to answer. See `LAST_RESORT_TIMEOUT_MS` above for the
 * reasoning; this is the arithmetic alone.
 *
 * Exported because it is a pure function of one number and its clamps are the
 * whole feature — `tests/pipeline-fallback.test.ts` asserts them directly
 * rather than waiting out forty real seconds to observe them through
 * `generate`.
 */
export function lastResortBudgetMs(observedMs: number | undefined): number {
  if (observedMs === undefined) return LAST_RESORT_TIMEOUT_MS;
  return Math.min(
    Math.max(Math.round(observedMs * LAST_RESORT_LATENCY_MARGIN), LAST_RESORT_TIMEOUT_MS),
    LARGE_ATTEMPT_TIMEOUT_MS,
  );
}

/**
 * One call site for every generator.
 *
 * Repairs once on a schema violation. `@ai-sdk/google` drops array/string
 * length limits (maxItems/maxLength) when it builds Gemini's responseSchema —
 * see `convertJSONSchemaToOpenAPISchema` in the provider package — so Gemini
 * is never told the real ceilings a Zod schema like `jobAnalysisSchema` or
 * `cvDocumentSchema` encodes, even though the SDK still enforces them
 * client-side. A model response that overshoots one of those hidden limits
 * fails validation for a reason it was never shown. Re-sending the same
 * prompt at a lower temperature does not fix that; feeding back the exact
 * validation error (which names the offending path and limit) and asking the
 * model to trim to fit does.
 */
export async function generate<T>(opts: {
  /**
   * The models this generation may use, in order. `generate` runs the first
   * one that is neither already discarded in this request nor cooling down
   * from an earlier one, and moves on when a failure says another provider
   * could do better — see `GenerationError.switchable`.
   */
  chain: ModelChain;
  schema: z.ZodType<T>;
  schemaName: string;
  system: string;
  prompt: string;
  /**
   * What the model must keep if the truncation repair has to shorten its
   * answer. Without it the cheapest way to shrink a response is to drop its
   * largest section, which for a CV is the work experience.
   */
  preserve?: string;
  /** Defaults to `MAX_OUTPUT_TOKENS`; only the CV needs more. */
  maxOutputTokens?: number;
  /**
   * Ceiling under which this generation would rather fail than be truncated.
   * Defaults to `MIN_USEFUL_CEILING`; see `LARGE_MIN_OUTPUT_TOKENS` for the
   * two that need more.
   */
  minOutputTokens?: number;
  /**
   * How long one candidate gets before the chain moves on. Defaults to
   * `ATTEMPT_TIMEOUT_MS`; the long documents pass `LARGE_ATTEMPT_TIMEOUT_MS`.
   * The last candidate standing gets more than either — see
   * `LAST_RESORT_TIMEOUT_MS`.
   */
  timeoutMs?: number;
  /**
   * A hard cap on how many times this call may actually ask a model to
   * generate something — across every candidate and every repair combined,
   * not per candidate. Unset (the default) leaves every existing caller's
   * chain as unbounded as it always was. `extractDocument`/`splitNarrative`
   * set this to 2: the first attempt plus a single retry, whichever form it
   * takes — a repair, a lower-ceiling reissue, or the next provider — and
   * never a third call for one document.
   */
  maxGenerations?: number;
  /**
   * Whether a response cut off for length may be repaired by asking the
   * model for the same object again, but shorter. Defaults to true.
   * `extractDocument`/`splitNarrative` set it false: a "shorter" answer is a
   * *different* answer, one nothing here re-checks against the source the
   * way the original reading is, so a caller this careful about invention
   * would rather fall back to the heuristic result than risk trusting one.
   */
  allowShortenRepair?: boolean;
  /** Mutable sink; `generate` fills it in before returning. */
  telemetry?: GenerationTelemetry;
}): Promise<T> {
  const system = `${opts.system}\n\n${JSON_MODE_REMINDER}\n\n${schemaHint(opts.schema, opts.schemaName)}`;
  const telemetry = opts.telemetry ?? {};
  const requestedTokens = opts.maxOutputTokens ?? MAX_OUTPUT_TOKENS;
  const floor = opts.minOutputTokens ?? MIN_USEFUL_CEILING;
  // A mutable object, not a plain counter: `repairSchemaViolation` is a
  // top-level function, not nested in here, so it needs a reference it can
  // increment itself, right before the one model call it might make — not a
  // value handed to it that a caller-side increment could get wrong relative
  // to whether a call actually happened.
  const generations = { count: 0 };
  const hasGenerationBudget = () => opts.maxGenerations === undefined || generations.count < opts.maxGenerations;

  /**
   * One candidate's whole attempt: the token-ceiling retry, the mechanical
   * repairs and the model-assisted one, all of which run to exhaustion here
   * before the chain below considers anyone else. Switching providers is the
   * last resort, not the first.
   *
   * `isLast` decides whether it is worth retrying at the transport level; see
   * `maxRetries` below.
   */
  const runOn = async (
    choice: ModelChoice,
    isLast: boolean,
    /**
     * The extended budget `generate` computed for a last candidate standing;
     * `undefined` for every other position. A floor over the caller's own
     * `timeoutMs`, never a replacement: the CV's `LARGE_ATTEMPT_TIMEOUT_MS`
     * already exceeds anything this would add, and the extension exists to
     * rescue a default-budget generation from a slow-but-alive last resort,
     * not to trim a deliberately longer one.
     */
    lastResortMs?: number,
  ): Promise<T> => {
  const budget = choice.budget;

  /**
   * What this attempt gets, clamped to what the whole request has left.
   *
   * Recomputed per attempt rather than fixed once: the token-ceiling retry and
   * the schema repair are further calls, and a request that has already spent
   * two minutes must not hand each of them a fresh full budget.
   *
   * `minAttemptTimeoutMs` raises the floor for a candidate whose provider is
   * known to run longer than `ATTEMPT_TIMEOUT_MS` on an ordinary, successful
   * call (see `minAttemptTimeoutFor` in `./provider-catalog.ts`) — without it,
   * such a provider is indistinguishable from one that has actually stopped
   * responding, and the chain would abandon a candidate that was always going
   * to answer. `lastResortMs` raises the same floor for the candidate nothing
   * follows, where waiting longer delays no fallback because there is none.
   */
  const attemptBudgetMs = (minAttemptTimeoutMs?: number) =>
    Math.min(
      Math.max(
        Math.max(lastResortMs ?? 0, opts.timeoutMs ?? ATTEMPT_TIMEOUT_MS),
        minAttemptTimeoutMs ?? 0,
      ),
      opts.chain.deadlineAt - Date.now(),
    );

  /**
   * Our own deadline for one call, combined with the request's own signal.
   *
   * Kept together so the two cannot drift, and built fresh per call because
   * `AbortSignal.timeout` starts counting the moment it is created.
   */
  const attemptSignal = (minAttemptTimeoutMs?: number) => {
    const deadline = AbortSignal.timeout(Math.max(attemptBudgetMs(minAttemptTimeoutMs), 1));
    return opts.chain.signal
      ? AbortSignal.any([opts.chain.signal, deadline])
      : deadline;
  };

  // Clamped before the first attempt rather than left to the retry below.
  // Neither of the two lower ceilings needs a failed round-trip to discover
  // the way `reportedCeiling` does for an unlisted provider limit: one is a
  // known server-side cap, the other was already paid for by an earlier
  // generation in this same request.
  const initialCeiling = Math.min(
    requestedTokens,
    choice.maxOutputTokens ?? Infinity,
    budget?.ceiling ?? Infinity,
  );

  // Known, from that earlier generation, not to fit. Refused here rather than
  // after twenty seconds of writing something that will be cut off: the
  // ceiling belongs to the account, so asking again cannot raise it.
  if (budget?.ceiling !== undefined && budget.ceiling < floor) {
    console.warn(
      `[generate] ${opts.schemaName} needs at least ${floor} output tokens and this ` +
        `request has already been held to ${budget.ceiling}; refusing without asking.`,
    );
    throw budget.message
      ? asGenerationError(new Error(budget.message))
      : new GenerationError(
          `El proveedor limitó la salida de este pedido a ${budget.ceiling} tokens y este ` +
            `documento necesita al menos ${floor}. Probá con otro modelo desde Ajustes.`,
          "request_too_large",
          413,
          true,
        );
  }
  const reasoning = choice.reasoningCapable ? REASONING : undefined;
  // Only the JSON Schema sent to the provider is relaxed — `relaxedSchema`
  // still validates the response against the original, unrelaxed `opts.schema`.
  const schema = choice.looseJsonSchema ? relaxedSchema(opts.schema) : opts.schema;

  // `maxOutputTokens` is threaded through as a parameter rather than closing
  // over the outer `initialCeiling`, so a retry at a lower ceiling (see
  // `reportedCeiling` below) also lowers the ceiling the schema-repair
  // call uses — otherwise the repair would repeat the same preflight
  // rejection the retry exists to work around.
  const attempt = (maxOutputTokens: number) =>
    generateObject({
      model: choice.model,
      schema,
      schemaName: opts.schemaName,
      system,
      prompt: opts.prompt,
      temperature: 0.4,
      reasoning,
      maxOutputTokens,
      abortSignal: attemptSignal(choice.minAttemptTimeoutMs),
      /**
       * Transport-level, and distinct from the schema repair below.
       *
       * Only worth paying for on the last candidate. The SDK treats 429 and 5xx
       * as retryable and backs off exponentially between attempts, so a
       * rate-limited provider costs three calls and some six seconds of waiting
       * to establish something the chain already knows how to handle — while a
       * standby that could have answered immediately sits unasked. With
       * somewhere to go, going is strictly faster than waiting; with nowhere to
       * go, the retry is the only thing left that might work.
       */
      maxRetries: isLast ? 2 : 0,
      repairText: ({ text, error }) => {
        // Nothing left to spend: skip even trying, rather than let the SDK's
        // own call into this callback be the thing that quietly exceeds the
        // cap `generate`'s own candidate loop and ceiling-retry already
        // respect.
        if (!hasGenerationBudget()) return Promise.resolve(null);
        return repairSchemaViolation(
          {
            model: choice.model,
            schema,
            // The unrelaxed original, kept alongside the (possibly relaxed)
            // wire schema above: `clipToLimits` has to re-validate what it
            // patched, and `relaxedSchema` returns an `ai` `Schema`, which has
            // no `safeParse`.
            zodSchema: opts.schema,
            schemaName: opts.schemaName,
            system,
            prompt: opts.prompt,
            preserve: opts.preserve,
            maxOutputTokens,
            telemetry,
            reasoning,
            // A repair is another round-trip, and the request's clock does not
            // stop for it. Without this a generation that fails slowly and then
            // repairs slowly outlives the budget that was supposed to bound it.
            abortSignal: attemptSignal(choice.minAttemptTimeoutMs),
            allowShortenRepair: opts.allowShortenRepair,
            // Incremented by `repairSchemaViolation` itself, right before its
            // own model call — never here, where it would be counted whether
            // or not that call actually happens (its own gates, `degenerate`
            // among them, can still skip it).
            onAttempt: () => {
              generations.count++;
            },
          },
          text,
          error,
        );
      },
    });

  // The SDK's InferSchema does not reduce through the generic, so the result is
  // asserted. It is sound: generateObject validates against `schema` before
  // returning, and a violation throws NoObjectGeneratedError rather than
  // yielding an unchecked value.
  let effectiveCeiling = initialCeiling;
  // Read now, not in the catch: by the time an attempt fails, `attemptBudgetMs`
  // has counted down and would report a number nobody was ever held to.
  const grantedMs = attemptBudgetMs(choice.minAttemptTimeoutMs);
  try {
    let result;
    try {
      generations.count++;
      result = await attempt(initialCeiling);
    } catch (error) {
      const reported = reportedCeiling(error, initialCeiling);
      if (reported === null) throw error;
      // Recorded even when this generation goes on to refuse it: an absolute
      // ceiling is the account's, not this call's, and whatever generates next
      // in this request should not pay another round-trip to learn it.
      if (budget && reported.absolute) {
        budget.ceiling = reported.ceiling;
        budget.message = reported.message;
      }
      if (reported.ceiling < floor) {
        console.warn(
          `[generate] ${opts.schemaName} needs at least ${floor} output tokens but the ` +
            `provider will only allow ${reported.ceiling}; refusing rather than truncating.`,
        );
        throw error;
      }
      // Nothing left to spend on retrying at the lower ceiling either.
      if (!hasGenerationBudget()) throw error;
      console.warn(
        `[generate] ${opts.schemaName} requested ${initialCeiling} output tokens but the ` +
          `provider reported it can only handle ${reported.ceiling}; retrying at the lower ceiling.`,
      );
      effectiveCeiling = reported.ceiling;
      generations.count++;
      result = await attempt(reported.ceiling);
    }
    const { object, finishReason, usage } = result;

    telemetry.finishReason = finishReason;
    telemetry.inputTokens = usage.inputTokens;
    telemetry.outputTokens = usage.outputTokens;
    telemetry.reasoningTokens = usage.outputTokenDetails?.reasoningTokens;

    // `length` and any repair both mean the model ran out of room; neither
    // throws, so this log is the only trace they leave.
    if (finishReason === "length" || telemetry.repaired) {
      console.warn(
        `[generate] ${opts.schemaName} finishReason=${finishReason} ` +
          `repaired=${telemetry.repaired ?? "no"} ` +
          `tokens=in:${usage.inputTokens ?? "?"}/out:${usage.outputTokens ?? "?"}` +
          `/reasoning:${telemetry.reasoningTokens ?? "?"} (cap ${effectiveCeiling})`,
      );
    }

    return object as T;
  } catch (error) {
    /**
     * Checked before anything else, because an abort can arrive wearing any of
     * the shapes below — a cut-off stream surfaces as a parse failure, and a
     * `NoObjectGeneratedError` can carry one as its cause.
     *
     * The two reasons a call stops early are opposite instructions to the chain,
     * so they must not collapse into one status. Our own budget firing means
     * this candidate is too slow and the next one should be asked; the request's
     * signal firing means nobody wants the answer any more, and asking anyone
     * else would spend the user's tokens on a page they have already left.
     */
    if (isAbort(error)) {
      if (opts.chain.signal?.aborted) {
        throw new GenerationError("El pedido fue cancelado.", "cancelled", 499, false);
      }
      throw new GenerationError(
        `${choice.describe} tardó más de ${Math.round(grantedMs / 1000)} segundos ` +
          `en responder y no llegó a terminar.`,
        "timeout",
        504,
        true,
      );
    }
    if (NoObjectGeneratedError.isInstance(error)) {
      // The cause embeds the whole rejected value. A model that degenerates
      // into a repetition loop produces tens of kilobytes of it, which buries
      // the validation errors that actually say what went wrong.
      console.error(
        `[generate] ${opts.schemaName} failed schema validation ` +
          `(finishReason=${error.finishReason ?? "unknown"}): ` +
          clip(redactKeys(describeValidationFailure(error)), MAX_LOGGED_CAUSE),
      );
      /**
       * A response cut off for want of room and a complete one that breaks the
       * schema are different failures with different remedies, and until this
       * branch existed they arrived as the same sentence. Telling someone the
       * model "did not respect the expected format" when it ran out of tokens
       * sends them to Ajustes to change models over something no model change
       * fixes — which is exactly what an OpenRouter account with no credit
       * left did, at 4722 affordable tokens against a CV that needs more.
       */
      const outOfRoom =
        error.finishReason === "length" ||
        // A parse failure alone is not proof of a cut-off: a model that
        // answers with prose or an apology instead of JSON fails to parse
        // too, and it did not run out of anything. What makes it proof is
        // that there was demonstrably less room than this generation asked
        // for — a ceiling the provider forced on us, or a cap clamped before
        // the first attempt.
        (JSONParseError.isInstance(error.cause) && effectiveCeiling < requestedTokens);
      if (outOfRoom) {
        throw new GenerationError(
          `La respuesta se cortó antes de terminar: sólo había lugar para ` +
            `${effectiveCeiling} tokens de salida y este documento necesita más. ` +
            `Si usás tu propia API key, revisá el crédito de tu cuenta con el proveedor; ` +
            `si no, probá con otro modelo desde Ajustes.`,
          "request_too_large",
          413,
          // A candidate with more room, or one that does not bill reasoning
          // against the same ceiling, can still finish this document.
          true,
        );
      }
      throw new GenerationError(
        `El modelo devolvió una respuesta que no respeta el formato esperado. ` +
          `Probá de nuevo, o cambiá de modelo en Ajustes. (${describe(error)})`,
        "unclassified",
      );
    }
    throw asGenerationError(error, choice.provider);
  }
  };

  const chain = opts.chain;
  const order = candidateOrder(chain);
  if (order.length === 0) {
    throw chain.lastError ??
      new GenerationError(
        "Ningún proveedor configurado pudo atender este pedido. Revisá tus keys en Ajustes.",
        "unclassified",
        502,
      );
  }

  /**
   * What this pass is *not* asking, said out loud.
   *
   * Three different reasons produce the same silence — candidates this request
   * already refuted, candidates the cooldown is resting, and the
   * `MAX_CANDIDATES_PER_GENERATION` slice — and from outside they are
   * indistinguishable from "the request never got that far". Logged only when
   * something is left behind, so a single-key chain stays quiet.
   */
  if (order.length < chain.candidates.length) {
    console.info(
      `[generate] ${opts.schemaName}: ${order.length} de ${chain.candidates.length} candidatos ` +
        `en esta pasada — preguntando ${order.map((candidate) => candidate.describe).join(", ")}`,
    );
  }

  for (let i = 0; i < order.length; i++) {
    const choice = order[i];

    /**
     * Stop before starting something the budget cannot hold.
     *
     * The same bargain as the ceiling check in `runOn`: a call that will be cut
     * off partway is not a cheaper answer, it is the user's tokens spent on a
     * result nobody will see. Reported as the reason the *previous* candidate
     * gave when there is one, since "the provider ran out of credit" is a more
     * useful thing to be told than "we gave up waiting".
     */
    if (chain.deadlineAt - Date.now() < MIN_ATTEMPT_MS) {
      console.warn(
        `[generate] ${opts.schemaName}: out of request budget before trying ` +
          `${choice.describe}; stopping after ${i} candidate(s).`,
      );
      throw chain.lastError ??
        new GenerationError(
          "El pedido tardó demasiado y lo cortamos antes de terminar. " +
            "Probá de nuevo, o elegí otro modelo en Ajustes.",
          "timeout",
          504,
          true,
        );
    }

    // The same bargain, for a caller's own `maxGenerations` rather than the
    // request's clock: the first candidate already used up everything this
    // call is allowed to spend, so a second one is not a cheaper retry, it is
    // a third generation nobody agreed to.
    if (!hasGenerationBudget()) {
      console.warn(
        `[generate] ${opts.schemaName}: reached its ${opts.maxGenerations}-generation limit ` +
          `before trying ${choice.describe}; stopping after ${i} candidate(s).`,
      );
      throw chain.lastError ??
        new GenerationError(
          "No pudimos leerlo con tu IA en el primer intento. Probá de nuevo, o seguí sin ella.",
          "timeout",
          504,
          true,
        );
    }

    /**
     * The extension applies only when nothing is left behind it: a candidate
     * with a live standby after it keeps the base budget, so a user with fast
     * alternatives still gets the quick fallback `ATTEMPT_TIMEOUT_MS` buys.
     * The last one standing gets `lastResortBudgetMs`, sized from what this
     * key has actually been taking to answer.
     */
    const observedMs = latencyOf(choice.cooldownKey);
    const lastResortMs =
      i === order.length - 1 ? lastResortBudgetMs(observedMs) : undefined;
    // Logged only when evidence lifts the budget past the floor. The floor
    // itself is routine for a last candidate — logging it would put a line
    // under every generation of every single-key user — but a measured
    // extension is the one trace a request leaves of being waited out on
    // purpose rather than hung.
    if (lastResortMs !== undefined && lastResortMs > LAST_RESORT_TIMEOUT_MS) {
      console.warn(
        `[generate] ${opts.schemaName}: ${choice.describe} es el último candidato disponible ` +
          `y viene respondiendo en ~${Math.round(observedMs! / 1000)} segundos; le doy hasta ` +
          `${Math.round(lastResortMs / 1000)}.`,
      );
    }

    chain.used = choice;
    // A repair recorded against a candidate that then failed is not a fact
    // about the candidate that succeeds after it.
    telemetry.repaired = undefined;
    const startedAt = Date.now();
    try {
      const result = await runOn(choice, i === order.length - 1, lastResortMs);
      recordOutcome(choice.cooldownKey, { ok: true, ms: Date.now() - startedAt });
      return result;
    } catch (error) {
      /**
       * Everything except the user's own cancellation is this candidate's
       * record. A 499 is neither a failure nor a latency sample — the elapsed
       * time measures how long the person waited before pressing Cancel, and
       * counting it would let an impatient user demote a perfectly good key.
       */
      const cancelled = error instanceof GenerationError && error.status === 499;
      if (!cancelled) {
        recordOutcome(choice.cooldownKey, { ok: false, ms: Date.now() - startedAt });
      }

      if (!(error instanceof GenerationError) || !error.switchable) throw error;

      chain.failed.add(choice.cooldownKey);
      chain.lastError = error;
      markCooldown(choice.cooldownKey, error.status);

      const next = order[i + 1];
      if (!next) throw error;

      const event = {
        from: choice.describe,
        to: next.describe,
        status: error.status,
        message: error.message,
        provider: choice.provider,
        modelId: choice.modelId,
        kind: error.kind,
      };
      chain.switches.push(event);
      // Told as it happens as well as collected for the response: a streaming
      // route can turn an unexplained wait into an explained one.
      chain.onSwitch?.(event);
      console.warn(
        `[generate] ${opts.schemaName}: ${choice.describe} failed with ${error.status} ` +
          `(${error.message}); falling back to ${next.describe}.`,
      );
    }
  }

  // Unreachable: the loop either returns or throws on its last candidate.
  throw chain.lastError;
}

/**
 * Recovers, with a single retry, from a provider rejecting the requested
 * `maxOutputTokens` outright rather than truncating to it — two different
 * providers, two different reasons, same shape of error and same fix:
 *
 * - OpenRouter preflights every request by estimating the worst-case cost of
 *   `maxOutputTokens` against the account's balance and rejects the call if
 *   it can't cover it, even though actual usage is often far cheaper (since
 *   `maxOutputTokens` is a ceiling, not a reservation). Names exactly how
 *   many tokens the balance *can* cover: "...but can only afford 6275".
 * - Cohere hard-caps output length per model server-side — `command-a-*`
 *   rejects anything over 8192 outright. `maxOutputTokensFor` in
 *   `./provider-catalog.ts` already clamps the *known* default model's
 *   requests below that ceiling before they're sent; this is the fallback
 *   for a BYOK model id that table doesn't know about. Names the ceiling:
 *   "max tokens must be less than or equal to 8192 ... received 16384".
 * - Groq caps output per model the same way, and phrases it the same way with
 *   the numbers in backticks: "`max_tokens` must be less than or equal to
 *   `8192`". `groq/compound` needs this — it is the only Groq model whose
 *   per-minute token budget leaves room for a CV, and it caps output at 8192
 *   against the 16384 `CV_MAX_OUTPUT_TOKENS` asks for.
 *
 * Whether the ceiling named is one worth retrying at is not decided here —
 * that is a floor, the floor is per-generation, and `generate` owns it.
 */
const RECOVERABLE_CEILING_PATTERNS = [
  /can only afford [`'"]?(\d+)/i,
  /must be less than or equal to [`'"]?(\d+)/i,
];

/**
 * A fourth case, which names no ceiling but gives the arithmetic for one:
 * Groq bills `maxOutputTokens` against a per-minute token budget up front,
 * so a request is rejected for a ceiling it would probably never have spent.
 * On the free tier that budget is 8000 and the smallest generation here asks
 * for 8192 output tokens on top of a ~2100-token prompt:
 *
 *   "Request too large ... on tokens per minute (TPM): Limit 8000,
 *    Requested 10301, please reduce your message size and try again."
 *
 * The prompt is fixed, so the only thing that can shed the excess is the
 * ceiling — by at least `Requested - Limit`.
 */
const TOKENS_PER_MINUTE = /tokens per minute \(tpm\): limit (\d+), requested (\d+)/i;

/**
 * The budget is per minute and shared with whatever else the user's key is
 * doing, so a retry sized to fit exactly would be refused again by anything
 * else moving. Ask for nine tenths of what fits.
 */
const TPM_MARGIN = 0.9;

/**
 * Below this, the retry stops being a rescue: every schema here needs a few
 * thousand output tokens, and answering a too-small budget with a truncated
 * response that then goes through `repairSchemaViolation` produces a mutilated
 * document where an honest error was the right answer.
 *
 * The default, for the schemas that fit inside `MAX_OUTPUT_TOKENS`. The two
 * that ask for more have their own floor, below.
 */
const MIN_USEFUL_CEILING = 4096;

/**
 * The floor for the generations that ask for a `*_MAX_OUTPUT_TOKENS` budget.
 *
 * A `CVDocument` is ~4.5k output tokens of JSON on its own and shares the
 * ceiling with whatever the model thinks before writing it — which is the
 * whole reason `CV_MAX_OUTPUT_TOKENS` is 16384 rather than 8192. A ceiling
 * below this cannot hold one: the response is cut off mid-string, and the
 * truncation branch of `repairSchemaViolation` re-issues it *at the same
 * ceiling*, so it is cut off again.
 *
 * Not hypothetical. An OpenRouter account with no credit left afforded 4722
 * output tokens; that cleared `MIN_USEFUL_CEILING`, so it was accepted for
 * every generation including the CV, and the user waited half a minute to be
 * told the model "did not respect the expected format" — which described
 * nothing that had happened. Above this floor the retry still rescues the
 * smaller generations; below it, the provider's own error is the honest
 * answer and `asGenerationError` turns it into one.
 */
const LARGE_MIN_OUTPUT_TOKENS = 8192;

/** What a provider's rejection of `maxOutputTokens` gives us to work with. */
type ReportedCeiling = {
  ceiling: number;
  /** The provider's own words, kept so a later refusal can quote the reason. */
  message: string;
  /**
   * Whether the ceiling holds for any request or only for this one. The two
   * patterns above name a limit that does not depend on what was asked, so it
   * is worth remembering for the rest of the request; the `TOKENS_PER_MINUTE`
   * arithmetic is relative to *this* prompt's size, and reusing it against a
   * longer one would clamp a later generation for no reason.
   */
  absolute: boolean;
};

/**
 * The ceiling a rejection names, whether or not it is one worth retrying at —
 * `generate` applies the floor, because the floor is per-generation and this
 * is not.
 */
function reportedCeiling(error: unknown, requested: number): ReportedCeiling | null {
  if (!APICallError.isInstance(error)) return null;

  const found = (ceiling: number, absolute: boolean): ReportedCeiling | null =>
    ceiling > 0 && ceiling < requested ? { ceiling, message: error.message, absolute } : null;

  const budget = TOKENS_PER_MINUTE.exec(error.message);
  if (budget) {
    const excess = Number(budget[2]) - Number(budget[1]);
    return found(Math.floor((requested - excess) * TPM_MARGIN), false);
  }

  for (const pattern of RECOVERABLE_CEILING_PATTERNS) {
    const match = pattern.exec(error.message);
    if (!match) continue;
    return found(Number(match[1]), true);
  }
  return null;
}

/**
 * Some models, despite `schemaHint`'s explicit warning not to, still nest the
 * whole object one level deep under a key named after `schemaName` (e.g.
 * `{"InferredSkills": {"skills": [...]}}` instead of `{"skills": [...]}`).
 * That's mechanically fixable without asking the model again, so it's handled
 * here rather than spending a full `generateText` round-trip on it.
 */
export function unwrapEnvelope(error: TypeValidationError, schemaName: string): string | null {
  const value = error.value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length !== 1 || keys[0].toLowerCase() !== schemaName.toLowerCase()) return null;
  return JSON.stringify((value as Record<string, unknown>)[keys[0]]);
}

/** The only overshoots removing characters or elements can actually fix. */
const CLIPPABLE_ORIGINS = new Set(["string", "array"]);

/** The shape of a Zod issue this reads, duck-typed — see `zodIssues` below. */
type Issue = {
  code?: unknown;
  origin?: unknown;
  maximum?: unknown;
  minimum?: unknown;
  message?: unknown;
  inclusive?: unknown;
  path?: unknown;
};

/**
 * The `ZodError` that rejected a value, wherever it sits in the AI SDK's error
 * chain — from the AI SDK's own `zod4Schema` and from `relaxedSchema`'s custom
 * `validate` alike, both of which hand `safeParseAsync`'s error straight to
 * `TypeValidationError.wrap`.
 *
 * The chain has one more link than that wrapping alone suggests: `generateObject`
 * throws a `NoObjectGeneratedError` whose `cause` is that `TypeValidationError`,
 * whose `cause` is the `ZodError` with the actual `issues`. Reading only one
 * level down reported every real schema violation — and every repair failure —
 * as "no structured issues (unparsable response)", which is how a production
 * incident's logs described a schema breach without ever naming a field.
 *
 * Read structurally rather than with `instanceof z.ZodError`: under pnpm the
 * SDK's `zod` and this app's can resolve to separate module instances, and an
 * `instanceof` that silently fails there would disable the clipping below in
 * production while every test still passed. The depth cap also keeps a
 * malformed cause chain from looping forever.
 */
function zodIssues(error: unknown): Issue[] | null {
  for (let current: unknown = error, depth = 0; depth < 5; depth++) {
    if (current === null || typeof current !== "object") return null;
    const issues = (current as { issues?: unknown }).issues;
    if (Array.isArray(issues)) return issues as Issue[];
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Trims a response that is over a length limit, without asking the model again.
 *
 * The limits `lib/schemas/*.ts` encode are, for most providers here, not
 * enforceable at the source: `relaxJsonSchema` strips `maxLength`/`maxItems`
 * for Cohere and Google, `@ai-sdk/google` drops them again on its own, and the
 * OpenAI-compatible clients (Groq, OpenRouter) forward no schema at all — the
 * model only ever meets the ceiling as prose inside `schemaHint`. A response
 * that overshoots one is therefore the expected cost of a constraint nobody was
 * structurally told about, not a misbehaving model, and it should not cost a
 * 502: a 130-character `derivedFrom` is one `slice` away from acceptable.
 *
 * Handled here beside `unwrapEnvelope`, for the same reason that one is —
 * spending the single repair attempt (and a full round-trip) on something this
 * mechanical is what turned a stray long string into a failed generation.
 *
 * Deliberately narrow. Every issue must be `too_big` on a string or an array;
 * a `too_small`, a missing field or a bad enum value cannot be fixed by
 * removing characters, and any one of them sends the whole response on to the
 * model repair below untouched.
 *
 * A string the caller says is printed (`printed`) is not clipped either: «…» at the end of a line of a CV reads on paper as a
 * rendering bug, and a sentence cut in the middle says what its author did not. The repair asks the model for a shorter one.
 */
export function clipToLimits(error: TypeValidationError, schema: z.ZodType, printed?: (path: PropertyKey[]) => boolean): string | null {
  const issues = zodIssues(error);
  if (!issues || issues.length === 0) return null;

  const clippable = issues.every(
    (issue) =>
      issue.code === "too_big" &&
      typeof issue.origin === "string" &&
      CLIPPABLE_ORIGINS.has(issue.origin) &&
      typeof issue.maximum === "number" &&
      Array.isArray(issue.path),
  );
  if (!clippable) return null;
  if (printed && issues.some((issue) => issue.origin === "string" && printed(issue.path as PropertyKey[]))) return null;

  const value = structuredClone(error.value);
  for (const issue of issues) {
    // `inclusive: false` means the maximum itself is already too big.
    const maximum = issue.maximum as number;
    const limit = issue.inclusive === false ? maximum - 1 : maximum;
    if (!clipAt(value, issue.path as PropertyKey[], limit)) return null;
  }

  // Re-validated rather than trusted: the SDK validates whatever text comes
  // back from here, and failing there would spend the one repair attempt this
  // exists to save. It can still fail — an issue list is not always complete,
  // since Zod stops descending into a branch once it rejects it — in which
  // case the model repair takes over as if nothing had been tried.
  return schema.safeParse(value).success ? JSON.stringify(value) : null;
}

/** Whether a string of a `CVDocument` ends up on the paper: all of it but the coverage report, which is shown beside the preview. */
const isPrintedCvText = (path: PropertyKey[]) => path[0] !== "coverage";

/** Shortens the string or array at `path` to `limit`, in place. */
function clipAt(root: unknown, path: PropertyKey[], limit: number): boolean {
  if (path.length === 0 || limit < 0) return false;

  let node: unknown = root;
  for (const key of path.slice(0, -1)) {
    if (node === null || typeof node !== "object") return false;
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  if (node === null || typeof node !== "object") return false;

  const parent = node as Record<PropertyKey, unknown>;
  const key = path[path.length - 1];
  const current = parent[key];

  if (typeof current === "string") {
    // An ellipsis rather than a hard cut: these strings are rendered verbatim
    // (`InferredSkillsPanel` shows `derivedFrom` as «…»), and a phrase that
    // stops mid-word with no mark reads as a rendering bug rather than a
    // deliberate trim.
    parent[key] = limit > 0 ? `${current.slice(0, limit - 1).trimEnd()}\u2026` : "";
    return true;
  }
  if (Array.isArray(current)) {
    parent[key] = current.slice(0, limit);
    return true;
  }
  return false;
}

/**
 * Called by the AI SDK when the model's output fails JSON parsing or schema
 * validation.
 *
 * A `JSONParseError` (an unterminated string/object — the response was cut off
 * mid-generation, sometimes by a provider that doesn't reliably report
 * `finishReason: "length"` on its free/low-quota routing) is a different
 * failure than a `TypeValidationError` (the model produced complete,
 * well-formed JSON that violates a schema constraint), and the two need
 * opposite treatment.
 *
 * For a `TypeValidationError` the previous response is normally the subject of
 * the repair: it is complete and valid JSON, one constraint away from
 * acceptable, so it goes back with the error that names the offending path and
 * limit.
 *
 * For a truncation there is nothing to fix — the model never finished. Sending
 * the fragment back only tells it what running out of room looks like, and if
 * the response was cut off inside a repetition loop, hands it the loop as
 * context. The original request goes out again with a brevity directive
 * instead.
 *
 * Both of those assume the rejected text is otherwise sound. A repetition loop
 * ("Nombre Nombre Nombre…", or a phone number that trails off into
 * "b-1a2b3c4d5e-1a2b3c4d5e-1a2b3c4d5e…") breaks that assumption regardless of
 * which error it surfaces as — the model doesn't stop looping just because it
 * ran out of room first, so the same loop can show up cut off mid-string
 * (`JSONParseError`) or finished inside otherwise-valid JSON
 * (`TypeValidationError`). Either way "make it shorter" or "here's your exact
 * error" does not address *why* it looped, and echoing it back risks the one
 * repair attempt continuing the loop. This is checked first, ahead of both
 * other branches.
 */
async function repairSchemaViolation(
  opts: {
    model: LanguageModel;
    /** What the provider is told, and what the repair call validates against. */
    schema: z.ZodType | Schema<unknown>;
    /** The unrelaxed original; only `clipToLimits` needs it. */
    zodSchema: z.ZodType;
    schemaName: string;
    system: string;
    prompt: string;
    preserve?: string;
    maxOutputTokens: number;
    telemetry?: GenerationTelemetry;
    reasoning: typeof REASONING | undefined;
    /** The caller's attempt budget; a repair is bound by it too. */
    abortSignal?: AbortSignal;
    /** Whether the truncation branch below may ask for a shorter answer at all. Defaults to true. */
    allowShortenRepair?: boolean;
    /** Called right before this function's own model call, once it is certain one will actually be made — never when a gate below skips it. */
    onAttempt?: () => void;
  },
  text: string,
  error: JSONParseError | TypeValidationError,
): Promise<string | null> {
  if (TypeValidationError.isInstance(error)) {
    const unwrapped = unwrapEnvelope(error, opts.schemaName);
    if (unwrapped) {
      if (opts.telemetry) opts.telemetry.repaired = "envelope";
      return unwrapped;
    }
    const clipped = clipToLimits(error, opts.zodSchema, opts.schemaName === "CVDocument" ? isPrintedCvText : undefined);
    if (clipped) {
      if (opts.telemetry) opts.telemetry.repaired = "clipped";
      return clipped;
    }
  }

  if (opts.telemetry) {
    opts.telemetry.repaired = JSONParseError.isInstance(error) ? "truncation" : "schema";
  }

  // "Make it shorter" with nothing declared off-limits invites the model to
  // delete whichever section is longest, which is exactly the material the
  // output exists to carry. The caller says what has to survive the cut.
  const floor = opts.preserve ? `\n\n${opts.preserve}` : "";

  // Fresh-prompt-plus-floor re-issue, shared by the truncation branch and the
  // degenerate-repetition branch below: both discard the previous response as
  // context rather than feed a runaway loop back into it.
  const reissue = (reason: string) => `${opts.prompt}

---

IMPORTANT — RETRY. ${reason}${floor}`;

  // On a genuine truncation the previous text is not evidence of anything
  // except where the budget ran out, and echoing it back is actively harmful:
  // a response cut off inside a degenerate repetition loop ("Nombre Nombre
  // Nombre…") feeds the loop straight back in as context and the model
  // obligingly continues it. A schema violation whose rejected value shows the
  // same repetition pattern — complete, well-formed JSON, but with a field
  // like `phone` full of repeated digits — is the same failure without the
  // truncation. Checked against the raw text regardless of which error it
  // surfaced as, since a truncation is not proof the loop was the *only*
  // problem, and a schema violation is not proof there wasn't one.
  const degenerate = DEGENERATE_REPETITION.test(clip(text, MAX_ECHOED_TEXT));

  // A "shorter" answer is a *different* answer — nothing here re-checks it
  // against the source the way the original reading is, so a caller careful
  // about that would rather fall back to whatever it had (the heuristic
  // result, the sentence-split facts) than trust one. Does not apply to the
  // repetition-loop case just above: asking for "real, varied content" is not
  // asking for less of it.
  if (opts.allowShortenRepair === false && !degenerate && JSONParseError.isInstance(error)) {
    return null;
  }

  const instruction = degenerate
    ? reissue(
        `Your previous answer to this exact request degenerated into repeating the ` +
          `same short phrase or character over and over instead of finishing normally, ` +
          `far more than natural language ever would. Produce the same object again ` +
          `with real, varied content in every field — do not repeat any word, phrase, ` +
          `or character more than a few times in a row.`,
      )
    : JSONParseError.isInstance(error)
      ? reissue(
          `Your previous answer to this exact request was cut off before it finished, ` +
            `because it was too long to fit in the available space. Produce the same ` +
            `object again, but SHORTER — aim for well under half the length you were cut ` +
            `off at. Shorten by making the text of each item more concise, not by ` +
            `deleting whole sections, and finish the object.`,
        )
      : `Your previous response for "${opts.schemaName}" did not satisfy the required schema:

${describeValidationFailure(error)}

Previous response:
${clip(text, MAX_ECHOED_TEXT)}

Return a corrected, complete object that fixes this violation (for example, by trimming the offending array or string to fit within the stated limit, or by supplying the required field) while keeping everything else intact.`;

  try {
    // `generateObject`, not `generateText`: the original call forwards a
    // response schema to the provider, and repairing without one throws that
    // constraint away at the exact moment it matters most. A repair run free of
    // it can return something that parses and has roughly the right shape but
    // is not the schema at all — a `sections` entry with no `kind`, say — which
    // then fails validation a second time with no attempt left.
    // No nested `repairText`, so this cannot recurse.
    opts.onAttempt?.();
    const { object } = await generateObject({
      model: opts.model,
      schema: opts.schema,
      schemaName: opts.schemaName,
      system: opts.system,
      prompt: instruction,
      // Not 0: greedy decoding is the regime where repetition loops are most
      // likely, and a loop is what sent this response to be repaired.
      temperature: 0.2,
      reasoning: opts.reasoning,
      maxOutputTokens: opts.maxOutputTokens,
      abortSignal: opts.abortSignal,
    });
    return JSON.stringify(object);
  } catch (error) {
    // Returning `null` re-throws the *original* rejection, so without this the
    // repair leaves no trace at all: the logs show one schema violation and a
    // 502, with nothing to say a second attempt was made or why it also failed.
    console.warn(
      `[generate] ${opts.schemaName} repair attempt failed: ` +
        clip(redactKeys(describeValidationFailure(error)), MAX_LOGGED_CAUSE),
    );
    return null;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Summarizes a schema-validation failure for the server log without echoing
 * the value that failed to validate.
 *
 * `describe()` on a `TypeValidationError` returns "Value: {…the entire
 * rejected object…} Error message: […]" — for every schema in this file that
 * object is a CV, a set of interview answers, or a profile, and "the entire
 * rejected object" is a person's name, phone, email and employment history.
 * That does not belong in a log line. What is actually diagnostic is which
 * field violated which rule, so this reports the issues' shape (path, code,
 * limits) and drops their values — except as zod itself quotes them inside an
 * issue's own message, which the callers clip.
 *
 * Exported for the tests that pin how the AI SDK's error chain is read: the
 * `ZodError` sits two links down (`NoObjectGeneratedError.cause.cause`), and
 * reading only one was exactly the bug this once shipped with.
 */
export function describeValidationFailure(error: unknown): string {
  const issues = zodIssues(error);
  if (issues && issues.length > 0) {
    return (
      `${issues.length === 1 ? "1 schema violation" : `${issues.length} schema violations`}: ` +
      issues
        .map((issue, i) => {
          const path = Array.isArray(issue.path) ? issue.path.join(".") : "(root)";
          const bits = [`#${i} "${path}"`, `code=${String(issue.code ?? "unknown")}`];
          if (typeof issue.message === "string") bits.push(issue.message);
          if (issue.maximum !== undefined) bits.push(`maximum=${String(issue.maximum)}`);
          if (issue.minimum !== undefined) bits.push(`minimum=${String(issue.minimum)}`);
          if (issue.inclusive !== undefined) bits.push(`inclusive=${String(issue.inclusive)}`);
          return bits.join(" ");
        })
        .join("; ")
    );
  }
  // No structured issues. Name what the cause chain actually surfaces instead
  // of assuming the text never parsed — and classify with the SDK's own
  // `isInstance` markers and `name`, not `constructor.name`: production
  // minification turns the latter into "te" and "t_", which is how these logs
  // became unreadable in the first place. The abort check comes first: an
  // aborted response body surfaces as a parse failure whose cause is the
  // abort, and calling that "unparsable" sends the operator chasing JSON that
  // was never there.
  if (isAbort(error)) {
    return "the call was aborted before it finished (timeout or disconnect) — no response was validated";
  }
  for (let current: unknown = error, depth = 0; depth < 5; depth++) {
    if (!(current instanceof Error)) break;
    if (JSONParseError.isInstance(current)) {
      return "the response could not be parsed as JSON";
    }
    if (TypeValidationError.isInstance(current)) {
      return "the response failed schema validation, but the validator reported no field-level issues";
    }
    current = current.cause;
  }
  const kind = error instanceof Error ? error.name || "unknown error" : typeof error;
  return `${kind}: schema validation failed with no structured issues (unparsable response)`;
}

/**
 * Shortens from the middle, keeping both ends.
 *
 * A `TypeValidationError` message reads "Value: {…the entire rejected object…}
 * Error message: [ …the issues… ]" — the part worth reading is at the *end*,
 * after the part that can run to tens of kilobytes. Trimming the tail would
 * throw away the only diagnostic in the string.
 */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor((max - 3) / 2);
  return `${text.slice(0, half)}…\n[${text.length - 2 * half} chars omitted]\n…${text.slice(-half)}`;
}

/**
 * How each provider says "that model is gone", for the check in
 * `asGenerationError` below.
 *
 * Matching only "not found" was not enough: Groq answers a retired id with
 * "The model `llama-3.3-70b-versatile` does not exist or you do not have
 * access to it", which fell through to the generic 502 and told the user
 * nothing they could act on — the one failure a BYOK user can actually fix
 * themselves, reported as if the service were broken. The phrasings differ
 * per provider and there is no shared error code across the five, so this is
 * a list of what they say.
 */
const MODEL_GONE =
  /not found|does not exist|no longer (available|supported)|decommission|deprecat|model_not_found|unknown model|invalid model/;

/**
 * How a provider says the model exists but not for this account's plan, for the
 * branch in `asGenerationError` below.
 *
 * Mistral is the one that matters here: its free tier — the tier this product
 * points people at — answers `mistral-large-latest` with 403 `tier_not_allowed`
 * and code 1910 ("This model is not available in your subscription tier"),
 * while `/v1/models` for the same key does not even list it. Nothing about that
 * is a credential problem, which is why it must not land on the 403 entry of
 * `BY_STATUS` — the remedy is the same as a retired model's: another model.
 */
const TIER_NOT_ALLOWED = /subscription tier|tier_not_allowed/i;

/**
 * How a provider says the account cannot pay for what was asked, for the
 * branch in `asGenerationError` below. OpenRouter is the one that matters
 * here — it is the only provider in the catalogue that prices a request
 * before running it — but the phrasings are generic enough to catch the
 * others' 402s too.
 */
const INSUFFICIENT_CREDIT =
  /requires more credits|can only afford|insufficient (credits|balance|funds)|payment required|not enough credit/;

/**
 * How a provider says "the model is saturated, come back" without a 429.
 *
 * Cloudflare is the one that surfaced it: "This model is currently
 * experiencing high demand. Spikes in demand are usually temporary. Please
 * try again later." Nothing here or in `BY_STATUS` covered it, so it fell to
 * the generic 502 — which is not switchable — and one saturated model ended a
 * whole request with the user's other keys unasked (`inferSkills` died on the
 * way too, which is allowed but was failing for an unclassifiable reason). A
 * provider that says "try again later" is asking the chain to do exactly that.
 *
 * Deliberately narrower than "any 5xx": a bare 500 is the provider's own
 * outage, the SDK has already retried it, and burning the chain there is a
 * cost with nothing to show for it — see the test that pins that. Only the
 * explicit phrasing, which is the provider naming the workaround.
 */
const OVERLOADED =
  /high demand|try again later|try again in|temporarily (unavailable|overloaded|unable)|overloaded|at capacity|capacity exceeded|server is busy/i;

/**
 * What a BYOK user with an empty balance is told.
 *
 * The OpenRouter half — its credit page, the `:free` advice — is only true of
 * OpenRouter, and it used to be the message every provider's 402 got: a
 * Cerebras key sent the user to openrouter.ai to top up, and someone with
 * three such keys read the same wrong sentence three times in Ajustes. The
 * rest get their provider's own name and the generic advice, which is the most
 * that is true across a catalogue whose balance pages all differ.
 */
function insufficientCreditMessage(provider?: ProviderId): string {
  if (provider === "openrouter") {
    return (
      "Tu cuenta con el proveedor no tiene crédito suficiente para este pedido. " +
      "En OpenRouter podés cargar crédito en https://openrouter.ai/settings/credits, " +
      "o elegir en Ajustes un modelo más barato o gratuito (con id terminado en «:free»)."
    );
  }

  const name = provider ? PROVIDER_LABEL[provider] : "el proveedor";
  return (
    `Tu cuenta con ${name} no tiene crédito suficiente para este pedido. ` +
    `Cargá crédito en el panel de ${name}, o elegí en Ajustes un modelo más barato o gratuito.`
  );
}

/**
 * Whether a call stopped because a signal fired rather than because the
 * provider said something.
 *
 * Walks the cause chain: the AI SDK wraps the underlying `AbortError` in its
 * own error types, and an aborted response body surfaces as a parse failure
 * whose cause is the abort. Checking only the top-level name misses both, which
 * would send a timeout down the generic 502 path and tell the user their model
 * "did not respect the expected format".
 */
function isAbort(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; depth < 5; depth++) {
    if (!(current instanceof Error)) return false;
    if (current.name === "AbortError" || current.name === "TimeoutError") return true;
    // Undici and the SDK both phrase it in prose rather than in `name`.
    if (/\baborted\b|\btimed? ?out\b/i.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}

/**
 * Maps provider failures onto the statuses, kinds and messages the UI can act
 * on.
 *
 * Exported for the tests that pin classification without driving a whole
 * generation to produce the error first — same reason as `lastResortBudgetMs`
 * above. The pipeline-branch failures that never pass through here (the 499
 * cancel, the 504 timeouts, the cut-off and format branches) are pinned where
 * they are built, not through this function.
 */
export function asGenerationError(error: unknown, provider?: ProviderId): GenerationError {
  const message = describe(error);
  const lower = message.toLowerCase();
  /**
   * The provider's own response body, when there is one. Some of what
   * classifies a failure only appears there: `@ai-sdk/mistral` has been seen
   * to surface an *empty* `message` on an `APICallError`, and its plan refusal
   * carries `type: "tier_not_allowed"` in the body beside the sentence.
   */
  const apiDetail = APICallError.isInstance(error) ? (error.responseBody ?? "") : "";

  if (lower.includes("api key") || lower.includes("unauthorized") || lower.includes("401")) {
    return new GenerationError(
      "La API key fue rechazada por el proveedor. Revisala en Ajustes.",
      "key_rejected",
      401,
      true,
    );
  }
  /**
   * A balance that cannot pay for the request is not a rate limit either, and
   * it is the BYOK failure least likely to be guessed from a generic message.
   * OpenRouter prices `maxOutputTokens` against the account's credit before
   * running anything and refuses with "This request requires more credits, or
   * fewer max_tokens. You requested up to 16384 tokens, but can only afford
   * 4722." Arriving as a bare 502 sent the user to Ajustes to change models,
   * which changes nothing: that ceiling belongs to the balance, not to the
   * model.
   */
  if (INSUFFICIENT_CREDIT.test(lower)) {
    return new GenerationError(insufficientCreditMessage(provider), "no_credit", 402, true);
  }
  /**
   * A per-minute token budget smaller than one request is not a rate limit,
   * however much it looks like one. Groq's free tier allows 8000 tokens per
   * minute on most models and a CV prompt is around 10300, so the request can
   * never fit no matter how long the user waits — telling them to try again
   * in a moment would be a lie, and it was the advice they got. The remedy is
   * a different model or a paid tier, so the message says so.
   */
  if (lower.includes("request too large") || lower.includes("reduce your message size")) {
    return new GenerationError(
      "El pedido supera el límite de tokens por minuto de tu plan con el proveedor. " +
        "Probá con otro modelo desde Ajustes, o subí de plan con el proveedor.",
      "request_too_large",
      413,
      true,
    );
  }
  /**
   * A quota that resets on a clock is not a rate that eases in a moment: Gemini's free tier allows 20 requests a day per
   * project and model, and "esperá un momento" sent the person back to fail for the next three hours. Said apart, with
   * when it comes back and where to change the model — the one thing that helps while it lasts.
   */
  const daily = dailyQuota(`${message} ${apiDetail}`);
  if (daily) {
    return new GenerationError(
      `Se agotó la cuota diaria de este modelo con tu key${daily.retryIn ? `; vuelve en ${daily.retryIn}` : ""}. Podés elegir otro modelo en Ajustes.`,
      "rate_limited",
      429,
      true,
    );
  }
  if (lower.includes("rate limit") || lower.includes("429") || lower.includes("quota")) {
    return new GenerationError(
      "El proveedor está limitando las peticiones. Esperá un momento y probá de nuevo.",
      "rate_limited",
      429,
      true,
    );
  }
  /**
   * A model the account's plan does not include. Mistral answers a
   * tier-restricted model with 403 and `type: "tier_not_allowed"` — "This
   * model is not available in your subscription tier", code 1910 — and its
   * free tier is exactly what Ajustes offers the provider for. That is not a
   * credential problem, so the 403 entry of `BY_STATUS` below ("the credential
   * was refused") is the wrong verdict for it, and the remedy is the same as a
   * retired model's: another model. Matched on the message *and* the body,
   * because a `message` that arrives empty would otherwise fall through to
   * that 403 entry and read as a broken key.
   */
  if (TIER_NOT_ALLOWED.test(`${message} ${apiDetail}`)) {
    return new GenerationError(
      "El modelo indicado no está disponible en tu plan con el proveedor. " +
        "Probá con otro modelo desde Ajustes.",
      "model_not_in_plan",
      400,
      true,
    );
  }
  if (lower.includes("model") && MODEL_GONE.test(lower)) {
    return new GenerationError(
      "El modelo indicado no existe para ese proveedor. Revisalo en Ajustes.",
      "model_retired",
      400,
      true,
    );
  }
  if (OVERLOADED.test(lower)) {
    return new GenerationError(
      "El proveedor está saturado en este momento. Esperá un momento y probá de nuevo.",
      "overloaded",
      503,
      true,
    );
  }
  /**
   * The same five verdicts, taken from the HTTP status when the provider did
   * not put them into words.
   *
   * Every branch above matches on the message because that is the only place
   * most providers say anything useful, and the phrasings differ across the
   * five. But the message is not guaranteed: `@ai-sdk/mistral` surfaces a
   * rejected key as an `APICallError` with an *empty* message, which fell
   * through to the generic 502 and read as "the service is broken" for what
   * was a typo in Ajustes. That mattered little when a failure ended the
   * request either way; with a chain it decides whether the next provider is
   * ever asked, so a terse 429 would silently cost the user the fallback that
   * exists for exactly that case.
   *
   * Last, not first: a provider that explains itself is believed over its own
   * status code — Groq answers a retired model id with 404, which is a 400
   * "that model is gone" here and not a transport failure.
   */
  if (APICallError.isInstance(error) && error.statusCode) {
    const byStatus = BY_STATUS[error.statusCode];
    if (byStatus) {
      return new GenerationError(byStatus.message, byStatus.kind, byStatus.status, true);
    }
  }

  return new GenerationError(`No pudimos generar el resultado. (${message})`, "unclassified");
}

/**
 * What each status means on its own, for the check at the end of
 * `asGenerationError`.
 *
 * Named fields rather than tuples, because the kind travels beside the status
 * it belongs to. `key_rejected` for a plain 403 is the one mapping worth
 * saying out loud: a 403 is "the credential was refused" for the OpenAI-shaped
 * providers, while Mistral's plan refusal is matched by `TIER_NOT_ALLOWED`
 * before it could ever reach this table.
 */
const BY_STATUS: Record<number, { status: number; message: string; kind: GenerationErrorKind }> = {
  401: {
    status: 401,
    message: "La API key fue rechazada por el proveedor. Revisala en Ajustes.",
    kind: "key_rejected",
  },
  403: {
    status: 401,
    message: "El proveedor rechazó la credencial para este pedido. Revisala en Ajustes.",
    kind: "key_rejected",
  },
  402: {
    status: 402,
    message:
      "Tu cuenta con el proveedor no tiene crédito suficiente para este pedido. " +
      "Cargá crédito, o elegí en Ajustes un modelo más barato o gratuito.",
    kind: "no_credit",
  },
  413: {
    status: 413,
    message:
      "El pedido supera el límite de tokens por minuto de tu plan con el proveedor. " +
      "Probá con otro modelo desde Ajustes, o subí de plan con el proveedor.",
    kind: "request_too_large",
  },
  429: {
    status: 429,
    message: "El proveedor está limitando las peticiones. Esperá un momento y probá de nuevo.",
    kind: "rate_limited",
  },
  /**
   * NVIDIA NIM retires a model with 410 and the single word "Gone". The
   * `MODEL_GONE` branch above needs the message to say "model", so a retired
   * model id landed on the generic 502 — which is not switchable, and a user
   * whose first key pointed at one lost the request, and every key behind it,
   * to a one-word answer. A retired model is the failure another candidate
   * fixes.
   */
  410: {
    status: 400,
    message: "El modelo indicado ya no está disponible para ese proveedor. Revisalo en Ajustes.",
    kind: "model_retired",
  },
  504: { status: 504, message: "El proveedor tardó demasiado en responder.", kind: "timeout" },
};

// --- Steps --------------------------------------------------------------------

export function analyzeJob(
  chain: ModelChain,
  jobText: string,
  profile: Profile,
  telemetry?: GenerationTelemetry,
) {
  return generate({
    chain,
    schema: jobAnalysisSchema,
    schemaName: "JobAnalysis",
    system: ANALYZE_JOB_SYSTEM,
    prompt: buildAnalyzeJobPrompt(jobText, profile),
    telemetry,
  });
}

export async function inferSkills(
  chain: ModelChain,
  profile: Profile,
  telemetry?: GenerationTelemetry,
): Promise<InferredSkill[]> {
  const result = await generate({
    chain,
    schema: inferredSkillsSchema,
    schemaName: "InferredSkills",
    system: INFER_SKILLS_SYSTEM,
    prompt: buildInferSkillsPrompt(profile),
    telemetry,
  });
  return result.skills;
}

export function buildCV(
  chain: ModelChain,
  input: Parameters<typeof buildCVPrompt>[0],
  telemetry?: GenerationTelemetry,
) {
  return generate({
    chain,
    schema: cvDocumentSchema,
    schemaName: "CVDocument",
    system: BUILD_CV_SYSTEM,
    prompt: buildCVPrompt(input),
    preserve: CV_REPAIR_FLOOR,
    maxOutputTokens: CV_MAX_OUTPUT_TOKENS,
    minOutputTokens: LARGE_MIN_OUTPUT_TOKENS,
    timeoutMs: LARGE_ATTEMPT_TIMEOUT_MS,
    telemetry,
  });
}

export function answerQuestions(
  chain: ModelChain,
  input: Parameters<typeof buildAnswersPrompt>[0],
  telemetry?: GenerationTelemetry,
) {
  return generate({
    chain,
    schema: answersSchema,
    schemaName: "Answers",
    system: ANSWER_QUESTIONS_SYSTEM,
    prompt: buildAnswersPrompt(input),
    telemetry,
  });
}

/**
 * The subject is composed here rather than asked of the model: it is whatever
 * the posting demanded, and where it demanded nothing, the job title. See
 * `resolveEmailSubject`.
 */
export async function writeEmail(
  chain: ModelChain,
  input: Parameters<typeof buildEmailPrompt>[0],
  telemetry?: GenerationTelemetry,
): Promise<CoverEmail> {
  const draft = await generate({
    chain,
    schema: coverEmailDraftSchema,
    schemaName: "CoverEmail",
    system: WRITE_EMAIL_SYSTEM,
    prompt: buildEmailPrompt(input),
    telemetry,
  });

  // The model is told not to open with the subject and pastes it in anyway;
  // `stripSubjectFromBody` is what actually keeps the body clean.
  const subject = resolveEmailSubject(input.analysis);
  return { ...draft, subject, body: stripSubjectFromBody(draft.body, subject) };
}

export function prepareInterview(
  chain: ModelChain,
  input: Parameters<typeof buildInterviewPrepPrompt>[0],
  telemetry?: GenerationTelemetry,
) {
  return generate({
    chain,
    schema: interviewPrepGenerationSchema,
    schemaName: "InterviewPrep",
    system: INTERVIEW_PREP_SYSTEM,
    prompt: buildInterviewPrepPrompt(input),
    preserve: INTERVIEW_REPAIR_FLOOR,
    maxOutputTokens: INTERVIEW_MAX_OUTPUT_TOKENS,
    minOutputTokens: LARGE_MIN_OUTPUT_TOKENS,
    timeoutMs: LARGE_ATTEMPT_TIMEOUT_MS,
    telemetry,
  });
}

export function writeVideoScript(
  chain: ModelChain,
  input: Parameters<typeof buildVideoScriptPrompt>[0],
  telemetry?: GenerationTelemetry,
) {
  return generate({
    chain,
    schema: videoScriptSchema,
    schemaName: "VideoScript",
    system: VIDEO_SCRIPT_SYSTEM,
    prompt: buildVideoScriptPrompt(input),
    preserve: VIDEO_REPAIR_FLOOR,
    maxOutputTokens: VIDEO_MAX_OUTPUT_TOKENS,
    minOutputTokens: LARGE_MIN_OUTPUT_TOKENS,
    timeoutMs: LARGE_ATTEMPT_TIMEOUT_MS,
    telemetry,
  });
}

/**
 * Reads a document — a non-standard CV, or a paragraph someone wrote about
 * their own career — into entities with a quote on every field.
 *
 * Only transcribes the document (source-shaped, like the deterministic
 * parsers in `lib/parse/`) rather than emitting operations against a profile
 * that already exists: `lib/parse/verify-extraction.ts` checks every quote
 * before anything here is trusted, and `lib/onboarding/merge.ts` is what
 * reconciles it against what is already in the profile.
 *
 * `maxGenerations: 2` and `allowShortenRepair: false`: the spec's own "un
 * único reintento" — one retry, in whatever form (a repair, a lower ceiling,
 * the next key), never a third call for one document — and never the retry
 * that asks for a *shorter* reading, which is a different reading, not a
 * finer one. Past that, the caller falls back to the heuristic reading, and
 * this never spends a third call chasing it.
 */
export function extractDocument(
  chain: ModelChain,
  text: string,
  kind: "cv" | "dump",
  telemetry?: GenerationTelemetry,
) {
  return generate({
    chain,
    schema: extractionSchema,
    schemaName: "Extraction",
    system: EXTRACT_SYSTEM,
    prompt: buildExtractPrompt(text, kind),
    preserve: "experience",
    maxOutputTokens: CV_MAX_OUTPUT_TOKENS,
    minOutputTokens: LARGE_MIN_OUTPUT_TOKENS,
    timeoutMs: LARGE_ATTEMPT_TIMEOUT_MS,
    maxGenerations: 2,
    allowShortenRepair: false,
    telemetry,
  });
}

/**
 * Separates one narrative answer into the atomic statements it contains. Named
 * `splitNarrative`, not `splitAnswer`, so it is never confused with the
 * deterministic, model-free `splitAnswer` in `lib/onboarding/split.ts` — the
 * fallback this degrades to, and the floor every piece this returns is checked
 * against before either is trusted. Capped the same way `extractDocument` is,
 * and for the same reason.
 */
export function splitNarrative(
  chain: ModelChain,
  answer: string,
  telemetry?: GenerationTelemetry,
) {
  return generate({
    chain,
    schema: splitSchema,
    schemaName: "Split",
    system: SPLIT_SYSTEM,
    prompt: buildSplitPrompt(answer),
    maxGenerations: 2,
    allowShortenRepair: false,
    telemetry,
  });
}

/**
 * Says one line of what a person did, or the description of a project, better: the same facts, and no figure, name or tool the text
 * did not have (`lib/ai/prompts/improve.ts`). Capped like `splitNarrative`, for the same reason: the first attempt and one more, in
 * whatever form, and never the retry that asks for a shorter text — that is a different text, not a better one. What comes back is a
 * proposal; the browser checks it against what was written before anyone sees it.
 */
export function improveText(
  chain: ModelChain,
  text: string,
  kind: ImproveKind,
  telemetry?: GenerationTelemetry,
) {
  return generate({
    chain,
    schema: improveSchema,
    schemaName: "Improve",
    system: IMPROVE_SYSTEM,
    prompt: buildImprovePrompt(text, kind),
    maxGenerations: 2,
    allowShortenRepair: false,
    telemetry,
  });
}

/**
 * `improveText` for many texts in one call — the button at the top of a section of the profile. The same two attempts at most and no retry that asks for a
 * shorter text; and the answer is closed as `condenseCvLines` closes its own (`keepProposed`): only what was asked about, once, and what its field could hold.
 */
export async function improveTexts(chain: ModelChain, items: readonly ImproveItem[], telemetry?: GenerationTelemetry) {
  const result = await generate({
    chain,
    schema: improveManySchema,
    schemaName: "ImproveMany",
    system: IMPROVE_MANY_SYSTEM,
    prompt: buildImproveManyPrompt(items),
    maxGenerations: 2,
    allowShortenRepair: false,
    telemetry,
  });
  return { items: keepProposed(items, result) };
}
