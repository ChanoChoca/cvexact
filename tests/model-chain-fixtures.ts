import type { LanguageModel } from "ai";
import type { ModelChain, ModelChoice } from "@/lib/ai/provider";
import type { ProviderId } from "@/lib/ai/provider-catalog";

/**
 * Chains built around mock models, for the tests that exercise `generate`.
 *
 * A `ModelChoice` carries eight fields and only two of them matter to any given
 * test; spelling out the other six at every call site is how a default drifts
 * apart between files that are meant to be testing the same thing.
 */
export function testCandidate(
  model: LanguageModel,
  overrides: Partial<ModelChoice> = {},
): ModelChoice {
  const provider: ProviderId = overrides.provider ?? "google";
  const modelId = overrides.modelId ?? "mock";
  return {
    model,
    describe: `${provider} · ${modelId}`,
    // Distinct per candidate, so a chain of mocks behaves like a real one: the
    // cooldown and the request-scoped `failed` set are both keyed by this.
    cooldownKey: `${provider} ${modelId} test`,
    provider,
    modelId,
    reasoningCapable: false,
    looseJsonSchema: false,
    budget: {},
    ...overrides,
  };
}

export function testChain(...candidates: ModelChoice[]): ModelChain {
  return {
    candidates,
    used: candidates[0],
    failed: new Set(),
    switches: [],
    // Far enough out that the request budget never fires by accident. The tests
    // that are *about* the deadline set their own.
    deadlineAt: Date.now() + 600_000,
  };
}

/** The common case: one mock model, no fallback. */
export function singleTestChain(
  model: LanguageModel,
  overrides: Partial<ModelChoice> = {},
): ModelChain {
  return testChain(testCandidate(model, overrides));
}
