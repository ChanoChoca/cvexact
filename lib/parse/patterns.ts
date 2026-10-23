import { toDateValue, withoutCurrent, type DateValue, type EndDateValue } from "@/lib/profile/dates";
import {
  COUNTRIES,
  CITY_PARTICLES,
  EMPLOYMENT_TYPE_WORDS,
  KNOWN_CITIES,
  WORK_MODE_WORDS,
  fold,
} from "./dictionaries";

/**
 * Recognising the small things a CV is made of: an email, a phone number, a
 * link, a date range, a bullet, a place. Each one returns what it found and the
 * text it found it in, or nothing — a pattern that is not sure says so.
 */

// --- Contact -------------------------------------------------------------------------

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

export function findEmail(text: string): string | null {
  return text.match(EMAIL)?.[0] ?? null;
}

/** Every email address in a text, as written. */
export function findEmails(text: string): string[] {
  return text.match(new RegExp(EMAIL.source, "g")) ?? [];
}

/**
 * A phone number, when the text is plausibly one: 8 to 15 digits, a leading `+`
 * or a separator, and not a pair of years ("2019 - 2021" has eight digits too).
 * Only ever looked for in the header of a CV and in labelled lines — never in
 * the body, where dates and figures look the same.
 */
export function findPhone(text: string): string | null {
  return findPhones(text)[0] ?? null;
}

/** Every number in a text that is plausibly a phone — see `findPhone` for what plausibly is. */
export function findPhones(text: string): string[] {
  const stripped = text.replace(EMAIL, " ");
  const candidates = stripped.match(/\+?\(?\d[\d\s().-]{6,}\d/g) ?? [];
  return candidates.flatMap((candidate) => {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return [];
    if (/^\s*(?:19|20)\d{2}\s*[-–—/]\s*(?:19|20)\d{2}\s*$/.test(candidate)) return [];
    if (/^\s*(?:0?[1-9]|1[0-2])\s*[/-]\s*(?:19|20)\d{2}\s*$/.test(candidate)) return [];
    return [candidate.trim()];
  });
}

const KNOWN_LINK_HOSTS =
  /^(?:www\.)?(?:linkedin\.com|github\.com|gitlab\.com|bitbucket\.org|behance\.net|dribbble\.com|twitter\.com|x\.com|medium\.com|stackoverflow\.com|kaggle\.com|instagram\.com|facebook\.com|youtube\.com|notion\.site|linktr\.ee|codepen\.io|dev\.to)\b/i;

const BARE_DOMAIN = /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|dev|io|co|me|app|ar|es|mx|cl|uy|pe|br|eu|info|xyz|site|tech|design|ai|cloud|page)(?:\/\S*)?$/i;

/** Whether a link is a profile on a site where people keep one — LinkedIn, GitHub, Behance… — and so says who they are. */
export const isProfileLink = (url: string): boolean => KNOWN_LINK_HOSTS.test(url.replace(/^https?:\/\//i, ""));

/** The label that opens a line of contact details: «Email:», «Tel.:», «LinkedIn:». */
export const CONTACT_LABEL = /^(?:e-?mail|correo(?: electr[oó]nico)?|tel[eé]fono|tel\.?|cel(?:ular)?\.?|m[oó]vil|mobile|phone|whatsapp|web|sitio(?: web)?|linkedin|github|portfolio|portafolio)\s*[:：-]\s*/i;

/** Links in a piece of text: full URLs, `www.` ones, and the bare domains people list on a CV. */
export function findUrls(text: string): string[] {
  const withoutEmails = text.replace(EMAIL, " ");
  const found: string[] = [];
  for (const raw of withoutEmails.split(/[\s,;|]+/)) {
    const token = raw.replace(/^[(<[]+|[)>\].,;:]+$/g, "");
    if (!token || token.length < 4) continue;
    if (/^https?:\/\//i.test(token) || /^www\./i.test(token) || KNOWN_LINK_HOSTS.test(token) || BARE_DOMAIN.test(token)) {
      if (!found.includes(token)) found.push(token);
    }
  }
  return found;
}

/** A link's label is what a reader sees: the address without its scheme. */
export function linkLabel(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

// --- Bullets and layout -----------------------------------------------------------------

const BULLET = /^\s*(?:[•●▪◦‣⁃·■□✓✔➢➤►▶*]|[-–—]\s|\d{1,2}[.)]\s)\s*/u;

export function stripBullet(text: string): { bullet: boolean; text: string } {
  const match = text.match(BULLET);
  if (!match) return { bullet: false, text: text.trim() };
  return { bullet: true, text: text.slice(match[0].length).trim() };
}

/**
 * Splits a line on the separators CVs put between items on one line: dashes with
 * spaces around them, pipes, bullets, middle dots. A hyphen with no spaces is
 * part of a word ("Jean-Luc"), and only a spaced one separates.
 */
export function splitOnSeparators(text: string): string[] {
  return text
    .split(/\s+[|•·]\s+|\s+[—–-]\s+|\s{3,}|\t/)
    .map((part) => part.trim())
    .filter(Boolean);
}

// --- Dates -----------------------------------------------------------------------------------

const MONTHS =
  "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|" +
  "january|february|march|april|june|july|august|september|october|november|december|" +
  "ene|feb|mar|abr|may|jun|jul|ago|sept|sep|set|oct|nov|dic|jan|apr|aug|dec";

const DATE_TOKEN =
  `(?:(?:${MONTHS})\\.?(?:\\s+(?:de|del|of))?\\s+\\d{4}` +
  `|\\d{1,2}\\s*[/.-]\\s*\\d{4}` +
  `|\\d{4}\\s*[/.-]\\s*\\d{1,2}(?!\\d)` +
  `|\\d{4}(?!\\d))`;

const PRESENT_TOKEN =
  "(?:(?:la\\s+)?actualidad|actualmente|actual|(?:el\\s+)?presente|hoy|ahora|present|current|now|en curso|(?:la\\s+)?fecha|to date|hoy en d[ií]a)";

const RANGE_SEPARATOR = "\\s*(?:[-–—]|→|\\bto\\b|\\ba\\b|\\bal\\b|\\bhasta\\b|\\buntil\\b|\\bthrough\\b)\\s*";

const RANGE = new RegExp(
  `(?:\\b(?:desde|from|since|de)\\s+)?(${DATE_TOKEN})${RANGE_SEPARATOR}(${DATE_TOKEN}|${PRESENT_TOKEN}\\b)`,
  "i",
);

const SINGLE_DATE_AT_END = new RegExp(`(?:^|[\\s(·,—–-])(${DATE_TOKEN})\\)?\\s*$`, "i");

const DURATION = /\(?\s*\d+\s+(?:años?|years?|yrs?|meses|mes|months?|mos?)(?:\s+(?:y\s+)?\d+\s+(?:años?|years?|yrs?|meses|mes|months?|mos?))?\s*\)?/i;

export type DateRangeMatch = {
  start: Quoted;
  end: Quoted<EndDateValue>;
  /** The text matched, as written, duration included. */
  quote: string;
  /** What is left of the line once the range and any duration are taken out. */
  rest: string;
};
type Quoted<T = DateValue> = { value: T; quote: string };

/**
 * A date range anywhere in a line: "Marzo 2021 – Actualidad", "03/2019 - 08/2021",
 * "2019 a 2021", "Since 2020", with an optional "(3 años 6 meses)" after it.
 *
 * A range whose parts are not both readable dates or a "still going" word is
 * not a range: two years with a dash between them is one (an education entry
 * says "2013 - 2017"), two numbers is not.
 */
export function extractDateRange(text: string): DateRangeMatch | null {
  const match = RANGE.exec(text);
  if (!match) return null;
  const [whole, from, to] = match as unknown as [string, string, string];

  // The lookbehind a regex cannot do: an "a" or "de" prefix must not eat the tail
  // of a word ("Analista 2019 - 2021" must not read the "a" of Analista).
  const before = text[match.index - 1];
  if (before && /[\p{L}\d]/u.test(before)) return null;

  const start = toDateValue(from);
  if (start.year === undefined) return null;
  const endValue = toDateValue(to);
  if (endValue.year === undefined && !endValue.current) return null;

  let end = match.index + whole.length;
  const duration = DURATION.exec(text.slice(end));
  if (duration && duration.index <= 2) end += duration.index + duration[0].length;

  const startOnly = withoutCurrent(start);
  let head = text.slice(0, match.index);
  let tail = text.slice(end);
  // A range in parentheses leaves the pair behind once it is taken out.
  if (/\(\s*$/.test(head) && /^\s*\)/.test(tail)) {
    head = head.replace(/\(\s*$/, "");
    tail = tail.replace(/^\s*\)/, "");
  }
  return {
    start: { value: startOnly, quote: from.trim() },
    end: { value: endValue, quote: to.trim() },
    quote: text.slice(match.index, end).trim(),
    rest: `${head} ${tail}`.replace(/\s+/g, " ").replace(/^[\s|·,—–-]+|[\s|·,—–-]+$/g, "").trim(),
  };
}

/** One date at the end of a line — a graduation year, a certification's date. */
export function extractTrailingDate(text: string): { value: DateValue; quote: string; rest: string } | null {
  const match = SINGLE_DATE_AT_END.exec(text);
  if (!match) return null;
  const token = match[1]!;
  const value = toDateValue(token);
  if (value.year === undefined) return null;
  const start = match.index + match[0].indexOf(token);
  const date = withoutCurrent(value);
  return {
    value: date,
    quote: token.trim(),
    rest: text
      .slice(0, start)
      .replace(/[\s|·,—–(-]+$/g, "")
      .trim(),
  };
}

/** "3 años 6 meses" on a line of its own: how long, not when. */
export function isDurationOnly(text: string): boolean {
  const match = DURATION.exec(text);
  return Boolean(match) && match![0].trim().length >= text.trim().length - 1;
}

export function stripDuration(text: string): string {
  return text.replace(DURATION, " ").replace(/\s+/g, " ").trim();
}

// --- Places ----------------------------------------------------------------------------------

export function isCountry(text: string): boolean {
  return COUNTRIES.has(fold(text).replace(/[.]/g, "").replace(/\s+/g, " ").trim());
}

const PLACE_WORD = "[\\p{Lu}][\\p{L}'’.-]*";
const PLACE_NAME = new RegExp(`^${PLACE_WORD}(?:\\s+(?:de|del|da|do|la|el)\\s+${PLACE_WORD}|\\s+${PLACE_WORD})*$`, "u");
const LINKERS = new Set(["de", "del", "da", "do"]);

/**
 * How many trailing words of `words` are a city: one, unless the city opens with
 * a particle ("San Isidro", "New Orleans", "Buenos Aires") or runs particle,
 * linker, name ("Ciudad de México", "Mar del Plata").
 */
function cityWordCount(words: readonly string[]): { count: number; known: boolean } {
  // A city this knows wins, longest first: "Buenos Aires" is two words and "Aires" is not a city.
  for (const take of [3, 2, 1]) {
    if (take <= words.length && KNOWN_CITIES.has(fold(words.slice(-take).join(" ")).replace(/[.]/g, ""))) {
      return { count: take, known: true };
    }
  }
  return { count: guessedCityWordCount(words), known: false };
}

function guessedCityWordCount(words: readonly string[]): number {
  const n = words.length;
  if (n >= 3 && LINKERS.has(fold(words[n - 2]!)) && CITY_PARTICLES.has(fold(words[n - 3]!))) return 3;
  if (n >= 2 && CITY_PARTICLES.has(fold(words[n - 2]!))) return 2;
  return 1;
}

/**
 * Where a line ends in a place: "Barcelona, España", "Buenos Aires, Argentina",
 * "Valencia, Comunidad Valenciana, España".
 *
 * Only when the last part is a country this knows — "Marketing, Ventas" is a
 * list, not a location. Anything before the place is `head`: "TechNova Barcelona,
 * España" is a company followed by a place, and a line that is only a place has
 * an empty `head`. Where the city starts inside `head` is a guess (one word, or
 * more after a particle), which is why callers that split a name from a place
 * mark the result as a doubt.
 */
export function splitTrailingPlace(
  text: string,
): { head: string; place: string; city: string; country: string; guessed: boolean } | null {
  const trimmed = text.trim();
  const parts = trimmed.split(/\s*,\s*/);
  if (parts.length < 2) return null;
  const country = parts[parts.length - 1]!.replace(/[.]$/, "").trim();
  if (!isCountry(country)) return null;

  // The city is the tail of the first comma-separated part; anything before it is head.
  const first = parts[0]!;
  const words = first.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const { count, known } = cityWordCount(words);
  const take = Math.min(count, words.length);
  const tail = new RegExp(`((?:\\S+\\s+){${take - 1}}\\S+)$`).exec(first);
  if (!tail) return null;
  const city = tail[1]!.replace(/\s+/g, " ");
  if (!PLACE_NAME.test(city)) return null;

  const cityIndex = tail.index;
  const head = first.slice(0, cityIndex).trim();
  return {
    head,
    place: trimmed.slice(cityIndex).trim(),
    city,
    country,
    // Nothing to guess when there is no head to split from, or the city is one this knows.
    guessed: head !== "" && !known,
  };
}

/** A line that is only a place. */
export function parsePlace(text: string): { city: string; country: string; quote: string } | null {
  const split = splitTrailingPlace(text);
  if (!split || split.head) return null;
  return { city: split.city, country: split.country, quote: text.trim() };
}

// --- Employment ------------------------------------------------------------------------------

export function findEmploymentType(text: string) {
  for (const [pattern, type] of EMPLOYMENT_TYPE_WORDS) {
    const match = pattern.exec(text);
    if (match) return { type, quote: match[0] };
  }
  return null;
}

export function findWorkMode(text: string) {
  for (const [pattern, mode] of WORK_MODE_WORDS) {
    const match = pattern.exec(text);
    if (match) return { mode, quote: match[0] };
  }
  return null;
}
