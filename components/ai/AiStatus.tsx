"use client";

import Link from "next/link";
import { cx } from "@/components/ui";
import { useAiAvailability, type AiTone } from "@/lib/ai/availability";

/**
 * Whether the assistant on this screen will work, on one line.
 *
 * Placed once per screen rather than under each control that uses a model: two
 * copies of "quedan 12" in one viewport is not twice as informative, it is
 * twice as loud.
 *
 * Unlike `BalanceIndicator`, which hides itself until the number is close to
 * running out, this one always speaks. The reason for the difference is what
 * the two answer: a balance is only worth reading when it is low, but "does
 * this work at all" has to be answerable before anyone writes a paragraph into
 * a box that might refuse it.
 */

const DOT: Record<AiTone, string> = {
  ok: "bg-oro-soft",
  warn: "bg-oro",
  bad: "bg-red-400",
};

const TEXT: Record<AiTone, string> = {
  ok: "text-ink-3",
  warn: "text-ink-3",
  bad: "text-red-300",
};

export function AiStatus({ className }: { className?: string }) {
  const availability = useAiAvailability();

  // Null while the server has not answered. Rendering a placeholder would put a
  // layout shift in the header of a form.
  if (!availability) return null;

  const { tone, message, actionable } = availability;

  const body = (
    <>
      <span aria-hidden className={cx("size-1.5 shrink-0", DOT[tone])} />
      {message}
    </>
  );

  const shared = cx(
    "inline-flex items-center gap-2 text-[11px] tracking-[0.02em]",
    TEXT[tone],
    className,
  );

  // The affordance is the point, and it is the same one `BalanceIndicator`
  // makes: a number is only useful beside the thing that changes it, and both
  // ways out — your own key, or credits — are in Ajustes.
  return actionable ? (
    <Link
      href="/ajustes"
      className={cx(shared, "transition-colors hover:text-ink motion-reduce:transition-none")}
    >
      {body}
    </Link>
  ) : (
    <span className={shared}>{body}</span>
  );
}
