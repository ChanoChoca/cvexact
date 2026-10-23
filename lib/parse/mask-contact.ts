import { foldKeepingLength } from "@/lib/text/normalize";
import { parseDocument } from "./index";
import { CONTACT_LABEL, findEmail, findEmails, findPhones, findUrls, isProfileLink } from "./patterns";
import { classifyHeading } from "./sections";
import type { ParsedContact } from "./types";

/**
 * A person's name and the ways to reach them, taken out of a text before it goes to a model — and put back into what the model says.
 *
 * Reading a document or an answer with the person's own model is what the product asks of it, and what the free tier of a provider says it
 * does not want sent: personal information (`lib/ai/google-terms.ts`). What can be kept from going is what identifies and is not what is
 * read: the name, the email, the phone, and the links that are a profile. A job, a date, a company, a figure are what the model is asked
 * for, and they go. So the model is sent `[NOMBRE_1]` where the name was, `[CORREO_1]`, `[TELEFONO_1]` and `[ENLACE_1]` where the rest were —
 * and what it says back is put right again here (`restore`), before any of it is checked: a quote that held a mark holds what the mark stood
 * for, and is found in the text as the person wrote it.
 *
 * That is why they are marks with a number and not a blank: «Armé el sitio www.acme.com.ar» comes back as a fact with its address, and not
 * with a hole in it. A mark that the model did not copy exactly is not found in the text and is dropped with the quote it was in, like any
 * quote that is not there. And it is why the contact of an import never comes from the model: the model never saw it. It is read from the
 * text by the patterns (`knownContact`), as it always could be.
 *
 * Line by line, and the lines do not move, like `redactPersonalData`. Recognised by shape (an email is one wherever it stands) and by
 * where it stands: a phone number is looked for only where the document keeps its contact details — the lines above its first heading,
 * those under «Contacto» or «Datos personales», and the ones that open with a label like «Tel.:» — because anywhere else a run of
 * digits is a date or a figure. A link is masked there too, and anywhere else only when it is a profile on a site where people keep one
 * (LinkedIn, GitHub…): the address of what someone built is part of what they did. A name is masked wherever it is written, by the name
 * the person has or the one the document opens with.
 *
 * It does not promise more than it recognises: a nickname, a name written once in a sentence, a phone number written out in words, are not
 * taken out. The screens say what goes, and the policy says it (clause 5).
 */

export type MarkKind = "NOMBRE" | "CORREO" | "TELEFONO" | "ENLACE";

/** The mark that stands where something was: `[CORREO_1]`. */
const MARK = /\[(?:NOMBRE|CORREO|TELEFONO|ENLACE)_\d+\]/g;

/** Whether a text holds one of the marks. */
export const hasMark = (text: string): boolean => new RegExp(MARK.source).test(text);

export type Masking = {
  /** The text as it may go: what identifies, replaced by marks. Equal to the text itself when there was nothing to take out. */
  text: string;
  /** What each mark stood for. */
  marks: ReadonlyMap<string, string>;
  /** Puts back what the marks stood for, in any text and in any structure of texts — a model's whole answer, say — and leaves the rest as it is. */
  restore: <T>(value: T) => T;
};

type Options = {
  /**
   * `document`: a CV, with a header and sections. `free`: something said in the person's own words — an answer, a story —, which has
   * no header: only a line that opens with a label is a place for a phone number.
   */
  kind: "document" | "free";
  /** The names to take out wherever they are written: the one the profile has, and the one the document opens with. */
  names?: readonly string[];
};

/** How long a line of contact details can be, and so how long a line can be to be searched for a phone number. */
const CONTACT_LINE_MAX = 120;

/** Words that sit inside a name without being a part of it: «de los Santos», «van der Berg». */
const PARTICLES = new Set(["de", "del", "la", "las", "los", "da", "das", "do", "dos", "di", "van", "von", "y", "e", "bin", "ibn", "al", "el"]);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** How a name is looked for, in text that has been folded: the whole name as it is written, and runs of its words in any order («PÉREZ, Lucía»). */
function patternsFor(name: string): Array<{ pattern: RegExp; distinct: number }> {
  const words = foldKeepingLength(name).split(/[\s,]+/).filter(Boolean);
  // A name of one word is not looked for: a first name alone is as likely to be a word, a place or a company.
  if (words.length < 2) return [];
  const found = [{ pattern: new RegExp(`(?<![a-z0-9])${words.map(escapeRegExp).join("[\\s,]+")}(?![a-z0-9])`, "g"), distinct: 1 }];
  const significant = [...new Set(words.filter((word) => word.length >= 2 && !PARTICLES.has(word)))];
  if (significant.length >= 2) {
    const any = significant.map(escapeRegExp).join("|");
    found.push({ pattern: new RegExp(`(?<![a-z0-9])(?:${any})(?:[\\s,]+(?:${any}))+(?![a-z0-9])`, "g"), distinct: 2 });
  }
  return found;
}

/** Which lines are where a document keeps its contact details: above its first heading, and under «Contacto» and «Datos personales». */
function contactLines(lines: readonly string[], kind: Options["kind"]): boolean[] {
  let inside = kind === "document";
  return lines.map((line) => {
    const heading = classifyHeading(line);
    if (heading !== null) inside = kind === "document" && (heading === "contact" || heading === "personal");
    return inside || CONTACT_LABEL.test(line.trim());
  });
}

export function maskContact(text: string, options: Options): Masking {
  // Decomposed accents are one character each from here on: what is cut out of a line is found in its folded copy by position.
  const lines = text.normalize("NFC").split("\n");
  const marks = new Map<string, string>();
  const byValue = new Map<string, string>();
  const counts: Record<MarkKind, number> = { NOMBRE: 0, CORREO: 0, TELEFONO: 0, ENLACE: 0 };

  /** The mark for one thing: the same address twice is the same mark, so what the model quotes twice comes back as one. */
  const markOf = (kind: MarkKind, value: string): string => {
    const key = `${kind}:${value.trim().toLowerCase()}`;
    const known = byValue.get(key);
    if (known) return known;
    counts[kind] += 1;
    const mark = `[${kind}_${counts[kind]}]`;
    byValue.set(key, mark);
    marks.set(mark, value);
    return mark;
  };

  const replaceAll = (line: string, value: string, kind: MarkKind): string => (value ? line.split(value).join(markOf(kind, value)) : line);

  const names = (options.names ?? []).flatMap(patternsFor);
  const inContact = contactLines(lines, options.kind);

  const masked = lines.map((original, at) => {
    if (original.trim() === "") return original;
    let line = original;
    for (const email of findEmails(line)) line = replaceAll(line, email, "CORREO");
    // The longest first: a link and the same link without its scheme are two things to cut, and the short one is inside the long one.
    const longestFirst = (found: string[]) => [...found].sort((a, b) => b.length - a.length);
    if (inContact[at]) {
      // A line of contact details is short; a paragraph that happens to sit above a heading is not a place to look for digits.
      if (line.length <= CONTACT_LINE_MAX) for (const phone of longestFirst(findPhones(line))) line = replaceAll(line, phone, "TELEFONO");
      for (const url of longestFirst(findUrls(line))) line = replaceAll(line, url, "ENLACE");
    } else {
      for (const url of longestFirst(findUrls(line))) if (isProfileLink(url)) line = replaceAll(line, url, "ENLACE");
    }
    return maskNames(line);
  });

  /** Every place a name is written in a line, found in its folded copy and cut out of the line itself — from the end, so the places do not move. */
  function maskNames(line: string): string {
    if (names.length === 0) return line;
    const folded = foldKeepingLength(line);
    const spans: Array<[number, number]> = [];
    for (const { pattern, distinct } of names) {
      for (const match of folded.matchAll(pattern)) {
        const start = match.index!;
        const end = start + match[0].length;
        // A run of the same word twice is not a name.
        if (distinct > 1 && new Set(match[0].split(/[\s,]+/).filter(Boolean)).size < 2) continue;
        spans.push([start, end]);
      }
    }
    if (spans.length === 0) return line;
    // Overlaps (the whole name and a run inside it) are one place.
    spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged: Array<[number, number]> = [];
    for (const span of spans) {
      const last = merged[merged.length - 1];
      if (last && span[0] < last[1]) last[1] = Math.max(last[1], span[1]);
      else merged.push([span[0], span[1]]);
    }
    let result = line;
    for (const [start, end] of merged.reverse()) result = `${result.slice(0, start)}${markOf("NOMBRE", line.slice(start, end))}${result.slice(end)}`;
    return result;
  }

  // Numbered as they are read, whatever order they were found in: the first name is `[NOMBRE_1]`, the second `[NOMBRE_2]`.
  const joined = masked.join("\n");
  const renamed = new Map<string, string>();
  const next: Record<MarkKind, number> = { NOMBRE: 0, CORREO: 0, TELEFONO: 0, ENLACE: 0 };
  for (const [mark] of joined.matchAll(MARK)) {
    if (renamed.has(mark)) continue;
    const kind = mark.slice(1, mark.indexOf("_")) as MarkKind;
    next[kind] += 1;
    renamed.set(mark, `[${kind}_${next[kind]}]`);
  }
  const numbered = joined.replace(MARK, (mark) => renamed.get(mark) ?? mark);
  const stood = new Map([...marks].map(([mark, value]) => [renamed.get(mark) ?? mark, value]));

  const restoreString = (value: string): string => value.replace(MARK, (mark) => stood.get(mark) ?? mark);
  function restore<T>(value: T): T {
    if (typeof value === "string") return restoreString(value) as T;
    if (Array.isArray(value)) return value.map((item) => restore(item)) as T;
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, restore(item)])) as T;
    }
    return value;
  }

  return { text: numbered, marks: stood, restore };
}

/**
 * What a text says of who someone is, read by the patterns — the name its header opens with, the email, the phone, the links — and never
 * by a model. An email found anywhere stands in for the one the header does not give: it is the one thing in a CV that cannot be taken for
 * anything else.
 */
export function knownContact(text: string): ParsedContact {
  const read = parseDocument({ text }).contact;
  if (read.email) return read;
  const email = findEmail(text);
  return email ? { ...read, email: { value: email, quote: email } } : read;
}
