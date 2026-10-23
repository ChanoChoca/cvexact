import { z } from "zod";

/**
 * Structured reading of a job post. Produced once per job text and reused by
 * all four generators, so a full application costs one analysis, not four.
 */

export const requirementSchema = z.object({
  text: z.string().max(300).describe("The requirement, in the job post's own language"),
  kind: z
    .enum(["hard", "soft"])
    .describe("hard = concrete skill/tool/credential; soft = trait or behaviour"),
  /**
   * Whether missing this disqualifies the application outright, which is a
   * different question from `kind`: a hard requirement can be negotiable and a
   * posting can mark a soft one as excluding.
   *
   * Drives the pre-flight warning, so the user finds out before a generation is
   * paid for rather than after. Defaulted because `jobAnalysisSchema` is
   * re-parsed out of localStorage and out of four route bodies, all of which
   * carry analyses saved before this field existed.
   */
  excluding: z
    .boolean()
    .default(false)
    .describe("True only when the post says its absence disqualifies, e.g. '(excluyente)'"),
});

/**
 * How far the job sits from what the user has done. This selects the CV
 * building strategy, and is the difference between a rich CV and a three-line
 * one when someone applies outside their field.
 */
export const relevanceSchema = z.enum(["direct", "adjacent", "unrelated"]);

export const jobAnalysisSchema = z.object({
  title: z.string().max(160).describe("Job title as posted"),
  company: z.string().max(160).default("").describe("Hiring company, empty if not stated"),
  location: z.string().max(160).default(""),
  workMode: z.enum(["onsite", "hybrid", "remote", "unknown"]).default("unknown"),
  seniority: z
    .enum(["intern", "junior", "mid", "senior", "lead", "not_applicable", "unknown"])
    .default("unknown"),
  /** BCP-47-ish tag. Drives the output language of every generated artifact. */
  language: z.string().max(10).describe("Language the post is written in, e.g. 'es', 'en'"),
  domain: z
    .string()
    .max(120)
    .describe("Field this job belongs to, e.g. 'software engineering', 'retail'"),
  relevance: relevanceSchema.describe(
    "How close this job is to the candidate's own background",
  ),
  relevanceReason: z
    .string()
    .max(400)
    .describe(
      "One sentence justifying the relevance call, written in the posting's own language (the 'language' field) — it is shown to the candidate",
    ),
  requirements: z.array(requirementSchema).max(30),
  responsibilities: z.array(z.string().max(300)).max(20).default([]),
  /** What the business behind the posting wants improved, in its own words. Defaulted: an analysis saved before this existed has none. */
  priorities: z
    .array(z.string().max(160))
    .max(5)
    .default([])
    .describe("What the business wants improved (costs, time, quality, scale, customers, risk), in the posting's words; empty when it does not say"),
  /** Terms worth mirroring verbatim so ATS keyword matching does not miss. */
  keywords: z
    .array(z.string().max(60))
    .transform((arr) => arr.slice(0, 40))
    .default([]),
  /** Questions the post asks applicants to answer, if any are embedded in it. */
  embeddedQuestions: z.array(z.string().max(400)).max(20).default([]),
  /**
   * The subject line the posting demands, verbatim. Empty when it demands none,
   * and the cover email falls back to `title`.
   *
   * Extracted here rather than left to the email generator because this is the
   * only stage that reads the posting's own text: a posting saying "asunto:
   * REF-2043 – Vendedor" otherwise loses that instruction, and the email goes
   * out with a subject the recruiter's filter drops.
   *
   * Defaulted for the same reason as `requirement.excluding`: the analysis is
   * re-parsed out of localStorage and out of four route bodies, all of which
   * carry analyses saved before this field existed.
   */
  emailSubject: z
    .string()
    .max(160)
    .default("")
    .describe("Subject line the posting tells applicants to use, empty if it does not"),
  /** Where the posting says to send the application. Empty if it publishes no address. */
  applicationEmail: z
    .string()
    .max(160)
    .default("")
    .describe("Address the posting says to send the CV to, empty if not stated"),
});

export type Requirement = z.infer<typeof requirementSchema>;
export type Relevance = z.infer<typeof relevanceSchema>;
export type JobAnalysis = z.infer<typeof jobAnalysisSchema>;

/**
 * A competency the candidate almost certainly has but did not write down,
 * derived from something they did write down. Never a free-floating guess:
 * `derivedFrom` must name the profile item it follows from.
 */
export const inferredSkillSchema = z.object({
  skill: z.string().max(80),
  derivedFrom: z
    .string()
    .max(100)
    .describe(
      "A short phrase naming the profile item this is entailed by, e.g. 'React' or 'Cajero en Coto' — never a full sentence",
    ),
  confidence: z.enum(["high", "medium"]),
  rationale: z.string().max(300).describe("Why the derivation holds"),
});

/**
 * The 60 is deliberately looser than the 40 `INFER_SKILLS_SYSTEM` asks for.
 * The prompt's number is a quality bar — precision over volume — while this one
 * only guards against a runaway response, and no provider here is reliably told
 * either (see `clipToLimits` in `lib/ai/pipeline.ts`). Tightening this to match
 * the prompt would turn a model that returned 45 good skills into a failed
 * generation.
 */
export const inferredSkillsSchema = z.object({
  skills: z.array(inferredSkillSchema).max(60),
});

export type InferredSkill = z.infer<typeof inferredSkillSchema>;
export type InferredSkills = z.infer<typeof inferredSkillsSchema>;
