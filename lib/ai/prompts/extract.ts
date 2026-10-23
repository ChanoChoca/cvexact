import { z } from "zod";
import { bounded } from "@/lib/schemas/profile";

/**
 * Reading a document — a CV in an unusual layout, or a paragraph someone wrote
 * about their own career — into the same shape the deterministic parsers
 * produce: entities with, on every field, the literal fragment it came from.
 *
 * This is the one AI extraction point the design calls for. It only
 * transcribes a document into entities (source-shaped), never operations
 * against an existing profile — matching, not merging, is
 * `lib/onboarding/merge.ts`'s job, and it runs the same way whether the reading
 * came from a pattern or from this. `lib/parse/verify-extraction.ts` is what
 * turns this response into a `ParsedDocument`: every `quote` is checked against
 * the source text there, not trusted here.
 *
 * Written in English like every prompt in this app; see the note in `./shared.ts`.
 */

/** A value with the literal fragment of the document it came from — for a list item, which is never itself null: an absent one is just missing from the array. */
const quotedItem = (max: number) =>
  z.object({
    /** The value, lightly cleaned up (see QUOTING below) but never rewritten. */
    value: bounded(max),
    /** The literal fragment of the document this was read from. */
    quote: bounded(600),
  });

/**
 * The same, for a single optional field — `.nullable().default(null)`, not
 * just `.nullable()`: a model's structured output can omit a key as easily as
 * send it `null`, and `generate()`'s repair path can also hand back a response
 * truncated before a later field — either way, a missing field means "not in
 * the document", the same as an explicit `null`, not a reason to fail the
 * whole extraction.
 */
const quoted = (max: number) => quotedItem(max).nullable().default(null);

/** A date exactly as the document wrote it — "marzo de 2021", "2019", "Present". Never normalised by the model. */
const quotedDate = quoted(40);

const linkSchema = z.object({ label: bounded(60), url: quotedItem(300) });

const experienceSchema = z.object({
  kind: z.enum(["job", "volunteer"]).catch("job"),
  company: quoted(120),
  role: quoted(120),
  city: quoted(80),
  country: quoted(80),
  start: quotedDate,
  /** The end date's text, or the word that says the role is still going ("actualidad", "Present"). */
  end: quotedDate,
  facts: z.array(quotedItem(600)).max(20).default([]),
});

const educationSchema = z.object({
  institution: quoted(160),
  degree: quoted(160),
  city: quoted(80),
  country: quoted(80),
  start: quotedDate,
  end: quotedDate,
  /** Only when the document says so in words: "en curso", "incompleto" — quoted, like everything else, so it is checked, not trusted. */
  status: z
    .object({ value: z.enum(["in_progress", "incomplete"]), quote: bounded(60) })
    .nullable()
    .default(null),
  honors: quoted(300),
});

const certificationSchema = z.object({
  name: quoted(160),
  issuer: quoted(120),
  date: quotedDate,
});

const languageSchema = z.object({
  name: quoted(60),
  /** As written — "B2", "Nativo", "Full Professional". Never converted to a CEFR level. */
  level: quoted(60),
});

const projectSchema = z.object({
  name: quoted(120),
  description: quoted(800),
  url: quoted(300),
});

const UNASSIGNED_KINDS = ["summary", "interests", "awards", "references", "other"] as const;

const unassignedSchema = z.object({
  text: bounded(2000),
  kind: z.enum(UNASSIGNED_KINDS).catch("other"),
  heading: bounded(80).nullable().default(null),
});

const contactSchema = z.object({
  fullName: quoted(120),
  /** A one-line title under the name, or a professional summary's first sentence. */
  headline: quoted(160),
  email: quoted(160),
  phone: quoted(40),
  city: quoted(80),
  country: quoted(80),
  links: z.array(linkSchema).max(10).default([]),
});

export const extractionSchema = z.object({
  // Defaulted like every list below: a response truncated before it reaches
  // contact — or a document with no contact details worth reading — still
  // parses, rather than failing the whole extraction over one empty section.
  contact: contactSchema.default(() => contactSchema.parse({})),
  experience: z.array(experienceSchema).max(15).default([]),
  education: z.array(educationSchema).max(10).default([]),
  certifications: z.array(certificationSchema).max(15).default([]),
  languages: z.array(languageSchema).max(10).default([]),
  skills: z.array(quotedItem(80)).max(40).default([]),
  projects: z.array(projectSchema).max(10).default([]),
  /** Text that named no section of its own — kept, never dropped, for the "Sin asignar" tray. */
  unassigned: z.array(unassignedSchema).max(10).default([]),
});
export type Extraction = z.infer<typeof extractionSchema>;

/** Bumped whenever the schema or the instructions change what a cached response means. */
export const EXTRACT_PROMPT_VERSION = 2;

export const EXTRACT_SYSTEM = `
You are reading a document — a CV, or a paragraph someone wrote describing
their own career — so it can be stored as a structured profile. You are
transcribing what is on the page. You are not writing, completing, or
improving anything.

FACTUAL INTEGRITY:
- Extract only what the document states. Never invent an employer, a title, a
  date, a degree, a certification, a figure, or a responsibility.
- Never infer a month, an end date, a language level, seniority, or a skill
  from a job title or from anything else not written down.
- If a field is not in the document, its value is null. A missing field is a
  question the app will ask later; a guessed one is a mistake nobody catches.

QUOTING — this is what makes the extraction checkable:
- Every non-null field has a "quote": the literal fragment of the document it
  came from, copied exactly — same characters, same accents, same case. It
  will be checked against the document's own text, and a value whose quote
  cannot be found there is discarded before it ever reaches the profile.
- "value" may be lightly cleaned up from "quote" — join a sentence the
  extractor split across two lines, drop a trailing page number — but it is
  never reworded, translated, or improved. Dates are copied verbatim into both
  "value" and "quote"; do not convert "marzo de 2021" to "2021-03" or a bare
  year to a specific month. An ongoing role's end is whatever word the
  document uses for it ("actualidad", "Present", "a la fecha").
- Keep the document's own language and wording throughout.

WHAT GOES WHERE:
- One experience entry per role. "kind" is "volunteer" only under a heading
  that says so; everything else is "job".
- A bullet under a role is one fact. Do not merge two bullets or split one.
- A standalone skills section goes in "skills". A tool named only inside a
  role's own bullets stays there — do not also copy it into "skills".
- Anything with no field of its own — a professional summary, interests,
  awards, references, a section you cannot place — goes in "unassigned" with
  its own heading, verbatim, rather than being dropped or forced into a field
  it does not belong in.
- Do not emit entries for personal data this schema has no field for: photo,
  birth date, national ID, marital status, nationality. If the document has a
  section for one, leave it out entirely — do not even put it in "unassigned".

MARKS:
- Some details of the person have been taken out of the document and replaced by marks:
  [NOMBRE_1] stands for a name, [CORREO_1] for an email address, [TELEFONO_1] for a phone
  number and [ENLACE_1] for a link. A mark is not text of the document: do not guess what it
  stood for, and leave the contact fields "fullName", "email", "phone" and "links" empty —
  the app has them already.
- Where a mark is part of a quote or of a value — a fact that names a web address, say — copy
  it exactly, brackets and number included. Never write a mark that is not in the document.

Return JSON matching the schema exactly. No prose outside it.
`.trim();

export function buildExtractPrompt(text: string, kind: "cv" | "dump"): string {
  const source =
    kind === "cv"
      ? "a CV file, extracted to plain text — it may have lost some of its original layout"
      : "a paragraph the person wrote freely about their own career, in no particular structure";
  return `The text below is ${source}.\n\nDOCUMENT TEXT (verbatim):\n"""\n${text}\n"""`;
}
