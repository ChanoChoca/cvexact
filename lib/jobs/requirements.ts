import { hardTermsIn } from "@/lib/ai/evidence";
import { foldKeepingLength } from "@/lib/text/normalize";
import {
  AVAILABILITY_STRONG,
  ASKING_SENTENCE,
  AVAILABILITY_WEAK,
  CAPITALISED_ONLY,
  CREDENTIAL,
  DOCUMENTS,
  EDUCATION,
  FLAT_HEADINGS,
  LANGUAGE,
  LICENSE,
  NEUTRAL_HEADINGS,
  NOT_A_TOOL,
  NOT_NEEDED,
  OFFER_SENTENCE,
  OWN_TOOLS,
  PERSONAL,
  PORTFOLIO,
  PREFERABLY,
  PREFERRED_HEADINGS,
  PREFERRED_MARKERS,
  QUALITY_WORD,
  RELAXED_MARKERS,
  REQUIRED_HEADINGS,
  REQUIRED_MARKERS,
  REQUIREMENT_HEADINGS,
  SEARCH_FRAME,
  SUBHEADINGS,
  TASK_LEAD,
  TASK_PHRASES,
  TOOL_DISPLAY,
  TOOL_PATTERN,
  TRAITS,
  TRAVEL,
  VEHICLE,
  ZONE_STRONG,
  ZONE_WEAK,
} from "./requirement-words";

/**
 * What a job posting asks of the person, read without a model: each requirement with the words the posting used (a literal piece of it), what
 * kind of thing it is, and whether the posting says it is a must.
 *
 * The reader is a dictionary and a handful of rules (`./requirement-words.ts`), not a judgement. It leaves out what it does not know, and it
 * is wrong in the direction of asking less: a requirement it cannot place is not a requirement, and nothing it reads is asked unless it is a
 * thing a person can have done, hold or be able to say yes or no to. How well it reads is measured, against postings written and labelled by
 * hand, by `lib/jobs/bank.ts` — the only honest answer to «does it work», and the place a new posting that it misreads is added.
 */

/** A tool or a system; a task or a kind of experience; a condition (a licence, a vehicle, an availability); a credential; a trait; or something else. */
export type RequirementType = "tool" | "task" | "condition" | "credential" | "trait" | "other";

/** What the posting says about how much: it is indispensable, it is only valued, or it does not say. */
export type Obligation = "required" | "preferred" | "unstated";

/** What a condition is about. */
export type ConditionKind = "license" | "vehicle" | "availability" | "zone" | "documents" | "travel" | "tools";

export type Requirement = {
  /** A literal piece of the posting: what the person is shown, so that they see where the question comes from. */
  fragment: string;
  type: RequirementType;
  obligation: Obligation;
  /**
   * What the requirement names, in the posting's words: the tools of a tool requirement (their usual spelling), the thing a task is about, the
   * credential, the condition. What a «no» is kept under and what a question says.
   */
  subjects: string[];
  /** For a condition, what it is about. Empty for anything else. */
  conditions: ConditionKind[];
};

/** Past this much text the rest of a posting is boilerplate; and past this many requirements the reader has been misled. */
const MAX_TEXT = 20_000;
const MAX_REQUIREMENTS = 60;

// --- Folding: the same text, in the form the dictionary is written in ----------------------------------------------

/**
 * Lower case and no accents, one character for each character: a position in the folded text is a position in the posting, so that what is
 * found there can be quoted. The punctuation stays where it is.
 */
export const fold = foldKeepingLength;

type Span = { start: number; end: number };

const isSpace = (char: string | undefined): boolean => char === undefined || /\s/.test(char);

function trimmed(text: string, span: Span): Span {
  let { start, end } = span;
  while (start < end && isSpace(text[start])) start += 1;
  while (end > start && isSpace(text[end - 1])) end -= 1;
  return { start, end };
}

function lineSpans(text: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    const char = text[index];
    if (index < text.length && char !== "\n" && char !== "\r") continue;
    spans.push({ start, end: index });
    if (char === "\r" && text[index + 1] === "\n") index += 1;
    start = index + 1;
  }
  return spans;
}

// --- Lines: bullets, headings, and the part of the posting each belongs to -----------------------------------------

/** How much of a line is its bullet, or zero: «- », «* », «• », «1. », «a) », an emoji. */
function bulletLength(line: string): number {
  const mark = line.match(/^(?:[-–—•·▪■□◦○●‣✓✔☑➢➤→>*+]+|\d{1,2}[.)]|[a-z]\))\s+/u) ?? line.match(/^\p{Extended_Pictographic}\uFE0F?\s*/u);
  return mark ? mark[0].length : 0;
}

/**
 * Which part of the posting the lines that follow belong to. `none`: nothing has said (a description, prose). `requirements`: under a heading that
 * opens what is asked. `required` and `preferred`: under one that also says how much. `neutral`: what the job offers or does.
 */
type Mode = "none" | "requirements" | "required" | "preferred" | "neutral";

type Heading = { mode: Mode | "sub"; /** Where the content on the same line begins, if there is any. */ rest: number | null };

const plainKey = (value: string): string => value.replace(/[^a-z0-9]+/g, " ").trim();

const FLAT_HEADING = new RegExp(`^(?:${[...FLAT_HEADINGS].sort((a, b) => b.length - a.length).map((heading) => heading.replace(/ /g, "\\s+")).join("|")})(?=\\s+\\S|$)`);

const headingMode = (key: string): Mode | "sub" | null =>
  REQUIRED_HEADINGS.has(key)
    ? "required"
    : PREFERRED_HEADINGS.has(key)
      ? "preferred"
      : NEUTRAL_HEADINGS.has(key)
        ? "neutral"
        : REQUIREMENT_HEADINGS.has(key)
          ? "requirements"
          : SUBHEADINGS.has(key)
            ? "sub"
            : null;

/**
 * Whether a piece of the posting is a heading — alone, with its content after a colon, or (for the few that cannot be taken for a sentence)
 * with its content straight after it — and of what. `raw` is the same text before folding: the first word of the content has a capital.
 */
function headingOf(folded: string, raw: string): Heading | null {
  const body = folded.replace(/^[^a-z0-9]+/, "");
  if (!body) return null;
  const offset = folded.length - body.length;

  const colon = body.indexOf(":");
  const head = colon >= 0 && colon <= 60 ? body.slice(0, colon) : body.length <= 60 ? body : null;
  const key = head === null ? "" : plainKey(head);
  const mode = key ? headingMode(key) : null;
  if (mode) {
    const after = colon >= 0 && colon <= 60 ? body.slice(colon + 1) : "";
    const content = after.replace(/^[\s*_]+/, "");
    const alone = content.replace(/[\s*_]+$/, "") === "";
    // «Experiencia: 2 años en ventas» is a requirement; «Experiencia:» is the heading of a few.
    if (mode === "sub" && !alone) return null;
    return { mode, rest: alone ? null : offset + colon + 1 + (after.length - content.length) };
  }

  // No colon, and the content straight after: «Requisitos Secundario completo Experiencia previa …».
  const flat = body.match(FLAT_HEADING);
  if (!flat) return null;
  const after = offset + flat[0].length;
  const next = raw.slice(after).trimStart()[0];
  if (next !== undefined && !/[\p{Lu}\d]/u.test(next)) return null;
  const flatMode = headingMode(plainKey(flat[0])) ?? "requirements";
  return { mode: flatMode, rest: next === undefined ? null : after };
}

type Piece = Span & { mode: Mode; bulleted: boolean };

/** Words after which a number is a quantity and not the number of an item: «mayor de 21», «entre 20 y 35», «hasta 3». */
const BEFORE_A_QUANTITY = new Set(["de", "del", "a", "y", "e", "o", "u", "entre", "desde", "hasta", "mayor", "menor", "edad", "con", "para", "por", "en", "los", "las", "nivel", "minimo", "maximo", "ano", "anos", "mas", "menos"]);

/**
 * Whether the number that begins at `at` numbers an item of a list («… (excluyente) 2. Disponibilidad …») and is not a quantity that ends a
 * sentence («Mayor de 21. Se ofrece …»): it is small, and the word before it is not one that a quantity follows.
 */
function numbersAnItem(text: string, from: number, at: number): boolean {
  const number = /^\d{1,2}/.exec(text.slice(at, at + 2));
  if (!number || Number(number[0]) > 30 || at <= from) return false;
  const before = text.slice(from, at).trimEnd();
  if (before.endsWith(")")) return true;
  const word = /([\p{L}\p{N}]+)$/u.exec(before)?.[1];
  return word === undefined || !BEFORE_A_QUANTITY.has(fold(word));
}

/** The sentences (and the parts either side of a semicolon) of a line: each is read by itself. */
function piecesOf(text: string, span: Span): Span[] {
  const pieces: Span[] = [];
  let start = span.start;
  let depth = 0;
  // Written all in lower case, as a message is, a stop followed by a letter is still the end of a sentence.
  const lowerCase = !/\p{Lu}/u.test(text.slice(span.start, span.end));
  const push = (end: number) => {
    const piece = trimmed(text, { start, end });
    if (piece.end > piece.start) pieces.push(piece);
  };
  for (let index = span.start; index < span.end; index += 1) {
    const char = text[index]!;
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (char === ";" || "•·▪◦●‣".includes(char))) {
      push(index);
      start = index + 1;
    } else if (depth === 0 && "-–—*".includes(char) && isSpace(text[index - 1]) && isSpace(text[index + 1]) && /[\p{Lu}\d]/u.test(text.slice(index + 1, span.end).trimStart()[0] ?? "")) {
      // « - » between two items of a list that had no lines.
      push(index);
      start = index + 1;
    } else if (depth === 0 && (char === "." || char === "!" || char === "?") && isSpace(text[index + 1]) && !(char === "." && listNumeralBefore(text, span.start, index))) {
      // A sentence ends at a stop followed by a capital or a digit; «etc. y» and «Sr. García» are the price of not asking for more.
      const next = text.slice(index + 1, span.end).trimStart()[0];
      if (next === undefined || /[\p{Lu}\d¿¡"“(*•-]/u.test(next) || (lowerCase && /\p{L}/u.test(next))) {
        push(index + 1);
        start = index + 1;
      }
    }
  }
  push(span.end);
  return pieces;
}

/** Whether the stop at `index` is the one in «2.» — the number of an item — and not the end of a sentence. */
function listNumeralBefore(text: string, from: number, index: number): boolean {
  const number = /(?:^|\s)(\d{1,2})$/.exec(text.slice(from, index));
  return number !== null && numbersAnItem(text, from, index - number[1]!.length);
}

/** Words after which a capital is not the start of a new item: «Manejo de Word», «Conocimientos de Excel y Photoshop». */
const CONNECTORS = new Set(["de", "del", "en", "con", "y", "e", "o", "u", "para", "a", "al", "la", "el", "los", "las", "por", "sin", "un", "una", "que", "se", "es", "su", "sus", "como", "mas", "nivel", "ni"]);

const ITEM_STARTS: readonly RegExp[] = [
  TASK_LEAD, AVAILABILITY_STRONG, ZONE_STRONG, LICENSE, CREDENTIAL, EDUCATION, LANGUAGE, PERSONAL, PORTFOLIO,
  REQUIRED_MARKERS, PREFERRED_MARKERS, RELAXED_MARKERS, NOT_NEEDED,
  new RegExp(`(?<![a-z0-9])(?:${[...FLAT_HEADINGS].map((heading) => heading.replace(/ /g, "\\s+")).join("|")})(?![a-z0-9])`, "g"),
  // Any heading that has its colon: «… equipo Ofrecemos: …», «… Cómo trabajamos: …».
  new RegExp(
    `(?<![a-z0-9])(?:${[...REQUIREMENT_HEADINGS, ...REQUIRED_HEADINGS, ...PREFERRED_HEADINGS, ...NEUTRAL_HEADINGS].map((heading) => heading.replace(/ /g, "\\s+")).join("|")})\\s*:`,
    "g",
  ),
];

/**
 * Where a paragraph that was a list says that a new item begins: with a capital, after a word and with nothing between them, at something that
 * opens a requirement («… hidráulica Disponibilidad para …»), or after a closing parenthesis («… (excluyente) Residir en …»). A page of HTML
 * with its tags taken out is one long line of these, and it is most of what comes from the feed.
 */
function itemCuts(text: string, folded: string, span: Span): number[] {
  const cuts = new Set<number>();
  const consider = (at: number, digit = false) => {
    if (at <= span.start || !(digit ? /[\p{Lu}\d]/u : /\p{Lu}/u).test(text[at] ?? "")) return;
    let before = at - 1;
    while (before > span.start && isSpace(text[before])) before -= 1;
    const previous = text[before] ?? "";
    if (before === at - 1) return;
    if (previous === ")") {
      cuts.add(at);
      return;
    }
    if (!/[\p{L}\d]/u.test(previous)) return;
    let wordStart = before;
    while (wordStart > span.start && !isSpace(text[wordStart - 1])) wordStart -= 1;
    if (!CONNECTORS.has(folded.slice(wordStart, before + 1))) cuts.add(at);
  };
  const slice = folded.slice(span.start, span.end);
  for (const pattern of ITEM_STARTS) for (const match of slice.matchAll(pattern)) consider(span.start + match.index!, pattern === TASK_LEAD);
  // A picture in the middle of a paragraph is a bullet: «… ✅ Lo que buscamos: …».
  for (const match of text.slice(span.start, span.end).matchAll(/\p{Extended_Pictographic}\uFE0F?/gu)) {
    const at = span.start + match.index!;
    if (at > span.start) cuts.add(at);
  }
  // «… 2. Manejo de …»: the number opens an item.
  for (const match of text.slice(span.start, span.end).matchAll(/(?<=\s)\d{1,2}[.)]\s+(?=\p{Lu})/gu)) {
    if (numbersAnItem(text, span.start, span.start + match.index!)) cuts.add(span.start + match.index!);
  }
  // A capital after a closing parenthesis opens an item whatever it opens with.
  for (const match of slice.matchAll(/\)\s+(?=\S)/g)) consider(span.start + match.index! + match[0].length);
  return [...cuts].sort((a, b) => a - b);
}

/** The part of the posting after a heading: the one it names, or — for a heading inside a list — the one the list was in. */
const afterHeading = (mode: Mode, heading: Heading): Mode =>
  heading.mode !== "sub" ? heading.mode : mode === "requirements" || mode === "required" || mode === "preferred" ? mode : "requirements";

function piecesOfPosting(text: string, folded: string): Piece[] {
  const lines = lineSpans(text);
  const pieces: Piece[] = [];
  let mode: Mode = "none";
  let items = 0;
  let blank = false;
  let seen = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = trimmed(text, lines[index]!);
    if (line.end <= line.start) {
      blank = true;
      continue;
    }
    const first = !seen;
    seen = true;
    const raw = text.slice(line.start, line.end);
    const bullet = bulletLength(raw);

    // The first line, standing alone above a blank one, is the title: «Repartidor/a con moto propia» is what the job is, not what is asked.
    if (first && bullet === 0 && !/[.:]$/.test(raw) && raw.length <= 120) {
      const next = lines[index + 1];
      const following = next ? trimmed(text, next) : null;
      if (following && following.end <= following.start && lines.slice(index + 1).some((other) => trimmed(text, other).end > trimmed(text, other).start)) {
        blank = true;
        continue;
      }
    }

    // A blank line closes a list that has begun, unless what follows is another item of it.
    if (blank && bullet === 0 && items > 0) mode = "none";
    blank = false;

    // A heading opens a part of the posting wherever it stands: at the head of a line, or after a stop in a paragraph («… EN FLORES. REQUISITOS: …»).
    const bulleted = bullet > 0;
    const emoji = /^\p{Extended_Pictographic}/u.test(raw);
    const sentences = piecesOf(text, { start: line.start + bullet, end: line.end }).flatMap((sentence) => {
      const cuts = itemCuts(text, folded, sentence);
      return [sentence.start, ...cuts].map((start, at) => trimmed(text, { start, end: cuts[at] ?? sentence.end }));
    });
    for (const cut of sentences) {
      if (cut.end <= cut.start) continue;
      const piece = { start: cut.start + bulletLength(text.slice(cut.start, cut.end)), end: cut.end };
      if (piece.end <= piece.start) continue;
      let content: Span = piece;
      const heading = headingOf(folded.slice(piece.start, piece.end), text.slice(piece.start, piece.end));
      // Under a bullet a word like «Horario:» is an item of the list; but an emoji in front of «Lo que buscamos:» is decoration, not a bullet.
      if (heading && (!bulleted || emoji || heading.rest === null)) {
        mode = afterHeading(mode, heading);
        items = 0;
        if (heading.rest === null) continue;
        content = { start: piece.start + heading.rest, end: piece.end };
      }
      items += 1;
      if (mode === "neutral") continue;
      pieces.push({ ...content, mode, bulleted });
    }
  }
  return pieces;
}

// --- Anchors: what in a piece names something --------------------------------------------------------------------------

type AnchorKind = "credential" | "condition" | "tool" | "other" | "lead" | "phrase" | "trait";

type Anchor = Span & {
  kind: AnchorKind;
  /** For a condition, a part of it said outright (a requirement wherever it stands) or only by its parts. */
  strong?: boolean;
  condition?: ConditionKind;
  /** For a tool, its usual spelling. */
  name?: string;
  /** A tool whose name is also a word, written in lower case: it is the tool only where the clause has a lead. */
  weak?: boolean;
};

function* hitsOf(pattern: RegExp, folded: string): Generator<Span> {
  for (const match of folded.matchAll(pattern)) yield { start: match.index!, end: match.index! + match[0].length };
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The tools of the whole posting: the dictionary first, and then the glossary of technologies on what the dictionary did not take. */
function toolAnchors(text: string, folded: string): Anchor[] {
  const anchors: Anchor[] = [];
  const taken: Span[] = [];
  for (const match of folded.matchAll(TOOL_PATTERN)) {
    const span = { start: match.index!, end: match.index! + match[0].length };
    taken.push(span);
    const weak = CAPITALISED_ONLY.has(match[0]) && !/\p{Lu}/u.test(text[span.start] ?? "");
    anchors.push({ ...span, kind: "tool", name: TOOL_DISPLAY.get(match[0].replace(/\s+/g, " ")) ?? text.slice(span.start, span.end), weak });
  }

  // The glossary also reads any capitals of two to seven letters as an acronym, so it is given each line by itself — a «MOZO» in a title is not a
  // tool in the lines below it — and what it finds is kept if the glossary knows it, or if it is a three-letter acronym in a line that is not
  // written in capitals: «BUENA PRESENCIA, ONDA, MAYOR DE 21» holds no acronyms, and «SQL avanzado» holds one.
  let rest = text;
  for (const span of taken) rest = `${rest.slice(0, span.start)}${" ".repeat(span.end - span.start)}${rest.slice(span.end)}`;
  for (const line of lineSpans(rest)) {
    const raw = rest.slice(line.start, line.end);
    if (raw.trim().length < 2) continue;
    const upper = raw.match(/\p{Lu}/gu)?.length ?? 0;
    const lower = raw.match(/\p{Ll}/gu)?.length ?? 0;
    const shouting = upper >= 4 && upper / (upper + lower) >= 0.7;
    const known = new Set(hardTermsIn(raw.toLowerCase()).map((term) => fold(term)));
    const lineFolded = fold(raw);
    for (const term of hardTermsIn(raw)) {
      if (NOT_A_TOOL.has(term)) continue;
      const acronym = /^[A-Z][A-Z0-9]{1,6}$/.test(term);
      if (acronym && !known.has(fold(term)) && (shouting || term.length !== 3)) continue;
      const pattern = new RegExp(`(?<![a-z0-9#+])${escapeRegExp(fold(term))}(?![a-z0-9#+])`, "g");
      for (const match of lineFolded.matchAll(pattern)) {
        anchors.push({ start: line.start + match.index!, end: line.start + match.index! + match[0].length, kind: "tool", name: term });
      }
    }
  }
  return anchors;
}

function anchorsOf(text: string, folded: string): Anchor[] {
  const anchors: Anchor[] = [];
  const add = (pattern: RegExp, extra: Omit<Anchor, "start" | "end">) => {
    for (const span of hitsOf(pattern, folded)) anchors.push({ ...span, ...extra });
  };
  add(CREDENTIAL, { kind: "credential" });
  add(LICENSE, { kind: "condition", condition: "license", strong: true });
  add(VEHICLE, { kind: "condition", condition: "vehicle", strong: true });
  add(AVAILABILITY_STRONG, { kind: "condition", condition: "availability", strong: true });
  add(AVAILABILITY_WEAK, { kind: "condition", condition: "availability", strong: false });
  add(ZONE_STRONG, { kind: "condition", condition: "zone", strong: true });
  add(ZONE_WEAK, { kind: "condition", condition: "zone", strong: false });
  add(TRAVEL, { kind: "condition", condition: "travel", strong: true });
  add(OWN_TOOLS, { kind: "condition", condition: "tools", strong: true });
  add(DOCUMENTS, { kind: "condition", condition: "documents", strong: true });
  add(PERSONAL, { kind: "other" });
  add(EDUCATION, { kind: "other" });
  add(LANGUAGE, { kind: "other" });
  add(PORTFOLIO, { kind: "other" });
  add(TASK_LEAD, { kind: "lead" });
  add(TASK_PHRASES, { kind: "phrase" });
  add(TRAITS, { kind: "trait" });
  anchors.push(...toolAnchors(text, folded));
  return anchors.sort((a, b) => a.start - b.start || b.end - a.end);
}

// --- Markers: how much the posting says -------------------------------------------------------------------------------

type Marker = Span & { obligation: Obligation };

/** The markers in a piece; a «no excluyente» is a marker of preferred, and the «excluyente» inside it is not one of required. */
function markersOf(folded: string): Marker[] {
  const relaxed = [...hitsOf(RELAXED_MARKERS, folded)];
  const inside = (span: Span) => relaxed.some((other) => span.start >= other.start && span.end <= other.end);
  // «Preferentemente» heads what it introduces, or qualifies what came before it; only the first is a marker.
  const heading = [...hitsOf(PREFERABLY, folded)].filter((span) => !folded.slice(0, span.start).includes(",") && folded.slice(0, span.start).trim().split(/\s+/).filter(Boolean).length <= 3);
  return [
    ...relaxed.map((span) => ({ ...span, obligation: "preferred" as const })),
    ...heading.map((span) => ({ ...span, obligation: "preferred" as const })),
    ...[...hitsOf(PREFERRED_MARKERS, folded)].map((span) => ({ ...span, obligation: "preferred" as const })),
    ...[...hitsOf(REQUIRED_MARKERS, folded)].filter((span) => !inside(span)).map((span) => ({ ...span, obligation: "required" as const })),
  ].sort((a, b) => a.start - b.start);
}

const overlaps = (a: Span, b: Span): boolean => a.start < b.end && b.start < a.end;

/**
 * What the posting says about how much of a stretch of a piece. A marker in the stretch says it for the stretch. A marker at the head of the
 * piece, before anything is asked («Se valorará A y B», «Es indispensable contar con A y B»), says it for all it introduces. A marker in
 * brackets that closes a line («A y B (excluyente)») says it for the line. Otherwise it is what the heading above said. A marker in the middle
 * of a list of commas («A, B deseable, C») is B's and no one else's.
 */
function obligationOf(range: Span, markers: readonly Marker[], mode: Mode, headEnd: number, closing: boolean): Obligation {
  const own = markers.find((marker) => overlaps(marker, range));
  if (own) return own.obligation;
  const head = [...markers].reverse().find((marker) => marker.end <= range.start && marker.start < headEnd);
  if (head) return head.obligation;
  const last = markers[markers.length - 1];
  if (closing && last) return last.obligation;
  return mode === "required" ? "required" : mode === "preferred" ? "preferred" : "unstated";
}

// --- Clauses: the parts of a piece that ask for one thing each --------------------------------------------------------------

const JOINT = /\s*[,;]\s*|\s+(?:y|e|o|pero|sino|aunque|ni)\s+/g;

/** Where a piece is cut: at commas and conjunctions that are outside parentheses and outside the lead of a requirement. */
function clausesOf(folded: string, leads: readonly Span[]): Span[] {
  const depth: number[] = [];
  let level = 0;
  for (let index = 0; index < folded.length; index += 1) {
    if (folded[index] === "(") level += 1;
    depth.push(level);
    if (folded[index] === ")") level = Math.max(0, level - 1);
  }
  const clauses: Span[] = [];
  let start = 0;
  for (const match of folded.matchAll(JOINT)) {
    const at = match.index!;
    if ((depth[at] ?? 0) > 0 || leads.some((lead) => at >= lead.start && at < lead.end)) continue;
    if (at > start) clauses.push({ start, end: at });
    start = at + match[0].length;
  }
  if (start < folded.length) clauses.push({ start, end: folded.length });
  return clauses.filter((clause) => folded.slice(clause.start, clause.end).trim() !== "");
}

/**
 * How much of what a piece names is a requirement. `full`: all of it — it is under a heading, or says itself that it asks («Se valorará», «experiencia
 * en»). `asking`: it opens by asking («Se requiere …») and names what is asked, but a day or a shift in it is still only a description of the job.
 * `strict`: outside the lists, where only a plain fact about the person (a licence, a registration, a «disponibilidad») is.
 */
type Level = "strict" | "asking" | "full";

/** What a clause is, by the strongest thing it names. A credential and a condition are facts about the person; a tool is named; a task is a lead. */
function typeOfClause(anchors: readonly Anchor[], clause: string, first: boolean, level: Level, frame: boolean): RequirementType | null {
  if (anchors.some((anchor) => anchor.kind === "credential")) return "credential";
  const conditions = anchors.filter((anchor) => anchor.kind === "condition");
  if (conditions.some((anchor) => anchor.strong) || (level === "full" && conditions.length > 0)) return "condition";
  if (level === "strict") return frame && anchors.some((anchor) => anchor.kind === "trait") ? "trait" : null;
  const lead = anchors.some((anchor) => anchor.kind === "lead");
  if (anchors.some((anchor) => anchor.kind === "tool" && (!anchor.weak || lead))) return "tool";
  if (anchors.some((anchor) => anchor.kind === "other")) return "other";
  if (anchors.some((anchor) => anchor.kind === "lead") || (anchors.some((anchor) => anchor.kind === "phrase") && (first || QUALITY_WORD.test(clause.trim())))) return "task";
  if (anchors.some((anchor) => anchor.kind === "trait")) return "trait";
  return null;
}

// --- Reading a piece -------------------------------------------------------------------------------------------------------------

const MARKER_PARENTHESES = /\s*\((?:excluyente|excluyentes|deseable|valorable|indispensable|obligatorio|opcional|plus)[^)]*\)\s*$/i;

/** The most of a posting that is quoted in one requirement. */
const MAX_FRAGMENT = 240;

/** A quoted piece of the posting without what surrounds it: the stops, the commas, the connectors at either end. */
function cleanFragment(value: string): string {
  const clean = value
    .replace(/^[\s,;:.\-–—•·*]+/, "")
    .replace(/^(?:y|e|o|u|pero|sino|aunque|ni)\s+/i, "")
    .replace(/[\s,;:.]+$/, "")
    .replace(/\s+\d{1,2}[.)]$/, "")
    .replace(/\s+/g, " ")
    .trim();
  // A paragraph with no stops is one long piece: what is quoted is the beginning of it, cut at a word.
  return clean.length <= MAX_FRAGMENT ? clean : clean.slice(0, clean.lastIndexOf(" ", MAX_FRAGMENT) > 0 ? clean.lastIndexOf(" ", MAX_FRAGMENT) : MAX_FRAGMENT).trimEnd();
}

/** What a tool requirement names, once each, in the order the posting says them. */
const toolNames = (anchors: readonly Anchor[]): string[] => {
  const lead = anchors.some((anchor) => anchor.kind === "lead");
  const names: string[] = [];
  for (const anchor of anchors) {
    if (anchor.kind !== "tool" || !anchor.name || (anchor.weak && !lead)) continue;
    if (!names.some((name) => name.toLowerCase() === anchor.name!.toLowerCase())) names.push(anchor.name);
  }
  return names;
};

/** The thing a task is about: what comes after its lead, up to where the posting adds detail («, mínimo 2 años», «(deseable)»). */
function taskSubject(text: string, span: Span, anchors: readonly Anchor[]): string {
  const lead = anchors.find((anchor) => anchor.kind === "lead");
  const phrase = anchors.find((anchor) => anchor.kind === "phrase");
  const from = lead ? lead.end : phrase ? phrase.start : span.start;
  const to = phrase && !lead ? phrase.end : span.end;
  let subject = cleanFragment(text.slice(from, to));
  const stop = fold(subject).search(/\s*(?:\(|,|;|\s-\s)|\s(?:para|de al menos|minimo|durante|preferentemente)\s/);
  if (stop > 0) subject = subject.slice(0, stop);
  return cleanFragment(subject.replace(MARKER_PARENTHESES, ""));
}

function credentialSubject(text: string, span: Span, anchors: readonly Anchor[]): string {
  const anchor = anchors.find((candidate) => candidate.kind === "credential");
  let subject = cleanFragment(text.slice(anchor ? anchor.start : span.start, span.end)).replace(MARKER_PARENTHESES, "");
  const stop = subject.search(/\s*(?:\(|,|;)/);
  if (stop > 0) subject = subject.slice(0, stop);
  return cleanFragment(subject).slice(0, 80);
}

function conditionSubject(text: string, span: Span): string {
  return cleanFragment(text.slice(span.start, span.end).replace(MARKER_PARENTHESES, "")).slice(0, 80);
}

/** Words that say how long or how much, or point back at the job itself, and not what: a task whose subject is only these names nothing. */
const FILLER = new Set([
  "de", "del", "la", "el", "los", "las", "en", "con", "y", "o", "un", "una", "ano", "anos", "mes", "meses", "minimo", "maximo", "previa", "previo",
  "laboral", "comprobable", "demostrable", "solida", "solido", "requerida", "requerido", "si", "no",
  // The job itself, said without saying what it is: «experiencia en el puesto», «en el rubro», «en posiciones similares».
  "puesto", "puestos", "posicion", "posiciones", "tarea", "tareas", "similar", "similares", "afin", "afines", "rubro", "area", "rol", "roles", "funcion",
  "funciones", "empresa", "empresas", "mismo", "misma", "igual", "equivalente", "sector", "industria",
]);

/** Whether a subject names something: a word that is neither a number nor one of the words above. */
const names = (subject: string | undefined): boolean =>
  fold(subject ?? "")
    .split(/[^a-z0-9#+]+/)
    .some((word) => word.length > 1 && !/^\d+$/.test(word) && !FILLER.has(word));

type Reading = {
  type: RequirementType;
  span: Span;
  /** What the clause itself says about how much, if it says. */
  own: Marker | null;
  anchors: Anchor[];
  /** The posting says it does *not* ask for this («no es necesaria experiencia previa»): kept only so that the clauses around it are not joined to it. */
  denied: boolean;
};

const shift = (anchors: readonly Anchor[], by: number): Anchor[] => anchors.map((anchor) => ({ ...anchor, start: anchor.start + by, end: anchor.end + by }));

function readPiece(text: string, folded: string, piece: Piece, all: readonly Anchor[]): Requirement[] {
  const f = folded.slice(piece.start, piece.end);
  if (OFFER_SENTENCE.test(f.replace(/^[^a-z0-9]+/, ""))) return [];

  const anchors = shift(
    all.filter((anchor) => anchor.start >= piece.start && anchor.end <= piece.end),
    -piece.start,
  );
  const markers = markersOf(f);
  const leads = anchors.filter((anchor) => anchor.kind === "lead");
  const frame = SEARCH_FRAME.test(f);

  // Outside the lists, a sentence is a requirement only when it says it is one: a marker, a «experiencia en», or a plain fact about the person.
  let level: Level = "full";
  if (piece.mode === "none") {
    const stated = markers.length > 0 || leads.length > 0;
    const asking = ASKING_SENTENCE.test(f.replace(/^[^a-z0-9]+/, ""));
    const fact = anchors.some((anchor) => anchor.kind === "credential" || (anchor.kind === "condition" && anchor.strong));
    const trait = frame && anchors.some((anchor) => anchor.kind === "trait");
    if (!stated && !asking && !fact && !trait) return [];
    level = stated ? "full" : asking ? "asking" : "strict";
  }

  // The clauses, typed; those that name nothing belong to the one before, and those that say they are not asked are set aside.
  const readings: Reading[] = [];
  clausesOf(f, leads).forEach((clause, index) => {
    const quote = f.slice(clause.start, clause.end);
    const previous = readings[readings.length - 1];
    if ([...quote.matchAll(NOT_NEEDED)].length > 0) {
      readings.push({ type: "other", span: clause, own: null, anchors: [], denied: true });
      return;
    }
    const inside = anchors.filter((anchor) => anchor.start >= clause.start && anchor.start < clause.end);
    const type = typeOfClause(inside, quote, index === 0, level, frame);
    if (type === null) {
      if (previous) {
        previous.span = { start: previous.span.start, end: clause.end };
        previous.anchors.push(...inside);
      }
      return;
    }
    const own = markers.find((marker) => overlaps(marker, clause)) ?? null;
    // Clauses of one kind are one requirement, unless the posting gives them different words: a marker that closes the later one («A y B
    // (excluyente)») or heads the earlier one («Se valorará A y B») covers both; one in the middle of a list («A, B deseable, C») is B's.
    const covers = (reading: Reading) => reading.own !== null && reading.own.start < Math.min(reading.span.end, ...reading.anchors.map((anchor) => anchor.start));
    if (previous && !previous.denied && previous.type === type && (previous.own === null || previous.own.obligation === own?.obligation || (own === null && covers(previous)))) {
      previous.span = { start: previous.span.start, end: clause.end };
      previous.own = previous.own ?? own;
      previous.anchors.push(...inside);
      return;
    }
    readings.push({ type, span: clause, own, anchors: [...inside], denied: false });
  });

  // Where what the piece asks begins — its first lead or name: a marker before that is the piece's, and says its word for everything after.
  const firstReading = readings.find((reading) => !reading.denied);
  const headEnd = firstReading ? Math.min(firstReading.span.end, ...firstReading.anchors.map((anchor) => anchor.start)) : 0;
  const found: Requirement[] = [];
  for (const reading of readings) {
    if (reading.denied) continue;
    let { start } = reading.span;
    // In a description the sentence begins long before the requirement does: the quote begins at the first thing that says it.
    if (piece.mode === "none" && !piece.bulleted && reading.type !== "trait") {
      const marks = [...reading.anchors.map((anchor) => anchor.start), ...markers.filter((marker) => overlaps(marker, reading.span)).map((marker) => marker.start)];
      if (marks.length > 0) {
        let first = Math.max(start, Math.min(...marks));
        // Not inside a bracket: «… (diurnos y nocturnos)» is quoted from its opening.
        const open = f.lastIndexOf("(", first);
        if (open >= start && f.indexOf(")", open) >= first) first = open;
        // «Es indispensable …», «Será valorado …»: the words before a marker that only say how it is said belong to it.
        const before = f.slice(start, first);
        start = /^\s*(?:(?:es|son|sera|seran|ser|se|muy|un|una)\s+){1,2}$/.test(before) ? start : first;
      }
    }
    const absolute = { start: piece.start + start, end: piece.start + reading.span.end };
    const fragment = cleanFragment(text.slice(absolute.start, absolute.end));
    if (fragment.length < 3) continue;

    const where = shift(reading.anchors, piece.start);
    let type = reading.type;
    let subjects =
      reading.type === "tool"
        ? toolNames(reading.anchors)
        : reading.type === "task"
          ? [taskSubject(text, absolute, where)]
          : reading.type === "credential"
            ? [credentialSubject(text, absolute, where)]
            : reading.type === "condition"
              ? [conditionSubject(text, absolute)]
              : [];
    // «Experiencia: 1 año» asks for experience in what the job itself is: nothing anybody could say yes or no to.
    if (type === "task" && !names(subjects[0])) {
      type = "other";
      subjects = [];
    }
    const conditions =
      reading.type === "condition" ? [...new Set(reading.anchors.flatMap((anchor) => (anchor.kind === "condition" && anchor.condition ? [anchor.condition] : [])))] : [];
    found.push({
      fragment,
      type,
      obligation: obligationOf(reading.span, markers, piece.mode, headEnd, piece.bulleted && /\)\s*$/.test(f)),
      subjects: subjects.filter(Boolean),
      conditions,
    });
  }
  return found;
}

/**
 * The posting as it is read: without the marks of Markdown (`**Excel**`, `## Requisitos`, `*ventas*`), which are not part of what it says. A
 * fragment is a literal piece of this text.
 */
export function cleanPosting(text: string): string {
  return text
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/(?<![\p{L}\p{N}*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\p{L}\p{N}*])/gu, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "");
}

/**
 * The requirements a posting states, in the order it states them. Never throws, and never reads past the first `MAX_TEXT` characters. A line
 * of the posting is read as one requirement, or as several if it asks for several different things; what it says about how much applies to what
 * it introduces.
 */
export function readRequirements(text: string): Requirement[] {
  const source = cleanPosting(text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text);
  if (!source.trim()) return [];
  const folded = fold(source);
  const anchors = anchorsOf(source, folded);
  const found: Requirement[] = [];
  const seen = new Set<string>();
  for (const piece of piecesOfPosting(source, folded)) {
    for (const requirement of readPiece(source, folded, piece, anchors)) {
      const key = `${requirement.type}|${fold(requirement.fragment)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(requirement);
      if (found.length >= MAX_REQUIREMENTS) return found;
    }
  }
  return found;
}

/** The kinds of requirement a person can be asked about: something they have done, hold, or can say yes or no to. Never a trait, never anything else. */
export const ASKABLE_TYPES: readonly RequirementType[] = ["tool", "task", "condition", "credential"];

/** Whether a requirement is one to ask about: of a kind that can be asked, and not something the posting itself calls a nicety. */
export const isAskable = (requirement: Requirement): boolean => ASKABLE_TYPES.includes(requirement.type) && requirement.obligation !== "preferred";
