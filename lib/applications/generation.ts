"use client";

import { ApiError } from "@/lib/api/client";
import { IDEMPOTENCY_HEADER } from "@/lib/generation/idempotency";
import { withGeneratedCV } from "@/lib/storage/applications/normalize";
import type { Application } from "@/lib/storage/local";
import type { CVDocument } from "@/lib/schemas/cv";
import type { InferredSkill, JobAnalysis } from "@/lib/schemas/job";
import type { AnswersWithLimits, CoverEmail, InterviewPrep, VideoScript } from "@/lib/schemas/outputs";
import type { Finding } from "@/lib/ai/verify";
import type { ProviderId } from "@/lib/ai/provider-catalog";
import type { GenerationErrorKind } from "@/lib/ai/error-kind";
import type { GenerationKind } from "./pending";

/**
 * What each generation returns, and how it lands on the application it was
 * generated for — in one place, so the three paths that apply a result (the
 * wizard, the extras tabs, and the recovery of one that never reached storage)
 * cannot disagree about it.
 */

/**
 * A CV, or — when the posting asks for skills that were only deduced — the
 * `skillReview` to put to the person first, with no CV yet. The excluding-
 * requirements pre-flight in `app/api/generate/cv/route.ts` never stops here:
 * `acknowledgeExclusions` is sent as `true`.
 */
export type CVResponse = {
  cv?: CVDocument;
  skillReview?: InferredSkill[];
  analysis: JobAnalysis;
  inferredSkills: InferredSkill[];
  findings?: Finding[];
  meta?: {
    provider?: ProviderId;
    modelId?: string;
    /**
     * Present only when a provider refused partway through and another one
     * finished the job. Recorded against the settings row it belongs to, so
     * Ajustes can say which key needs attention — a rejected key keeps costing
     * a failed call on every generation until someone fixes it.
     */
    switches?: Array<{
      provider: ProviderId;
      modelId: string;
      status: number;
      message: string;
      kind?: GenerationErrorKind;
    }>;
  };
};

/** A generated CV applied to its application: `cv`, `findings` and the analysis written together, as they always were. */
export function applyCvResult(base: Application, result: CVResponse, jobText: string): Application {
  return withGeneratedCV(
    {
      ...base,
      jobText,
      label: [result.analysis.title, result.analysis.company].filter(Boolean).join(" · "),
      analysis: result.analysis,
      inferredSkills: result.inferredSkills,
      // A CV exists, so the question was answered or had nothing to ask: a regeneration does not repeat it.
      skillsReviewed: true,
      // Kept with the application so the panel survives a reload. Until this
      // existed the findings lived only in React state, and reopening a saved
      // application showed a clean CV that had never been clean.
      findings: result.findings ?? [],
      // Which model wrote this one. Without it the eval corpus mixes providers
      // and a regression cannot be attributed to the one it came from.
      provider: result.meta?.provider,
      model: result.meta?.modelId,
    },
    result.cv,
  );
}

export type ExtraResults = {
  answers: { answers: AnswersWithLimits; findings: Finding[] };
  email: { email: CoverEmail };
  interview: { interview: InterviewPrep };
  video: { video: VideoScript };
};

export type ExtraKind = keyof ExtraResults;

export const EXTRA_PATCH: { [K in ExtraKind]: (result: ExtraResults[K]) => Partial<Application> } = {
  answers: (result) => ({ answers: result.answers, answersFindings: result.findings }),
  email: (result) => ({ email: result.email }),
  interview: (result) => ({ interview: result.interview }),
  video: (result) => ({ video: result.video }),
};

export const EXTRA_ENDPOINT: Record<ExtraKind, string> = {
  answers: "/api/generate/answers",
  email: "/api/generate/email",
  interview: "/api/generate/interview",
  video: "/api/generate/video",
};

/** The field an extra writes, to tell whether an application already holds a given result. */
export const EXTRA_FIELD: Record<ExtraKind, keyof Application> = {
  answers: "answers",
  email: "email",
  interview: "interview",
  video: "video",
};

export function isExtraKind(kind: GenerationKind): kind is ExtraKind {
  return kind !== "cv";
}

// --- Recovery ---------------------------------------------------------------------

export type RecoveredResult =
  | { status: "done"; kind: GenerationKind; value: unknown; jobText?: string }
  | { status: "running" }
  | { status: "missing" }
  | { status: "error" };

/** Asks the server for a result it kept under `key`. Never throws. */
export async function fetchGenerationResult(key: string): Promise<RecoveredResult> {
  let response: Response;
  try {
    response = await fetch("/api/generate/result", {
      headers: { [IDEMPOTENCY_HEADER]: key },
      cache: "no-store",
    });
  } catch {
    return { status: "error" };
  }
  if (response.status === 404) return { status: "missing" };
  if (response.status === 409) return { status: "running" };
  if (!response.ok) return { status: "error" };
  const payload = (await response.json().catch(() => null)) as
    | { kind?: GenerationKind; value?: unknown; jobText?: string }
    | null;
  if (!payload || !payload.kind || payload.value === undefined) return { status: "error" };
  return { status: "done", kind: payload.kind, value: payload.value, jobText: payload.jobText };
}

/**
 * A failure after which the server may still have finished — and kept — the
 * result: the connection dropped, the stream ended without its last frame, or
 * the server answered 409 because this very key is still being generated. An
 * error the server itself sent back for any other reason is not one of them:
 * it had nothing to keep.
 */
export function isRecoverableFailure(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return false;
  if (error instanceof ApiError) {
    return (
      error.status === 0 ||
      error.status === 409 ||
      (error.status === 502 && /se cortó/.test(error.message))
    );
  }
  // A body stream that breaks mid-read rejects with a plain TypeError.
  return error instanceof TypeError;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs a generation; if the connection fails in a way the server may have
 * survived, asks for the result by key before giving up — for a while, if the
 * server says it is still working on it. Returns the result either way it came.
 * Throws the original error when nothing could be recovered.
 */
export async function generateWithRecovery<T>(
  run: () => Promise<T>,
  key: string,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isRecoverableFailure(error)) throw error;
    const attempts = options.attempts ?? 10;
    const delayMs = options.delayMs ?? 2000;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const recovered = await fetchGenerationResult(key);
      if (recovered.status === "done") return recovered.value as T;
      if (recovered.status !== "running") break;
      await sleep(delayMs);
    }
    throw error;
  }
}
