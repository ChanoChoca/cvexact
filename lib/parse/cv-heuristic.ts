import { packSentences } from "@/lib/text/sentences";
import {
  COMPANY_STRONG,
  COMPANY_WEAK,
  DEGREE_WORDS,
  INSTITUTION_WORDS,
  LANGUAGE_LEVEL_WORDS,
  LANGUAGE_NAMES,
  ROLE_WORDS,
  fold,
  wordsOf,
} from "./dictionaries";
import { isFooter, layoutOf } from "./lines";
import {
  CONTACT_LABEL,
  extractDateRange,
  extractTrailingDate,
  findEmail,
  findEmploymentType,
  findPhone,
  findUrls,
  findWorkMode,
  isDurationOnly,
  linkLabel,
  parsePlace,
  splitOnSeparators,
  splitTrailingPlace,
  stripBullet,
  stripDuration,
  type DateRangeMatch,
} from "./patterns";
import { isPersonalData, redactLines } from "./redact";
import { classifyHeading, type SectionKind } from "./sections";
import {
  weakest,
  type Confidence,
  type Doubt,
  type Line,
  type ParsedCertification,
  type ParsedContact,
  type ParsedDocument,
  type ParsedEducation,
  type ParsedExperience,
  type ParsedLanguage,
  type ParsedPractical,
  type ParsedProject,
  type ParsedUnassigned,
  type Quoted,
} from "./types";
import { toDateValue, withoutCurrent, type DateValue, type EndDateValue } from "@/lib/profile/dates";
import { practicalFactFor, type PracticalFact } from "@/lib/profile/practical-facts";
import { toolsIn } from "@/lib/onboarding/tools";
import { linkKey } from "@/lib/schemas/profile";

/**
 * Reading a CV without a model.
 *
 * The document is cut into sections by their headings, and each section is read
 * by what it is made of: a date range anchors an entry in experience and in
 * education, and the lines around it — a company, a role, a place — are told
 * apart by the words in them, not by where they happen to sit, because CVs put
 * them in every order. When the words do not settle it, the entry is marked low
 * and keeps both candidates, so the review can ask instead of the parser
 * guessing quietly.
 *
 * Nothing here is written by the parser. Every value is a piece of a line of the
 * document, and comes back with the text it was cut from.
 */

export type Item = { line: Line; text: string; bullet: boolean };

export const itemsOf = (lines: readonly Line[]): Item[] =>
  lines.map((line) => {
    const { bullet, text } = stripBullet(line.text);
    return { line, text, bullet };
  });

const MAX_FACT = 600;

// --- What is a line? ---------------------------------------------------------------------

/** Short enough, and not a sentence, to be the name of something. */
function isHeaderShaped(item: Item): boolean {
  if (item.bullet) return false;
  const text = item.text;
  if (text.length > 90 || isDurationOnly(text)) return false;
  const words = text.split(/\s+/).length;
  if (words > 12) return false;
  if (/[.!?]$/.test(text) && words > 4 && !/\b(?:s\.?a\.?|s\.?r\.?l\.?|inc|ltd|corp|co)\.$/i.test(text)) return false;
  return true;
}

function roleWords(text: string): number {
  const seen = new Set<string>();
  for (const word of wordsOf(text)) if (ROLE_WORDS.has(word)) seen.add(word);
  return Math.min(2, seen.size);
}

function count(text: string, set: ReadonlySet<string>): number {
  const seen = new Set<string>();
  for (const word of wordsOf(text)) if (set.has(word)) seen.add(word);
  return seen.size;
}

/**
 * How much a line reads as a role (positive) or as an organisation (negative).
 * Weak company words count only when no role word is there to explain them:
 * "Software Engineer" is a role, "Software Colmena" is not.
 */
function roleScore(text: string): number {
  const role = roleWords(text);
  const strong = count(text, COMPANY_STRONG);
  const weak = role === 0 ? count(text, COMPANY_WEAK) : 0;
  return role - strong * 2 - weak * 0.5;
}

function institutionScore(text: string): number {
  // Positive: an institution; negative: a degree.
  const inst = count(text, INSTITUTION_WORDS);
  const degree = count(text, DEGREE_WORDS);
  return inst * 2 - degree;
}

const DOC_TITLES = /^(curr[ií]culum( vitae)?|cv|resume|résumé|hoja de vida|curriculo|currículo)$/i;

function looksLikeName(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 3 || trimmed.length > 60 || DOC_TITLES.test(trimmed)) return false;
  if (/[\d@/:]/.test(trimmed) || classifyHeading(trimmed)) return false;
  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 2 || tokens.length > 6) return false;
  const particles = /^(de|del|la|las|los|da|das|do|dos|di|van|von|y|e|bin|ibn|al|el)$/i;
  const valid = tokens.every((token) => particles.test(token) || /^[\p{Lu}][\p{L}'’.-]*$/u.test(token));
  return valid && roleWords(trimmed) === 0 && count(trimmed, COMPANY_STRONG) === 0;
}

// --- Sections -----------------------------------------------------------------------------

type Section = { kind: SectionKind; heading: string; lines: Line[] };

function splitSections(lines: readonly Line[]): { header: Line[]; sections: Section[] } {
  const header: Line[] = [];
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    const kind = classifyHeading(line.text);
    if (kind) {
      current = { kind, heading: line.text.trim(), lines: [] };
      sections.push(current);
    } else {
      (current ? current.lines : header).push(line);
    }
  }
  return { header, sections };
}

/** Blank lines between almost every line say nothing about which lines belong together. */
function gapsInformative(lines: readonly Line[]): boolean {
  if (lines.length < 4) return false;
  return lines.filter((line) => line.gapBefore).length / lines.length < 0.7;
}

const joinText = (lines: readonly Line[]) => lines.map((line) => line.text).join("\n");

// --- Contact ---------------------------------------------------------------------------------

const PLACE_LABEL = /^(?:ubicaci[oó]n|ciudad|location|localidad|residencia|reside en|vivo en|based in)\s*[:：]\s*/i;

type ContactResult = { contact: ParsedContact; leftovers: Line[]; omitted: number };

function readContactLines(lines: readonly Line[]): ContactResult {
  const contact: ParsedContact = { links: [] };
  const leftovers: Line[] = [];
  let omitted = 0;

  for (const line of lines) {
    if (isPersonalData(line.text)) {
      omitted += 1;
      continue;
    }
    const kept: string[] = [];
    for (const part of splitOnSeparators(line.text)) {
      if (isPersonalData(part)) {
        omitted += 1;
        continue;
      }
      const labelled = CONTACT_LABEL.test(part);
      const body = part.replace(CONTACT_LABEL, "").trim();

      const email = findEmail(body);
      if (email && !contact.email) {
        contact.email = { value: email, quote: part };
        continue;
      }
      if (email) continue;

      const urls = findUrls(body);
      if (urls.length > 0 && urls.join("").length >= body.replace(/\s+/g, "").length * 0.8) {
        for (const url of urls) {
          if (!contact.links.some((link) => linkKey(link.value.url) === linkKey(url))) {
            contact.links.push({ value: { label: linkLabel(url).slice(0, 60), url }, quote: url });
          }
        }
        continue;
      }

      const digitsOnly = /^[+()\d\s.-]+$/.test(body);
      if (labelled || digitsOnly) {
        const phone = findPhone(body);
        if (phone && !contact.phone) {
          contact.phone = { value: phone, quote: part };
          continue;
        }
      }

      if (PLACE_LABEL.test(part)) {
        const value = part.replace(PLACE_LABEL, "").trim();
        const place = parsePlace(value);
        if (place && !contact.city) {
          contact.city = { value: place.city, quote: part };
          contact.country = { value: place.country, quote: part };
        } else if (value && !contact.city) {
          contact.city = { value, quote: part };
        }
        continue;
      }
      const place = parsePlace(part);
      if (place && !contact.city) {
        contact.city = { value: place.city, quote: place.quote };
        contact.country = { value: place.country, quote: place.quote };
        continue;
      }
      kept.push(part);
    }
    if (kept.length > 0) leftovers.push({ ...line, text: kept.join("   ") });
  }
  return { contact, leftovers, omitted };
}

// --- Entries: what a date range anchors --------------------------------------------------------

type AnchorMatch = {
  range: DateRangeMatch | null;
  /** A single date, for an entry that has one and not two. */
  single: { value: DateValue; quote: string } | null;
  rest: string;
};

type Block = {
  header: Item[];
  anchor: Item;
  match: AnchorMatch;
  content: Item[];
  from: number;
  to: number;
};

/**
 * Whether two lines sit in the same visual row of the page — close enough in
 * `y` that a role and the date beside it, typeset a point or two off each
 * other's baseline (this app's own CV export among them: Chromium's line
 * boxes do this whenever the two sit in cells of different font weight), are
 * still one row and not two. `false` for anything not positioned (pasted
 * text, a Word file), where a "row" is just whatever `false` makes it: one
 * line at a time, same as before this existed.
 */
function sameRow(a: Line, b: Line): boolean {
  if (a.page !== b.page || a.y === undefined || b.y === undefined) return false;
  const size = Math.max(a.size ?? 10, b.size ?? 10);
  return Math.abs(a.y - b.y) < 0.5 * size;
}

/**
 * Cuts a section into entries at its date lines.
 *
 * Above each date line are the lines that name the entry, and below it what was
 * done; the trick is where one entry's description ends and the next one's name
 * begins, and what settles it is that a name is short and is not a sentence.
 * Where the layout separates entries with blank lines (a PDF), those gaps are a
 * boundary too; where every line has one (a Word file), they are ignored.
 *
 * The lookback budget is two *rows*, not two lines: a company set to the left
 * of its city, or a role to the left of its date, is one row split into two
 * `Line`s by the column-break in `linesFromRuns`, and counting it as two would
 * leave no budget for the row above it — the one actually naming the company.
 */
function findBlocks(
  items: Item[],
  anchorAt: (item: Item) => AnchorMatch | null,
  gaps: boolean,
): { blocks: Block[]; before: Item[] } {
  const anchors: Array<{ at: number; match: AnchorMatch }> = [];
  items.forEach((item, at) => {
    if (item.bullet || item.text.length > 140) return;
    const match = anchorAt(item);
    if (match && match.rest.length <= 90) anchors.push({ at, match });
  });
  if (anchors.length === 0) return { blocks: [], before: items };

  const starts = anchors.map(({ at }, k) => {
    const floor = k === 0 ? 0 : anchors[k - 1]!.at + 1;
    let start = at;
    let rows = 0;
    for (let j = at - 1; j >= floor && rows < 2; j--) {
      if (!isHeaderShaped(items[j]!)) break;
      // With informative gaps, a header is one block of lines with none between them.
      if (gaps && items.slice(j + 1, start + 1).some((next) => next.line.gapBefore)) break;
      // A line in the same row as what is already taken costs nothing against
      // the budget — it is the same name, split by a column, not another row.
      if (!sameRow(items[j]!.line, items[start]!.line)) rows += 1;
      start = j;
    }
    return start;
  });

  const blocks = anchors.map(({ at, match }, k) => {
    const end = k + 1 < anchors.length ? starts[k + 1]! : items.length;
    return {
      header: items.slice(starts[k]!, at),
      anchor: items[at]!,
      match,
      content: items.slice(at + 1, end),
      from: items[starts[k]!]!.line.index,
      to: items[Math.max(end - 1, at)]!.line.index,
    };
  });
  return { blocks, before: items.slice(0, starts[0]!) };
}

// --- Reading what names an entry -----------------------------------------------------------------

type Part = { text: string };

type HeaderRead = {
  parts: Part[];
  place: { city: string; country: string; quote: string } | null;
  employmentType: ReturnType<typeof findEmploymentType>;
  workMode: ReturnType<typeof findWorkMode>;
  guessedSplit: boolean;
};

const ONLY_EMPLOYMENT = /^(?:jornada completa|tiempo completo|full[- ]?time|media jornada|medio tiempo|part[- ]?time|freelance|aut[oó]nomo|contrato|contract|pr[aá]cticas?|pasant[ií]a|internship|voluntari[oa]do?|volunteer|remoto|remote|h[ií]brido|hybrid|presencial|on[- ]?site)$/i;

function readHeader(texts: readonly string[]): HeaderRead {
  const read: HeaderRead = { parts: [], place: null, employmentType: null, workMode: null, guessedSplit: false };
  for (const text of texts) {
    for (const piece of splitOnSeparators(stripDuration(text))) {
      const part = piece.trim();
      if (!part) continue;
      if (ONLY_EMPLOYMENT.test(part)) {
        read.employmentType ??= findEmploymentType(part);
        read.workMode ??= findWorkMode(part);
        continue;
      }
      const whole = parsePlace(part);
      if (whole && !read.place) {
        read.place = whole;
        continue;
      }
      const trailing = splitTrailingPlace(part);
      if (trailing && trailing.head && !read.place) {
        read.place = { city: trailing.city, country: trailing.country, quote: trailing.place };
        read.guessedSplit ||= trailing.guessed;
        read.parts.push({ text: trailing.head });
        continue;
      }
      read.parts.push({ text: part });
    }
  }
  return read;
}

type Assignment = {
  first?: Part;
  second?: Part;
  ambiguous: boolean;
  candidates?: string[];
};

/**
 * Which of two names is the role and which the organisation, by what is in them.
 * Returns roles first. Two lines that score alike are ambiguous, and stay so.
 */
function assignRoleAndCompany(parts: readonly Part[]): Assignment {
  if (parts.length === 0) return { ambiguous: false };
  if (parts.length === 1) {
    const only = parts[0]!;
    return roleScore(only.text) > 0 ? { first: only, ambiguous: false } : { second: only, ambiguous: false };
  }
  if (parts.length === 2) {
    const [a, b] = parts as [Part, Part];
    const diff = roleScore(a.text) - roleScore(b.text);
    if (diff >= 1) return { first: a, second: b, ambiguous: false };
    if (diff <= -1) return { first: b, second: a, ambiguous: false };
    return { first: b, second: a, ambiguous: true, candidates: [a.text, b.text] };
  }
  // More names than an entry has: keep the strongest role and the strongest
  // organisation, and say the rest were not placed.
  const ranked = [...parts].sort((x, y) => roleScore(y.text) - roleScore(x.text));
  const role = ranked[0]!;
  const company = ranked[ranked.length - 1]!;
  return {
    first: role,
    second: company,
    ambiguous: true,
    candidates: parts.map((part) => part.text),
  };
}

/**
 * Whether a role and an organisation, said in that order, are the right way round — by the words in
 * them, the way a document's own lines are read. `"swapped"` only when the words say so outright; two
 * names that score alike ("Cajero" and "Kiosco del Centro" against a dictionary that knows neither)
 * are `"unsure"`, which whoever asks is free to take as given.
 */
export function roleAndCompanyOrder(role: string, company: string): "ok" | "swapped" | "unsure" {
  const diff = roleScore(role) - roleScore(company);
  if (diff >= 1) return "ok";
  if (diff <= -1) return "swapped";
  return "unsure";
}

function quoted<T>(value: T, quote: string): Quoted<T> {
  return { value, quote };
}

// --- Facts -----------------------------------------------------------------------------------------

const TERMINAL = /[.!?;:…]$/;

/** A paragraph that is nothing but a URL — punctuation aside — is a link, not a sentence about the job. */
function urlOnly(text: string): string | null {
  const urls = findUrls(text);
  if (urls.length !== 1) return null;
  const without = text.replace(urls[0]!, "").trim();
  return /^[\s.,;:()-]*$/.test(without) ? urls[0]! : null;
}

/**
 * What is written under an entry, as statements — and, apart from those, any
 * paragraph that was only ever a URL ("https://flashpage.com.ar" under a job,
 * on its own line): not a thing the person did, so it is kept as `links`
 * instead of joining `facts` as an oddly-worded "achievement".
 *
 * A bullet is one statement; a paragraph is one; a line that wraps onto the next
 * is joined to it. A paragraph too long for a field is cut into sentences —
 * never inside one, unless one sentence alone is too long.
 */
export function factsFrom(items: readonly Item[], gaps: boolean): { facts: Quoted<string>[]; links: Quoted<string>[] } {
  const paragraphs: string[] = [];
  let current: string | null = null;
  const flush = () => {
    if (current !== null) paragraphs.push(current);
    current = null;
  };
  for (const item of items) {
    if (!item.text) continue;
    // Where blank lines mean something, a line with none above it may be the rest
    // of the line above. Where they do not (a Word file: a blank between every
    // paragraph), only a lower-case start says a line was broken mid-sentence.
    // Either way a line that ends a sentence ends the statement unless the next
    // starts in lower case: two sentences are two facts, which is the point of
    // facts, and cutting a wrapped paragraph at a full stop loses nothing.
    const lower = /^[a-záéíóúñü]/.test(item.text);
    const continues =
      current !== null &&
      !item.bullet &&
      (gaps ? !item.line.gapBefore : lower) &&
      (!TERMINAL.test(current) || lower);
    if (continues) {
      current = `${current} ${item.text}`;
    } else {
      flush();
      current = item.text;
    }
  }
  flush();

  const facts: Quoted<string>[] = [];
  const links: Quoted<string>[] = [];
  for (const paragraph of paragraphs) {
    const text = paragraph.replace(/\s+/g, " ").trim();
    if (text.length < 3) continue;
    const url = urlOnly(text);
    if (url) {
      links.push(quoted(url, text));
      continue;
    }
    for (const piece of text.length > MAX_FACT ? packSentences(text, MAX_FACT) : [text]) {
      facts.push(quoted(piece, piece));
    }
  }
  return { facts, links };
}

// --- Experience --------------------------------------------------------------------------------------

function experienceAnchor(item: Item): AnchorMatch | null {
  const range = extractDateRange(item.text);
  return range ? { range, single: null, rest: range.rest } : null;
}

function interpretExperience(
  block: Block,
  kind: "job" | "volunteer",
  gaps: boolean,
): { entry: ParsedExperience; links: Quoted<string>[] } {
  const range = block.match.range!;
  let header = block.header;
  let content = block.content;

  // A layout that puts the dates first and the names under them.
  if (header.length === 0 && !range.rest) {
    let n = 0;
    while (n < 2 && n < content.length && isHeaderShaped(content[n]!) && !(gaps && n > 0 && content[n]!.line.gapBefore)) n += 1;
    if (n > 0) {
      header = content.slice(0, n);
      content = content.slice(n);
    }
  }

  const read = readHeader([...header.map((item) => item.text), range.rest].filter(Boolean));
  const assignment = assignRoleAndCompany(read.parts);

  let place = read.place;
  let employmentType = read.employmentType;
  let workMode = read.workMode;

  // The line right under the dates is often where and how: "Valencia, España", "Jornada completa".
  const remaining = [...content];
  while (remaining.length > 0) {
    const first = remaining[0]!;
    if (first.bullet || first.text.length > 70) break;
    const asPlace = !place ? parsePlace(first.text) : null;
    if (asPlace) {
      place = asPlace;
      remaining.shift();
      continue;
    }
    if (ONLY_EMPLOYMENT.test(first.text)) {
      employmentType ??= findEmploymentType(first.text);
      workMode ??= findWorkMode(first.text);
      remaining.shift();
      continue;
    }
    break;
  }

  const doubts: Doubt[] = [];
  if (!assignment.second) doubts.push("no_company");
  if (!assignment.first) doubts.push("no_role");
  if (assignment.ambiguous) doubts.push("company_or_role");
  if (read.guessedSplit) doubts.push("location_guess");

  let confidence: Confidence = "high";
  if (assignment.ambiguous || (!assignment.first && !assignment.second)) confidence = "low";
  else if (!assignment.first || !assignment.second || read.guessedSplit) confidence = "medium";

  const { facts, links } = factsFrom(remaining, gaps);
  const entry: ParsedExperience = {
    kind,
    facts,
    confidence,
    doubts,
    span: [block.from, block.to],
  };
  if (assignment.second) entry.company = quoted(assignment.second.text, assignment.second.text);
  if (assignment.first) entry.role = quoted(assignment.first.text, assignment.first.text);
  if (assignment.candidates) entry.candidates = assignment.candidates;
  entry.start = { value: range.start.value, quote: range.start.quote };
  entry.end = { value: range.end.value, quote: range.end.quote };
  if (place) {
    entry.city = quoted(place.city, place.quote);
    entry.country = quoted(place.country, place.quote);
  }
  if (employmentType) entry.employmentType = quoted(employmentType.type, employmentType.quote);
  if (workMode) entry.workMode = quoted(workMode.mode, workMode.quote);
  if (kind === "volunteer" && !entry.employmentType) entry.employmentType = quoted("volunteer", "voluntariado");
  return { entry, links };
}

// --- Experience with nothing to cut it at -----------------------------------------------------------------

/**
 * One entry of an experience section that has no dates to cut it at, as far as the words go.
 *
 * What `parseCv` cannot do — a date range is what anchors an entry — this does for the sections that
 * name each job and say what was done in it, and never say when. It is a guess, and says so: the one
 * place it uses is a form the person completes and confirms, never a block that enters the profile.
 */
export type UndatedJob = {
  role?: string;
  company?: string;
  /** What the name's own line said of when — one year, or both ends of a range — and nothing it did not say. */
  start?: DateValue;
  end?: EndDateValue;
  tasks: string[];
  /** The words did not say which name is the role and which the organisation. */
  ambiguous: boolean;
};

/** The most tasks one entry is given: a section that turns out to be one long list is not a hundred of them. */
const MAX_UNDATED_TASKS = 12;

/**
 * "Cajero en Kiosco del Centro", "Analista @ Acme": a role, then where. Cut at the *last* one: a role has
 * an "en" in it far more often than a company does ("Técnico en electrónica en Radio Sur").
 */
const ROLE_AT_COMPANY = /^(.+)\s+(?:en|@|at)\s+(.+)$/i;

/**
 * A line that names an entry: short, and not ending the way a sentence does. With no date to tell it
 * from what was done, a short line that ends in a full stop is what was done.
 */
function isNameLine(item: Item): boolean {
  if (!isHeaderShaped(item)) return false;
  const text = item.text.trim();
  return !/[.;:…]$/.test(text) || /\b(?:s\.?a\.?|s\.?r\.?l\.?|inc|ltd|corp|co)\.$/i.test(text);
}

/** A name line that says both names at once, and so needs no line beside it to be an entry's name. */
function isWholeName(item: Item): boolean {
  if (!isNameLine(item)) return false;
  return splitOnSeparators(stripDuration(item.text)).length >= 2 || ROLE_AT_COMPANY.test(item.text);
}

/**
 * Where each entry starts. When some lines say both names at once, only those start one — whatever else
 * is short is something done there. Otherwise a name line that follows a task, or nothing, starts one,
 * and up to two lines in a row are the same entry's name (a role, then the company under it).
 */
function undatedBlocks(items: readonly Item[]): Array<{ name: Item[]; body: Item[] }> {
  const whole = items.some(isWholeName);
  const blocks: Array<{ name: Item[]; body: Item[] }> = [];
  for (const item of items) {
    const last = blocks[blocks.length - 1];
    if (whole) {
      if (isWholeName(item)) blocks.push({ name: [item], body: [] });
      else last?.body.push(item);
    } else if (isNameLine(item)) {
      if (last && last.body.length === 0 && last.name.length < 2) last.name.push(item);
      else blocks.push({ name: [item], body: [] });
    } else {
      last?.body.push(item);
    }
  }
  return blocks;
}

export function readUndatedJobs(lines: readonly Line[]): UndatedJob[] {
  const items = itemsOf(lines.filter((line) => line.text.trim() && !isFooter(line.text)));
  const jobs: UndatedJob[] = [];

  for (const block of undatedBlocks(items)) {
    // What a name line says of when is taken out of it first, so it is not read as part of a name.
    let start: DateValue | undefined;
    let end: EndDateValue | undefined;
    const texts = block.name
      .map((item) => {
        const range = extractDateRange(item.text);
        if (range) {
          start ??= range.start.value;
          end ??= range.end.value;
          return range.rest;
        }
        const single = extractTrailingDate(item.text);
        if (single) {
          start ??= single.value;
          return single.rest;
        }
        return item.text;
      })
      .filter(Boolean);
    if (texts.length === 0) continue;

    const roleAtCompany = texts.length === 1 && splitOnSeparators(stripDuration(texts[0]!)).length === 1 && ROLE_AT_COMPANY.test(texts[0]!);
    const read = readHeader(roleAtCompany ? [texts[0]!.replace(ROLE_AT_COMPANY, "$1 | $2")] : texts);
    const assignment = assignRoleAndCompany(read.parts);
    let role = assignment.first?.text;
    let company = assignment.second?.text;
    let ambiguous = assignment.ambiguous;
    if (roleAtCompany && ambiguous && read.parts.length === 2) {
      // "X en Y" is a role somewhere before it is anything else — unless the words say outright that it is not.
      role = read.parts[0]!.text;
      company = read.parts[1]!.text;
      ambiguous = false;
    }
    if (!role && !company) continue;

    const tasks = factsFrom(block.body, false)
      .facts.map((fact) => fact.value)
      .slice(0, MAX_UNDATED_TASKS);
    jobs.push({
      ...(role ? { role } : {}),
      ...(company ? { company } : {}),
      ...(start ? { start: withoutCurrent(start) } : {}),
      ...(end ? { end } : {}),
      tasks,
      ambiguous,
    });
  }
  return jobs;
}

// --- Education --------------------------------------------------------------------------------------------

const HONORS = /^(honores|honors?|menci[oó]n|distinci[oó]n|promedio|gpa|calificaci[oó]n|nota media|tesis|thesis|cum laude)\b\s*[:\-–]?\s*/i;
const IN_PROGRESS = /\b(en curso|cursando|actualmente|in progress|ongoing|expected|esperado|previsto|cursa)\b/i;
const INCOMPLETE = /\b(incompleto|incompleta|incomplete|sin finalizar|no finalizado|no finalizada|interrumpido|discontinued)\b/i;

function educationAnchor(item: Item): AnchorMatch | null {
  const range = extractDateRange(item.text);
  if (range) return { range, single: null, rest: range.rest };
  const trailing = extractTrailingDate(item.text);
  if (trailing) return { range: null, single: { value: trailing.value, quote: trailing.quote }, rest: trailing.rest };
  const leading = item.text.match(/^\(?((?:19|20)\d{2})\)?\s*[-–—:·|]?\s+(\S.*)$/);
  if (leading) {
    const date = withoutCurrent(toDateValue(leading[1]!));
    return { range: null, single: { value: date, quote: leading[1]! }, rest: leading[2]!.trim() };
  }
  return null;
}

function interpretEducation(block: Block): { entry: ParsedEducation; extra: string[] } {
  const { match } = block;
  let header = block.header;
  let content = block.content;
  if (header.length === 0 && !match.rest) {
    let n = 0;
    while (n < 2 && n < content.length && isHeaderShaped(content[n]!)) n += 1;
    header = content.slice(0, n);
    content = content.slice(n);
  }

  const read = readHeader([...header.map((item) => item.text), match.rest].filter(Boolean));
  let institution: Part | undefined;
  let degree: Part | undefined;
  let ambiguous = false;
  let candidates: string[] | undefined;

  const parts = read.parts;
  if (parts.length === 1) {
    const only = parts[0]!;
    if (institutionScore(only.text) > 0) institution = only;
    else degree = only;
  } else if (parts.length >= 2) {
    const ranked = [...parts].sort((x, y) => institutionScore(y.text) - institutionScore(x.text));
    const top = ranked[0]!;
    const bottom = ranked[ranked.length - 1]!;
    if (institutionScore(top.text) - institutionScore(bottom.text) >= 1 && parts.length === 2) {
      institution = top;
      degree = bottom;
    } else {
      ambiguous = true;
      candidates = parts.map((part) => part.text);
      institution = parts[0];
      degree = parts[1];
    }
  }

  const doubts: Doubt[] = [];
  if (!institution) doubts.push("no_institution");
  if (!degree) doubts.push("no_degree");
  if (ambiguous) doubts.push("company_or_role");
  if (read.guessedSplit) doubts.push("location_guess");

  const extra: string[] = [];
  let honors: Quoted<string> | undefined;
  for (const item of content) {
    const label = item.text.match(HONORS);
    if (label && !honors) honors = quoted(item.text.slice(label[0].length).trim() || item.text, item.text);
    else if (item.text.length >= 3) extra.push(item.text);
  }

  const entry: ParsedEducation = {
    confidence: ambiguous || (!institution && !degree) ? "low" : !institution || !degree || read.guessedSplit ? "medium" : "high",
    doubts,
    span: [block.from, block.to],
  };
  if (institution) entry.institution = quoted(institution.text, institution.text);
  if (degree) entry.degree = quoted(degree.text, degree.text);
  if (candidates) entry.candidates = candidates;
  if (match.range) {
    entry.start = { value: match.range.start.value, quote: match.range.start.quote };
    entry.end = { value: match.range.end.value, quote: match.range.end.quote };
  } else if (match.single) {
    entry.end = { value: match.single.value, quote: match.single.quote };
  }
  if (read.place) {
    entry.city = quoted(read.place.city, read.place.quote);
    entry.country = quoted(read.place.country, read.place.quote);
  }
  if (honors) entry.honors = honors;

  const evidence = [...header.map((h) => h.text), match.rest, ...content.map((c) => c.text)].join(" ");
  const inProgress = evidence.match(IN_PROGRESS)?.[0];
  const incomplete = evidence.match(INCOMPLETE)?.[0];
  if (incomplete) entry.status = quoted("incomplete", incomplete);
  else if (inProgress) entry.status = quoted("in_progress", inProgress);
  else if (entry.end?.value.current) entry.status = quoted("in_progress", entry.end.quote);

  return { entry, extra };
}

/** Studies listed with no dates: one line each, degree and institution found by their words. */
function parseUndatedEducation(items: Item[]): ParsedEducation[] {
  const entries: Array<{ institution?: string; degree?: string; from: number; to: number; ambiguous: boolean; candidates?: string[] }> = [];
  for (const item of items) {
    if (!isHeaderShaped(item)) continue;
    const read = readHeader([item.text]);
    if (read.parts.length === 0) continue;
    const isEducation = read.parts.some((part) => count(part.text, INSTITUTION_WORDS) + count(part.text, DEGREE_WORDS) > 0);
    if (!isEducation) continue;
    const idx = item.line.index;
    if (read.parts.length >= 2) {
      const [a, b] = read.parts as [Part, Part];
      const diff = institutionScore(a.text) - institutionScore(b.text);
      if (diff >= 1) entries.push({ institution: a.text, degree: b.text, from: idx, to: idx, ambiguous: false });
      else if (diff <= -1) entries.push({ institution: b.text, degree: a.text, from: idx, to: idx, ambiguous: false });
      else entries.push({ institution: a.text, degree: b.text, from: idx, to: idx, ambiguous: true, candidates: [a.text, b.text] });
    } else {
      const only = read.parts[0]!;
      if (institutionScore(only.text) > 0) entries.push({ institution: only.text, from: idx, to: idx, ambiguous: false });
      else entries.push({ degree: only.text, from: idx, to: idx, ambiguous: false });
    }
  }

  // An institution line next to a degree line is one entry.
  const merged: typeof entries = [];
  for (const entry of entries) {
    const prev = merged[merged.length - 1];
    const complementary =
      prev &&
      entry.from - prev.to === 1 &&
      ((prev.institution && !prev.degree && entry.degree && !entry.institution) ||
        (prev.degree && !prev.institution && entry.institution && !entry.degree));
    if (prev && complementary) {
      prev.institution ??= entry.institution;
      prev.degree ??= entry.degree;
      prev.to = entry.to;
    } else {
      merged.push({ ...entry });
    }
  }

  return merged.map((entry) => {
    const doubts: Doubt[] = [];
    if (!entry.institution) doubts.push("no_institution");
    if (!entry.degree) doubts.push("no_degree");
    if (entry.ambiguous) doubts.push("company_or_role");
    doubts.push("no_dates");
    const parsed: ParsedEducation = {
      // Undated is never better than medium: there is no anchor to say it is an entry.
      confidence: entry.ambiguous ? "low" : "medium",
      doubts,
      span: [entry.from, entry.to],
    };
    if (entry.institution) parsed.institution = quoted(entry.institution, entry.institution);
    if (entry.degree) parsed.degree = quoted(entry.degree, entry.degree);
    if (entry.candidates) parsed.candidates = entry.candidates;
    return parsed;
  });
}

// --- Languages, skills, certifications, projects ----------------------------------------------------------

function languageNameOf(text: string): string | null {
  return LANGUAGE_NAMES[fold(text).replace(/[^a-z]/g, "")] ? text.trim() : null;
}

const LEVEL_FIRST = /^(nativ[oa]|biling[uü]e|fluid[oa]|avanzad[oa]|intermedi[oa]|b[aá]sic[oa]|fluent|advanced|intermediate|basic|native|proficient|conversational)\s+(?:en|de|in)\s+(.+)$/i;

function parseLanguages(lines: readonly Line[]): { languages: ParsedLanguage[]; rest: string[] } {
  const languages: ParsedLanguage[] = [];
  const rest: string[] = [];
  const add = (name: string, level: string | undefined, quote: string) => {
    if (languages.some((l) => fold(l.name.value) === fold(name))) return;
    const entry: ParsedLanguage = { name: quoted(name, quote) };
    if (level) entry.level = quoted(level, quote);
    languages.push(entry);
  };

  for (const line of lines) {
    const text = stripBullet(line.text).text;
    let consumed = false;
    // Whole sentences first: "Nativo en Español y Catalán. Fluido en Inglés."
    for (const sentence of text.split(/(?<=[.;])\s+/)) {
      const levelFirst = sentence.replace(/[.;]$/, "").match(LEVEL_FIRST);
      if (levelFirst) {
        for (const name of levelFirst[2]!.split(/\s*(?:,|\by\b|\band\b|\be\b|&|\/)\s*/)) {
          if (languageNameOf(name)) {
            add(name.trim(), levelFirst[1], sentence);
            consumed = true;
          }
        }
      }
    }
    if (consumed) continue;

    // "Inglés (B2)", "Inglés - Avanzado", "Inglés: B2", "Inglés B2" — separated by commas or pipes or alone.
    for (const piece of text.split(/\s*[,;|·•]\s*/)) {
      const match = piece.match(/^([\p{L}]+(?:\s[\p{L}]+)?)\s*(?:[:\-–—]\s*|\(\s*)?([^)]*?)\)?$/u);
      const words = piece.trim().split(/\s+/);
      let name: string | null = null;
      let level = "";
      if (match && languageNameOf(match[1]!)) {
        name = match[1]!;
        level = match[2]!.trim();
      } else if (languageNameOf(words[0] ?? "")) {
        name = words[0]!;
        level = words.slice(1).join(" ").replace(/^[:\-–—(\s]+|[)\s]+$/g, "");
      }
      if (name) {
        const levelWords = level.split(/[\s/,()-]+/).filter(Boolean).map((word) => fold(word));
        const plausible = level === "" || levelWords.every((word) => LANGUAGE_LEVEL_WORDS.has(word) || /^\d/.test(word) || word.length <= 3);
        add(name, plausible && level ? level : undefined, piece.trim());
        if (!plausible && level) rest.push(piece.trim());
        consumed = true;
      }
    }
    if (!consumed) rest.push(text);
  }
  return { languages, rest };
}

/**
 * A line's languages, or a practical fact's value — the two things worth
 * pulling out of a line that is not obviously anything else, wherever it
 * turns up: inside a section combining several kinds, or a stray one inside
 * an ordinary skills list. Never guesses at a certification — that reading
 * needs a heading actually about certifications to be a safe assumption; see
 * `parsePairs`, which is where a line falling through this still gets one.
 *
 * A single line can name more than one language ("Nativo en Español y
 * Catalán. Fluido en Inglés."), which is why this carries all of them rather
 * than the first.
 */
function narrowPair(
  line: Line,
): { kind: "language"; values: ParsedLanguage[] } | { kind: "practical"; field: PracticalFact["field"]; value: Quoted<string> } | null {
  const { languages } = parseLanguages([line]);
  if (languages.length > 0) return { kind: "language", values: languages };
  const pair = splitColonPair(stripBullet(line.text).text);
  if (!pair) return null;
  const fact = practicalFactFor(pair.label);
  return fact && fact.kind === "text" ? { kind: "practical", field: fact.field, value: quoted(pair.value, pair.raw) } : null;
}

/** "Label: value", split at the first colon — the one separator a practical fact or an ad-hoc certification actually uses, as opposed to `parseCertifications`'s own dash/"por"/"@" set. */
function splitColonPair(text: string): { label: string; value: string; raw: string } | null {
  const at = text.indexOf(":");
  if (at === -1) return null;
  const label = text.slice(0, at).trim();
  const value = text.slice(at + 1).trim();
  if (!label || !value || label.length > 40) return null;
  return { label, value, raw: text };
}

function parseSkills(lines: readonly Line[]): {
  skills: Quoted<string>[];
  rest: string[];
  languages: ParsedLanguage[];
  practical: ParsedPractical;
} {
  const skills: Quoted<string>[] = [];
  const rest: string[] = [];
  const languages: ParsedLanguage[] = [];
  const practical: ParsedPractical = {};
  for (const line of lines) {
    // "Inglés: Avanzado" or "Disponibilidad: Full time" under a skills heading
    // with no section of its own — this is not what the heading promised, but
    // it is what the document says, and it has a real field to go to.
    const narrow = narrowPair(line);
    if (narrow?.kind === "language") {
      for (const value of narrow.values) {
        if (!languages.some((l) => fold(l.name.value) === fold(value.name.value))) languages.push(value);
      }
      continue;
    }
    if (narrow?.kind === "practical") {
      practical[narrow.field] ??= narrow.value;
      continue;
    }

    const text = stripBullet(line.text).text;
    // "Frontend: React, Vue, CSS" — the category is not a skill.
    const body = text.replace(/^[\p{L}][\p{L} &/+.-]{1,30}:\s+(?=.*[,;|·])/u, "");
    const words = body.split(/\s+/).length;
    if ((words > 8 && !/[,;|·]/.test(body)) || (/[.!?]$/.test(body) && words > 6)) {
      // A sentence rather than a list ("Conocimiento de Docker y Kubernetes
      // para contenedorización.") still names real tools; only one that
      // names none is left for the person to place.
      const tools = toolsIn(text, { skillsSection: true });
      if (tools.length > 0) {
        for (const tool of tools) if (!skills.some((skill) => fold(skill.value) === fold(tool))) skills.push(quoted(tool, text));
      } else {
        rest.push(text);
      }
      continue;
    }
    for (const raw of body.split(/\s*[,;|·•]\s*/)) {
      const token = raw.replace(/^[-–—\s]+|[.\s]+$/g, "").trim();
      if (token.length < 2 || token.length > 40 || token.split(/\s+/).length > 5) {
        if (token.length > 40) rest.push(token);
        continue;
      }
      if (!skills.some((skill) => fold(skill.value) === fold(token))) skills.push(quoted(token, token));
    }
  }
  return { skills, rest, languages, practical };
}

function parseCertifications(lines: readonly Line[]): ParsedCertification[] {
  const out: ParsedCertification[] = [];
  for (const line of lines) {
    const text = stripBullet(line.text).text;
    if (text.length < 3) continue;
    const trailing = extractTrailingDate(text);
    const body = trailing ? trailing.rest : text;
    const pieces = body.split(/\s+[—–|]\s+|\s+(?:por|by)\s+|\s+@\s+/i);
    const name = (pieces[0] ?? body).trim().replace(/[,-]\s*$/, "");
    const issuer = pieces.length > 1 ? pieces.slice(1).join(" ").trim() : "";
    if (!name) continue;
    const cert: ParsedCertification = { name: quoted(name, text) };
    if (issuer && issuer.length <= 60) cert.issuer = quoted(issuer, text);
    if (trailing) cert.date = quoted(trailing.value, trailing.quote);
    out.push(cert);
  }
  return out;
}

/**
 * A section combining more than one kind under one heading ("Certificaciones
 * e idiomas"), or one this reader could not place at all ("Disponibilidad"):
 * read one line at a time, since its own heading cannot say what each line is.
 * A language and a practical fact are only ever `narrowPair`'s own careful
 * guess; anything else with a colon in it is read as a certification, "Name:
 * Issuer" — safe here in a way it is not inside an ordinary skills list,
 * because a line under this heading has nowhere else it could belong.
 */
function parsePairs(lines: readonly Line[]): {
  languages: ParsedLanguage[];
  practical: ParsedPractical;
  certifications: ParsedCertification[];
  rest: string[];
} {
  const languages: ParsedLanguage[] = [];
  const practical: ParsedPractical = {};
  const certifications: ParsedCertification[] = [];
  const rest: string[] = [];
  for (const line of lines) {
    const narrow = narrowPair(line);
    if (narrow?.kind === "language") {
      for (const value of narrow.values) {
        if (!languages.some((l) => fold(l.name.value) === fold(value.name.value))) languages.push(value);
      }
      continue;
    }
    if (narrow?.kind === "practical") {
      practical[narrow.field] ??= narrow.value;
      continue;
    }
    const text = stripBullet(line.text).text;
    if (!text) continue;
    const pair = splitColonPair(text);
    if (pair) {
      certifications.push({ name: quoted(pair.label, text), issuer: quoted(pair.value, text) });
      continue;
    }
    rest.push(text);
  }
  return { languages, practical, certifications, rest };
}

function parseProjects(lines: readonly Line[], gaps: boolean): ParsedProject[] {
  const items = itemsOf(lines);
  const projects: ParsedProject[] = [];
  let current: { name: string; body: Item[] } | null = null;
  const flush = () => {
    if (!current) return;
    const description = current.body.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
    const urls = findUrls(`${current.name} ${description}`);
    const project: ParsedProject = { name: quoted(current.name, current.name) };
    if (description) project.description = quoted(description.slice(0, 800), description);
    if (urls[0]) project.url = quoted(urls[0], urls[0]);
    projects.push(project);
    current = null;
  };
  for (const item of items) {
    const startsProject = !item.bullet && isHeaderShaped(item) && (!current || current.body.length > 0 || (gaps && item.line.gapBefore));
    if (startsProject) {
      flush();
      current = { name: item.text.replace(/\s*[-–—:]\s*$/, ""), body: [] };
    } else if (current) {
      current.body.push(item);
    } else {
      current = { name: item.text.slice(0, 120), body: [] };
    }
  }
  flush();
  return projects;
}

// --- The document ----------------------------------------------------------------------------------------------

function documentConfidence(
  experience: readonly ParsedExperience[],
  education: readonly ParsedEducation[],
): Confidence {
  const blocks = [...experience, ...education];
  if (blocks.length === 0) return "low";
  const low = blocks.filter((block) => block.confidence === "low").length;
  if (low / blocks.length >= 0.5) return "low";
  return weakest(...blocks.map((block) => block.confidence));
}

export { REDACTED } from "./redact";

/** Fills in whichever practical fields `doc` does not already have; never overwrites a field this document, or an earlier section of it, already set. */
function mergePractical(doc: ParsedDocument, practical: ParsedPractical): void {
  const entries = Object.entries(practical) as Array<[keyof ParsedPractical, Quoted<string>]>;
  if (entries.length === 0) return;
  doc.practical ??= {};
  for (const [field, value] of entries) doc.practical[field] ??= value;
}

/**
 * Reads a CV from its lines.
 *
 * `kind` is what to call the result; the reading itself does not change. LinkedIn's
 * own PDF has a reader of its own (`parseLinkedInPdf`) because its layout can be
 * relied on; this one is for everything else, where nothing can.
 */
export function parseCv(input: readonly Line[], kind: ParsedDocument["kind"] = "cv"): ParsedDocument {
  const lines = input.filter((line) => line.text.trim() && !isFooter(line.text));
  const { header, sections } = splitSections(lines);

  const unassigned: ParsedUnassigned[] = [];
  const doc: ParsedDocument = {
    kind,
    contact: { links: [] },
    experience: [],
    education: [],
    certifications: [],
    languages: [],
    skills: [],
    projects: [],
    unassigned,
    omittedPersonalData: 0,
    confidence: "low",
    lineCount: lines.length,
  };

  // --- The top of the document: who, and how to reach them ---
  const top = readContactLines(header);
  doc.contact = top.contact;
  doc.omittedPersonalData += top.omitted;
  const leftovers = [...top.leftovers];
  const nameIndex = leftovers.findIndex((line) => looksLikeName(line.text));
  if (nameIndex !== -1) {
    const name = leftovers.splice(nameIndex, 1)[0]!;
    doc.contact.fullName = quoted(name.text, name.text);
    // The line right under the name is usually what the person does.
    const next = leftovers[nameIndex];
    if (
      next &&
      next.text.length <= 80 &&
      !/[.!?]$/.test(next.text) &&
      !/[\d@]/.test(next.text) &&
      !DOC_TITLES.test(next.text) &&
      // Never a broken glyph or a link that ended up here unrecognised —
      // "what the person does" is never a URL.
      !/[\u0000�]/.test(next.text) &&
      findUrls(next.text).length === 0
    ) {
      doc.contact.headline = quoted(next.text, next.text);
      leftovers.splice(nameIndex, 1);
    }
  }
  const prose = leftovers.filter((line) => !DOC_TITLES.test(line.text.trim()));
  if (prose.length > 0) {
    const long = prose.filter((line) => line.text.length > 60 || /[.!?]$/.test(line.text));
    const short = prose.filter((line) => !long.includes(line));
    if (long.length > 0) unassigned.push({ text: long.map((l) => l.text).join(" "), kind: "summary" });
    for (const line of short) unassigned.push({ text: line.text, kind: "other" });
  }

  // --- Each section, by what it is ---
  for (const section of sections) {
    const items = itemsOf(section.lines);
    switch (section.kind) {
      case "summary": {
        if (section.lines.length > 0) {
          unassigned.push({ text: section.lines.map((l) => l.text).join(" "), kind: "summary", heading: section.heading });
        }
        break;
      }
      case "experience":
      case "volunteer": {
        const jobKind = section.kind === "volunteer" ? "volunteer" : "job";
        const sectionGaps = gapsInformative(section.lines);
        const { blocks, before } = findBlocks(items, experienceAnchor, sectionGaps);
        for (const block of blocks) {
          const { entry, links } = interpretExperience(block, jobKind, sectionGaps);
          doc.experience.push(entry);
          const heading = entry.company?.value || entry.role?.value || section.heading;
          for (const link of links) unassigned.push({ text: link.value, kind: "link", heading });
        }
        if (blocks.length === 0 && section.lines.length > 0) {
          unassigned.push({ text: joinText(section.lines), kind: "other", heading: section.heading });
        } else if (before.length > 0) {
          unassigned.push({ text: before.map((item) => item.line.text).join("\n"), kind: "other", heading: section.heading });
        }
        break;
      }
      case "education": {
        const { blocks, before } = findBlocks(items, educationAnchor, gapsInformative(section.lines));
        for (const block of blocks) {
          const { entry, extra } = interpretEducation(block);
          doc.education.push(entry);
          if (extra.length > 0) unassigned.push({ text: extra.join("\n"), kind: "other", heading: section.heading });
        }
        if (blocks.length === 0) doc.education.push(...parseUndatedEducation(items));
        const consumed = new Set(doc.education.flatMap((entry) => range(entry.span)));
        const untouched = (blocks.length === 0 ? items : before).filter((item) => !consumed.has(item.line.index));
        if (untouched.length > 0) {
          unassigned.push({ text: untouched.map((item) => item.line.text).join("\n"), kind: "other", heading: section.heading });
        }
        break;
      }
      case "skills": {
        const { skills, rest, languages, practical } = parseSkills(section.lines);
        doc.skills.push(...skills.filter((skill) => !doc.skills.some((s) => fold(s.value) === fold(skill.value))));
        for (const language of languages) {
          if (!doc.languages.some((l) => fold(l.name.value) === fold(language.name.value))) doc.languages.push(language);
        }
        mergePractical(doc, practical);
        if (rest.length > 0) unassigned.push({ text: rest.join("\n"), kind: "other", heading: section.heading });
        break;
      }
      case "mixed":
      case "practical": {
        // A heading that names one practical fact outright ("Disponibilidad")
        // has no label of its own to read line by line — the heading *is* the
        // label, and its lines together are the value. A heading `parsePairs`
        // still has to sort out line by line ("Certificaciones e idiomas", or
        // a "practical"-shaped one this does not resolve to a single field,
        // such as "Requisitos") falls to the same per-line reading as "mixed".
        const singleFact = section.kind === "practical" ? practicalFactFor(section.heading) : undefined;
        if (singleFact && singleFact.kind === "text" && section.lines.length > 0) {
          const text = section.lines.map((line) => line.text).join(", ");
          mergePractical(doc, { [singleFact.field]: quoted(text, text) } as ParsedPractical);
          break;
        }
        const { languages, practical, certifications, rest } = parsePairs(section.lines);
        for (const language of languages) {
          if (!doc.languages.some((l) => fold(l.name.value) === fold(language.name.value))) doc.languages.push(language);
        }
        mergePractical(doc, practical);
        doc.certifications.push(...certifications);
        if (rest.length > 0) unassigned.push({ text: rest.join("\n"), kind: "other", heading: section.heading });
        break;
      }
      case "languages": {
        const { languages, rest } = parseLanguages(section.lines);
        doc.languages.push(...languages);
        if (rest.length > 0) unassigned.push({ text: rest.join("\n"), kind: "other", heading: section.heading });
        break;
      }
      case "certifications": {
        doc.certifications.push(...parseCertifications(section.lines));
        break;
      }
      case "projects": {
        doc.projects.push(...parseProjects(section.lines, gapsInformative(section.lines)));
        break;
      }
      case "awards":
      case "interests": {
        if (section.lines.length > 0) {
          unassigned.push({ text: joinText(section.lines), kind: section.kind, heading: section.heading });
        }
        break;
      }
      case "references": {
        // Other people's details are not this person's to hand over.
        if (section.lines.length > 0) doc.omittedPersonalData += 1;
        break;
      }
      case "personal":
      case "contact": {
        const read = readContactLines(section.lines);
        doc.omittedPersonalData += read.omitted;
        doc.contact.email ??= read.contact.email;
        doc.contact.phone ??= read.contact.phone;
        doc.contact.city ??= read.contact.city;
        doc.contact.country ??= read.contact.country;
        for (const link of read.contact.links) {
          if (!doc.contact.links.some((l) => linkKey(l.value.url) === linkKey(link.value.url))) doc.contact.links.push(link);
        }
        for (const line of read.leftovers) unassigned.push({ text: line.text, kind: "other", heading: section.heading });
        break;
      }
    }
  }

  // Sentences like "Nativo en Español. Fluido en Inglés." sit in sections with other names.
  for (const item of [...unassigned]) {
    if (item.kind !== "other") continue;
    const kept: string[] = [];
    for (const text of item.text.split("\n")) {
      const isLanguageLine = text.split(/(?<=[.;])\s+/).some((sentence) => LEVEL_FIRST.test(sentence.replace(/[.;]$/, "")));
      const { languages } = isLanguageLine ? parseLanguages([{ text, index: 0, gapBefore: false }]) : { languages: [] };
      if (languages.length === 0) {
        kept.push(text);
        continue;
      }
      for (const language of languages) {
        if (!doc.languages.some((l) => fold(l.name.value) === fold(language.name.value))) doc.languages.push(language);
      }
    }
    if (kept.length === 0) unassigned.splice(unassigned.indexOf(item), 1);
    else item.text = kept.join("\n");
  }

  doc.confidence = documentConfidence(doc.experience, doc.education);
  doc.lines = redactLines(
    input,
    new Set(sections.filter((section) => section.kind === "references").flatMap((section) => section.lines.map((line) => line.index))),
  );
  doc.layout = layoutOf(input);
  return doc;
}

const range = ([from, to]: [number, number]): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export type { DateValue, EndDateValue };
