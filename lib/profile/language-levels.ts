import type { CefrLevel } from "@/lib/schemas/profile-v2";
import { normalizeForComparison } from "@/lib/text/normalize";

/**
 * A language's level in the words people use for it, with the European framework's code beside as a help.
 *
 * "B2" is not how most people say how much English they have: in a trade, a small shop or a first job nobody was ever
 * graded against the framework, and a chip that asks for a code is asking about the framework, not about the person.
 * So the chips say the word and carry the code, small, for those who know it, and a note says the match is
 * approximate — "Avanzado" means C1 to a school and something else to the person who learned it on the job.
 *
 * A pick stores both, in the shape a level read from a document already has (`languageLevelFrom`): `raw` is what was
 * said — here, the phrase on the chip that was tapped — and `cefr` is its reading. The words are only ever offered
 * for the person to pick: a document's "Avanzado" stays "Avanzado" and is not turned into C1, because nobody said C1.
 *
 * Pure, so the vocabulary is tested apart from the screens that show it.
 */

const WORD: Record<CefrLevel, string> = {
  A1: "Principiante",
  A2: "Básico",
  B1: "Intermedio",
  B2: "Intermedio alto",
  C1: "Avanzado",
  C2: "Casi nativo",
  native: "Nativo",
};

/** "Avanzado": the word a level goes by. */
export const levelWord = (level: CefrLevel): string => WORD[level];

/** "C1", or nothing for "Nativo", which is not a step on the framework's scale. */
export const levelCode = (level: CefrLevel): string | undefined => (level === "native" ? undefined : level);

/** "Avanzado (C1)": the word with its code, as a plain line where there is no room for a small one. */
export function levelPhrase(level: CefrLevel): string {
  const code = levelCode(level);
  return code ? `${WORD[level]} (${code})` : WORD[level];
}

/** What picking a level stores: its code, and the phrase the person saw and tapped. */
export function pickedLevel(level: CefrLevel): { cefr: CefrLevel; raw: string } {
  return { cefr: level, raw: levelPhrase(level) };
}

/**
 * Whether a text says the level a pick stored — its word, its code, or both as the chip did. A document that says
 * "Avanzado" after the person tapped "Avanzado" says the same thing, and is not a disagreement to settle.
 */
export function namesLevel(level: CefrLevel, text: string): boolean {
  const said = normalizeForComparison(text);
  return [levelWord(level), level, levelPhrase(level)].some((candidate) => normalizeForComparison(candidate) === said);
}

/** Under the chips: the framework's letters are a reference, not a grade. */
export const LEVEL_NOTE = "Elegí el que más se parezca a lo que podés hacer. El código chico es el del marco europeo (A1 a C2) y la equivalencia es aproximada.";
