/**
 * Dates as the profile stores them: a year, optionally a month, and the text
 * they were read from.
 *
 * Deliberately not `parseProfileDate` (`lib/ai/evidence.ts`). That one answers
 * "roughly when, for arithmetic" and so gives a bare "2019" the month of
 * January — right for counting years of experience, wrong for a stored value:
 * a profile that says "enero 2019" where the user said "2019" has invented a
 * month, and every later screen shows it with the authority of a fact. Here a
 * year with no month stays a year, and anything that is not unmistakably a date
 * is kept as the text it was, not guessed at.
 */

export type DateValue = {
  year?: number;
  month?: number;
  /** The text as it was written. Kept while the value is untouched; see `formatDateValue`. */
  raw?: string;
};

export type EndDateValue = DateValue & { current?: boolean };

export type DatePrecision = "month" | "year" | "none";

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

/**
 * Month names and the abbreviations people actually type, Spanish and English,
 * already stripped of accents and dots. Whole tokens only — "mar" is March, but
 * "marketing" is not a date.
 */
const MONTH_TOKENS: Record<string, number> = {
  enero: 1, ene: 1, january: 1, jan: 1,
  febrero: 2, feb: 2, february: 2,
  marzo: 3, mar: 3, march: 3,
  abril: 4, abr: 4, april: 4, apr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6, june: 6,
  julio: 7, jul: 7, july: 7,
  agosto: 8, ago: 8, august: 8, aug: 8,
  septiembre: 9, setiembre: 9, sep: 9, sept: 9, set: 9, september: 9,
  octubre: 10, oct: 10, october: 10,
  noviembre: 11, nov: 11, november: 11,
  diciembre: 12, dic: 12, december: 12, dec: 12,
};

/** Words that mean "still going" where an end date would be. */
const CURRENT_TOKENS = new Set([
  "presente",
  "actual",
  "actualidad",
  "la actualidad",
  "actualmente",
  "el presente",
  "la fecha",
  "hoy en dia",
  "hoy",
  "ahora",
  "present",
  "current",
  "now",
  "a la fecha",
  "al presente",
  "en curso",
  "to date",
  "hasta la fecha",
  "hasta hoy",
  "hasta el presente",
]);

export const MONTH_NAMES_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

const MONTH_SHORT_ES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

const MONTH_ALTERNATION = Object.keys(MONTH_TOKENS)
  .sort((a, b) => b.length - a.length)
  .join("|");

/** Lowercased, accent-free, with dots and commas dropped and spaces collapsed. */
function tidy(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const inYearRange = (year: number) => year >= MIN_YEAR && year <= MAX_YEAR;
const inMonthRange = (month: number) => month >= 1 && month <= 12;

export type DateParse =
  | { kind: "date"; year: number; month?: number }
  | { kind: "current" }
  | { kind: "unknown" };

/**
 * Reads one date. Accepts what is unambiguous and refuses the rest.
 *
 * "Marzo 2021", "mar. 2021", "March 2021", "sept de 2018", "03/2019", "3-2019",
 * "2019-03" and "2019" are dates. "19", "2019-2021" (a range, not a date),
 * "Verano 2019" and "hace 3 años" are not: they come back `unknown` and the
 * caller keeps the text.
 */
export function parseDateText(text: string): DateParse {
  const t = tidy(text);
  if (!t) return { kind: "unknown" };
  if (CURRENT_TOKENS.has(t)) return { kind: "current" };

  let match = t.match(/^(\d{4})$/);
  if (match) {
    const year = Number(match[1]);
    return inYearRange(year) ? { kind: "date", year } : { kind: "unknown" };
  }

  match = t.match(/^(\d{1,2})\s*[/\-]\s*(\d{4})$/);
  if (match) {
    const month = Number(match[1]);
    const year = Number(match[2]);
    return inMonthRange(month) && inYearRange(year)
      ? { kind: "date", year, month }
      : { kind: "unknown" };
  }

  match = t.match(/^(\d{4})\s*[/\-]\s*(\d{1,2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    return inMonthRange(month) && inYearRange(year)
      ? { kind: "date", year, month }
      : { kind: "unknown" };
  }

  // "05 Sep 2023": the day is dropped, the month and year are kept.
  match = t.match(new RegExp(`^\\d{1,2} (?:de )?(${MONTH_ALTERNATION}) (?:de )?(\\d{4})$`));
  if (match) {
    const month = MONTH_TOKENS[match[1]!];
    const year = Number(match[2]);
    return month && inYearRange(year) ? { kind: "date", year, month } : { kind: "unknown" };
  }

  match = t.match(new RegExp(`^(${MONTH_ALTERNATION})(?: (?:de|del|of))* (\\d{4})$`));
  if (match) {
    const month = MONTH_TOKENS[match[1]!];
    const year = Number(match[2]);
    return month && inYearRange(year) ? { kind: "date", year, month } : { kind: "unknown" };
  }

  return { kind: "unknown" };
}

/**
 * A stored date from the text a person typed or a document held.
 *
 * `raw` is always the text as given, whether or not it parsed: it is the
 * literal evidence, and it is what the profile keeps showing until someone
 * edits the date with the picker. An empty string is "no date", not a date
 * whose text is empty.
 */
export function toDateValue(text: string): EndDateValue {
  const raw = text.trim();
  if (!raw) return {};
  const parsed = parseDateText(raw);
  if (parsed.kind === "date") {
    return { year: parsed.year, ...(parsed.month ? { month: parsed.month } : {}), raw };
  }
  // A "current" word in an end field is the flag, and stays readable as text.
  if (parsed.kind === "current") return { raw, current: true };
  return { raw };
}

/** An end date read as a plain date: the `current` flag is the checkbox's, not the text's. */
export function withoutCurrent(value: EndDateValue): DateValue {
  const rest = { ...value };
  delete rest.current;
  return rest;
}

export function datePrecision(value: DateValue | undefined): DatePrecision {
  if (!value || value.year === undefined) return "none";
  return value.month === undefined ? "year" : "month";
}

export const hasDate = (value: DateValue | undefined): boolean =>
  datePrecision(value) !== "none";

/**
 * How a date reads on screen and in the plain profile the generators get.
 *
 * The literal text wins while it is there, so a profile written before dates
 * had structure keeps producing exactly the strings it always did. A date set
 * from the picker has no text and is written the way the app's own examples
 * are: "Marzo 2021", or just "2021".
 */
export function formatDateValue(value: DateValue | undefined): string {
  if (!value) return "";
  if (value.raw) return value.raw;
  if (value.year === undefined) return "";
  if (value.month === undefined) return String(value.year);
  return `${MONTH_NAMES_ES[value.month - 1]} ${value.year}`;
}

const MONTH_WORDS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"] as const;

/**
 * A date as a sentence says it: «marzo de 2021», or «2021» when that is all there is. Not the text it was read from: a sentence
 * that names a date names what the profile holds, with its month if it has one and without inventing it if it does not.
 */
export function spelledDate(value: DateValue | undefined): string {
  if (!value || value.year === undefined) return "";
  return value.month === undefined ? String(value.year) : `${MONTH_WORDS_ES[value.month - 1]} de ${value.year}`;
}

/** The short form for tight rows: "mar 2021", "2021". */
export function formatDateShort(value: DateValue | undefined): string {
  if (!value || value.year === undefined) return value?.raw ?? "";
  if (value.month === undefined) return String(value.year);
  return `${MONTH_SHORT_ES[value.month - 1]} ${value.year}`;
}

/** "2021-03" or "2021", the stable form for comparing and for sorting. */
export function dateKey(value: DateValue | undefined): string | null {
  if (!value || value.year === undefined) return null;
  return value.month === undefined
    ? String(value.year)
    : `${value.year}-${String(value.month).padStart(2, "0")}`;
}

/**
 * A position on the calendar in months, for ordering and gap arithmetic.
 *
 * A bare year is placed at its first month. That is a convention for sorting,
 * not a claim about the date, and it never leaves this function: nothing stored
 * or shown is derived from it.
 */
export function monthIndex(value: DateValue | undefined): number | null {
  if (!value || value.year === undefined) return null;
  return value.year * 12 + ((value.month ?? 1) - 1);
}

/**
 * The months a date can be, as far as it says: a bare year is any of its
 * twelve. Shared between the gap-detection engine and the cross-source merge,
 * which both need to ask "do these two spans of time overlap" without either
 * one owning the concept.
 */
export type Bounds = { min: number; max: number };

export function boundsOf(value: DateValue | undefined): Bounds | null {
  if (!value || value.year === undefined) return null;
  return { min: value.year * 12 + ((value.month ?? 1) - 1), max: value.year * 12 + ((value.month ?? 12) - 1) };
}

/** The picker's own output: no `raw`, since nothing was written. */
export function dateFromParts(year: number | undefined, month?: number): DateValue {
  if (year === undefined || !inYearRange(year)) return {};
  return month !== undefined && inMonthRange(month) ? { year, month } : { year };
}

export function sameDate(a: DateValue | undefined, b: DateValue | undefined): boolean {
  return (
    (a?.year ?? null) === (b?.year ?? null) &&
    (a?.month ?? null) === (b?.month ?? null) &&
    (a?.raw ?? null) === (b?.raw ?? null)
  );
}
