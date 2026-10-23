import { normalizeForComparison } from "@/lib/text/normalize";

/**
 * Whether a posting is what the person said they are after.
 *
 * The objective is a line in their own words — "Analista de marketing digital", "Diseño de producto" — and a posting's
 * title is a line in somebody else's: the two are compared by the words they share, folded for case and accents and
 * cut to their first five letters so "analista" meets "analistas" and "diseño" meets "diseñadora". It is a lexical
 * reading and says so: a posting titled in another language shares no word with it, which is why a title that shares
 * none is not held against the posting (it only adds to the score when it does share, never takes from it) and why the
 * note on `/postular` is worded as a difference to look at, not as a verdict.
 */

/** The little words that join the ones that say something. */
const FUNCTION_WORDS = new Set(["de", "la", "el", "en", "y", "a", "o", "un", "una", "los", "las", "del", "con", "por", "para", "the", "of", "and", "in", "at", "to", "for", "sr", "jr"]);

const stemsOf = (text: string): string[] => [
  ...new Set(
    normalizeForComparison(text)
      .split(" ")
      .filter((word) => word.length >= 2 && !FUNCTION_WORDS.has(word))
      .map((word) => word.slice(0, 5)),
  ),
];

/** How much of what the person is after the posting's title (or its own tags) says: 0 to 1, the share of the objective's words found. */
export function objectiveOverlap(objective: string, title: string, tags: readonly string[] = []): number {
  const wanted = stemsOf(objective);
  if (wanted.length === 0) return 0;
  const have = new Set(stemsOf([title, ...tags].join(" ")));
  return wanted.filter((stem) => have.has(stem)).length / wanted.length;
}

/** `unknown` when there is no objective or no title to compare it to; `match` when they share a word; `mismatch` when they share none. */
export type ObjectiveFit = "match" | "mismatch" | "unknown";

export function objectiveFit(objective: string, title: string, tags: readonly string[] = []): ObjectiveFit {
  if (!objective.trim() || !title.trim()) return "unknown";
  return objectiveOverlap(objective, title, tags) > 0 ? "match" : "mismatch";
}
