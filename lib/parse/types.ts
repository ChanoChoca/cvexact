import type { DateValue, EndDateValue } from "@/lib/profile/dates";
import type { PracticalFact } from "@/lib/profile/practical-facts";
import type { EmploymentType, WorkMode } from "@/lib/schemas/profile-v2";

/**
 * What the deterministic parsers produce: a document read into the shape of a
 * profile, every value carrying the literal text it was read from.
 *
 * Nothing here is a claim the parser made up. A `quote` is a fragment of the
 * source, so the same rule the AI extraction has to meet — the value must be
 * findable in the document — holds by construction, and the review can put the
 * original next to what was read.
 */

/**
 * One line of the document, in reading order.
 *
 * Text pasted or read from a Word file has only `gapBefore` (a blank line);
 * a PDF also has where the line sat on the page and how large it was, which is
 * what tells a company from a role in LinkedIn's export.
 */
export type Line = {
  text: string;
  /** Position in the array it came from. Spans and quotes point back with it. */
  index: number;
  /** A blank line, or a vertical gap wider than a wrapped line, precedes it. */
  gapBefore: boolean;
  page?: number;
  x?: number;
  /** Distance from the bottom of the page; larger is higher. */
  y?: number;
  /** Font size, in points. */
  size?: number;
  /** How far it runs to the right of `x`, in points. */
  width?: number;
};

export type Quoted<T> = { value: T; quote: string };

export type Confidence = "high" | "medium" | "low";

/**
 * Why a block is not `high`. The review says it in words, next to the block,
 * instead of just colouring it: "no supimos cuál de estas dos líneas es la
 * empresa" is something a person can act on, an amber border is not.
 */
export type Doubt =
  | "company_or_role"
  | "no_company"
  | "no_role"
  | "no_dates"
  | "no_end"
  | "unreadable_date"
  | "location_guess"
  | "no_institution"
  | "no_degree";

export type ParsedExperience = {
  kind: "job" | "volunteer";
  company?: Quoted<string>;
  role?: Quoted<string>;
  city?: Quoted<string>;
  country?: Quoted<string>;
  start?: Quoted<DateValue>;
  end?: Quoted<EndDateValue>;
  employmentType?: Quoted<EmploymentType>;
  workMode?: Quoted<WorkMode>;
  /** What was written under the entry, one statement each, in the author's words. */
  facts: Quoted<string>[];
  /** When two lines could each be the company or the role: both, as written. */
  candidates?: string[];
  confidence: Confidence;
  doubts: Doubt[];
  /** First and last line the entry covers, for showing the original beside it. */
  span: [number, number];
};

export type ParsedEducation = {
  institution?: Quoted<string>;
  degree?: Quoted<string>;
  city?: Quoted<string>;
  country?: Quoted<string>;
  start?: Quoted<DateValue>;
  end?: Quoted<EndDateValue>;
  /** Only when the document says so in words: "en curso", "incompleto". */
  status?: Quoted<"in_progress" | "incomplete">;
  honors?: Quoted<string>;
  candidates?: string[];
  confidence: Confidence;
  doubts: Doubt[];
  span: [number, number];
};

export type ParsedCertification = {
  name: Quoted<string>;
  issuer?: Quoted<string>;
  date?: Quoted<DateValue>;
};

export type ParsedLanguage = {
  name: Quoted<string>;
  /** As written: "B2", "Nativo", "Full Professional". Never converted. */
  level?: Quoted<string>;
};

export type ParsedProject = {
  name: Quoted<string>;
  description?: Quoted<string>;
  url?: Quoted<string>;
};

export type ParsedLink = Quoted<{ label: string; url: string }>;

export type ParsedContact = {
  fullName?: Quoted<string>;
  headline?: Quoted<string>;
  email?: Quoted<string>;
  phone?: Quoted<string>;
  city?: Quoted<string>;
  country?: Quoted<string>;
  links: ParsedLink[];
};

export type UnassignedKind =
  | "summary"
  | "interests"
  | "awards"
  | "references"
  /** A link with nowhere else to go — a bare URL under a job, a portfolio address the reader could not place in contact details. */
  | "link"
  /** A tool or technology named in a sentence a list-section reader could not otherwise place — see `toolsIn`. */
  | "skill"
  | "other";

/** Text that fit no section. Shown in the "Sin asignar" tray; nothing is lost silently. */
export type ParsedUnassigned = {
  text: string;
  kind: UnassignedKind;
  /** The heading it sat under in the document, as written. */
  heading?: string;
};

/**
 * `"dump"` is the one kind no deterministic reader ever produces: it names a
 * `ParsedDocument` built by AI extraction from a free-text answer ("Contámelo
 * a mi manera"), not from a file. `lib/parse/verify-extraction.ts` is the only
 * place that sets it.
 */
export type DocumentKind = "cv" | "linkedin_pdf" | "linkedin_csv" | "dump";

/** A practical fact — availability, a driving licence, work eligibility — read from a "Label: value" line. Flags (own vehicle, willing to relocate) have no text a line like that could carry, so they are never set this way. */
export type ParsedPractical = Partial<Record<PracticalFact["field"], Quoted<string>>>;

export type ParsedDocument = {
  kind: DocumentKind;
  contact: ParsedContact;
  experience: ParsedExperience[];
  education: ParsedEducation[];
  certifications: ParsedCertification[];
  languages: ParsedLanguage[];
  skills: Quoted<string>[];
  projects: ParsedProject[];
  unassigned: ParsedUnassigned[];
  /** Only ever set from a line naming one outright — never inferred, same rule as `employmentType`/`workMode`. */
  practical?: ParsedPractical;
  /**
   * How many personal details were left out on purpose (birth date, document
   * number, marital status): they are never read into the profile, and the
   * screen says so.
   */
  omittedPersonalData: number;
  /** The weakest block. `high` only when every block is. */
  confidence: Confidence;
  /** Read with a model: every value that comes of it says so, wherever it is shown. Absent for a reading by patterns. */
  via?: "ai";
  lineCount: number;
  /**
   * The document as the reader saw it, one string per line, indexed the way
   * every `span` is — what lets the review show the original beside a block.
   * Absent for a data export, which has no lines to show.
   */
  lines?: string[];
  /**
   * Where each of `lines` sat on its page — aligned with it index for index,
   * `null` for a line with no position of its own. What lets "Ver el
   * original" draw the page instead of a plain list of text; absent
   * altogether for a source with no positions to begin with (pasted text, a
   * Word file, an AI reading), the same as `lines` is for a data export.
   */
  layout?: Array<LineBox | null>;
};

/** One line's box on its page, in the units `Line.x`/`y`/`size`/`width` already use — points, y measured from the bottom. */
export type LineBox = { page: number; x: number; y: number; width: number; size: number };

export const CONFIDENCE_ORDER: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };

export function weakest(...levels: Confidence[]): Confidence {
  return levels.reduce<Confidence>(
    (worst, level) => (CONFIDENCE_ORDER[level] < CONFIDENCE_ORDER[worst] ? level : worst),
    "high",
  );
}
