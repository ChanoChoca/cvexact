import { splitSentences } from "@/lib/text/sentences";

/**
 * An answer, as the facts it says — with nothing added and nothing rewritten.
 *
 * Without a model this is all there is: one fact per sentence, each a piece of
 * what was typed, in the order it was typed. With one, an answer can be split
 * finer ("Google Ads y Meta, el SEO de la web…" into its parts), but never
 * reworded — and either way what is kept is what the person wrote.
 */

/** Longest a fact can be; the schema truncates past it and this splits before that happens. */
const MAX_FACT = 600;

const BULLET = /^\s*(?:[•●▪◦‣⁃·*]|[-–—]\s|\d{1,2}[.)]\s)\s*/u;

export function splitAnswer(answer: string): string[] {
  const facts: string[] = [];
  // Lines first — a list typed as lines is a list — then sentences within each.
  for (const line of answer.split(/\n+/)) {
    const text = line.replace(BULLET, "").trim();
    if (!text) continue;
    for (const sentence of splitSentences(text)) {
      const clean = sentence.trim();
      if (clean.length < 2) continue;
      if (clean.length <= MAX_FACT) facts.push(clean);
      else facts.push(...cutLong(clean));
    }
  }
  return facts;
}

/** A sentence longer than a fact can be is cut at the last space that fits, and only then. */
function cutLong(sentence: string): string[] {
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_FACT) {
    const at = rest.lastIndexOf(" ", MAX_FACT);
    const cut = at > MAX_FACT / 2 ? at : MAX_FACT;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}
