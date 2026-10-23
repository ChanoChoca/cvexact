import { toDateValue, withoutCurrent } from "@/lib/profile/dates";
import { factsFrom, itemsOf } from "./cv-heuristic";
import { linesFromText } from "./lines";
import { parseCsv, pick, type CsvTable } from "./csv";
import { findEmail, findPhone, linkLabel, parsePlace, isCountry } from "./patterns";
import {
  weakest,
  type Doubt,
  ParsedContact,
  ParsedDocument,
  ParsedEducation,
  ParsedExperience,
  Quoted,
} from "./types";

/**
 * Reading the CSV files of LinkedIn's data export ("Descargar tus datos").
 *
 * More structured than the PDF — a company, a title and two dates are columns,
 * not lines to tell apart — and slower to get: LinkedIn prepares the archive and
 * mails a link. Every file is optional, names and columns are matched without
 * regard to case, and a column that is not recognised is ignored, because what
 * LinkedIn puts in the archive has changed before and will again.
 */

/** File names (lower case, no folder, no extension) mapped to their text. */
export type CsvFiles = Record<string, string>;

const FILES = {
  profile: ["profile"],
  positions: ["positions"],
  education: ["education"],
  skills: ["skills"],
  languages: ["languages"],
  certifications: ["certifications"],
  projects: ["projects"],
  emails: ["email addresses", "emailaddresses"],
  phones: ["phonenumbers", "phone numbers"],
} as const;

/** The names of the files this reader looks at. The ZIP reader opens nothing else. */
export const WANTED_FILES: readonly string[] = Object.values(FILES).flat();

function table(files: CsvFiles, names: readonly string[], expect: readonly string[]): CsvTable | null {
  for (const name of names) {
    const text = files[name];
    if (text !== undefined) return parseCsv(text, expect);
  }
  return null;
}

const quoted = <T>(value: T, quote: string): Quoted<T> => ({ value, quote });

function endValue(text: string) {
  const value = toDateValue(text);
  // An empty "Finished On" is how LinkedIn writes a position that has not ended.
  return text.trim() === "" ? { value: { current: true as const }, quote: "" } : { value, quote: text.trim() };
}

/** LinkedIn's "Websites" cell: `[COMPANY:https://a.com],[PERSONAL:https://b.com]`. */
function websites(cell: string): string[] {
  return [...cell.matchAll(/\[[A-Za-z_ ]+:\s*([^\]\s]+)\s*\]/g)].map((m) => m[1]!);
}

export function parseLinkedInExport(files: CsvFiles): ParsedDocument | null {
  const profile = table(files, FILES.profile, ["First Name", "Last Name", "Headline"]);
  const positions = table(files, FILES.positions, ["Company Name", "Title", "Started On"]);
  const education = table(files, FILES.education, ["School Name", "Degree Name"]);
  const skills = table(files, FILES.skills, ["Name"]);
  const languages = table(files, FILES.languages, ["Name", "Proficiency"]);
  const certifications = table(files, FILES.certifications, ["Name", "Authority"]);
  const projects = table(files, FILES.projects, ["Title", "Description"]);
  const emails = table(files, FILES.emails, ["Email Address"]);
  const phones = table(files, FILES.phones, ["Number"]);

  if (![profile, positions, education, skills, languages, certifications, projects].some((t) => t && t.rows.length > 0)) {
    return null;
  }

  const contact: ParsedContact = { links: [] };
  const unassigned: ParsedDocument["unassigned"] = [];
  let omitted = 0;

  const row = profile?.rows[0];
  if (row) {
    const name = [pick(row, "First Name"), pick(row, "Last Name")].filter(Boolean).join(" ");
    if (name) contact.fullName = quoted(name, name);
    const headline = pick(row, "Headline");
    if (headline) contact.headline = quoted(headline, headline);
    const summary = pick(row, "Summary");
    if (summary) unassigned.push({ text: summary, kind: "summary", heading: "Extracto" });
    const geo = pick(row, "Geo Location", "Location");
    const place = geo ? parsePlace(geo.replace(/\s*Area$/i, "")) : null;
    if (place) {
      contact.city = quoted(place.city, geo);
      contact.country = quoted(place.country, geo);
    } else if (geo) {
      const first = geo.split(",")[0]!.trim();
      const last = geo.split(",").slice(-1)[0]!.trim();
      if (first && geo.includes(",")) contact.city = quoted(first, geo);
      if (isCountry(last)) contact.country = quoted(last, geo);
    }
    for (const url of websites(pick(row, "Websites"))) {
      contact.links.push(quoted({ label: linkLabel(url).slice(0, 60), url }, url));
    }
    // Birth date and street address are in the file and are never read.
    if (pick(row, "Birth Date")) omitted += 1;
    if (pick(row, "Address")) omitted += 1;
  }
  const primary = emails?.rows.find((r) => /^yes|true|s[ií]$/i.test(pick(r, "Primary"))) ?? emails?.rows[0];
  const email = primary ? findEmail(pick(primary, "Email Address")) : null;
  if (email) contact.email = quoted(email, email);
  const phoneRow = phones?.rows[0];
  const phone = phoneRow ? findPhone(pick(phoneRow, "Number")) : null;
  if (phone) contact.phone = quoted(phone, phone);

  // --- Positions ---
  const experience: ParsedExperience[] = [];
  (positions?.rows ?? []).forEach((r, i) => {
    const company = pick(r, "Company Name", "Company");
    const title = pick(r, "Title", "Position");
    const started = pick(r, "Started On", "Start Date");
    const finished = pick(r, "Finished On", "End Date");
    if (!company && !title) return;

    const doubts: Doubt[] = [];
    if (!company) doubts.push("no_company");
    if (!title) doubts.push("no_role");
    if (!started) doubts.push("no_dates");
    const description = pick(r, "Description");
    const lines = linesFromText(description);
    const { facts, links } = factsFrom(itemsOf(lines), true);
    for (const link of links) unassigned.push({ text: link.value, kind: "link", heading: company || title || undefined });
    const entry: ParsedExperience = {
      kind: "job",
      facts,
      confidence: doubts.length === 0 ? "high" : company || title ? "medium" : "low",
      doubts,
      span: [i, i],
    };
    if (company) entry.company = quoted(company, company);
    if (title) entry.role = quoted(title, title);
    if (started) {
      entry.start = quoted(withoutCurrent(toDateValue(started)), started);
      entry.end = endValue(finished);
    }
    const location = pick(r, "Location");
    const place = location ? parsePlace(location) : null;
    if (place) {
      entry.city = quoted(place.city, location);
      entry.country = quoted(place.country, location);
    } else if (location) {
      entry.city = quoted(location.split(",")[0]!.trim(), location);
    }
    experience.push(entry);
  });

  // --- Education ---
  const educationEntries: ParsedEducation[] = (education?.rows ?? [])
    .filter((r) => pick(r, "School Name", "School"))
    .map((r, i) => {
      const school = pick(r, "School Name", "School");
      const degree = pick(r, "Degree Name", "Degree");
      const doubts: Doubt[] = degree ? [] : ["no_degree"];
      const entry: ParsedEducation = { confidence: degree ? "high" : "medium", doubts, span: [i, i] };
      entry.institution = quoted(school, school);
      if (degree) entry.degree = quoted(degree, degree);
      const start = pick(r, "Start Date", "Started On");
      const end = pick(r, "End Date", "Finished On");
      if (start) entry.start = quoted(withoutCurrent(toDateValue(start)), start);
      if (end) entry.end = quoted(toDateValue(end), end);
      const notes = [pick(r, "Notes"), pick(r, "Activities")].filter(Boolean).join("\n");
      if (notes) unassigned.push({ text: notes, kind: "other", heading: `Formación · ${school}` });
      return entry;
    });

  const doc: ParsedDocument = {
    kind: "linkedin_csv",
    contact,
    experience,
    education: educationEntries,
    certifications: (certifications?.rows ?? [])
      .filter((r) => pick(r, "Name"))
      .map((r) => {
        const name = pick(r, "Name");
        const cert: ParsedDocument["certifications"][number] = { name: quoted(name, name) };
        const issuer = pick(r, "Authority");
        if (issuer) cert.issuer = quoted(issuer, issuer);
        const started = pick(r, "Started On", "Start Date");
        if (started) cert.date = quoted(withoutCurrent(toDateValue(started)), started);
        return cert;
      }),
    languages: (languages?.rows ?? [])
      .filter((r) => pick(r, "Name"))
      .map((r) => {
        const name = pick(r, "Name");
        const level = pick(r, "Proficiency");
        return level ? { name: quoted(name, name), level: quoted(level, level) } : { name: quoted(name, name) };
      }),
    skills: (skills?.rows ?? [])
      .map((r) => pick(r, "Name"))
      .filter(Boolean)
      .map((skill) => quoted(skill, skill)),
    projects: (projects?.rows ?? [])
      .filter((r) => pick(r, "Title"))
      .map((r) => {
        const title = pick(r, "Title");
        const description = pick(r, "Description");
        const url = pick(r, "Url");
        const project: ParsedDocument["projects"][number] = { name: quoted(title, title) };
        if (description) project.description = quoted(description.slice(0, 800), description);
        if (url) project.url = quoted(url, url);
        return project;
      }),
    unassigned,
    omittedPersonalData: omitted,
    confidence: "low",
    lineCount: (positions?.rows.length ?? 0) + (education?.rows.length ?? 0),
  };

  const blocks = [...doc.experience, ...doc.education];
  doc.confidence = blocks.length === 0 ? "low" : weakest(...blocks.map((block) => block.confidence));
  return doc;
}
