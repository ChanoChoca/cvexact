"use client";

import { useBillingStatus } from "@/lib/api/billing";
import { useSettings } from "@/lib/storage/hooks";
import type { BillingStatus } from "@/lib/api/billing";

/**
 * Whether the assistant on this screen will work, said before it is used.
 *
 * It can fail for a few unrelated reasons — this installation has no key of its
 * own, this is the `free` tier (which never had one to begin with), the
 * credits are gone — and until now these were discovered the same way: write a
 * paragraph, send it, wait, read a 400. This is the same information, ahead of
 * the effort.
 *
 * Two sources have to be crossed to know, and nothing crossed them before.
 * Whether the *user* brought a key lives in the browser (`useSettings`), and
 * whether the *service* has one, plus the tier and any credit balance, lives on
 * the server (`useBillingStatus`). Either one alone gives the wrong answer for
 * half the cases.
 */

export type AiTone = "ok" | "warn" | "bad";

export type AiAvailability = {
  tone: AiTone;
  /** Short enough for one line of the rail. Always starts with "IA" — see below. */
  message: string;
  /** Whether there is something in Ajustes that would change this. */
  actionable: boolean;
  /** Whether the text an AI action sends goes to the person's own configured provider, rather than the service's. */
  byok: boolean;
};

/**
 * The decision, with no React around it.
 *
 * Separated from the hook so `tests/ai-availability.test.ts` can drive all six
 * outcomes without a renderer or a fake `localStorage`.
 *
 * Every message opens with "IA" deliberately. `BalanceIndicator` already sits
 * in the nav reporting the *generation* budget, which is a different counter
 * with a different number (`SEPARATE_BUDGET` in `lib/quota.ts`); without the
 * prefix, two unrelated figures on one screen both read as "your quota".
 */
export function aiAvailability(input: {
  /** The user has at least one usable key of their own. */
  byok: boolean;
  /** Null while the server has not answered. */
  status: BillingStatus | null;
}): AiAvailability | null {
  const { byok, status } = input;

  // A key of our own beats everything and needs no server answer: the request
  // never touches our budget, so there is nothing to be out of.
  if (byok) {
    return { tone: "ok", message: "IA con tu key · sin límite", actionable: false, byok: true };
  }

  // Say nothing rather than guess. A wrong answer here is worse than a late
  // one, and the row appears a few hundred milliseconds later.
  if (!status) return null;

  if (status.tier === "byok") {
    return { tone: "ok", message: "IA con tu key · sin límite", actionable: false, byok: true };
  }

  // `free` never draws on the service key at all, and the counter can be full
  // for `pro`/`credits` while the capability behind it is still absent — both
  // read the same to whoever is looking at this row: nothing to spend here,
  // and a free fix in Ajustes. There is no trial balance to count down any more.
  if (status.tier === "free" || !status.serviceConfigured) {
    return {
      tone: "bad",
      message: "Sin IA disponible · poné tu key en Ajustes",
      actionable: true,
      byok: false,
    };
  }

  if (status.tier === "pro") {
    return { tone: "ok", message: "IA incluida en tu suscripción", actionable: false, byok: false };
  }

  return {
    tone: "ok",
    message: `IA · te quedan ${status.credits} créditos`,
    actionable: false,
    byok: false,
  };
}

export function useAiAvailability(): AiAvailability | null {
  const settings = useSettings();
  // `intake` rather than the default `cv`: help with the profile is metered
  // against its own row, so asking about `cv` would report the wrong budget.
  const { status } = useBillingStatus("intake");

  // The same condition `SettingsEditor` calls `usingOwnKey`.
  const byok = settings.entries.some((entry) => entry.provider && entry.apiKey.trim());

  return aiAvailability({ byok, status });
}
