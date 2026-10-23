import { z } from "zod";
import { bounded } from "@/lib/schemas/profile";

/**
 * The other AI extraction point the design calls for: separating one free-form
 * answer into the atomic facts it states.
 *
 * `lib/onboarding/split.ts` already does this without a model — one fact per
 * sentence — and stays the fallback. What a model adds is a finer cut: "Llevo
 * las campañas de Google Ads y Meta, el SEO de la web y preparo los informes"
 * is one sentence and four facts. It is never allowed to reword, though, which
 * is the whole reason this is checked rather than trusted: `lib/onboarding/ai.ts`
 * keeps a piece only when it is found, once whitespace and case are folded, as a
 * run of the original answer — so a model that "cleans up" a piece is the same
 * as a model that returns nothing for it, and the sentence-splitter fills the gap.
 */

export const splitSchema = z.object({
  /** Each piece, in the order it was said. Verified as a literal run of the answer — see the module comment. */
  pieces: z.array(bounded(600)).max(12).default([]),
});
export type SplitResult = z.infer<typeof splitSchema>;

/** Bumped whenever the schema or the instructions change what a cached response means. */
export const SPLIT_PROMPT_VERSION = 2;

export const SPLIT_SYSTEM = `
You are separating one thing a person said about their work into the individual
statements it contains. You are transcribing, not writing.

RULES:
- Every piece is a run of consecutive words taken verbatim from the answer — no
  synonyms, no reordering within a piece, no added or removed words. Copying a
  clause exactly and cutting it at a natural boundary (a comma, "y", "and") is
  correct; rephrasing it is not.
- Split only where the answer names more than one responsibility, tool or
  outcome. A single statement that merely runs long is one piece, not several.
- Preserve the order the person said things in.
- Never add a statement the person did not make, and never merge two distinct
  statements into a generality that is not in the text.
- If the answer is already one statement, return it as the only piece.
- Some details of the person may have been replaced by marks like [CORREO_1] or [ENLACE_1].
  A mark is part of the answer: copy it exactly, brackets and number included, wherever it
  falls in a piece.

Return JSON matching the schema exactly. No prose outside it.
`.trim();

export function buildSplitPrompt(answer: string): string {
  return `ANSWER (verbatim):\n"""\n${answer}\n"""`;
}
