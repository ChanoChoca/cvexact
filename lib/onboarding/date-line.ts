import { dateFromParts, formatDateValue, monthIndex, parseDateText, type DateValue } from "@/lib/profile/dates";
import { extractDateRange } from "@/lib/parse/patterns";
import { formatRange } from "@/lib/profile/timeline";

/**
 * Dates, written in one line: «mar 2020 – actualidad», «2018 – 2021», «desde marzo de 2019 hasta hoy».
 *
 * A stretch is four boxes — a month and a year, twice — and a person who knows when they worked at a place knows it as one
 * thing, in a line. The same reading the review already does for the dates found in what was said freely
 * (`extractDateRange`), turned around: the person writes, and what was read is shown back before anything is kept, in
 * words — «Marzo 2020 a hoy» — so that the one case a line can be read two ways costs a look and not a wrong date.
 *
 * What it will not do is guess. A line it cannot read says so and says what it would read; a lone date is not a stretch
 * unless it says «desde» (a year alone could be when something started or when it ended, and it is not for this to
 * choose); and it never fills in a month, a day or an end that was not written.
 */

export type DateLine = {
  from: DateValue;
  /** Empty when the stretch is still going, or when only the start was given. */
  to: DateValue;
  /** «actualidad», «hoy», «presente»: the stretch has no end yet. */
  current: boolean;
};

export type DateLineReading =
  | { kind: "empty" }
  /** `says`: what was read, in words, to show before it is kept. */
  | { kind: "read"; line: DateLine; says: string }
  /** `why` says what to change, in the words the field shows. */
  | { kind: "unclear"; why: string };

const NOT_DATES =
  "No pudimos leer las fechas. Escribilas con el mes y el año —mar 2020 – actualidad, 03/2018 – 05/2021— o solo los años: 2018 – 2021.";
const ONLY_DATES = "Escribí solo las fechas, sin otras palabras. Lo demás va en los otros campos.";
const BACKWARDS = "La fecha de fin es anterior a la de inicio.";
const ONE_DATE = "Falta la otra fecha. Escribí desde y hasta —mar 2020 – actualidad— o, si solo sabés cuándo empezó, «desde mar 2020».";

const OLDEST = 1950;
/** Far enough ahead for a study that has not finished: «hasta 2027». */
const YEARS_AHEAD = 10;

const plain = (value: DateValue): DateValue => (value.year === undefined ? {} : dateFromParts(value.year, value.month));

const lower = (text: string) => (text ? text.charAt(0).toLowerCase() + text.slice(1) : text);

/** «Marzo 2020 a hoy», «2018 a 2021», «Desde marzo 2019, sin fecha de fin»: what a line was read as. */
export function describeDateLine(line: DateLine): string {
  const from = formatDateValue(line.from);
  if (line.current) return `${from} a hoy`;
  const to = formatDateValue(line.to);
  return to ? `${from} a ${lower(to)}` : `Desde ${lower(from)}, sin fecha de fin`;
}

/** The line a stretch is written as, which reads back as the same stretch: «Marzo 2020 – Actualidad». */
export function lineOf(line: DateLine): string {
  if (line.from.year === undefined && line.to.year === undefined && !line.current) return "";
  return formatRange(line.from, line.current ? { current: true } : line.to);
}

/**
 * What a line says. `now` only bounds the years a person can mean: nothing before 1950, nothing more than ten years from
 * now.
 */
export function readDateLine(text: string, now: Date = new Date()): DateLineReading {
  const written = text.replace(/\s+/g, " ").trim();
  if (!written) return { kind: "empty" };

  const range = extractDateRange(written);
  if (range) {
    if (range.rest !== "") return { kind: "unclear", why: ONLY_DATES };
    const end = range.end.value;
    return check({ from: plain(range.start.value), to: end.current ? {} : plain(end), current: Boolean(end.current) }, now);
  }

  // Only the start, and only when it says so: a lone date is not a stretch, and which end it is is not ours to decide.
  const since = /^(?:desde|from|since)\s+(.+)$/i.exec(written);
  if (since) {
    const parsed = parseDateText(since[1]!);
    if (parsed.kind === "date") return check({ from: dateFromParts(parsed.year, parsed.month), to: {}, current: false }, now);
    return { kind: "unclear", why: NOT_DATES };
  }
  if (parseDateText(written).kind === "date") return { kind: "unclear", why: ONE_DATE };
  return { kind: "unclear", why: NOT_DATES };
}

function check(line: DateLine, now: Date): DateLineReading {
  const newest = now.getFullYear() + YEARS_AHEAD;
  for (const date of [line.from, line.to]) {
    if (date.year !== undefined && (date.year < OLDEST || date.year > newest)) {
      return { kind: "unclear", why: `El año ${date.year} no parece bien: tiene que estar entre ${OLDEST} y ${newest}.` };
    }
  }
  const start = monthIndex(line.from) ?? 0;
  const end = line.current ? Number.POSITIVE_INFINITY : (monthIndex(line.to) ?? Number.POSITIVE_INFINITY);
  // A year alone is read as its first month on both sides, so «2020 – 2020» is a year and not a mistake.
  if (end < start) return { kind: "unclear", why: BACKWARDS };
  return { kind: "read", line, says: describeDateLine(line) };
}
