"use client";

import { callGenerator } from "@/lib/api/client";
import { buildEvidenceIndex, type EvidenceIndex } from "@/lib/ai/evidence";
import type { CondenseHint, CondenseItem } from "@/lib/ai/prompts/condense-cv";
import {
  applyCondensed,
  classifyFitUnits,
  type CondensedLine,
  type FitAnalysis,
  type FitUnit,
} from "@/lib/cv/fit";
import { guardRewrite, summaryStillAllowed } from "@/lib/cv/condense-guard";
import type { CvLayout } from "@/components/cv/measure";
import type { CVDocument } from "@/lib/schemas/cv";
import type { Profile } from "@/lib/schemas/profile";

/**
 * The Etapa 2 client: which lines are worth shortening, the one call that asks
 * for it, and the guard that decides what may be applied.
 *
 * Nothing here is reached unless the page overflowed, the person brought their
 * own key and the session has not spent its one call (to-do §7) — the flow is
 * orchestrated by `lib/applications/fit.ts`, which knows the session. This module
 * is the part that talks to the model and trusts none of what comes back: every
 * rewrite passes `guardRewrite`, and the summary also has to leave the document's
 * own rules standing.
 */

/**
 * How many lines may be asked for in one call. Small on purpose: it is one
 * request over lines that are already written, and a page rarely overflows by
 * more than a few lines.
 */
export const MAX_CONDENSE_ITEMS = 12;

/**
 * Below this, a bullet's last line is short enough that cutting a few words wins
 * a whole line — the cheapest edit on the page, and the one this stage is for.
 */
export const SHORT_TAIL_RATIO = 0.55;

/**
 * What a line is asked to give up: 20 % when a short tail makes a whole line
 * reachable, 10 % for the long ones, where the win is usually a line gained two
 * rewrites later.
 */
const TAIL_TARGET = 0.8;
const LONG_TARGET = 0.9;

/** The schema's own ceilings for a bullet (400) and for the summary (600). */
const BULLET_CEILING = 400;
const SUMMARY_CEILING = 600;

/** Under this, a line is not worth a rewrite: there is nothing in it to cut. */
const MIN_CHARS = 45;

/**
 * About how many characters one line of the CV holds at 11pt over the printable
 * width. Used only to decide whether the summary is worth a rewrite; the real
 * measurement is what decides whether the page fits.
 */
const SUMMARY_LINE_CHARS = 105;

export type CondenseTarget = CondenseItem;

/** T0 → 0, … T5 → 5: the tier's own number, for ordering. */
const tierOf = (unit: FitUnit): number => Number.parseInt(unit.tier.slice(1), 10);

/** The longest a rewrite may be: the target cut, never longer than what it replaces. */
function ceiling(text: string, target: number, max: number): number {
  const length = text.trim().length;
  return Math.max(1, Math.min(max, length - 1, Math.round(length * target)));
}

/**
 * The lines worth shortening, best candidates first (§7).
 *
 * Three groups, in this order:
 *
 *  1. bullets whose last line is nearly empty — the tail is a few words, so
 *     cutting them wins a whole line, and the most valuable ones go first
 *     because those are the lines the ladder would otherwise reach for;
 *  2. the longest lines of the cheapest categories, quantified ones included:
 *     shortening a line that states a figure is always better than letting the
 *     `relaxed`/`extreme` ladder take it;
 *  3. the summary, and only past one line — the most visible thing on the page.
 *
 * The one thing never shortened is the only evidence of an excluding requirement
 * (`T5`): that line is a fact about whether the person can take the job at all,
 * and the design spends it last and with consent. It is also the line whose
 * compression nobody could check.
 */
export function condenseTargets(
  cv: CVDocument,
  options: { layout: CvLayout; units: readonly FitUnit[]; linesToGain: number },
): CondenseTarget[] {
  const { layout, units } = options;
  const wanted = Math.max(1, Math.min(MAX_CONDENSE_ITEMS, options.linesToGain));

  const lines = units.filter((unit) => unit.kind === "bullet" || unit.kind === "skill");
  const ranked = lines.flatMap((unit, index) => {
    if (unit.tier === "T5") return [];
    const text = unit.text.trim();
    if (text.length < MIN_CHARS) return [];

    const tail = layout.bullets[index]?.tailRatio ?? 1;
    const shortTail = tail > 0 && tail <= SHORT_TAIL_RATIO;
    const quantified = tierOf(unit) >= 4;
    const group = shortTail ? 0 : quantified ? 2 : 1;
    // Inside the first group the most valuable line wins its line back; inside the
    // others the cheapest editorial cost comes first, which is the low tier.
    const within = shortTail ? -tierOf(unit) : tierOf(unit);

    return [
      {
        group,
        within,
        length: text.length,
        target: {
          id: unit.id,
          text,
          hint: (shortTail ? "short-tail" : "long-line") satisfies CondenseHint,
          maxChars: ceiling(text, shortTail ? TAIL_TARGET : LONG_TARGET, BULLET_CEILING),
        } satisfies CondenseTarget,
      },
    ];
  });

  ranked.sort(
    (a, b) =>
      a.group - b.group ||
      a.within - b.within ||
      b.length - a.length ||
      a.target.id.localeCompare(b.target.id),
  );

  const chosen: CondenseTarget[] = ranked.slice(0, wanted).map((entry) => entry.target);

  const summary = cv.summary.trim();
  if (summary.length > SUMMARY_LINE_CHARS && chosen.length < MAX_CONDENSE_ITEMS) {
    chosen.push({
      id: "sum",
      text: summary,
      hint: "summary",
      maxChars: ceiling(summary, LONG_TARGET, SUMMARY_CEILING),
    });
  }

  return chosen;
}

/**
 * Asks the person's own model for shorter versions of those lines and returns the
 * ones that may be applied.
 *
 * Answers `[]` for everything that is not a usable list of rewrites — no key, a
 * 403, a provider failure, a timeout, a body that does not parse — because this
 * step is an improvement on the deterministic fit and never a reason to stop it.
 * The call is made once and not retried: whoever asked has one attempt to spend
 * (to-do §4).
 */
export async function condenseCv(
  cv: CVDocument,
  options: {
    layout: CvLayout;
    language: string;
    linesToGain: number;
    profile: Profile;
    analysis?: FitAnalysis;
    signal?: AbortSignal;
  },
): Promise<CondensedLine[]> {
  const units = classifyFitUnits(cv, options.analysis);
  const targets = condenseTargets(cv, {
    layout: options.layout,
    units,
    linesToGain: options.linesToGain,
  });
  if (targets.length === 0) return [];

  const index: EvidenceIndex = buildEvidenceIndex(options.profile);
  const byId = new Map(targets.map((target) => [target.id, target]));

  let rewrites: Array<{ id: string; text: string }>;
  try {
    const answer = await callGenerator<{ rewrites?: Array<{ id?: unknown; text?: unknown }> }>(
      "/api/generate/condense",
      { language: options.language, items: targets },
      options.signal,
    );
    rewrites = (answer.rewrites ?? []).flatMap((rewrite) =>
      typeof rewrite.id === "string" && typeof rewrite.text === "string"
        ? [{ id: rewrite.id, text: rewrite.text }]
        : [],
    );
  } catch {
    // No key, a 403, a provider that failed, a network that dropped: all of them
    // mean the same thing here — carry on without shortening.
    return [];
  }

  const accepted: CondensedLine[] = [];
  for (const rewrite of rewrites) {
    const target = byId.get(rewrite.id);
    if (!target) continue;
    const verdict = guardRewrite({
      original: target.text,
      rewrite: rewrite.text,
      language: options.language,
      maxChars: target.maxChars,
      profile: index,
    });
    if (!verdict.ok) continue;
    accepted.push({
      id: target.id,
      before: target.text,
      after: rewrite.text.trim(),
      needsReview: verdict.needsReview,
    });
  }

  // The summary has rules of its own, and they are read on the document: a
  // rewrite that introduces one is dropped, and the rest of the lines stay.
  const summary = accepted.find((line) => line.id === "sum");
  if (summary) {
    const candidate = applyCondensed(cv, accepted);
    if (!summaryStillAllowed(cv, candidate, options.profile)) {
      return accepted.filter((line) => line.id !== "sum");
    }
  }

  return accepted;
}
