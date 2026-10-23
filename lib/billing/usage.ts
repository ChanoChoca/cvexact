import "server-only";

import { sql } from "drizzle-orm";
import { databaseConfigured, getDb, schema } from "@/lib/db";
import type { GenerationTelemetry } from "@/lib/ai/pipeline";
import type { Action, Tier } from "@/lib/quota";

/**
 * What the models actually cost, rolled up.
 *
 * This exists to answer one question: what does a complete application cost to
 * produce. Every number in the pricing — how many credits a pack holds, what a
 * pack is worth, `pro`'s daily cap — is a guess until this has run for a while,
 * so it is deliberately the first thing wired up rather than the last.
 *
 * Aggregated on `(day, action, tier, provider, model)` rather than logged per
 * generation. The totals are the same, the table is bounded by the number of
 * combinations instead of by traffic, and it holds nothing that points at a
 * person — no subject, no user id, no content. A per-generation log would carry
 * a timeline of one user's activity and answer no additional question.
 */
export async function recordUsage(input: {
  action: Action;
  tier: Tier;
  provider: string;
  modelId: string;
  telemetry?: GenerationTelemetry;
}): Promise<void> {
  if (!databaseConfigured) return;

  const { telemetry } = input;

  try {
    await getDb()
      .insert(schema.generationUsage)
      .values({
        day: new Date().toISOString().slice(0, 10),
        action: input.action,
        tier: input.tier,
        provider: input.provider,
        modelId: input.modelId,
        calls: 1,
        inputTokens: telemetry?.inputTokens ?? 0,
        outputTokens: telemetry?.outputTokens ?? 0,
        reasoningTokens: telemetry?.reasoningTokens ?? 0,
        repairs: telemetry?.repaired ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: [
          schema.generationUsage.day,
          schema.generationUsage.action,
          schema.generationUsage.tier,
          schema.generationUsage.provider,
          schema.generationUsage.modelId,
        ],
        set: {
          calls: sql`${schema.generationUsage.calls} + 1`,
          inputTokens: sql`${schema.generationUsage.inputTokens} + ${telemetry?.inputTokens ?? 0}`,
          outputTokens: sql`${schema.generationUsage.outputTokens} + ${telemetry?.outputTokens ?? 0}`,
          reasoningTokens: sql`${schema.generationUsage.reasoningTokens} + ${telemetry?.reasoningTokens ?? 0}`,
          repairs: sql`${schema.generationUsage.repairs} + ${telemetry?.repaired ? 1 : 0}`,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    // Accounting must never cost a user their generation. They already have
    // their document by the time this runs.
    console.error(
      "[usage] failed to record:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
