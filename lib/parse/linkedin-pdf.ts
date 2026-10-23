import { linkKey } from "@/lib/schemas/profile";
import { factsFrom, itemsOf } from "./cv-heuristic";
import { fold } from "./dictionaries";
import { isFooter, layoutOf, WRAP_LIMIT } from "./lines";
import {
  extractDateRange,
  extractTrailingDate,
  findEmail,
  findPhone,
  findUrls,
  isDurationOnly,
  linkLabel,
  parsePlace,
  isCountry,
} from "./patterns";
import { REDACTED, redactLines } from "./redact";
import { classifyHeading, type SectionKind } from "./sections";
import {
  weakest,
  type Confidence,
  type Doubt,
  type Line,
  type ParsedContact,
  type ParsedDocument,
  type ParsedEducation,
  type ParsedExperience,
  type ParsedLanguage,
  type ParsedProject,
  type ParsedUnassigned,
  type Quoted,
} from "./types";

/**
 * Reading the PDF LinkedIn generates from a profile ("Guardar como PDF").
 *
 * That file is the one document whose layout can be relied on: it comes out of
 * the same template for everyone — a narrow sidebar on the left holding contact
 * details, top skills, languages and certifications, and a main column with the
 * name, headline, location, summary, experience and education — and inside the
 * main column what a line *is* shows in how large it is. The name is the
 * largest text, section headings are a step down, a company is set slightly
 * larger than the role under it, and everything else is body text. Reading by
 * size and position instead of by pattern is what makes the company/role split,
 * the one thing a CV parser cannot do reliably, dependable here.
 *
 * The numbers below are that template's, measured on exports and reported by
 * others who parse them. They are read relative to the document's own body size
 * where possible, so a small change in the template does not silently break the
 * reading — and where the structure is not recognised at all, this returns
 * `null` and the caller falls back to the general reader, which marks what it
 * cannot be sure of.
 */

export type PdfInfo = {
  author?: string;
  subject?: string;
  title?: string;
  producer?: string;
  /** When the PDF says it was made, and last saved, in ISO. */
  created?: string;
  modified?: string;
};

/** Left of this is the sidebar, in points. The template is A4/Letter-wide. */
const SIDEBAR_MAX_X = 150;
/** Footer text ("Page 1 of 3") is set smaller than anything else. */
const FOOTER_MAX_SIZE = 9.5;
/** A gap this many font sizes wide starts a new paragraph; less is a wrapped line. */
const PARAGRAPH_GAP = 1.8;
const LOCATION_GAP = 1.5;
/** A line ending short of this fraction of the column's own widest line is a complete one, not a line word-wrap broke short of the edge. */
const ENDS_EARLY = 0.8;

/**
 * How far right the main column's text actually reaches — its widest line —
 * which is what "ends early" is measured against.
 */
function columnWidth(lines: readonly Positioned[]): number {
  return Math.max(0, ...lines.map((line) => line.width ?? 0));
}

/**
 * A line far short of the column's own widest line is a complete statement on
 * its own, whatever the vertical gap to the next line says: LinkedIn sets
 * consecutive one-line bullets ("Desarrollo en backend: …", "Desarrollo en
 * frontend: …", a bare URL) with the *same* leading a genuinely wrapped
 * paragraph uses between its own lines, so the vertical gap alone cannot tell
 * "this wrapped" from "this is another, separate line" — but a wrapped line
 * runs to (or past) the edge before breaking, and a complete one rarely does.
 */
function endsEarly(line: Positioned, colWidth: number): boolean {
  return colWidth > 0 && (line.width ?? 0) < colWidth * ENDS_EARLY;
}

/**
 * Whether this PDF was made by LinkedIn. The file says so in its metadata; when
 * the metadata is missing (a print-to-PDF of the page, a re-saved copy) the
 * shape of the text has to say it instead, and is trusted less.
 */
export function isLinkedInPdf(info: PdfInfo | undefined, lines: readonly Line[]): boolean {
  if (info?.author?.trim().toLowerCase() === "linkedin") return true;
  if (/generated from profile/i.test(info?.subject ?? "")) return true;

  // Page footers are already gone by the time lines exist, so what gives it away
  // is the profile address plus the template's own headings. Generic ones —
  // "Contacto", "Idiomas", "Experiencia" — are on every CV, so they prove nothing;
  // "Top Skills" (or "Aptitudes principales") is LinkedIn's own label for the
  // block in the sidebar, and it is what the shape check hinges on. Calling an
  // ordinary CV LinkedIn's would put "De LinkedIn" on values that are not.
  const text = lines.map((line) => line.text).join("\n");
  if (!/linkedin\.com\/in\//i.test(text)) return false;
  const headings = new Set(lines.map((line) => fold(line.text).trim()));
  const has = (...names: string[]) => names.some((name) => headings.has(name));
  return (
    has("contact", "contacto", "contactar") &&
    has("top skills", "aptitudes principales") &&
    has("experience", "experiencia", "education", "educacion", "summary", "extracto", "resumen")
  );
}

// --- Geometry ------------------------------------------------------------------------------

type Positioned = Line & { x: number; y: number; size: number; page: number };

const isPositioned = (line: Line): line is Positioned =>
  line.x !== undefined && line.y !== undefined && line.size !== undefined && line.page !== undefined;

const gapBetween = (prev: Positioned | null, line: Positioned): number =>
  !prev || prev.page !== line.page ? Infinity : prev.y - line.y;

const continues = (prev: Positioned | null, line: Positioned): boolean => gapBetween(prev, line) <= line.size * WRAP_LIMIT;

/** Puts a line broken at a hyphen back together without a space: "Marke-" + "ting". */
function joinWrapped(prev: string, next: string): string {
  if (!prev) return next;
  return /[a-záéíóúñü]-$/i.test(prev) && /^[a-záéíóúñü]/.test(next) ? prev + next : `${prev} ${next}`;
}

/**
 * The document's own body size — everything that is not the name, a heading,
 * a company or a role.
 *
 * Not simply the size with the most characters: a long "Extracto" paragraph
 * set a touch larger than the body — this template does exactly that — would
 * otherwise outweigh the real body text on character count alone and throw
 * off every size class built on it, since `classifier` measures company and
 * role sizes as multiples of whatever this returns. The smallest size
 * substantial enough to be a real candidate — a handful of lines, or a real
 * share of the column's text — is the body; a paragraph merely larger than it
 * is content, not the unit everything else is measured against.
 */
function bodySizeOf(lines: readonly Positioned[]): number {
  const totalChars = lines.reduce((sum, line) => sum + line.text.length, 0);
  const bySize = new Map<number, { chars: number; lines: number }>();
  for (const line of lines) {
    const size = Math.round(line.size * 10) / 10;
    const entry = bySize.get(size) ?? { chars: 0, lines: 0 };
    entry.chars += line.text.length;
    entry.lines += 1;
    bySize.set(size, entry);
  }

  const substantial = [...bySize.entries()]
    .filter(([, entry]) => entry.lines >= 3 || entry.chars >= 0.1 * totalChars)
    .sort((a, b) => a[0] - b[0]);
  if (substantial.length > 0) return substantial[0]![0];

  // Nothing substantial by either measure — too short a document to trust
  // that rule. Fall back to the previous one: whichever size carries the
  // most characters.
  let best = 10.5;
  let bestWeight = 0;
  for (const [size, entry] of bySize) {
    if (entry.chars > bestWeight) {
      best = size;
      bestWeight = entry.chars;
    }
  }
  return best;
}

type SizeClass = "name" | "heading" | "company" | "role" | "body";

function classifier(body: number) {
  return (size: number): SizeClass => {
    if (size >= body * 1.9) return "name";
    if (size >= body * 1.4) return "heading";
    if (size >= body * 1.12) return "company";
    if (size >= body * 1.05) return "role";
    return "body";
  };
}

const quoted = <T>(value: T, quote: string): Quoted<T> => ({ value, quote });

// --- The sidebar -----------------------------------------------------------------------------

type SidebarKind = "contact" | "skills" | "languages" | "certifications" | "other";

function sidebarKind(heading: string): SidebarKind {
  const kind = classifyHeading(heading);
  if (kind === "contact") return "contact";
  if (kind === "skills") return "skills";
  if (kind === "languages") return "languages";
  if (kind === "certifications") return "certifications";
  return "other";
}

type SidebarItems = Record<SidebarKind, string[]>;

function readSidebar(lines: readonly Positioned[], body: number): SidebarItems {
  const items: SidebarItems = { contact: [], skills: [], languages: [], certifications: [], other: [] };
  let section: SidebarKind | null = null;
  let heading: string[] = [];
  let prev: Positioned | null = null;

  for (const line of lines) {
    // A heading is set larger than the text under it.
    if (line.size >= body * 1.2) {
      heading = section === null && prev && prev.size >= body * 1.2 && continues(prev, line) ? [...heading, line.text] : [line.text];
      section = null;
      prev = line;
      continue;
    }
    if (section === null) {
      section = sidebarKind(heading.join(" "));
      heading = [];
    }
    const list = items[section];
    if (list.length > 0 && prev && prev.size < body * 1.2 && continues(prev, line)) {
      list[list.length - 1] = joinWrapped(list[list.length - 1]!, line.text);
    } else {
      list.push(line.text);
    }
    prev = line;
  }
  return items;
}

const TRAILING_PAREN = /\s*\(([^)]*)\)\s*$/;

function readContact(items: readonly string[]): { contact: ParsedContact; leftover: string[] } {
  const contact: ParsedContact = { links: [] };
  const leftover: string[] = [];
  for (const raw of items) {
    const label = raw.match(TRAILING_PAREN)?.[1]?.trim() ?? "";
    const text = raw.replace(TRAILING_PAREN, "").replace(/\s+/g, " ").trim();
    const email = findEmail(text);
    if (email && !contact.email) {
      contact.email = quoted(email, raw);
      continue;
    }
    const compact = text.replace(/\s+/g, "");
    if (/linkedin\.com\/in\//i.test(compact)) {
      const url = compact;
      if (!contact.links.some((link) => linkKey(link.value.url) === linkKey(url))) {
        contact.links.push(quoted({ label: linkLabel(url).slice(0, 60), url }, raw));
      }
      continue;
    }
    const urls = findUrls(compact);
    if (urls.length > 0 && !/^[+()\d\s.-]+$/.test(text)) {
      for (const url of urls) {
        if (!contact.links.some((link) => linkKey(link.value.url) === linkKey(url))) contact.links.push(quoted({ label: linkLabel(url).slice(0, 60), url }, raw));
      }
      continue;
    }
    const phone = findPhone(text);
    if (phone && !contact.phone && (/mobile|m[oó]vil|phone|tel|home|work|casa|trabajo/i.test(label) || /^[+()\d\s.-]+$/.test(text))) {
      contact.phone = quoted(phone, raw);
      continue;
    }
    leftover.push(raw);
  }
  return { contact, leftover };
}

/** "English (Native or Bilingual)": the level is what is in the parentheses, as written. */
function readLanguages(items: readonly string[]): ParsedLanguage[] {
  const out: ParsedLanguage[] = [];
  for (const raw of items) {
    const level = raw.match(TRAILING_PAREN)?.[1]?.trim();
    const name = raw.replace(TRAILING_PAREN, "").trim();
    if (!name || name.length > 40) continue;
    const entry: ParsedLanguage = { name: quoted(name, raw) };
    if (level) entry.level = quoted(level, raw);
    if (!out.some((l) => fold(l.name.value) === fold(name))) out.push(entry);
  }
  return out;
}

// --- The main column -------------------------------------------------------------------------------

type DraftRole = {
  company: { text: string; quote: string };
  title: { text: string; quote: string };
  range: ReturnType<typeof extractDateRange>;
  location: string | null;
  expectLocation: boolean;
  description: Positioned[];
  from: number;
  to: number;
};

function placeFrom(text: string): { city?: string; country?: string; quote: string } | null {
  const place = parsePlace(text);
  if (place) return place;
  const trimmed = text.trim();
  if (isCountry(trimmed)) return { country: trimmed, quote: trimmed };
  // "Remote", "Hybrid" and the like are not places; a bare capitalised name is a city.
  if (/^\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*){0,2}$/u.test(trimmed) && !/remot|h[ií]brid|hybrid|presencial|on-?site/i.test(trimmed)) {
    return { city: trimmed, quote: trimmed };
  }
  return null;
}

function finishRole(role: DraftRole, kind: "job" | "volunteer", colWidth: number): { entry: ParsedExperience; links: Quoted<string>[] } {
  const doubts: Doubt[] = [];
  if (!role.company.text) doubts.push("no_company");
  if (!role.title.text) doubts.push("no_role");
  if (!role.range) doubts.push("no_dates");
  const items = itemsOf(
    role.description.map((line, i, all) => ({
      ...line,
      index: line.index,
      gapBefore:
        i === 0 ||
        gapBetween(all[i - 1]!, line) > line.size * PARAGRAPH_GAP ||
        // The line before this one was already a complete statement of its
        // own — see `endsEarly` — so this one starts fresh whatever the gap.
        endsEarly(all[i - 1]!, colWidth),
    })),
  );
  const { facts, links } = factsFrom(items, true);
  const entry: ParsedExperience = {
    kind,
    facts,
    confidence: doubts.length === 0 ? "high" : role.company.text || role.title.text ? "medium" : "low",
    doubts,
    span: [role.from, role.to],
  };
  if (role.company.text) entry.company = quoted(role.company.text, role.company.quote);
  if (role.title.text) entry.role = quoted(role.title.text, role.title.quote);
  if (role.range) {
    entry.start = { value: role.range.start.value, quote: role.range.start.quote };
    entry.end = { value: role.range.end.value, quote: role.range.end.quote };
  }
  const place = role.location ? placeFrom(role.location) : null;
  if (place?.city) entry.city = quoted(place.city, place.quote);
  if (place?.country) entry.country = quoted(place.country, place.quote);
  if (kind === "volunteer") entry.employmentType = quoted("volunteer", "voluntariado");
  return { entry, links };
}

/**
 * The experience (or volunteer) section, line by line.
 *
 * A company is set larger than a role and appears once for all the roles held
 * there, so it is remembered until another company line replaces it. A role opens
 * an entry; the line under it is the dates, the one under that the place, and
 * whatever follows is the description. A duration on its own ("2 años 3 meses")
 * under a company is how long in total, not something to read.
 */
function readExperience(
  lines: readonly Positioned[],
  classify: (size: number) => SizeClass,
  kind: "job" | "volunteer",
  colWidth: number,
): { entries: ParsedExperience[]; links: ParsedUnassigned[] } {
  const roles: DraftRole[] = [];
  let company = { text: "", quote: "" };
  let prev: Positioned | null = null;

  for (const line of lines) {
    const size = classify(line.size);
    const current = roles[roles.length - 1];
    if (size === "company") {
      company =
        prev && classify(prev.size) === "company" && continues(prev, line)
          ? { text: joinWrapped(company.text, line.text), quote: `${company.quote} ${line.text}`.trim() }
          : { text: line.text, quote: line.text };
    } else if (size === "role") {
      if (current && prev && classify(prev.size) === "role" && continues(prev, line) && !current.range) {
        current.title = { text: joinWrapped(current.title.text, line.text), quote: `${current.title.quote} ${line.text}` };
        current.to = line.index;
      } else {
        roles.push({
          company,
          title: { text: line.text, quote: line.text },
          range: null,
          location: null,
          expectLocation: false,
          description: [],
          from: line.index,
          to: line.index,
        });
      }
    } else if (current) {
      const range = !current.range ? extractDateRange(line.text) : null;
      if (range) {
        current.range = range;
        current.expectLocation = true;
      } else if (current.expectLocation && gapBetween(prev, line) <= line.size * LOCATION_GAP) {
        current.location = line.text;
        current.expectLocation = false;
      } else if (!current.range && isDurationOnly(line.text)) {
        // How long in total, under a company that held several roles.
      } else {
        current.expectLocation = false;
        current.description.push(line);
      }
      current.to = line.index;
    }
    prev = line;
  }
  const results = roles.map((role) => finishRole(role, kind, colWidth));
  const entries = results.map((result) => result.entry);
  const links = results.flatMap((result, i) =>
    result.links.map((link) => ({
      text: link.value,
      kind: "link" as const,
      heading: entries[i]!.company?.value || entries[i]!.role?.value || undefined,
    })),
  );
  return { entries, links };
}

/**
 * How wide a gap the education section's own degree line still joins across —
 * looser than the general `continues()`. LinkedIn wraps its field-of-study
 * line ("…INFORMATION SCIENCES AND\nSUPPORT SERVICES") with more leading
 * than an ordinary paragraph uses, and losing that second line loses the
 * dates that sit right after it.
 */
const DEGREE_WRAP = 2.2;
const degreeContinues = (prev: Positioned | null, line: Positioned): boolean => gapBetween(prev, line) <= line.size * DEGREE_WRAP;

/**
 * LinkedIn appends its own standardised field-of-study after whatever the
 * person actually wrote, in shouting case: "Analista de Sistemas, COMPUTER
 * AND INFORMATION SCIENCES AND SUPPORT SERVICES". Only the part they wrote
 * is a degree worth keeping; short enough to be an acronym ("UBA") is left
 * alone; a real name in Spanish, mixed case, is left alone regardless of
 * length.
 */
function withoutFieldOfStudy(text: string): string {
  return text.replace(/,\s*\p{Lu}[\p{Lu}\s&/-]{3,}$/u, "").trim();
}

function readEducation(lines: readonly Positioned[], classify: (size: number) => SizeClass): ParsedEducation[] {
  type Draft = { institution: string; degree: string; done: boolean; from: number; to: number; quote: string };
  const drafts: Draft[] = [];
  let prev: Positioned | null = null;

  for (const line of lines) {
    const size = classify(line.size);
    const entry = drafts[drafts.length - 1];
    if (size === "company" || size === "role") {
      if (entry && !entry.degree && prev && classify(prev.size) !== "body" && continues(prev, line)) {
        entry.institution = joinWrapped(entry.institution, line.text);
        entry.quote = `${entry.quote} ${line.text}`;
      } else {
        drafts.push({ institution: line.text, degree: "", done: false, from: line.index, to: line.index, quote: line.text });
      }
    } else if (entry && !entry.done) {
      if (entry.degree && !degreeContinues(prev, line)) {
        entry.done = true;
      } else {
        entry.degree = joinWrapped(entry.degree, line.text);
        // The years close the degree line: "Grado en ADE · (2013 - 2017)".
        if (/\(\s*(?:19|20)\d{2}[^)]*\)\s*$/.test(entry.degree)) entry.done = true;
      }
      entry.to = line.index;
    }
    prev = line;
  }

  return drafts.map((draft) => {
    const range = extractDateRange(draft.degree);
    const single = range ? null : extractTrailingDate(draft.degree.replace(/[\s·]*\(\s*([^)]*)\)\s*$/, " $1"));
    const degreeText = withoutFieldOfStudy(
      (range ? range.rest : single ? single.rest : draft.degree).replace(/[\s·(),-]+$/g, "").replace(/^[\s·]+/, "").trim(),
    );
    const doubts: Doubt[] = [];
    if (!degreeText) doubts.push("no_degree");
    const entry: ParsedEducation = {
      confidence: doubts.length === 0 ? "high" : "medium",
      doubts,
      span: [draft.from, draft.to],
    };
    entry.institution = quoted(draft.institution, draft.quote);
    if (degreeText) entry.degree = quoted(degreeText, draft.degree);
    if (range) {
      entry.start = { value: range.start.value, quote: range.start.quote };
      entry.end = { value: range.end.value, quote: range.end.quote };
    } else if (single) {
      entry.end = { value: single.value, quote: single.quote };
    }
    return entry;
  });
}

function readProjects(lines: readonly Positioned[], classify: (size: number) => SizeClass): ParsedProject[] {
  const projects: Array<{ name: string; body: string[] }> = [];
  for (const line of lines) {
    const size = classify(line.size);
    if (size === "company" || size === "role") projects.push({ name: line.text, body: [] });
    else if (projects.length > 0 && !extractDateRange(line.text)) projects[projects.length - 1]!.body.push(line.text);
  }
  return projects.map(({ name, body }) => {
    const description = body.join(" ").replace(/\s+/g, " ").trim();
    const url = findUrls(`${name} ${description}`)[0];
    const project: ParsedProject = { name: quoted(name, name) };
    if (description) project.description = quoted(description.slice(0, 800), description);
    if (url) project.url = quoted(url, url);
    return project;
  });
}

// --- The document ----------------------------------------------------------------------------------------

/**
 * Reads a LinkedIn PDF from its positioned lines (`linesFromRuns`, before any
 * column reordering). Returns `null` when the lines are not positioned or the
 * template's structure is not there.
 */
export function parseLinkedInPdf(input: readonly Line[]): ParsedDocument | null {
  const all = input.filter(isPositioned);
  if (all.length < 5) return null;

  const content = all
    .filter((line) => line.size > FOOTER_MAX_SIZE && !isFooter(line.text))
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const side = content.filter((line) => line.x < SIDEBAR_MAX_X);
  const main = content.filter((line) => line.x >= SIDEBAR_MAX_X);
  if (main.length < 3) return null;

  const body = bodySizeOf(main);
  const classify = classifier(body);
  if (!main.some((line) => classify(line.size) === "name") || !main.some((line) => classify(line.size) === "heading")) return null;
  const colWidth = columnWidth(main);

  const sidebar = readSidebar(side, body);
  const { contact, leftover } = readContact(sidebar.contact);

  // --- Main column: name, headline, place, then sections ---
  let name = "";
  const header: Positioned[] = [];
  let section: SectionKind | "header" | "other" = "header";
  const bySection = new Map<string, { kind: SectionKind | "other"; heading: string; lines: Positioned[] }>();
  let order = 0;
  let current: { kind: SectionKind | "other"; heading: string; lines: Positioned[] } | null = null;

  for (const line of main) {
    const size = classify(line.size);
    if (size === "name") {
      name = joinWrapped(name, line.text);
    } else if (size === "heading") {
      section = classifyHeading(line.text) ?? "other";
      current = { kind: section, heading: line.text, lines: [] };
      bySection.set(`${order++}:${section}`, current);
    } else if (section === "header") {
      header.push(line);
    } else if (current) {
      current.lines.push(line);
    }
  }

  // The copy kept of the document, without what the product does not read: a PDF of a profile has no birth date to
  // show, but a "Contacto" with a document number or an address is as much a part of one a person can have written.
  const copy = redactLines(input);
  const doc: ParsedDocument = {
    kind: "linkedin_pdf",
    contact,
    experience: [],
    education: [],
    certifications: [],
    languages: readLanguages(sidebar.languages),
    skills: sidebar.skills.map((skill) => quoted(skill.replace(/\s+/g, " ").trim(), skill)).filter((skill) => skill.value),
    projects: [],
    unassigned: [],
    omittedPersonalData: copy.filter((line) => line === REDACTED).length,
    confidence: "low",
    lineCount: content.length,
    lines: copy,
    layout: layoutOf(input),
  };

  if (name.trim()) doc.contact.fullName = quoted(name.replace(/\s+/g, " ").trim(), name);
  // The last header line is where they are; what comes before it is what they do.
  if (header.length >= 2) {
    const place = header[header.length - 1]!;
    const located = placeFrom(place.text);
    if (located?.city) doc.contact.city = quoted(located.city, located.quote);
    if (located?.country) doc.contact.country = quoted(located.country, located.quote);
    const headline = header.slice(0, -1).reduce((acc, line) => joinWrapped(acc, line.text), "");
    if (headline) doc.contact.headline = quoted(headline.replace(/\s+/g, " ").trim(), headline);
  } else if (header.length === 1) {
    const headline = header[0]!.text;
    doc.contact.headline = quoted(headline, headline);
  }

  const unassigned: ParsedUnassigned[] = doc.unassigned;
  for (const { kind, heading, lines } of bySection.values()) {
    if (lines.length === 0) continue;
    switch (kind) {
      case "summary": {
        const paragraphs: string[] = [];
        let last: Positioned | null = null;
        for (const line of lines) {
          if (paragraphs.length === 0) paragraphs.push(line.text);
          else if (gapBetween(last, line) > line.size * PARAGRAPH_GAP || (last && endsEarly(last, colWidth))) paragraphs.push(line.text);
          else paragraphs[paragraphs.length - 1] = joinWrapped(paragraphs[paragraphs.length - 1]!, line.text);
          last = line;
        }
        unassigned.push({ text: paragraphs.join("\n\n"), kind: "summary", heading });
        break;
      }
      case "experience": {
        const { entries, links } = readExperience(lines, classify, "job", colWidth);
        doc.experience.push(...entries);
        unassigned.push(...links.map((link) => ({ ...link, heading: link.heading ?? heading })));
        break;
      }
      case "volunteer": {
        const { entries, links } = readExperience(lines, classify, "volunteer", colWidth);
        doc.experience.push(...entries);
        unassigned.push(...links.map((link) => ({ ...link, heading: link.heading ?? heading })));
        break;
      }
      case "education":
        doc.education.push(...readEducation(lines, classify));
        break;
      case "projects":
        doc.projects.push(...readProjects(lines, classify));
        break;
      case "certifications": {
        for (const line of lines) doc.certifications.push({ name: quoted(line.text, line.text) });
        break;
      }
      default:
        unassigned.push({ text: lines.map((line) => line.text).join("\n"), kind: kind === "awards" ? "awards" : "other", heading });
    }
  }

  for (const cert of sidebar.certifications) {
    const name = cert.replace(/\s+/g, " ").trim();
    if (name) doc.certifications.push({ name: quoted(name, cert) });
  }
  if (sidebar.other.length > 0) {
    unassigned.push({ text: sidebar.other.join("\n"), kind: "awards" });
  }
  for (const text of leftover) unassigned.push({ text, kind: "other", heading: "Contacto" });

  const blocks = [...doc.experience, ...doc.education];
  doc.confidence =
    blocks.length === 0
      ? "low"
      : blocks.filter((block) => block.confidence === "low").length / blocks.length >= 0.5
        ? "low"
        : (weakest(...blocks.map((block) => block.confidence)) as Confidence);
  return doc;
}

