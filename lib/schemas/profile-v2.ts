import { z } from "zod";
import {
  EXTRA_LIMIT,
  bounded,
  linkSchema,
  practicalSchema,
  SITUATIONS,
} from "@/lib/schemas/profile";
import { jobsByRecency, studiesByRecency } from "@/lib/profile/timeline";

/**
 * The profile as it is stored and edited: every value carries where it came
 * from and whether the user has stood behind it.
 *
 * What the generators read is `Profile` in `./profile` — the same career data as
 * plain strings — and `lib/profile/project.ts` derives one from the other. This
 * is the source of truth; that is a view of it.
 *
 * Parsing follows the same rule as the plain schema: text is truncated, never
 * rejected, and every field has a default, so a profile written by an older
 * build still loads. The enums use `.catch` for the same reason — a value this
 * build has never heard of degrades to the closest known one instead of failing
 * the whole profile.
 */

// --- Provenance ----------------------------------------------------------------

export const SOURCE_KINDS = [
  "cv",
  "linkedin_pdf",
  "linkedin_csv",
  "answer",
  "dump",
  "manual",
  "legacy",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * Where a value came from.
 *
 * `legacy` is data that predates provenance: it was in the profile before this
 * existed, typed by the person, imported by a model or written by the old
 * interview, and there is no honest way to tell which. Saying "manual" would
 * claim more than is known, so it says what is known.
 */
export const sourceSchema = z.object({
  kind: z.enum(SOURCE_KINDS).catch("manual"),
  /** The imported document it came from — an id in `StoredProfile.sources`. */
  docId: z.string().optional(),
  /** The literal fragment of that document that backs the value. */
  quote: bounded(600).optional(),
  /** The question whose answer this is (`kind: "answer"`). */
  questionId: z.string().optional(),
  /**
   * How the document was read: by the app's own patterns (absent) or with the person's model (`"ai"`).
   * Said wherever the value is shown — what a model read and what a pattern read are not equally to be
   * trusted, and the person should be able to tell which is which.
   */
  via: z.literal("ai").optional().catch(undefined),
  at: z.string().default(""),
});
export type Source = z.infer<typeof sourceSchema>;

/**
 * Where a value came from, said as who stands behind it. What the person typed, answered or told in their own words is theirs from
 * the moment they gave it; what a reader took out of a document is nobody's until they say so — a review, an edit, a «sigue igual».
 * `legacy` is the third kind: it predates provenance, and nobody can say. This is the one place that says which is which, so that
 * «cuándo lo confirmaste» (`standingAt`, `lib/profile/currency.ts`) and the edits that stamp it (`editedField`) agree.
 */
export const PERSON_SOURCE_KINDS: ReadonlySet<SourceKind> = new Set<SourceKind>(["manual", "answer", "dump"]);
export const isPersonSource = (kind: SourceKind | undefined): boolean => kind !== undefined && PERSON_SOURCE_KINDS.has(kind);

export const STATUSES = ["proposed", "confirmed", "edited"] as const;
export const statusSchema = z.enum(STATUSES).catch("confirmed");
export type Status = (typeof STATUSES)[number];

// --- The field wrapper ---------------------------------------------------------

/**
 * One value with its provenance.
 *
 * `original` is the value before the user's first edit. It is what "deshacer"
 * returns to and what the review shows next to a changed date; it is set once
 * and never overwritten by a later edit.
 */
export function field<T extends z.ZodType>(value: T) {
  return z.object({
    value,
    status: statusSchema,
    source: sourceSchema.optional(),
    original: value.optional(),
    /**
     * The last time the person stood behind this value: they edited it, answered with it, or said it is still so. Absent for what a
     * reader took from a document and nobody has looked at — and for everything saved before this was kept. An import never writes
     * it. What a value was *given* at (`source.at`) is another date: it says when it came in, and this says when it was last true
     * to the person, which is what a question about «¿sigue igual?» needs.
     */
    confirmedAt: z.string().optional().catch(undefined),
  });
}

export type Field<T> = {
  value: T;
  status: Status;
  source?: Source | undefined;
  original?: T | undefined;
  confirmedAt?: string | undefined;
};

export const emptyField = <T>(value: T): Field<T> => ({ value, status: "confirmed" });

/** A wrapped string with a cap, defaulting to empty so a missing key still parses. */
export const textField = (max: number) =>
  field(bounded(max)).default(() => emptyField(""));

// --- Dates ---------------------------------------------------------------------

/**
 * A year, optionally a month. A missing month means the source did not give
 * one, which is not the same as January: precision is whatever is present.
 */
export const dateValueSchema = z.object({
  year: z.number().int().min(1900).max(2100).optional().catch(undefined),
  month: z.number().int().min(1).max(12).optional().catch(undefined),
  raw: bounded(40).optional(),
});

export const endDateValueSchema = dateValueSchema.extend({
  current: z.boolean().optional().catch(undefined),
});

export const dateField = field(dateValueSchema).default(() => emptyField({}));
export const endDateField = field(endDateValueSchema).default(() => emptyField({}));

// --- Facts ---------------------------------------------------------------------

export const FACT_KINDS = ["responsibility", "achievement", "scope", "tool"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

/**
 * A number the user gave for a fact, kept apart from the text so it can be
 * shown, asked about and marked approximate without rewriting their words.
 * `{ unknown: true }` is the recorded answer "no lo sé": an absence, and the
 * reason not to ask again.
 */
export const metricSchema = z.union([
  z.object({ unknown: z.literal(true) }),
  z.object({
    value: bounded(40),
    unit: bounded(24).default(""),
    approx: z.boolean().default(false),
  }),
]);
export type Metric = z.infer<typeof metricSchema>;

/**
 * The unit of the profile: one thing the user did or used, in their words.
 * Nothing here is polished text — that is written per posting, from these.
 */
export const factSchema = z.object({
  id: z.string(),
  kind: z.enum(FACT_KINDS).catch("responsibility"),
  text: bounded(600),
  metric: metricSchema.optional(),
  source: sourceSchema.default(() => ({ kind: "manual" as const, at: "" })),
  status: statusSchema,
  /** The text before the user's first edit. */
  original: bounded(600).optional(),
  /** The last time the person reworded this task, gave it a figure or said it still holds — see `field`. Absent for one nobody has touched since it came in. */
  confirmedAt: z.string().optional().catch(undefined),
  /**
   * Left out of every CV, though it stays in the profile — «No usar en CVs». Absent for a task that is used. It is the person's
   * mark and nothing infers it; what is marked is not projected (`toPlainProfile`) nor drawn in the base CV.
   */
  excluded: z.boolean().optional().catch(undefined),
  /**
   * Said to be what carries over to the kind of job they are after (`transferable`, for someone changing sector). A mark beside
   * the words, which are not touched; the generators read it as the lines to lead with.
   */
  transferable: z.boolean().optional().catch(undefined),
});
export type Fact = z.infer<typeof factSchema>;

// --- Entities ------------------------------------------------------------------

/**
 * What the review needs to say about an imported block: how sure the reading was
 * and why not more. Set when a document is read and dropped once the user has
 * confirmed the block — it is a note for the review, not part of the career data.
 */
export const reviewSchema = z.object({
  confidence: z.enum(["high", "medium", "low"]).catch("medium"),
  doubts: z.array(z.string()).default([]),
  /** When two lines could each be the company (or the role): both, as written. */
  candidates: z.array(bounded(200)).optional(),
  /** The lines of the source document this block was read from, first and last. */
  span: z.tuple([z.number().int(), z.number().int()]).optional().catch(undefined),
});
export type Review = z.infer<typeof reviewSchema>;

// --- Evidence ----------------------------------------------------------------------

/**
 * How what the person says of a job, a study, a certification or a project can be seen by someone else (e5, O13, O14, O20). What the person
 * just says is the one every thing has and none is kept for: there is no «afirmado» here, only what has something beside it.
 *  - `link`: a page that shows it, and the person's words about what is seen there. The app never opens it.
 *  - `registry`: they looked it up themselves in an official register (`lib/evidence/registries.ts`), in another tab, and say what they saw.
 *  - `signed`: a credential whose signature was checked in the browser with the key it carries (`lib/evidence/jws.ts`).
 */
export const EVIDENCE_TYPES = ["link", "registry", "signed"] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** What read it for the person, when something did: the public repositories of a GitHub user, or a badge file. */
export const EVIDENCE_VIAS = ["github", "badge"] as const;
export type EvidenceVia = (typeof EVIDENCE_VIAS)[number];

/** The most pieces of evidence one thing has at once. More than a handful is not showing, it is piling up. */
export const MAX_EVIDENCE = 5;

export const evidenceSchema = z.object({
  id: z.string(),
  type: z.enum(EVIDENCE_TYPES).catch("link"),
  /** The address of the page that shows it. Empty for what has no page: a badge file with no address of its own, a register seen without a link. */
  url: bounded(300).default(""),
  /** What is seen there, in the person's words. The one thing, with the address, that is kept of the evidence: never what the page says. */
  phrase: bounded(300).default(""),
  /** When it was added: for `registry`, the day they looked. */
  at: z.string().default(""),
  /** The official register it was seen in (`lib/evidence/registries.ts`), for `registry`. */
  registry: bounded(40).optional().catch(undefined),
  via: z.enum(EVIDENCE_VIAS).optional().catch(undefined),
  /** For `signed`: how the signature was checked — the algorithm, where the key came from, and the day. */
  check: z.object({ alg: bounded(20), keyFrom: bounded(24), at: z.string().default("") }).optional().catch(undefined),
  /**
   * When the person took it off. The entry stays, inert and out of sight, so that the copy of the profile that still has it does not bring it
   * back when the two are joined (`joinProfiles`) — the same reason a «no» is taken back and not deleted (`declinedSchema`).
   */
  removedAt: z.string().optional().catch(undefined),
});
export type Evidence = z.infer<typeof evidenceSchema>;

/** A list that keeps the entries that are one and lets go of the rest, so that a single bad one never costs the whole profile. */
export const evidenceListSchema = z
  .array(z.unknown())
  .transform((entries) =>
    entries.flatMap((entry) => {
      const parsed = evidenceSchema.safeParse(entry);
      return parsed.success && parsed.data.id !== "" ? [parsed.data] : [];
    }),
  )
  .optional()
  .catch(undefined);

export const EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "freelance",
  "contract",
  "internship",
  "volunteer",
  /** A teaching assistantship or any teaching: «ayudante de cátedra». */
  "teaching",
  "research",
  /** A club or a student organisation, with the role held in `role`. */
  "student_org",
  "other",
] as const;
export const WORK_MODES = ["onsite", "remote", "hybrid"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export type WorkMode = (typeof WORK_MODES)[number];

/**
 * How long a job's company or role may be. Said once so that what asks for them can stop at the same length: a box that
 * took 160 characters for a field that keeps 120 handed the last forty to a schema that cut them without a word.
 */
export const JOB_NAME_MAX = 120;

/** A job's note is one line of a CV, and the person's own: the reason for a short stay or for the pause before the job. */
export const JOB_NOTE_MAX = 120;

export const experienceSchema = z.object({
  id: z.string(),
  company: textField(JOB_NAME_MAX),
  role: textField(JOB_NAME_MAX),
  city: textField(80),
  country: textField(80),
  start: dateField,
  end: endDateField,
  /** Only ever set from what a source says outright; never inferred from the role. */
  employmentType: field(z.enum(EMPLOYMENT_TYPES).catch("other")).optional(),
  workMode: field(z.enum(WORK_MODES).catch("onsite")).optional(),
  /**
   * A short reason, in the person's words, for a stay of under a year or for the pause before this job — «Cierre del área de desarrollo»,
   * «Pausa por cuidado familiar». Only what they write, never inferred; it goes on the CV as a line under the job, unchanged.
   */
  note: field(bounded(JOB_NOTE_MAX)).optional(),
  facts: z.array(factSchema).default([]),
  /** The whole job left out of every CV, though it stays in the profile: «No usar en CVs». See `factSchema.excluded`. */
  excluded: z.boolean().optional().catch(undefined),
  /** What shows this job, beside it (`evidenceSchema`). Absent for a job nobody has put anything beside. */
  evidence: evidenceListSchema,
  review: reviewSchema.optional(),
  /**
   * The lines of the source document this was read from, first and last — set
   * once at import and kept forever after, unlike `review.span`, which
   * `confirmExperience` deletes along with the rest of the review once the
   * person has stood behind the block. "Ver en el original" reads whichever
   * of the two is there, so it keeps working after confirming.
   */
  origin: z.tuple([z.number().int(), z.number().int()]).optional().catch(undefined),
});
export type StoredExperience = z.infer<typeof experienceSchema>;

export const educationStatusSchema = z.enum(["completed", "in_progress", "incomplete"]).catch("completed");

/** How long a point of a study can be: a line of a CV, not a paragraph. */
export const STUDY_HIGHLIGHT_MAX = 300;

export const educationSchema = z.object({
  id: z.string(),
  institution: textField(160),
  degree: textField(160),
  city: textField(80),
  country: textField(80),
  start: dateField,
  end: dateField,
  honors: textField(300),
  /**
   * What stands out of this study, one point to a line: subjects or papers, a thesis or a final project, a grade when the
   * person wants it said. Their own words — answered to «¿Algo para destacar de …?» or written in the hub — which the
   * generators read beside the degree, as a job's lines are read beside the job. A list in one field, as `extras` is, and not
   * facts: a study has no figures to ask after and no kinds to tell apart, only points. Empty for a profile from before it existed.
   */
  highlights: field(z.array(bounded(STUDY_HIGHLIGHT_MAX))).default(() => emptyField([] as string[])),
  status: field(educationStatusSchema).default(() => emptyField("completed" as const)),
  /** What shows this study, beside it (`evidenceSchema`). */
  evidence: evidenceListSchema,
  review: reviewSchema.optional(),
  /** Same as `StoredExperience.origin`: kept after `confirmEducation` clears `review`. */
  origin: z.tuple([z.number().int(), z.number().int()]).optional().catch(undefined),
});
export type StoredEducation = z.infer<typeof educationSchema>;

export const certificationSchema = z.object({
  id: z.string(),
  name: textField(160),
  issuer: textField(120),
  /** When it was given — «cuándo lo hiciste»; for a credential that lapses, `expires` is until when it holds. */
  date: dateField,
  /**
   * Until when it is valid: for what lapses — a licence, a carnet, a registration — and absent for what does not, a course above all.
   * Only ever what the person said (the hub, or the answer to «¿La renovaste?»): nothing infers it from a name. A month and a year, or
   * a year alone, which holds to its December. It stays with the profile — in the copies the person keeps, and in their account if they sync it — and goes no further: a CV does not say it, and no model is told.
   */
  expires: field(dateValueSchema).optional().catch(undefined),
  /** «No usar en CVs»: it stays in the profile and goes in none — what «Ya no corresponde» does to one that is no longer theirs. Absent when it is used. */
  excluded: z.boolean().optional().catch(undefined),
  /** What shows this certification, beside it (`evidenceSchema`): a page, a register, a signed badge. */
  evidence: evidenceListSchema,
});
export type StoredCertification = z.infer<typeof certificationSchema>;

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "native"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

/**
 * A level is only ever what the source said. "Avanzado" stays "Avanzado" in
 * `raw`; it is not turned into C1, because nobody said C1.
 */
export const languageLevelSchema = z.object({
  cefr: z.enum(CEFR_LEVELS).optional().catch(undefined),
  raw: bounded(60).optional(),
});

export const languageSchema = z.object({
  id: z.string(),
  name: textField(60),
  level: field(languageLevelSchema).default(() => emptyField({})),
});
export type StoredLanguage = z.infer<typeof languageSchema>;

export const projectSchema = z.object({
  id: z.string(),
  name: textField(120),
  description: textField(800),
  url: textField(300),
  tags: field(z.array(bounded(60))).default(() => emptyField([] as string[])),
  /** What shows this project, beside it (`evidenceSchema`): its page is `url`, and this is what the person says is seen there, and where else. */
  evidence: evidenceListSchema,
});
export type StoredProject = z.infer<typeof projectSchema>;

/**
 * A skill, and the roles it was used in. The link is the user's: it is set from
 * an answer or a literal match, never guessed from a job title.
 */
export const SKILL_LEVELS = ["strong", "working", "basic"] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export const skillSchema = z.object({
  id: z.string(),
  name: textField(80),
  experienceIds: z.array(z.string()).default([]),
  /** How well they know it, when they said: «Fuerte», «Uso habitual» or «Básico». Only ever what the person marks, never inferred from the jobs. */
  level: field(z.enum(SKILL_LEVELS).catch("working")).optional(),
});
export type StoredSkill = z.infer<typeof skillSchema>;

// --- Contact and the fields the guided flow does not ask for -----------------------

const contactShape = z.object({
  fullName: textField(120),
  email: textField(160),
  phone: textField(40),
  city: textField(80),
  country: textField(80),
  links: field(z.array(linkSchema)).default(() => emptyField([] as z.infer<typeof linkSchema>[])),
});
export const contactSchema = contactShape.default(() => contactShape.parse({}));

/**
 * Fields of the plain profile that the guided onboarding never asks for but the
 * generators still read: the headline, the free-form summary, extras and the
 * practical facts. They keep their place and are shown in the hub, so nothing a
 * user wrote is dropped for not fitting the new flow.
 */
const legacyShape = z.object({
  headline: textField(160),
  about: textField(2000),
  extras: field(z.array(bounded(EXTRA_LIMIT))).default(() => emptyField([] as string[])),
  practical: field(practicalSchema).default(() => emptyField(practicalSchema.parse({}))),
  /**
   * Until when the driving licence is valid. Beside `practical` and not inside it, on purpose: what is in `practical` is what the
   * generators read and a CV states, and the date of a licence is for the person's own reminders — it is not projected
   * (`toPlainProfile`) and so it does not travel to a model. The class of the licence is where it always was, in `practical`.
   */
  driverLicenseExpires: field(dateValueSchema).optional().catch(undefined),
});
export const legacySchema = legacyShape.default(() => legacyShape.parse({}));

// --- Sources, review trays, queue, history ------------------------------------------

const count = z.number().int().nonnegative().catch(0).default(0);

/**
 * What reading a document added, counted at that moment: what the review says it read.
 * It is kept as it was — once the person has edited or taken out some of it, this is still
 * what the reading found — and `conflicts` are the disagreements with what the profile
 * already held. Nothing here is career data; it is a receipt.
 */
export const readCountsSchema = z.object({
  experience: count,
  education: count,
  facts: count,
  skills: count,
  languages: count,
  certifications: count,
  projects: count,
  /** Text that fit no section. */
  unassigned: count,
  conflicts: count,
});
export type ReadCounts = z.infer<typeof readCountsSchema>;

/** How many stretches of a document's lines are kept as «no quedaron en ningún lado»: the first few, which is what a person looks at. */
export const MAX_LOOSE_RANGES = 40;

/** First and last line of a stretch of an original, both included — the way every `span` is. */
const lineRangeSchema = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);

/** A document the user brought: its hash, so the same file is never read twice. */
export const importedSourceSchema = z.object({
  id: z.string(),
  kind: z.enum(["cv", "linkedin_pdf", "linkedin_csv", "dump"]).catch("cv"),
  name: bounded(200).default(""),
  fileHash: bounded(80).default(""),
  pasted: z.boolean().default(false),
  chars: z.number().int().nonnegative().catch(0),
  importedAt: z.string().default(""),
  /** Absent on a document read before this was kept. */
  read: readCountsSchema.optional().catch(undefined),
  /** Read with a model, rather than by the app's own patterns. */
  via: z.literal("ai").optional().catch(undefined),
  /**
   * The text of this document was written by a model looking at a photo or a scan of it, and then read like any other text.
   * What is checked against it is that text, not the photo, so what the person is told about it is not the same as for a file:
   * a date or a figure can be one the model misread, and nothing here can know.
   */
  photo: z.literal(true).optional().catch(undefined),
  /**
   * When the file was last changed, as the device said (`File.lastModified`), in ISO. A download or a copy changes it, so it says
   * when the file reached this device more than when it was written: only ever a hint, and `madeAt` outranks it.
   */
  modifiedAt: z.string().optional().catch(undefined),
  /** When the document says it was made or last saved — a PDF's own metadata. Absent for a pasted text, a Word file or an export. */
  madeAt: z.string().optional().catch(undefined),
  /**
   * The ids of what was already in the profile that this document said again — a job, a study, a skill —
   * and so added nothing to. Whatever says a thing is a reason to keep it when another document that said
   * it is taken out; without this, a document that only repeated what was there left no trace of having.
   */
  alsoSaid: z.array(z.string()).optional().catch(undefined),
  /**
   * Where, in this document's own lines, are stretches that nothing it was read into comes from, and that the person
   * has not yet dealt with: kept as a note, or let go. Only where they are — the text is in the original, kept in this
   * browser — so a profile that travels carries no more of the document than it did.
   */
  loose: z.array(lineRangeSchema).max(MAX_LOOSE_RANGES).optional().catch(undefined),
});
export type ImportedSource = z.infer<typeof importedSourceSchema>;

/** Text from a document that fit no section — shown in the "Sin asignar" tray. */
export const unassignedSchema = z.object({
  id: z.string(),
  text: bounded(2000),
  kind: z.enum(["summary", "interests", "awards", "references", "link", "skill", "other"]).catch("other").default("other"),
  sourceId: z.string().optional(),
  heading: bounded(80).optional(),
});
export type Unassigned = z.infer<typeof unassignedSchema>;

/** How a note got here when it was not read out of a document or told as a story: written in «Anotá algo», or shared to the app from another (O15). */
export const NOTE_VIAS = ["capture", "share"] as const;
export type NoteVia = (typeof NOTE_VIAS)[number];

export const noteSchema = z.object({
  id: z.string(),
  text: bounded(2000),
  sourceId: z.string().optional(),
  at: z.string().default(""),
  /** Only for a note the person wrote down on purpose — «Anotá algo» — or shared to the app: the ones that wait to be put somewhere. Absent for the rest. */
  via: z.enum(NOTE_VIAS).optional().catch(undefined),
  /** When the person dealt with it — passed it to a job, or said it stays as a note — so that it is no longer one «sin ordenar» and nothing asks about it. */
  settledAt: z.string().optional().catch(undefined),
});
export type Note = z.infer<typeof noteSchema>;

/**
 * What a person can say «no» to, and have it remembered: a tool or a credential an offer asked for and they do not have
 * (`requirement`), or a skill deduced from what they wrote that is not true of them (`inferred_skill`).
 */
export const DECLINED_KINDS = ["requirement", "inferred_skill"] as const;
export type DeclinedKind = (typeof DECLINED_KINDS)[number];

/**
 * A «no» with its date: «No lo tengo», said to what an offer asked for, or the veto of a skill the app deduced. It is the person's
 * own word and is kept as they gave it, with the day — so that it is not asked again in every posting, and so that, a year later or
 * when a line names the thing, it can be asked once more (`lib/profile/declined.ts`). It is not a fact about them that goes into a
 * CV, and it is not part of the plain profile: no generator reads it.
 *
 * Never deleted by the person's «Volver a preguntarlo»: that sets `withdrawnAt`, so the account's copy and this browser's agree on what
 * was taken back instead of one bringing the other's «no» back (`joinProfiles`). At most one for each thing named.
 */
export const declinedSchema = z.object({
  id: z.string(),
  kind: z.enum(DECLINED_KINDS),
  /** What was said no to, as it was named — «SAP», «Carnet de manipulación de alimentos» — or the skill, as it was deduced. */
  text: bounded(160),
  /** The line of the offer that asked for it, when it was one: what the person was answering. */
  quote: bounded(300).optional().catch(undefined),
  /** When they said it. */
  at: z.string().default(""),
  /** When it was asked once more, and answered: it is not asked a second time. */
  offeredAgainAt: z.string().optional().catch(undefined),
  /** When they took it back: the entry stays, inert. */
  withdrawnAt: z.string().optional().catch(undefined),
});
export type Declined = z.infer<typeof declinedSchema>;

/** A list that keeps the entries that are one and lets go of those that are not, so that a single bad one never costs the whole profile. */
const declinedListSchema = z.array(z.unknown()).transform((entries) =>
  entries.flatMap((entry) => {
    const parsed = declinedSchema.safeParse(entry);
    return parsed.success && parsed.data.text.trim() !== "" ? [parsed.data] : [];
  }),
);

export const PENDING_STATES = ["later", "skipped", "na"] as const;
export type PendingState = (typeof PENDING_STATES)[number];

/**
 * What became of a question the user did not answer. The three exits mean
 * different things: `later` returns next session, `skipped` returns with less
 * priority, `na` never returns.
 */
export const pendingSchema = z.object({
  questionId: z.string(),
  ruleId: z.string(),
  entityId: z.string().optional(),
  state: z.enum(PENDING_STATES).catch("skipped"),
  count: z.number().int().min(1).catch(1),
  at: z.string().default(""),
});
export type Pending = z.infer<typeof pendingSchema>;

/**
 * A job's skeleton used to be one question — `incomplete_skeleton:<job>` — and putting it aside, "Dejarlo así" on
 * the year, turned down the company and the role with it. It is one question for each field now, and what a person
 * said of the old one stands for each of the three: a profile that had set the skeleton of a job aside still has it
 * set aside, field by field, and nothing that was turned down is asked again.
 */
const SKELETON_FIELD_IDS = ["start", "company", "role"] as const;
function perSkeletonField(entries: Pending[]): Pending[] {
  return entries.flatMap((entry) => {
    const old = /^incomplete_skeleton:([^:]+)$/.exec(entry.questionId);
    return old ? SKELETON_FIELD_IDS.map((field) => ({ ...entry, questionId: `incomplete_skeleton:${old[1]}:${field}` })) : [entry];
  });
}

export const fatigueSchema = z.record(
  z.string(),
  z.object({
    skipped: z.number().int().nonnegative().catch(0),
    unknown: z.number().int().nonnegative().catch(0),
    /**
     * The person said this kind of question has no answer in their work — "En mi trabajo no se miden cifras" — and it
     * is not asked again, of any job, however recent. Written only when it is true, and gone with the rest of what
     * became of the questions when they are asked again (`resetQuestions`).
     */
    off: z.boolean().optional().catch(undefined),
  }),
);

export const HISTORY_OPS = ["set", "add", "remove", "restore"] as const;
export type HistoryOp = (typeof HISTORY_OPS)[number];

/**
 * One change, addressed by ids (never array positions, which shift), holding
 * what was there and what is there now so it can be undone.
 */
export const historyEntrySchema = z.object({
  id: z.string(),
  at: z.string().default(""),
  op: z.enum(HISTORY_OPS).catch("set"),
  path: z.array(z.string()),
  label: bounded(200).optional(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const ARCHIVE_KINDS = [
  "fact",
  "experience",
  "education",
  "certification",
  "language",
  "project",
  "skill",
  "note",
  /** A whole document and what it brought, taken out in one piece: see `sourceBundleSchema`. */
  "source",
] as const;
export type ArchiveKind = (typeof ARCHIVE_KINDS)[number];

/** Something the user removed. Kept, so it can be restored. */
export const archiveEntrySchema = z.object({
  id: z.string(),
  at: z.string().default(""),
  kind: z.enum(ARCHIVE_KINDS),
  /** The list it came out of, as a path of keys and ids. */
  parentPath: z.array(z.string()).default([]),
  /** Where it was in that list, so a restore puts it back in place. */
  index: z.number().int().nonnegative().optional().catch(undefined),
  entity: z.unknown(),
  label: bounded(200).default(""),
});
export type ArchiveEntry = z.infer<typeof archiveEntrySchema>;

/**
 * The archive as stored: each entry on its own. One of a kind this version does not know — put there by a
 * newer one, from another device — is left out rather than making the whole profile unreadable: losing the
 * way back to one removal is small next to not being able to open the profile at all.
 */
const archiveListSchema = z.array(z.unknown()).transform((entries) =>
  entries.flatMap((entry) => {
    const parsed = archiveEntrySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  }),
);

// --- Conflicts between sources --------------------------------------------------

export const CONFLICT_ENTITIES = ["experience", "education", "language", "contact", "legacy"] as const;
export type ConflictEntity = (typeof CONFLICT_ENTITIES)[number];

/** One side of a conflict: what a source says, and — when it has one — its provenance. */
export const conflictSideSchema = z.object({
  value: z.unknown(),
  source: sourceSchema.optional(),
});

/**
 * Two sources disagree about one field of one entity, and neither is a document
 * the person has stood behind. Kept apart from `Field.source` — a conflict is
 * between two *sources*, not between a source and the person — and resolved by
 * `resolveConflict` (`lib/onboarding/review.ts`), which is the only thing that
 * turns one of these into an ordinary edit.
 */
export const conflictSchema = z.object({
  id: z.string(),
  entity: z.enum(CONFLICT_ENTITIES).catch("experience"),
  /** The experience or education id this is about; `"contact"`/`"legacy"` for those, which have only one each. */
  entityId: z.string(),
  field: z.string(),
  current: conflictSideSchema,
  incoming: conflictSideSchema,
  at: z.string().default(""),
});
export type Conflict = z.infer<typeof conflictSchema>;

/**
 * A document and everything it brought, taken out together — what "Quitar este documento y lo que
 * trajo" keeps in the archive, so the whole removal can be taken back in one tap. Each list says where
 * its entries were, so a restore puts them back in place; `resets` are the values that were emptied
 * rather than removed (a contact field the document had filled, a date it had proposed), by path, with
 * what they said.
 */
const placed = <T extends z.ZodType>(entity: T) => z.object({ entity, index: z.number().int().nonnegative().catch(0) });
export const sourceBundleSchema = z.object({
  id: z.string(),
  source: importedSourceSchema,
  sourceIndex: z.number().int().nonnegative().catch(0),
  experience: z.array(placed(experienceSchema)).default([]),
  education: z.array(placed(educationSchema)).default([]),
  /** Tasks the document had added to jobs that stay. */
  facts: z.array(z.object({ experienceId: z.string(), fact: factSchema, index: z.number().int().nonnegative().catch(0) })).default([]),
  skills: z.array(placed(skillSchema)).default([]),
  languages: z.array(placed(languageSchema)).default([]),
  certifications: z.array(placed(certificationSchema)).default([]),
  projects: z.array(placed(projectSchema)).default([]),
  unassigned: z.array(placed(unassignedSchema)).default([]),
  conflicts: z.array(placed(conflictSchema)).default([]),
  /** Skills that stay but were linked to jobs that went: what each was linked to. */
  skillLinks: z.array(z.object({ skillId: z.string(), experienceIds: z.array(z.string()) })).default([]),
  resets: z.array(z.object({ path: z.array(z.string()), before: z.unknown() })).default([]),
});
export type SourceBundle = z.infer<typeof sourceBundleSchema>;

export const ONBOARDING_ROUTES = ["cv", "linkedin", "both", "scratch"] as const;
export const ONBOARDING_MODES = ["dump", "steps"] as const;
export type OnboardingRoute = (typeof ONBOARDING_ROUTES)[number];
export type OnboardingMode = (typeof ONBOARDING_MODES)[number];

/**
 * The kinds of entry the step-by-step lists and the questions that add one can make, in the order they are offered. A
 * course or a certificate is the last: it is what someone with no work yet has most of, and everyone else has the least.
 */
export const ENTRY_KIND_VALUES = ["job", "study", "internship", "project", "volunteer", "teaching", "research", "student_org", "certification"] as const;

/**
 * Where the achievements cycle of a question stands, so a reload in the middle of it picks up there: the
 * kinds still to tell, how many were told, and the achievement waiting for its figure. The question's
 * gap is not kept whole — once the first achievement is told the profile no longer has the gap to find
 * again — so what the cycle needs of it (its id and its rule) is kept instead. Gone when the cycle ends.
 */
export const storedCycleSchema = z.object({
  gapId: z.string(),
  rule: z.enum(["no_achievements", "more_achievements"]).catch("no_achievements"),
  experienceId: z.string(),
  /** The kinds still to tell, in the order they were chosen: values of `ACHIEVEMENT_TYPES`. */
  remaining: z.array(z.string()).default([]),
  created: z.number().int().nonnegative().catch(0),
  /** The achievement just told: its fact, and the question that asks its figure. */
  figure: z.object({ gapId: z.string(), factId: z.string() }).optional().catch(undefined),
});
export type StoredCycle = z.infer<typeof storedCycleSchema>;

/** An entry half filled in on one of the step-by-step lists: what was typed and not yet added. */
export const builderFormSchema = z.object({
  kind: z.enum(ENTRY_KIND_VALUES).catch("job"),
  what: bounded(300).default(""),
  where: bounded(300).default(""),
  from: dateValueSchema.default(() => ({})),
  to: dateValueSchema.default(() => ({})),
  current: z.boolean().catch(false).default(false),
});

/** The step-by-step lists: which one the person is on, and what is half written in it. */
export const builderStateSchema = z.object({
  index: z.number().int().nonnegative().catch(0),
  form: builderFormSchema.optional().catch(undefined),
});
export type BuilderState = z.infer<typeof builderStateSchema>;

const onboardingShape = z.object({
  route: z.enum(ONBOARDING_ROUTES).optional().catch(undefined),
  situation: z.enum(SITUATIONS).optional().catch(undefined),
  mode: z.enum(ONBOARDING_MODES).optional().catch(undefined),
  /** The screen the user is on, so a reload resumes there. Owned by `lib/onboarding/flow.ts`. */
  step: z.string().default("start"),
  done: z.boolean().default(false),
  /**
   * The person turned on, for the questions, that their own model choose which of the fixed ones follows an answer
   * (`lib/onboarding/followup-choice.ts`): an experiment, off for everyone until they say so, and absent when it is off.
   */
  aiFollowUp: z.literal(true).optional().catch(undefined),
  /** Personal details (birth date, document number…) left out of what was read, for the screen to say so. */
  omittedPersonalData: z.number().int().nonnegative().catch(0),
  sessionCount: z.number().int().nonnegative().catch(0),
  /** Deepening questions asked in the current session, against its budget. */
  askedThisSession: z.number().int().nonnegative().catch(0),
  /** One-tap questions asked in the current session: they have their own, smaller limit. */
  askedQuick: z.number().int().nonnegative().catch(0),
  /** When the current session began. A visit long after it is a new session. */
  sessionStartedAt: z.string().default(""),
  /** Questions asked about each job in the current session, against the per-job limit. */
  askedByExperience: z.record(z.string(), z.number().int().nonnegative().catch(0)).default(() => ({})),
  /** What the person had half done — see `lib/onboarding/resume.ts`: the achievements cycle in progress… */
  cycle: storedCycleSchema.optional().catch(undefined),
  /** …the step-by-step lists they were on, and the entry half written in one… */
  builder: builderStateSchema.optional().catch(undefined),
  /** …and the answer being typed to a question, one at a time: which question, and what was typed. */
  draft: z.object({ key: z.string(), text: bounded(1500) }).optional().catch(undefined),
});
export const onboardingSchema = onboardingShape.default(() => onboardingShape.parse({}));
export type OnboardingState = z.infer<typeof onboardingShape>;

// --- The profile -----------------------------------------------------------------

export const STORED_VERSION = 2 as const;

export const storedProfileSchema = z.object({
  version: z.literal(2).default(2),
  /** Counts local saves. Sync compares against it. */
  rev: z.number().int().nonnegative().catch(0),
  updatedAt: z.string().default(""),
  contact: contactSchema,
  objective: textField(160),
  // In the order a CV lists them, whenever the profile is read or written: the profile's own cards, the base CV
  // and what the generators are given then all agree, with no second order to keep by hand. A job typed in
  // after the older ones stands where its dates put it; what has no dates keeps the order it was given, last.
  experience: z.array(experienceSchema).default([]).transform((jobs) => jobsByRecency(jobs)),
  education: z.array(educationSchema).default([]).transform((entries) => studiesByRecency(entries)),
  certifications: z.array(certificationSchema).default([]),
  languages: z.array(languageSchema).default([]),
  projects: z.array(projectSchema).default([]),
  skills: z.array(skillSchema).default([]),
  legacy: legacySchema,
  sources: z.array(importedSourceSchema).default([]),
  unassigned: z.array(unassignedSchema).default([]),
  notes: z.array(noteSchema).default([]),
  /** What the person said no to, with the day — not part of the plain profile, and read by no generator. */
  declined: declinedListSchema.default([]),
  pending: z.array(pendingSchema).default([]).transform(perSkeletonField),
  fatigue: fatigueSchema.default(() => ({})),
  history: z.array(historyEntrySchema).default([]),
  archive: archiveListSchema.default([]),
  conflicts: z.array(conflictSchema).default([]),
  onboarding: onboardingSchema,
});
export type StoredProfile = z.infer<typeof storedProfileSchema>;

export const emptyStoredProfile = (): StoredProfile => storedProfileSchema.parse({});

/** A role that has something in it — the stored counterpart of `meaningfulExperience`. */
export function isMeaningfulExperience(job: StoredExperience): boolean {
  return Boolean(
    job.company.value.trim() || job.role.value.trim() || job.facts.length > 0,
  );
}

/** Nothing has been entered yet. Decides whether the first-run flow applies. */
export function isBlankProfile(profile: StoredProfile): boolean {
  return (
    !profile.contact.fullName.value.trim() &&
    !profile.contact.email.value.trim() &&
    !profile.experience.some(isMeaningfulExperience) &&
    profile.education.length === 0 &&
    profile.skills.length === 0 &&
    profile.languages.length === 0 &&
    profile.projects.length === 0 &&
    profile.certifications.length === 0 &&
    profile.notes.length === 0 &&
    profile.unassigned.length === 0
  );
}

export function newSource(kind: SourceKind, at: string, extra: Partial<Source> = {}): Source {
  return { kind, at, ...extra };
}

/** A wrapped value the user gave directly. Empty strings carry no source: nothing to attribute. */
export function givenField<T>(value: T, source: Source, empty = false): Field<T> {
  return empty ? emptyField(value) : { value, status: "confirmed", source };
}
