import { normalizeForComparison } from "@/lib/text/normalize";

/**
 * How alike two short texts are, from 0 to 1: the Dice coefficient over
 * character trigrams.
 *
 * Trigrams rather than words because the question it answers is "did the user
 * edit this line or replace it?" — a fixed typo, a plural, a word added at the
 * end must all read as the same line, and word overlap calls "sprint" and
 * "sprints" different. Case, accents and punctuation are folded first for the
 * same reason.
 */
export function similarity(a: string, b: string): number {
  const x = normalizeForComparison(a);
  const y = normalizeForComparison(b);
  if (x === y) return 1;
  if (!x || !y) return 0;
  const left = trigrams(x);
  const right = trigrams(y);
  let shared = 0;
  for (const [gram, count] of left) {
    shared += Math.min(count, right.get(gram) ?? 0);
  }
  return (2 * shared) / (sumValues(left) + sumValues(right));
}

function trigrams(text: string): Map<string, number> {
  // Padded so that a two-letter word still yields a gram.
  const padded = ` ${text} `;
  const grams = new Map<string, number>();
  for (let i = 0; i <= padded.length - 3; i++) {
    const gram = padded.slice(i, i + 3);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

function sumValues(map: Map<string, number>): number {
  let total = 0;
  for (const value of map.values()) total += value;
  return total;
}

/**
 * Pairs the entries of two lists that are the same thing in a different state.
 *
 * Exact matches are paired first, in order, so a list with duplicates keeps its
 * duplicates apart. What is left is paired greedily by similarity, best first,
 * and only above `threshold`; the rest come back unpaired, which is how a caller
 * tells "edited" from "removed and added".
 *
 * `positional` is for lists edited in place, one box per entry: when exactly as
 * many entries are left over on each side, the count did not change, so each
 * left-over is the edit of the one in the same place — whatever it now says. A
 * line rewritten from scratch passes through states that resemble nothing before
 * it ("D", "Di", "Dis"…), and judging those by likeness would call every pause
 * in typing a removal and an addition.
 */
export function pairBySimilarity(
  before: readonly string[],
  after: readonly string[],
  threshold: number,
  options: { positional?: boolean } = {},
): { pairs: Array<[number, number]>; removed: number[]; added: number[] } {
  const pairs: Array<[number, number]> = [];
  const usedBefore = new Set<number>();
  const usedAfter = new Set<number>();

  for (let j = 0; j < after.length; j++) {
    const i = before.findIndex((text, index) => !usedBefore.has(index) && text === after[j]);
    if (i === -1) continue;
    pairs.push([i, j]);
    usedBefore.add(i);
    usedAfter.add(j);
  }

  if (options.positional) {
    const leftBefore = before.map((_, i) => i).filter((i) => !usedBefore.has(i));
    const leftAfter = after.map((_, j) => j).filter((j) => !usedAfter.has(j));
    if (leftBefore.length > 0 && leftBefore.length === leftAfter.length) {
      leftBefore.forEach((i, n) => pairs.push([i, leftAfter[n]!]));
      return { pairs, removed: [], added: [] };
    }
  }

  const candidates: Array<{ i: number; j: number; score: number }> = [];
  for (let i = 0; i < before.length; i++) {
    if (usedBefore.has(i)) continue;
    for (let j = 0; j < after.length; j++) {
      if (usedAfter.has(j)) continue;
      const score = similarity(before[i]!, after[j]!);
      if (score >= threshold) candidates.push({ i, j, score });
    }
  }
  candidates.sort((p, q) => q.score - p.score || p.i - q.i || p.j - q.j);
  for (const { i, j } of candidates) {
    if (usedBefore.has(i) || usedAfter.has(j)) continue;
    pairs.push([i, j]);
    usedBefore.add(i);
    usedAfter.add(j);
  }

  return {
    pairs,
    removed: before.map((_, i) => i).filter((i) => !usedBefore.has(i)),
    added: after.map((_, j) => j).filter((j) => !usedAfter.has(j)),
  };
}
