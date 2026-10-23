import { normalizeForComparison } from "@/lib/text/normalize";
import { packSentences, splitSentences } from "@/lib/text/sentences";
import { MAX_LOOSE_RANGES } from "@/lib/schemas/profile-v2";
import { REDACTED } from "./cv-heuristic";
import { isFooter } from "./lines";
import { classifyHeading } from "./sections";
import type { ParsedDocument, ParsedUnassigned } from "./types";

/**
 * What was said that nothing the reading kept comes from.
 *
 * A model reads a story and gives back what it can quote: a job here, a task there. What it cannot quote it leaves
 * out — and `verifyExtraction` drops a value whose quote is not in the text without a word, so a sentence that said
 * something the model did not carry over simply is not in the profile, and nobody is told. Which is how someone who
 * wrote three paragraphs sees two jobs on the review and never learns that the third paragraph went nowhere.
 *
 * This finds those sentences, by comparing the text with what survived. It does not judge them: it only says "this
 * is not in anything you are about to confirm", and the tray they land in lets the person make it a task, a note,
 * or nothing. Nothing is lost either way — the whole text is kept as a note — but a note nobody opens is not a
 * profile that says it.
 */

/** The heading the tray shows over a sentence that nothing was kept from: where it came from, in the person's own terms. */
export const LOOSE_HEADING = "De lo que contaste";

/** Words of four letters or fewer carry little by themselves; so do the connectors that are longer. */
const MIN_LENGTH = 5;
const CONNECTORS = new Set([
  "desde", "hasta", "entre", "sobre", "tambien", "ademas", "luego", "despues", "antes", "cuando", "donde", "porque",
  "aunque", "mientras", "algo", "todo", "toda", "todos", "todas", "mucho", "mucha", "muchos", "muchas", "otra", "otro",
  "otras", "otros", "cada", "estos", "estas", "aquel", "aquella", "siempre", "ahora", "hacia", "segun", "aunque",
]);

/** A word that says something: a number, or a word long enough and not one of the connectors. */
const isContent = (word: string) => /\d/.test(word) || (word.length >= MIN_LENGTH && !CONNECTORS.has(word));

/** A sentence with fewer content words than this is a crumb — "Sí, claro." — and not worth a card in the tray. */
const MIN_CONTENT = 3;

/** Of a sentence's content words, the share that must be somewhere in what was kept for it to count as kept. */
const COVERED_SHARE = 0.4;

/** A sentence longer than this is cut at a space: a voice dictation has no full stops, and one card for all of it is no card. */
const LONG_SENTENCE = 400;
const CUT_AT = 300;

/** How long a card of the tray may be, and how many there may be: a story with many loose sentences is a few cards, not a wall. */
const MAX_CARD = 500;
const MAX_CARDS = 6;
const TRAY_TEXT_MAX = 2000;

const words = (value: string): string[] => normalizeForComparison(value).split(" ").filter(Boolean);

/** Every fragment of the text that something the reading kept was taken from. */
export function keptFragments(doc: ParsedDocument): string[] {
  const out: string[] = [];
  const add = (quoted: { quote: string } | null | undefined) => {
    if (quoted?.quote) out.push(quoted.quote);
  };

  const { contact } = doc;
  [contact.fullName, contact.headline, contact.email, contact.phone, contact.city, contact.country].forEach(add);
  contact.links.forEach(add);

  for (const job of doc.experience) {
    [job.company, job.role, job.city, job.country, job.start, job.end, job.employmentType, job.workMode].forEach(add);
    job.facts.forEach(add);
    // The two lines either of which could be the company are both on the card, to choose between: not lost, though not either value yet.
    out.push(...(job.candidates ?? []));
  }
  for (const entry of doc.education) {
    [entry.institution, entry.degree, entry.city, entry.country, entry.start, entry.end, entry.status, entry.honors].forEach(add);
    out.push(...(entry.candidates ?? []));
  }
  for (const cert of doc.certifications) [cert.name, cert.issuer, cert.date].forEach(add);
  for (const language of doc.languages) [language.name, language.level].forEach(add);
  doc.skills.forEach(add);
  for (const project of doc.projects) [project.name, project.description, project.url].forEach(add);
  Object.values(doc.practical ?? {}).forEach(add);
  // What already sits in the tray is placed, as far as this goes: it is on its way to the person's eyes.
  for (const item of doc.unassigned) out.push(item.text);
  return out;
}

/** The sentences of `text`, with a long one cut where it can be. */
function pieces(text: string): string[] {
  return splitSentences(text)
    // A detail struck out on purpose (`redactPersonalData`) is the mark that stands where it was, and not a sentence nobody read.
    .map((sentence) => sentence.split(REDACTED).join(" ").replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence !== "")
    .flatMap((sentence) => (sentence.length > LONG_SENTENCE ? packSentences(sentence, CUT_AT) : [sentence]));
}

/** What one unit of text — a sentence, a line — holds: how many words say something, and how many of those are in something that was kept. */
type Share = { content: number; covered: number };

/** Whether `needle` is, word for word, a stretch of `haystack`. */
function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (haystack[start] !== needle[0]) continue;
    let matches = true;
    for (let at = 1; at < needle.length; at++) {
      if (haystack[start + at] !== needle[at]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

/**
 * For each of `units`, how much of it comes from something the reading kept. One run of words for all of them, each
 * word knowing the unit it is in: a fragment kept from the text can straddle the end of a sentence or of a line, and
 * is found all the same. And the other way round: a unit that is, whole, a stretch of what was kept comes from it even
 * where the quote is not in the run of words around it — the two lines of one summary with a sidebar set between them,
 * in a document read in columns.
 */
function shares(units: readonly string[], doc: ParsedDocument): Share[] {
  const stream: string[] = [];
  const owner: number[] = [];
  const unitWords: string[][] = [];
  units.forEach((unit, index) => {
    const found = words(unit);
    unitWords.push(found);
    for (const word of found) {
      stream.push(word);
      owner.push(index);
    }
  });

  const kept = new Array<boolean>(stream.length).fill(false);
  const fragments = keptFragments(doc).map(words).filter((fragment) => fragment.length > 0);
  for (const needle of fragments) {
    for (let start = 0; start + needle.length <= stream.length; start++) {
      if (stream[start] !== needle[0]) continue;
      let matches = true;
      for (let at = 1; at < needle.length; at++) {
        if (stream[start + at] !== needle[at]) {
          matches = false;
          break;
        }
      }
      if (matches) for (let at = 0; at < needle.length; at++) kept[start + at] = true;
    }
  }

  // A unit inside a kept fragment, whole: all of it is kept.
  let offset = 0;
  for (const found of unitWords) {
    if (found.length > 0 && fragments.some((fragment) => fragment.length >= found.length && containsRun(fragment, found))) {
      for (let at = 0; at < found.length; at++) kept[offset + at] = true;
    }
    offset += found.length;
  }

  const result = units.map((): Share => ({ content: 0, covered: 0 }));
  stream.forEach((word, position) => {
    if (!isContent(word)) return;
    const share = result[owner[position]!]!;
    share.content += 1;
    if (kept[position]) share.covered += 1;
  });
  return result;
}

/** Said something, and too little of it is in what was kept. A crumb — fewer content words than `MIN_CONTENT` — never is. */
const isLoose = (share: Share) => share.content >= MIN_CONTENT && share.covered / share.content < COVERED_SHARE;

/**
 * The sentences of `text` that too little of what the reading kept comes from, in the order they were said. A
 * crumb is not one of them; neither is a sentence whose content words are mostly in something that was kept.
 */
export function uncoveredSentences(text: string, doc: ParsedDocument): string[] {
  const sentences = pieces(text);
  const share = shares(sentences, doc);
  return sentences.filter((_, index) => isLoose(share[index]!));
}

// --- Lines of a document, not sentences of a story ------------------------------------------------------------------

/** First and last line of a stretch of the original, both included — the way every `span` is. */
export type LineRange = [from: number, to: number];

/** «6 years 3 months», «2 años 6 meses»: how long, which LinkedIn sets under a company — a line of dates, and the dates are read. */
const A_DURATION_LINE = /^\s*\d+\s*(?:years?|yrs?|months?|mos?|a[ñn]os?|meses|mes)(?:\s*(?:,|y|and)?\s*\d+\s*(?:years?|yrs?|months?|mos?|a[ñn]os?|meses|mes))*\s*$/i;

/** Short lines that sit between two lines that said something — «Ver más», a bare date — do not break the stretch they are in. */
const BRIDGE = 2;

/**
 * The stretches of a document's own lines that nothing the reading kept comes from.
 *
 * A reader of CVs gives a value for what it understood and puts into the tray what it could not place; what it understood
 * and did not carry — a certificate it could not tell the name of, the line of a project it dropped, the paragraph under a
 * heading it took for something else — is in neither. The review counts what the reading found, and says nothing of
 * this, so a person who sees four jobs on the screen does not learn that a fifth was in the file and went nowhere.
 *
 * It judges lines the way `uncoveredSentences` judges sentences — by the words that say something, and how many of them
 * are in what was kept — and not by what a line means. A heading is never one (it names a section, it does not say
 * anything in it), nor is a page number or a length of time (the dates are read), nor a personal detail left out on
 * purpose (the review says so already, in its own words), nor a line too short to say something, nor one that is mostly
 * in what was kept. Short lines between two that did say something stay in the stretch; short lines at either end do not,
 * so a stretch never opens or closes on a heading's neighbour, and a blank line ends it: a paragraph is a thing of its own.
 *
 * `lines` are the original's, indexed as every `span` is. A document with none — a data export — has no stretches.
 */
export function looseLineRanges(doc: ParsedDocument): LineRange[] {
  const lines = doc.lines ?? [];
  if (lines.length === 0) return [];

  // What is not judged: a detail struck out on purpose, a heading, a page number. The patterns' own reading never has the last — it
  // drops them as it reads — but the lines of a document a model read are every one the file had.
  const judged = lines.map((line) => (line === REDACTED || classifyHeading(line) !== null || isFooter(line) || A_DURATION_LINE.test(line) ? "" : line));
  const share = shares(judged, doc);

  const ranges: LineRange[] = [];
  let open: LineRange | null = null;
  let crumbs = 0;
  for (let index = 0; index < lines.length && ranges.length < MAX_LOOSE_RANGES; index++) {
    const line = share[index]!;
    if (isLoose(line)) {
      if (open) open[1] = index;
      else open = [index, index];
      crumbs = 0;
      continue;
    }
    // A short line between two that said something stays inside; a blank line, a heading, a line that was mostly kept, or a third short one closes it.
    const crumb = judged[index] !== "" && line.content < MIN_CONTENT;
    if (open && crumb && crumbs < BRIDGE) {
      crumbs += 1;
      continue;
    }
    if (open) ranges.push(open);
    open = null;
    crumbs = 0;
  }
  if (open && ranges.length < MAX_LOOSE_RANGES) ranges.push(open);
  return ranges;
}

/**
 * The reading without the tray items that are already in the tray. A story read again — back to the box, one word
 * changed, on again — would otherwise put every sentence that nothing came from there a second time, beside the first.
 * What was put away on purpose is not asked about twice by this: only what is still there is not repeated.
 */
export function withoutKnownCards(doc: ParsedDocument, known: ReadonlyArray<{ text: string }>): ParsedDocument {
  const seen = new Set(known.map((item) => normalizeForComparison(item.text)));
  return { ...doc, unassigned: doc.unassigned.filter((item) => !seen.has(normalizeForComparison(item.text))) };
}

/**
 * Those sentences as the cards the tray shows: the ones said one after another stay together, up to a
 * length, and past a few cards the rest goes into the last one — the whole text is a note anyway, and the
 * point of these is to be looked at, which a long list is not.
 */
export function looseSentencesAsCards(text: string, doc: ParsedDocument, heading: string): ParsedUnassigned[] {
  const loose = new Set(uncoveredSentences(text, doc));
  if (loose.size === 0) return [];

  const placed = doc.unassigned.map((item) => normalizeForComparison(item.text));
  const cards: string[] = [];
  let previousWasLoose = false;
  for (const sentence of pieces(text)) {
    const isLoose = loose.has(sentence) && !placed.some((text) => text.includes(normalizeForComparison(sentence)));
    if (!isLoose) {
      previousWasLoose = false;
      continue;
    }
    const last = cards.length - 1;
    if (previousWasLoose && last >= 0 && cards[last]!.length + 1 + sentence.length <= MAX_CARD) cards[last] = `${cards[last]} ${sentence}`;
    else cards.push(sentence);
    previousWasLoose = true;
  }

  if (cards.length > MAX_CARDS) {
    const rest = cards.splice(MAX_CARDS - 1).join(" ");
    cards.push(rest.length > TRAY_TEXT_MAX ? `${rest.slice(0, TRAY_TEXT_MAX - 1).trimEnd()}…` : rest);
  }
  return cards.map((card) => ({ text: card.slice(0, TRAY_TEXT_MAX), kind: "other" as const, heading }));
}
