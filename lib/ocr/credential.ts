/**
 * What a photo of a credential says that is worth keeping (e5, O18; O7): the class of a driving licence and the day it lapses — and nothing else.
 *
 * The text an OCR makes of a licence has everything on the card in it: a name, a document number, an address, a date of birth, a blood group and a will to
 * donate organs (Ley 24.449 puts the last two on it). Health is a sensitive datum that nobody is obliged to give (Ley 25.326, arts. 2 and 7), and the CV needs
 * none of it. So this takes out the two things the profile has a place for — the class, and the date it holds until — and returns only those: the text itself
 * is not returned, not shown, not logged and not kept by anything that calls this, and a date near the words of a birth or of an issue is not a date it lapses.
 *
 * What an OCR reads is a guess, and the person looks at what was found before anything is kept: these are candidates for them to confirm, in a box they can change.
 * Pure, and tried against what an OCR makes of a card: letters for digits, spaces where there are none, the word and its date on different lines.
 */

export type Expiry = {
  year: number;
  month: number;
  day?: number;
  /** Whether it came after a word that says it lapses (`vence`, `vto`, `válido hasta`), or was only a date in the photo. */
  after: "vence" | "otra";
};

export type Found = {
  /** The classes of the licence, as the card prints them — «B.1», «D2» — most likely first. */
  classes: string[];
  /** The dates it may lapse on: the ones that say so first, then the rest. */
  expiries: Expiry[];
};

/** What an OCR takes a digit for, inside something that is made of digits: the letter O, and the stroke of an «l», an «I» or a bar. */
const FIX_DIGITS: Record<string, string> = { O: "0", o: "0", Q: "0", l: "1", I: "1", "|": "1" };
const fixDigits = (token: string): string => token.replace(/[OoQlI|]/g, (char) => FIX_DIGITS[char] ?? char);

const DIGITISH = "[0-9OoQlI|]";
const SEP = "\\s*[\\/.\\-–]\\s*";
const NOT_PART = "(?<![\\p{L}\\p{N}])";
const NOT_FOLLOWED = "(?![\\p{L}\\p{N}])";
/** A year of this century or the last, with the same mistakes let in: «2O29» is 2029. */
const YEAR_START = "(?:[1lI|]9|2[0OoQ])";
const FULL = new RegExp(`${NOT_PART}(${DIGITISH}{1,2})${SEP}(${DIGITISH}{1,2})${SEP}(${YEAR_START}${DIGITISH}{2})${NOT_FOLLOWED}`, "gu");
// A month and a year alone is only this century: «11/1990» is somebody's birth, not the day a licence lapses.
const MONTH_YEAR = new RegExp(`(?<![\\p{L}\\p{N}\\/.\\-])(${DIGITISH}{1,2})${SEP}(2[0OoQ]${DIGITISH}{2})${NOT_FOLLOWED}(?![\\/.\\-]\\d)`, "gu");

/** The words before a date that say what it is. */
const LAPSES = /venc|vto|v\.?\s?to\b|valid|hasta|vigen/i;
const NOT_THAT = /nac(?:im|\b|\.)|f\.?\s?nac|otorg|emis|emit|exped|impres|alta\b|desde|1\W?(?:era|er|ra)(?!\p{L})|primer/iu;

const BEFORE = 30;

type Written = { at: number; end: number; day: string | undefined; month: string; year: string };

/** Everything in the text that is written like a date, in the order of the photo. */
function datesIn(text: string): Written[] {
  const dates: Written[] = [];
  for (const match of text.matchAll(FULL)) dates.push({ at: match.index!, end: match.index! + match[0].length, day: match[1], month: match[2]!, year: match[3]! });
  const whole = dates.map((date) => [date.at, date.end] as const);
  for (const match of text.matchAll(MONTH_YEAR)) {
    const at = match.index!;
    // «05 / 2029» inside a «12 / 05 / 2029» is the same date, not another one.
    if (!whole.some(([from, to]) => at >= from && at < to)) dates.push({ at, end: at + match[0].length, day: undefined, month: match[1]!, year: match[2]! });
  }
  return dates.sort((a, b) => a.at - b.at);
}

function expiriesIn(text: string): Expiry[] {
  const found: Expiry[] = [];
  let previousEnd = 0;
  for (const date of datesIn(text)) {
    // What says what a date is comes just before it and after the date before: the «vence» of one is not the word of the next.
    const context = text.slice(Math.max(previousEnd, date.at - BEFORE), date.at);
    previousEnd = date.end;
    const y = Number(fixDigits(date.year));
    const m = Number(fixDigits(date.month));
    const d = date.day === undefined ? undefined : Number(fixDigits(date.day));
    if (!(y >= 1990 && y <= 2100) || !(m >= 1 && m <= 12) || (d !== undefined && !(d >= 1 && d <= 31))) continue;
    // A date of birth, the day it was issued or the day it starts is a date on the card and is not the day it lapses.
    if (NOT_THAT.test(context) && !LAPSES.test(context.slice(context.search(NOT_THAT)))) continue;
    found.push({ year: y, month: m, ...(d !== undefined ? { day: d } : {}), after: LAPSES.test(context) ? "vence" : "otra" });
  }
  // The ones that say they lapse go first, each group in the order of the photo, and a month is there once: the one that says it lapses.
  const ordered = [...found.filter((entry) => entry.after === "vence"), ...found.filter((entry) => entry.after === "otra")];
  const unique: Expiry[] = [];
  for (const entry of ordered) {
    if (!unique.some((other) => other.year === entry.year && other.month === entry.month)) unique.push(entry);
  }
  return unique.slice(0, 4);
}

const CLASS_LABEL = /clases?\b|clas\.|categor[ií]as?|cat\./gi;
/** A class as the card prints it: a letter from A to G and, usually, a number or two — «B», «B1», «B.1», «A.2.1». The stroke of a «1» is read as a letter often enough to be let in. */
const CLASS_AT_START = /^(?:([A-G])|([a-g])(?=\s?\.?\s?[1-4lI|]))(?:\s?\.?\s?([1-4lI|])(?:\s?\.?\s?([1-4lI|]))?)?(?![\p{L}\p{N}])/u;

/** How a class was printed, in its letter and its digits: the spaces an OCR puts between the characters taken out, and a stroke read as a letter put back as a «1». */
const printedClass = (token: string): string => {
  const compact = token.replace(/\s+/g, "");
  return compact[0]!.toUpperCase() + compact.slice(1).replace(/[lI|]/g, "1");
};

function classesIn(text: string): string[] {
  const classes: string[] = [];
  for (const label of text.matchAll(CLASS_LABEL)) {
    // What follows the word that says «clase»: the classes, one after another, and then something else — on its line or, when the card was read in lines of its
    // own, on the next one.
    const [sameLine = "", ...nextLines] = text.slice(label.index! + label[0].length).split(/\r?\n/);
    const line = sameLine.replace(/^[\s:.\-–]+/, "") === "" ? (nextLines.find((candidate) => candidate.trim() !== "") ?? "") : sameLine;
    let rest = line.replace(/^[\s:.\-–]+/, "");
    let first = true;
    while (classes.length < 4) {
      const match = CLASS_AT_START.exec(rest);
      if (!match) break;
      // A letter with no number is a class only first in the list, or after a comma: the «A» in «B1 A LA» is the word.
      if (match[3] === undefined && !first) break;
      const printed = printedClass(match[0]);
      if (!classes.includes(printed)) classes.push(printed);
      const separator = /^[\s,;/&\-–]+/.exec(rest.slice(match[0].length))?.[0] ?? "";
      rest = rest.slice(match[0].length + separator.length);
      first = /[,;/&]/.test(separator);
    }
  }
  return classes.slice(0, 4);
}

/** The class and the dates that may be its expiry, from what an OCR read of the photo. Nothing else of the text comes out. */
export function readCredential(text: string): Found {
  return { classes: classesIn(text), expiries: expiriesIn(text) };
}

/**
 * The date to show chosen before the person looks, if any: the one that says it lapses when only one does, or the only one there is. With several to choose from,
 * none — a guess there is a wrong date in somebody's profile, and a few taps are cheaper than finding it later.
 */
export function likelyExpiry(found: Found): Expiry | null {
  const says = found.expiries.filter((entry) => entry.after === "vence");
  if (says.length === 1) return says[0]!;
  if (says.length === 0 && found.expiries.length === 1) return found.expiries[0]!;
  return null;
}

/** The classes as they go in the box for the licence: «A.2.1, B.1». */
export const classesText = (found: Found): string => found.classes.join(", ");

/** An expiry as a person reads it on the card: month and year — the day is not something the profile keeps. */
export const expiryLabel = (expiry: Pick<Expiry, "year" | "month">): string => `${String(expiry.month).padStart(2, "0")}/${expiry.year}`;
