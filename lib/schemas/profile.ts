import { z } from "zod";

/**
 * The user's complete, unfiltered career data. This is the source of truth and
 * is never trimmed — trimming happens per application, in the generated CV.
 *
 * Free-text fields are truncated rather than rejected: the form never enforces
 * these caps while typing, so a schema that throws on overlong input would
 * make an otherwise-valid profile fail to load or import (silently falling
 * back to an empty profile, since that's what every caller of this schema
 * does on failure) instead of just losing the tail end of one field.
 */
export const bounded = (max: number) => z.string().transform((s) => s.slice(0, max));

/**
 * Exported so the editor can show the limit it is about to enforce. A cap the
 * form does not display is a cap the user only discovers after losing text.
 */
export const EXTRA_LIMIT = 1200;

/**
 * `linkedin.com/in/x` is a relative path, not a URL — an `<a href>` or a DOCX
 * `ExternalHyperlink` resolves it against whatever page renders the CV instead
 * of opening it. The form's placeholder shows the `https://` form but never
 * enforces it, so a bare domain typed by the user needs a scheme prepended
 * before anything treats this string as an absolute link.
 */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

const decoded = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * Whether two links are the same page, however each was written: with or
 * without a scheme, "www.", a trailing slash, a query string or a fragment, in
 * any case — "linkedin.com/in/juan" in a CV and "https://www.linkedin.com/in/juan"
 * in a LinkedIn export are one profile. A LinkedIn profile is its slug, whichever
 * country's subdomain ("ar.linkedin.com") or language suffix ("/in/juan/es") a
 * copy of it came with. For comparing only: a link is kept as it was written.
 */
export function linkKey(url: string): string {
  const absolute = normalizeUrl(url);
  let host = "";
  let path = "";
  try {
    const parsed = new URL(absolute);
    host = parsed.hostname;
    path = parsed.pathname;
  } catch {
    // Not something `URL` can read: the same cut, by hand.
    const bare = absolute.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[?#]/)[0] ?? "";
    const slash = bare.indexOf("/");
    host = slash === -1 ? bare : bare.slice(0, slash);
    path = slash === -1 ? "" : bare.slice(slash);
  }
  host = host.toLowerCase().replace(/^www\./, "");
  if (/(^|\.)linkedin\.com$/.test(host)) {
    const profile = /^\/in\/([^/]+)/i.exec(path);
    if (profile) return `linkedin.com/in/${decoded(profile[1]!).toLowerCase()}`;
    host = "linkedin.com";
  }
  return `${host}${decoded(path).toLowerCase().replace(/\/+$/, "")}`;
}

/**
 * The inverse of `normalizeUrl`, for display.
 *
 * A CV shows "linkedin.com/in/juanperez", not "https://linkedin.com/in/juanperez" — the
 * scheme is what makes `url` a working link everywhere it is used as an href, but nobody
 * reads it out loud. The ficha's single link field uses this both to show an existing entry
 * and to derive its visible label from what gets typed, so the two can never drift apart.
 */
export function displayUrl(url: string): string {
  return url.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
}

export const linkSchema = z.object({
  label: z.string().min(1).transform((s) => s.slice(0, 60)),
  url: z
    .string()
    .min(1)
    .transform((s) => normalizeUrl(s).slice(0, 300)),
});

/** Free-form month/year, e.g. "Marzo 2021", "2019", "03/2019". */
const dateish = bounded(40);

export const experienceSchema = z.object({
  id: z.string(),
  company: bounded(120),
  role: bounded(120),
  city: bounded(80).default(""),
  country: bounded(80).default(""),
  start: dateish.default(""),
  end: dateish.default(""),
  current: z.boolean().default(false),
  /** Raw achievements, as the user wrote them. The model rewrites, never invents. */
  bullets: z.array(bounded(600)).default([]),
  /** Tools, tech, systems used here. Feeds skill inference. */
  tags: z.array(bounded(60)).default([]),
  /** «full_time», «internship»…: what kind of job it was, when a source said so outright. Empty when nobody did. */
  employmentType: bounded(30).default(""),
  /** «onsite», «remote» or «hybrid», when a source said so outright. */
  workMode: bounded(30).default(""),
  /** The person's own reason for a short stay or for the pause before this job, printed under it; empty when they gave none. */
  note: bounded(120).default(""),
  /**
   * Which of `bullets` the person told as results rather than as duties, by their text. Derived from how each line was told,
   * never edited from here: a copy of the bullets that carry the mark, so that it survives their being reordered.
   */
  achievements: z.array(bounded(600)).default([]),
  /** Which of `bullets` the person said carry over to the kind of job they are after, by their text: derived, like `achievements`. */
  transferable: z.array(bounded(600)).default([]),
});

/**
 * The roles that are actually roles.
 *
 * A blank entry reaches the prompt as "(role not given) @ (company not given)
 * [? – ?]" — and, worse, it counts: the CV's length budget branches on how many
 * roles there are, so a single blank entry moved a one-role profile onto the
 * two-to-three-role budget and cut the page in half.
 *
 * Two things create them. The ficha's "+ Agregar trabajo" appends an empty row,
 * which is the whole point of the button — you fill it in after you add it, and
 * some of them never get filled in. And the assistant opens a role from a
 * mention the user never finishes describing. Same empty record either way,
 * same consequence, so the filter stays.
 */
export function meaningfulExperience(profile: Profile): Experience[] {
  return profile.experience.filter(
    (job) => job.company.trim() || job.role.trim() || job.bullets.length > 0,
  );
}

export const educationSchema = z.object({
  id: z.string(),
  institution: bounded(160),
  degree: bounded(160),
  city: bounded(80).default(""),
  country: bounded(80).default(""),
  /** When it began, as the person gave it; empty when nobody did. A study that is still going has this and no end. */
  start: dateish.default(""),
  end: dateish.default(""),
  honors: bounded(300).default(""),
  /** Subjects or papers, a thesis, a grade: what the person said stands out of this study, a point to a line. */
  highlights: z.array(bounded(300)).default([]),
  /** In progress / incomplete studies still matter, especially outside tech. */
  status: z.enum(["completed", "in_progress", "incomplete"]).default("completed"),
});

export const projectSchema = z.object({
  id: z.string(),
  name: bounded(120),
  description: bounded(800).default(""),
  url: bounded(300).default(""),
  tags: z.array(bounded(60)).default([]),
});

export const certificationSchema = z.object({
  id: z.string(),
  name: bounded(160),
  issuer: bounded(120).default(""),
  date: dateish.default(""),
});

export const languageSchema = z.object({
  id: z.string(),
  name: bounded(60),
  level: bounded(60).default(""),
});

/**
 * Non-professional facts that are decisive for jobs outside the user's field
 * (retail, warehouse, hospitality) and usually missing from a tech CV.
 */
export const practicalSchema = z.object({
  availability: bounded(200).default(""),
  driverLicense: bounded(80).default(""),
  ownVehicle: z.boolean().default(false),
  willingToRelocate: z.boolean().default(false),
  workEligibility: bounded(200).default(""),
});

/**
 * What the person said they were when they began (`onboardingShape`): a student, someone with work behind them, back from a
 * pause, or changing field. Said here, where the generators read, because the order of a CV's sections follows it.
 */
export const SITUATIONS = ["student", "experienced", "break", "switch"] as const;
export type Situation = (typeof SITUATIONS)[number];

export const profileSchema = z.object({
  version: z.literal(1).default(1),
  /** Only what the person declared: never filled in from the dates. Absent for whoever did not say. */
  situation: z.enum(SITUATIONS).optional().catch(undefined),
  fullName: bounded(120).default(""),
  headline: bounded(160).default(""),
  /**
   * What kind of job the person is after, in a line of their own words. Not printed on a CV and not given to the
   * generators: it is what the job feed is ordered by (the semantic query, and a bonus for the postings whose title
   * says it) and what `/postular` compares a posting to.
   */
  objective: bounded(160).default(""),
  city: bounded(80).default(""),
  country: bounded(80).default(""),
  phone: bounded(40).default(""),
  email: bounded(160).default(""),
  links: z.array(linkSchema).default([]),
  /** The user's own words about themselves. The model reframes it per job. */
  about: bounded(2000).default(""),
  experience: z.array(experienceSchema).default([]),
  education: z.array(educationSchema).default([]),
  projects: z.array(projectSchema).default([]),
  certifications: z.array(certificationSchema).default([]),
  skills: z.array(bounded(80)).default([]),
  /** What the person marked for some of `skills`, by name: how well they know it. A skill they said nothing of is not here. */
  skillLevels: z.record(z.string(), z.enum(["strong", "working", "basic"])).default({}),
  languages: z.array(languageSchema).default([]),
  /**
   * Volunteering, sports, community work — transferable-skill evidence.
   *
   * Capped where `about` is rather than where a one-line note would be. For a
   * posting outside the candidate's field this is the only material the CV has:
   * `STRATEGIES.unrelated` is built on promoting it, and a real profile arrived
   * with its one extra cut mid-word at 400 characters — silently, because
   * `bounded` truncates rather than rejects and the form showed no limit.
   */
  extras: z.array(bounded(EXTRA_LIMIT)).default([]),
  practical: practicalSchema.default({
    availability: "",
    driverLicense: "",
    ownVehicle: false,
    willingToRelocate: false,
    workEligibility: "",
  }),
});

export type Link = z.infer<typeof linkSchema>;
export type Experience = z.infer<typeof experienceSchema>;
export type Education = z.infer<typeof educationSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Certification = z.infer<typeof certificationSchema>;
export type LanguageSkill = z.infer<typeof languageSchema>;
export type Practical = z.infer<typeof practicalSchema>;
export type Profile = z.infer<typeof profileSchema>;

export const emptyProfile = (): Profile => profileSchema.parse({});
