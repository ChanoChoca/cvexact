import { PERSONAL_DATA_LABELS } from "./dictionaries";
import { splitOnSeparators } from "./patterns";
import { classifyHeading } from "./sections";

/**
 * What the product promises not to read, taken out wherever the text would otherwise go: to a model, or into the copy of the
 * document kept in the browser.
 *
 * The details are a birth date, a document number, a marital status and the like (`PERSONAL_DATA_LABELS`), and a whole section of
 * references, which holds other people's. The deterministic reader never read them into the profile and struck them out of its
 * copy of the document; the ways of reading that go through a model, and the LinkedIn reader, kept the lines as they were, and
 * sent them. The same rule now applies in all of them, because a promise not to read something is a promise about where it goes
 * as well: and the model does not need them — it is told not to emit them (`EXTRACT_SYSTEM`).
 *
 * Line by line, and the lines do not move: a blank line stays blank and every other line keeps its place, so that the text a model
 * is checked against is exactly the text it was sent, and a span of lines still means the same lines in the copy that is kept.
 *
 * Recognised by the label a detail comes with, which is what a reader can know: "Fecha de nacimiento: 12/05/1990" is struck out
 * whole, and so is the line under a label that stands alone (a table's cell of a label, with its value under it). A date or a
 * number with no label before it is not guessed at.
 */

/** What stands where a personal detail was. */
export const REDACTED = "▒▒▒ dato personal omitido ▒▒▒";

/** Whether a text is, or holds, the mark that stands where a detail was: there is nothing in it to read, so nothing to keep. */
export const isStruckOut = (text: string): boolean => text.includes(REDACTED) || /dato personal omitido/i.test(text);

/** Whether a text opens with the label of one of the details. */
export const isPersonalData = (text: string): boolean => {
  const trimmed = text.trim();
  return PERSONAL_DATA_LABELS.some((pattern) => pattern.test(trimmed));
};

/** Whether a line says one of the details — by its label, alone or in any of the parts a separator cuts it into. */
const saysPersonalData = (line: string): boolean => isPersonalData(line) || splitOnSeparators(line).some((part) => isPersonalData(part));

/** A label with nothing after it, but for the punctuation that came with it: its value is somewhere else. */
function isBareLabel(line: string): boolean {
  const trimmed = line.trim();
  for (const pattern of PERSONAL_DATA_LABELS) {
    const match = pattern.exec(trimmed);
    if (match) return /^[\s:：.\-–—]*$/.test(trimmed.slice(match[0].length));
  }
  return false;
}

/** How far under a label that stands alone its value can be, and how long a line can be to be one. */
const VALUE_REACH = 2;
const VALUE_LENGTH = 80;

/**
 * Which of `texts` are struck out: a line that says one of the details, the value under a label that stands alone, and
 * whatever `inReferences` says is in the references section — but not a blank line, which has nothing to strike.
 */
function struckOut(texts: readonly string[], inReferences: (at: number) => boolean): boolean[] {
  const struck = texts.map((text, at) => text.trim() !== "" && (inReferences(at) || saysPersonalData(text)));
  texts.forEach((text, at) => {
    if (!struck[at] || !isBareLabel(text)) return;
    for (let next = at + 1; next < texts.length && next <= at + VALUE_REACH; next += 1) {
      const candidate = texts[next]!.trim();
      if (candidate === "") continue;
      // A heading is the next thing, not this label's value; so is a line long enough to be a sentence.
      if (classifyHeading(candidate) === null && candidate.length <= VALUE_LENGTH) struck[next] = true;
      break;
    }
  });
  return struck;
}

/** `lines` as the copy the review shows: a personal detail, and any line of `referenceLines` (by `index`), struck out. */
export function redactLines(lines: ReadonlyArray<{ text: string; index: number }>, referenceLines: ReadonlySet<number> = new Set()): string[] {
  const struck = struckOut(
    lines.map((line) => line.text),
    (at) => referenceLines.has(lines[at]!.index),
  );
  return lines.map((line, at) => (struck[at] ? REDACTED : line.text));
}

/**
 * A text as it may go to a model and be kept: a personal detail struck out, and everything under a heading of references up to
 * the next heading. `omitted` counts what was left out, for the review to say so as it does for the deterministic reader: each
 * detail once, and a references section once.
 */
export function redactPersonalData(text: string): { text: string; omitted: number } {
  const texts = text.split("\n");
  // Which lines are under a heading of references, up to the next heading.
  const underReferences: boolean[] = [];
  let inReferences = false;
  for (const line of texts) {
    const heading = classifyHeading(line);
    if (heading !== null) inReferences = heading === "references";
    underReferences.push(heading === null && inReferences);
  }
  const struck = struckOut(texts, (at) => underReferences[at]!);
  let omitted = 0;
  const lines = texts.map((line, at) => {
    if (!struck[at]) return line;
    // A references section is one thing left out, however many lines it had.
    if (!underReferences[at] || !underReferences[at - 1]) omitted += 1;
    return REDACTED;
  });
  return { text: lines.join("\n"), omitted };
}
