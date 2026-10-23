import { z } from "zod";

import type { Relevance } from "./job";
import { displayUrl, linkKey, normalizeUrl } from "./profile";
import type { Profile } from "./profile";

/**
 * The model's output and the renderer's input contract.
 *
 * The model never emits HTML. It emits this object; `components/cv/CVDocument.tsx`
 * turns it into the exact template layout. Adding or removing bullets, jobs and
 * whole sections is expressible here, so the template stays fixed while the
 * content adapts.
 */

/**
 * Truncates rather than rejects. Used for fields whose value cannot reach the
 * printed CV — the coverage panel beside the preview, and the contact details
 * the route replaces with the profile's own — where an overflow should not
 * fail the whole `generateObject` call.
 */
function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

/** A string field whose overflow is trimmed instead of rejected. */
function lenient(max: number) {
  return z.string().transform((s) => truncate(s, max));
}

/**
 * Strips the formatting the model was told not to emit.
 *
 * `BUILD_CV_SYSTEM` has forbidden markdown since it was written, and a CV still
 * came back with its summary wrapped in asterisks — which `CVDocument.tsx`
 * prints verbatim, because the renderer's whole job is to not interpret the
 * model's text. The instruction is not enforceable and does not need to be:
 * emphasis markers and list bullets carry no meaning this template can use, so
 * removing them costs nothing and cannot be got wrong.
 *
 * Deliberately not `lenient()`: length is a mistake the repair pass can fix and
 * should still be rejected, while formatting is one no retry improves.
 */
function plainText(max: number) {
  return z
    .string()
    .transform((s) =>
      s
        // Leading list markers, including the "- " a model writes when it
        // forgets the renderer supplies its own bullet.
        .replace(/^\s*[-*•‣▪]\s+/, "")
        // Emphasis around a whole field or any run inside it. Handles **bold**
        // before *italic* so the doubled form does not leave one asterisk.
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/(?<![\w*])[*_](?=\S)(.+?)(?<=\S)[*_](?![\w*])/g, "$1")
        .replace(/`+/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .pipe(z.string().max(max));
}

/** Only ever reached via `header.links`, which the route replaces — lenient. */
export const cvLinkSchema = z.object({
  label: lenient(60).describe("Display text, e.g. 'linkedin.com/in/midudev'"),
  url: z.string().transform((s) => (s.trim() === "" ? s : truncate(normalizeUrl(s), 300))),
});

export const cvExperienceItemSchema = z.object({
  company: plainText(120),
  role: plainText(120),
  location: plainText(120).describe("'City, Country' — right column, bold"),
  dateRange: plainText(80).describe("e.g. 'Agosto 2017 – Septiembre 2022'"),
  bullets: z.array(plainText(400)).max(8),
  /** The person's own reason for a short stay or the pause before the job, under its header; put in from the profile after you answer, so leave it empty. */
  note: plainText(120).optional().describe("Always omit or leave empty: the candidate's own words are put in after you answer"),
});

export const cvEducationItemSchema = z.object({
  institution: plainText(160),
  degree: plainText(160),
  location: plainText(120),
  date: plainText(80),
  honors: plainText(300).default("").describe("Empty string to omit the line"),
});

/**
 * A short labelled fact: a certification and its issuer, a language and its
 * level, availability and what it is.
 *
 * Without this, the only place such a fact could go was a bullets section, and
 * in practice it went nowhere — across a corpus of 53 generated CVs not one
 * listed the candidate's AWS certification or their English level, both of
 * which several of those postings asked for outright.
 */
export const cvPairItemSchema = z.object({
  label: plainText(80).describe("e.g. 'AWS Cloud Practitioner', 'Inglés'"),
  value: plainText(160).describe("e.g. 'AWS, 2024', 'Avanzado'"),
});

/**
 * One project of the candidate's, with its link.
 *
 * `ref` is how the generator points at the profile's project (`P1`, `P2`…) and is
 * never printed: the name and the link come from the profile, not from whatever
 * the model wrote, so a project that is not the person's cannot reach the page.
 * Defaulted for a provider whose relaxed schema drops it.
 */
export const PROJECT_DESCRIPTION_MAX = 300;

export const cvProjectItemSchema = z.object({
  ref: lenient(20).default("").describe("The [Pn] reference of the profile's project this is"),
  name: plainText(120),
  description: plainText(PROJECT_DESCRIPTION_MAX).default("").describe("Empty string to show the name alone"),
  url: z
    .string()
    .transform((s) => (s.trim() === "" ? s : truncate(normalizeUrl(s), 300)))
    .default(""),
});

/**
 * One project as the CV prints it, all of it the profile's: the base CV and a generated one both build theirs here, so
 * a project reads the same in either. A project with no description shows its name (and link) alone — nothing is written
 * to fill it.
 */
export function projectFromProfile(ref: string, project: { name: string; description: string; url: string }): CVProjectItem {
  const description = project.description.replace(/\s+/g, " ").trim();
  const url = project.url.trim();
  return {
    ref,
    name: project.name.trim(),
    description: description.length <= PROJECT_DESCRIPTION_MAX ? description : `${description.slice(0, PROJECT_DESCRIPTION_MAX - 1).trimEnd()}…`,
    url: url ? truncate(normalizeUrl(url), 300) : "",
  };
}

/**
 * One activity of the candidate's — a club they run, classes they give, a volunteering — as the CV prints it: a line of text.
 *
 * `ref` is how the generator points at the profile's line (`O1`, `O2`…, by its place in `extras`) and is never printed. The
 * text is the profile's own, put in after the model answers, for the reason a project's is: what a model writes about
 * somebody's club is the one thing nothing here can tell from the truth. Defaulted for a provider whose relaxed schema drops
 * either.
 */
export const ACTIVITY_MAX = 300;

export const cvActivityItemSchema = z.object({
  ref: lenient(20).default("").describe("The [On] reference of the profile's activity this is"),
  text: plainText(ACTIVITY_MAX).default("").describe("Empty string: the candidate's own words are put in after you answer"),
});

/** One activity as the CV prints it, all of it the profile's: one line of text, as long as the schema allows. */
export function activityFromProfile(ref: string, text: string): CVActivityItem {
  const line = text.replace(/\s+/g, " ").trim();
  return { ref, text: line.length <= ACTIVITY_MAX ? line : `${line.slice(0, ACTIVITY_MAX - 1).trimEnd()}…` };
}

/** The link as the page shows it: no scheme, no closing slash, about one line wide. */
export function projectLinkLabel(url: string): string {
  const shown = displayUrl(url).replace(/\/$/, "");
  return shown.length <= 48 ? shown : `${shown.slice(0, 47)}…`;
}

/**
 * A section heading. The template sets them in uppercase and the prompt asks
 * for uppercase, which across 53 CVs it delivered — the casing is not the part
 * that drifts. Normalising it here is what lets `CANONICAL_SECTION_TITLES`
 * below compare against a single form instead of a table of variants.
 */
function sectionTitle() {
  return plainText(60).transform((s) => s.toLocaleUpperCase());
}

export const cvSectionSchema = z.discriminatedUnion("kind", [
  // Minimums, not just maximums: the prompt already says to omit a section
  // rather than emit an empty one, and an empty section renders as a heading
  // with nothing under it. Rejecting it here turns a silent layout bug into a
  // repair the model can act on.
  z.object({
    kind: z.literal("experience"),
    title: sectionTitle().describe("Section heading, uppercase, in the CV's language"),
    items: z.array(cvExperienceItemSchema).min(1).max(10),
  }),
  z.object({
    kind: z.literal("education"),
    title: sectionTitle(),
    items: z.array(cvEducationItemSchema).min(1).max(8),
  }),
  z.object({
    kind: z.literal("bullets"),
    title: sectionTitle(),
    bullets: z.array(plainText(400)).min(2).max(12),
  }),
  z.object({
    kind: z.literal("pairs"),
    title: sectionTitle(),
    items: z.array(cvPairItemSchema).min(1).max(8),
  }),
  z.object({
    kind: z.literal("projects"),
    title: sectionTitle(),
    items: z.array(cvProjectItemSchema).min(1).max(4),
  }),
  z.object({
    kind: z.literal("activities"),
    title: sectionTitle(),
    items: z.array(cvActivityItemSchema).min(1).max(4),
  }),
]);

/**
 * Minimum non-empty count, per section kind, and which field carries it.
 *
 * Exported because the CV editor has to warn before a deletion rather than after:
 * removing the second bullet of a `bullets` section removes the section, and
 * finding that out from a failed re-parse is not a usable answer.
 */
export const SECTION_MINIMUM: Record<string, { field: "items" | "bullets"; min: number }> = {
  experience: { field: "items", min: 1 },
  education: { field: "items", min: 1 },
  pairs: { field: "items", min: 1 },
  projects: { field: "items", min: 1 },
  activities: { field: "items", min: 1 },
  bullets: { field: "bullets", min: 2 },
};

/**
 * Drops a raw section that fails its own kind's minimum, before `sections` is
 * validated against `cvSectionSchema`.
 *
 * A generation once ran off into a repetition loop inside `header.phone`
 * (absorbed by `lenient()` below) and, in the same response, closed out with
 * four sections whose `items`/`bullets` arrays were empty — well-formed JSON,
 * `finishReason: "stop"`, but a 502 after two full round-trips, because
 * `sections[].items`/`bullets` have hard minimums nothing else absorbs. The
 * prompt already says to omit an empty section rather than emit one
 * (build-cv.ts's "Omit a section entirely..." rule); this is the deterministic
 * fallback for when a model says that and does it anyway — same rationale as
 * `lenient()`, applied to sections instead of header fields.
 *
 * A section with a missing or unrecognized `kind` is left untouched — that is
 * a different, worse failure than an empty section, and should still surface
 * the discriminated union's own error rather than vanish silently.
 */
function dropEmptySections(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.filter((raw) => {
    const kind = raw && typeof raw === "object" ? (raw as Record<string, unknown>).kind : undefined;
    const spec = typeof kind === "string" ? SECTION_MINIMUM[kind] : undefined;
    if (!spec) return true;
    const list = (raw as Record<string, unknown>)[spec.field];
    return Array.isArray(list) && list.length >= spec.min;
  });
}

/**
 * Folds every extra `pairs` section into the first one.
 *
 * The prompt asks for exactly one ("Emit ONE section with kind: pairs"), and a
 * run against a posting that named both a certification and a language came
 * back with two — CERTIFICACIONES over a single line, IDIOMAS over two. Nothing
 * was wrong with the content; it cost two of the six section slots and two
 * headings' worth of a page that has to fit on one sheet. The instruction is
 * unenforceable and the merge is unambiguous, so it happens here.
 */
function mergePairSections(value: unknown): unknown {
  if (!Array.isArray(value)) return value;

  const isPairs = (raw: unknown): raw is Record<string, unknown> =>
    typeof raw === "object" && raw !== null && (raw as Record<string, unknown>).kind === "pairs";

  const pairs = value.filter(isPairs);
  if (pairs.length < 2) return value;

  const titles = [
    ...new Set(pairs.map((s) => (typeof s.title === "string" ? s.title.trim() : "")).filter(Boolean)),
  ];
  const joined = titles.join(" · ");

  const merged = {
    ...pairs[0],
    // The schema caps a title at 60 characters, and this is a repair — it must
    // not be the reason a CV is rejected. Past the cap the first title stands.
    title: joined.length <= 60 ? joined : titles[0],
    items: pairs.flatMap((s) => (Array.isArray(s.items) ? s.items : [])).slice(0, 8),
  };

  let placed = false;
  return value.flatMap((raw) => {
    if (!isPairs(raw)) return [raw];
    if (placed) return [];
    placed = true;
    return [merged];
  });
}

/**
 * Moves the `pairs` section to the end of the document.
 *
 * `STRATEGIES.unrelated` tells the model to reorder — education or skills before
 * experience, so the reader hits the relevant material first — and that licence
 * is worth keeping. What it also produced was a CV whose first section, above the
 * degree and above the work history, was a four-row table of availability,
 * licence, languages and work eligibility. `public/plantilla-cv.html` has no
 * equivalent of that block anywhere, let alone leading the page, and the original
 * brief for this product asks for the template to be followed strictly.
 *
 * So the reordering stays and this one position does not. Applied here rather than
 * asked for in the prompt because it is a template rule and not a strategy: it
 * holds for every relevance, needs nothing but the section list, and a rule the
 * schema can impose is a rule the model cannot lose.
 *
 * Runs after `mergePairSections`, so there is at most one section to move.
 */
function pairsLast(value: unknown): unknown {
  if (!Array.isArray(value)) return value;

  const isPairs = (raw: unknown) =>
    typeof raw === "object" && raw !== null && (raw as Record<string, unknown>).kind === "pairs";

  const index = value.findIndex(isPairs);
  if (index === -1 || index === value.length - 1) return value;

  return [...value.slice(0, index), ...value.slice(index + 1), value[index]];
}

/**
 * The heading the template uses for each section, per output language.
 *
 * Five of the six section kinds have exactly one correct name — the one in
 * `public/plantilla-cv.html` — so the model does not get to pick it. It used to:
 * this was a lookup table of the wrong names seen so far, mapping each back to
 * the right one, and it lost every time a model invented a variant nobody had
 * written down. Five CVs from one provider produced two misses, "EXPERIENCIA"
 * and "HABILIDADES CLAVE", and the drift is invisible in any single CV and
 * glaring across a folder of them. A model that had drifted also cited the
 * heading it had invented in its own coverage report, pointing the reader at a
 * section under a name the page does not carry.
 *
 * Applied by language rather than translated: a CV in a language not listed
 * here keeps whatever the model wrote, which is what stops a French CV from
 * being retitled into Spanish.
 */
export const TEMPLATE_SECTION_TITLES: Record<string, Partial<Record<CVSection["kind"], string>>> = {
  es: {
    experience: "EXPERIENCIA PROFESIONAL",
    education: "EDUCACIÓN",
    bullets: "SKILLS ADICIONALES",
    projects: "PROYECTOS",
    activities: "ACTIVIDADES",
  },
  en: {
    experience: "WORK EXPERIENCE",
    education: "EDUCATION",
    bullets: "ADDITIONAL SKILLS",
    projects: "PROJECTS",
    activities: "ACTIVITIES",
  },
};

/**
 * Imposes the template's heading on every kind but `pairs`.
 *
 * `pairs` is left alone on purpose: its heading names whichever credential the
 * posting asked about ("DISPONIBILIDAD Y CERTIFICACIONES", "IDIOMAS"), so there
 * is nothing to canonicalise it to.
 */
function canonicaliseSectionTitles(value: unknown, language: unknown): unknown {
  if (!Array.isArray(value)) return value;

  const titles =
    typeof language === "string"
      ? TEMPLATE_SECTION_TITLES[language.trim().toLocaleLowerCase().slice(0, 2)]
      : undefined;
  if (!titles) return value;

  return value.map((raw) => {
    if (typeof raw !== "object" || raw === null) return raw;
    const section = raw as Record<string, unknown>;

    const canonical = titles[section.kind as CVSection["kind"]];
    return canonical ? { ...section, title: canonical } : raw;
  });
}

/**
 * The fixed words the renderers print around the model's own text.
 *
 * They belong to the model for the same reason `section.title` does: the CV can
 * come out in any language, and a table of translations here would only ever
 * cover the handful someone thought to list. `languageDirective()` already
 * covers "every user-visible string"; the prompt only has to name these so they
 * are not mistaken for schema enums.
 *
 * Defaulted, so a CV generated before this field existed — one sitting in a
 * browser's localStorage right now — still parses and still renders in Spanish.
 */
export const CV_LABEL_DEFAULTS = { honors: "Honores" };

export const cvLabelsSchema = z
  .object({
    honors: z
      .string()
      .max(40)
      .default(CV_LABEL_DEFAULTS.honors)
      .describe("Label before the education honors line, e.g. 'Honores', 'Honors'"),
  })
  // Both levels of default are load-bearing: the object's covers a model that
  // omits `labels` outright, the fields' cover one that sends a partial object.
  .default(CV_LABEL_DEFAULTS);

/**
 * How many omitted-material entries are worth keeping. Exported so
 * `BUILD_CV_SYSTEM`'s LIMITS block states the same number this enforces.
 */
export const OMITTED_LIMIT = 10;

/**
 * The coverage report shown beside the preview, never printed on the CV.
 *
 * Every array here is defaulted, and the object itself is defaulted in
 * `cvDocumentSchema` below, for the reason the fields above are `lenient()`: a
 * model that omits a report nobody prints must not fail a document the user is
 * going to read. It did. A CVDocument came back schema-valid except for
 * `coverage.omitted` being absent — an array a model drops when it has nothing
 * to report, rather than sending an empty one — and the document spent a
 * model-assisted repair, came back with the array absent again, and failed the
 * whole generation after 106 seconds and a walk down the provider chain. The
 * prompt's "one entry per requirement" is not something a schema can enforce
 * anyway; `verifyCoverage` in `lib/ai/verify.ts` warns when the report arrives
 * empty, which is where that failure becomes visible instead of fatal.
 */
export const coverageSchema = z.object({
  requirements: z
    .array(
      z.object({
        requirement: z.string().max(300),
        covered: z.boolean(),
        evidence: z
          .string()
          .max(400)
          .describe("Which line of the CV covers it, or why it is not covered"),
        inferred: z
          .boolean()
          .describe("True when the evidence comes from a derived skill, not a stated one"),
      }),
    )
    .max(30)
    .default([]),
  /**
   * Held well below `requirements` because it is the cheapest thing in the
   * response to cut and the most expensive to keep.
   *
   * It is never printed — it exists so the user can check nothing they cared
   * about was dropped — yet across 69 applications it averaged 15.8 entries and
   * hit the old ceiling of 30. On Cohere, whose API refuses any `max_tokens`
   * above 8192, that is the largest single consumer of a budget the CV itself
   * has to fit in, and running out triggers the truncation repair, which asks
   * for a shorter document and gets one with a section missing. Ten entries is
   * more than a user reads and leaves the room for the CV.
   *
   * Sliced rather than rejected, for the same reason the fields above are
   * truncated: this array cannot reach the printed CV, and the applications
   * already saved in a browser carry more than ten. `answers`, `email`,
   * `interview` and the PDF export all re-parse a stored CV through this
   * schema, so a hard cap here would take an existing application and make it
   * unexportable over a report nobody prints. The prompt's LIMITS block is
   * where the model is told the number.
   */
  omitted: z
    .array(
      z.object({
        item: z
          .string()
          .describe("A short label for the omitted item (a few words) — never the full bullet text")
          .transform((s) => truncate(s, 200)),
        reason: z.string().transform((s) => truncate(s, 300)),
      }),
    )
    // A model with nothing to report sometimes sends `null` rather than
    // omitting the key or sending `[]` — `.default()` alone only catches the
    // latter two (it substitutes on `undefined`, not on an explicit `null`).
    .nullable()
    .transform((entries) => (entries ?? []).slice(0, OMITTED_LIMIT))
    .default([]),
});

/**
 * Section titles are imposed rather than accepted, and the title to impose
 * depends on `language` — a sibling field, which a `z.preprocess` on `sections`
 * alone cannot see. So the rewrite happens here, over the whole object, before
 * anything is validated.
 */
export const cvDocumentSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null) return value;
  const document = value as Record<string, unknown>;
  if (!("sections" in document)) return value;

  return {
    ...document,
    sections: canonicaliseSectionTitles(document.sections, document.language),
  };
}, z.object({
  language: z.string().max(10).describe("Output language, matching the job post"),
  /**
   * The route overwrites every field here from the profile (see
   * `headerFromProfile`), so every field is lenient — rejecting the whole
   * document over the length of a value that is about to be thrown away turns
   * a cosmetic overshoot into a failed request, which is exactly what a model
   * that ran off into a repetition loop inside `phone` once did.
   */
  header: z.object({
    fullName: lenient(120),
    location: lenient(120),
    phone: lenient(40).default(""),
    email: lenient(160).default(""),
    links: z
      .array(cvLinkSchema)
      .transform((links) => links.slice(0, 5))
      .default([]),
  }),
  summary: plainText(700).describe("The italic paragraph under the contact line"),
  /** Order is adaptive: for an unrelated job, education may precede experience. */
  sections: z.preprocess(
    // Merge before dropping: two pairs sections whose items the model split
    // unevenly should become one section, not one section and one casualty. And
    // both before `pairsLast`, which assumes there is one pairs section and that
    // it survived.
    (value) => pairsLast(dropEmptySections(mergePairSections(value))),
    z.array(cvSectionSchema).min(1).max(6),
  ),
  /** The renderers' own words, in the CV's language. See `cvLabelsSchema`. */
  labels: cvLabelsSchema,
  /**
   * Shown beside the preview, never printed.
   *
   * Both levels of default, for the reason `cvLabelsSchema` has them: a model
   * that omits the block outright and one that sends half of it are both
   * survivable. This is metadata that never reaches the printed CV, and a
   * missing `omitted` used to fail the whole document after a repair
   * round-trip — see the comment on `coverageSchema`. The prompt still asks
   * for the report; `verifyCoverage` warns when it arrives empty.
   */
  coverage: coverageSchema.default({ requirements: [], omitted: [] }),
}));

/**
 * Where a link points when it points at code.
 *
 * Matched against the URL and the label together, because a profile writes the
 * same link either way ("github.com/x" as a label, the full URL underneath).
 *
 * Exported so `tests/eval/score.ts` counts exactly the links this filter drops.
 */
export const CODE_HOST = /github|gitlab|bitbucket|stackoverflow|npmjs|codepen|codesandbox|huggingface|kaggle|dev\.to/i;

/**
 * The header block, copied from the profile rather than generated.
 *
 * Everything here is verbatim profile data, so asking the model for it buys
 * nothing and risks everything: a CV came back with the email and both links
 * missing, which the schema accepted (all three carry defaults) and the
 * verifier ignored (it compares values, and there was no value to compare).
 *
 * Outside the candidate's field the code links come off. `STRATEGIES.unrelated`
 * spends its first instruction on stripping the jargon because naming a stack
 * reads as overqualification, and a `github.com/...` under the phone number says
 * the same thing in the one place on the page every reader looks. A restaurant
 * hiring a waiter has no use for the repositories.
 *
 * Never down to nothing, though: `verifyCompleteness` reports a CV that lost the
 * profile's links, and it is right to — so a profile whose every link is a code
 * host keeps them rather than arriving bare.
 */
export function headerFromProfile(
  profile: Profile,
  options: { relevance?: Relevance } = {},
): CVDocument["header"] {
  // One page listed twice — "linkedin.com/in/x" and "www.linkedin.com/in/x", in a
  // profile read before imports compared links by `linkKey` — is printed once,
  // and does not take the place of a fifth link that is really different.
  const links = profile.links.filter((link, index, all) => all.findIndex((other) => linkKey(other.url) === linkKey(link.url)) === index).slice(0, 5);
  const kept =
    options.relevance === "unrelated"
      ? links.filter((link) => !CODE_HOST.test(`${link.label} ${link.url}`))
      : links;

  return {
    fullName: profile.fullName,
    location: [profile.city, profile.country].filter(Boolean).join(", "),
    phone: profile.phone,
    email: profile.email,
    links: kept.length > 0 ? kept : links,
  };
}

export type CVLink = z.infer<typeof cvLinkSchema>;
export type CVLabels = z.infer<typeof cvLabelsSchema>;
export type CVPairItem = z.infer<typeof cvPairItemSchema>;
export type CVProjectItem = z.infer<typeof cvProjectItemSchema>;
export type CVActivityItem = z.infer<typeof cvActivityItemSchema>;
export type CVExperienceItem = z.infer<typeof cvExperienceItemSchema>;
export type CVEducationItem = z.infer<typeof cvEducationItemSchema>;
export type CVSection = z.infer<typeof cvSectionSchema>;
export type Coverage = z.infer<typeof coverageSchema>;
export type CVDocument = z.infer<typeof cvDocumentSchema>;
