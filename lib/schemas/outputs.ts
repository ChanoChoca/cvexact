import { z } from "zod";

/** Outputs of the generators that sit alongside the CV. */

// --- Application form answers -------------------------------------------------

export const answerSchema = z.object({
  question: z.string().max(600),
  answer: z.string().max(2000),
  /** Set when the question wants a bare value (years, salary, yes/no). */
  shortAnswer: z
    .string()
    .max(120)
    .default("")
    .describe("Bare value for numeric or yes/no questions, empty otherwise"),
  /** Flags answers the user must check because the profile did not settle them. */
  needsUserInput: z
    .boolean()
    .default(false)
    .describe("True when the profile lacks the fact and the answer is a placeholder"),
});

export const answersSchema = z.object({
  language: z.string().max(10),
  answers: z.array(answerSchema).max(30),
});

/**
 * Stored shape. `maxChars`/`maxWords` are the form limit parsed out of the
 * pasted question in code (`parseQuestionLimit` in `@/lib/ai/question-limits`)
 * and attached by the answers route — the model never sees them, so they are
 * not in the schema it answers against, the same split `coverEmailDraftSchema`
 * makes from `coverEmailSchema`. Optional both ways: every set of answers
 * saved before limits existed keeps parsing untouched.
 */
export const answerWithLimitSchema = answerSchema.extend({
  maxChars: z.number().int().positive().max(100000).optional(),
  maxWords: z.number().int().positive().max(100000).optional(),
});

export const answersWithLimitsSchema = z.object({
  language: z.string().max(10),
  answers: z.array(answerWithLimitSchema).max(30),
});

export type AnswerWithLimit = z.infer<typeof answerWithLimitSchema>;
export type AnswersWithLimits = z.infer<typeof answersWithLimitsSchema>;

export type Answer = z.infer<typeof answerSchema>;
export type Answers = z.infer<typeof answersSchema>;

// --- Cover email --------------------------------------------------------------

export const emailToneSchema = z.enum(["formal", "neutral", "cercano"]);
export const emailLengthSchema = z.enum(["short", "medium"]);

export const coverEmailSchema = z.object({
  language: z.string().max(10),
  subject: z.string().max(160),
  body: z.string().max(3000).describe("Plain text, with real line breaks, no markdown"),
});

/**
 * What the model actually writes. `subject` is missing on purpose: it is not a
 * judgement call, it is the line the posting demanded (or the job title), and
 * `resolveEmailSubject` settles it in code — see `writeEmail`. The stored shape
 * above keeps the field, because that is what the UI reads and what is already
 * in localStorage.
 */
export const coverEmailDraftSchema = coverEmailSchema.omit({ subject: true });

export type EmailTone = z.infer<typeof emailToneSchema>;
export type EmailLength = z.infer<typeof emailLengthSchema>;
export type CoverEmail = z.infer<typeof coverEmailSchema>;

// --- Interview preparation ----------------------------------------------------

export const interviewQuestionSchema = z.object({
  question: z.string().max(400),
  answer: z.string().max(1800).describe("A first-person answer the candidate can adapt"),
  keyPoints: z.array(z.string().max(200)).max(5).default([]),
  followUps: z.array(z.string().max(300)).max(3).default([]),
});

export const interviewSectionSchema = z.object({
  category: z.string().max(80),
  questions: z.array(interviewQuestionSchema).max(12),
});

/**
 * The words the prep sheet prints around the model's own text.
 *
 * Same reasoning as `cvLabelsSchema`: the document can come out in any
 * language, so its fixed strings come from the model rather than from a
 * translation table the code would have to keep. Every field is defaulted to
 * the Spanish that used to be hardcoded, so a prep sheet generated before this
 * existed still renders unchanged.
 */
export const INTERVIEW_LABEL_DEFAULTS = {
  intro:
    "Preguntas probables y respuestas preparadas a partir de tu perfil y del aviso. " +
    "Las respuestas son un punto de partida: contalas con tus palabras.",
  keyPoints: "No te olvides de",
  followUps: "Repreguntas probables",
  questionsToAsk: "Preguntas para hacerles vos",
};

export const interviewLabelsSchema = z
  .object({
    intro: z
      .string()
      .max(300)
      .default(INTERVIEW_LABEL_DEFAULTS.intro)
      .describe("The paragraph under the title, addressed to the candidate"),
    keyPoints: z.string().max(60).default(INTERVIEW_LABEL_DEFAULTS.keyPoints),
    followUps: z.string().max(60).default(INTERVIEW_LABEL_DEFAULTS.followUps),
    questionsToAsk: z.string().max(60).default(INTERVIEW_LABEL_DEFAULTS.questionsToAsk),
  })
  // Both levels of default are load-bearing: the object's covers a model that
  // omits `labels` outright, the fields' cover one that sends a partial object.
  .default(INTERVIEW_LABEL_DEFAULTS);

export const interviewPrepSchema = z.object({
  language: z.string().max(10),
  jobTitle: z.string().max(160),
  company: z.string().max(160).default(""),
  sections: z.array(interviewSectionSchema).max(8),
  /** Questions the candidate should ask the interviewer. */
  questionsToAsk: z.array(z.string().max(300)).max(8).default([]),
  /** The renderer's own words, in the sheet's language. */
  labels: interviewLabelsSchema,
});

/**
 * What a fresh generation must satisfy — stricter than `interviewPrepSchema`
 * itself on purpose. The plain schema also validates prep sheets coming back
 * *out* of storage (`interview` in `applicationSchema`,
 * lib/storage/local.ts), where `loadApplications` drops an entire application
 * — CV, answers, email, everything — on one failed `safeParse`. A floor here
 * would silently delete every saved application whose interview prep was
 * generated before this floor existed. Applied only to what the model must
 * produce right now: a response of one category with two questions passed
 * this schema and was indistinguishable from a deliberately short, valid one.
 */
export const interviewPrepGenerationSchema = interviewPrepSchema.extend({
  sections: z
    .array(interviewSectionSchema.extend({ questions: z.array(interviewQuestionSchema).min(2).max(12) }))
    .min(4)
    .max(8),
});

export type InterviewLabels = z.infer<typeof interviewLabelsSchema>;
export type InterviewQuestion = z.infer<typeof interviewQuestionSchema>;
export type InterviewSection = z.infer<typeof interviewSectionSchema>;
export type InterviewPrep = z.infer<typeof interviewPrepSchema>;

// --- Presentation video -------------------------------------------------------

/**
 * How long a video may be asked for, in seconds.
 *
 * The range rather than a list of presets: postings set this themselves and set
 * it anywhere — "90 segundos", "máximo 4 minutos", "10 minutos" are all things
 * they say. The floor is the shortest anyone can say something meaningful in;
 * the ceiling is the longest a posting realistically asks for, and it also
 * bounds what one generation can be asked to write.
 */
export const VIDEO_MIN_SECONDS = 20;
export const VIDEO_MAX_SECONDS = 600;

export const videoBlockSchema = z.object({
  topic: z.string().max(120).describe("What this block is about, in the output language"),
  seconds: z
    .number()
    .int()
    .min(5)
    .max(600)
    .describe("How long this block takes to say aloud, at a calm pace"),
  /**
   * What `script` holds. A long video cannot be a wall of memorised text — a
   * thousand words read off a screen is visibly read — so past a few minutes
   * only the opening and the closing stay written out and the middle becomes
   * guidance the candidate speaks around.
   *
   * Defaulted, and read as such: scripts saved before this existed come back
   * from localStorage unvalidated, so their blocks have no `mode` at all and
   * every renderer must treat that as "verbatim".
   */
  mode: z
    .enum(["verbatim", "outline"])
    .default("verbatim")
    .describe(
      'Whether "script" is the exact words to say ("verbatim") or a guide to what to cover ("outline")',
    ),
  script: z
    .string()
    .max(3500)
    .describe(
      "For verbatim blocks: exactly what to say, first person, spoken register. " +
        "For outline blocks: what to cover and in what order, addressed to the candidate. " +
        "No markdown, no stage directions either way",
    ),
  /**
   * The glanceable version: what to remember if the script is lost mid-take.
   * In an outline block this carries the content, not the trimmings.
   */
  keyPoints: z.array(z.string().max(200)).max(8).default([]),
});

/**
 * The words the printed script puts around the model's own text.
 *
 * Same reasoning as `interviewLabelsSchema`: the sheet can come out in any
 * language, so its fixed strings come from the model rather than from a
 * translation table the code would have to keep. Defaulted to the Spanish the
 * panel uses, so a script generated before the PDF existed still prints.
 */
export const VIDEO_SCRIPT_LABEL_DEFAULTS = {
  intro:
    "Guion para grabar tu video de presentación. No lo leas de corrido: " +
    "usá los tiempos como referencia y contalo con tus palabras.",
  duration: "Duración total",
  keyPoints: "No te olvides de",
  outline: "Guía — no es texto para leer",
  tips: "Antes de grabar",
};

export const videoScriptLabelsSchema = z
  .object({
    intro: z
      .string()
      .max(300)
      .default(VIDEO_SCRIPT_LABEL_DEFAULTS.intro)
      .describe("The paragraph under the title, addressed to the candidate"),
    duration: z.string().max(60).default(VIDEO_SCRIPT_LABEL_DEFAULTS.duration),
    keyPoints: z.string().max(60).default(VIDEO_SCRIPT_LABEL_DEFAULTS.keyPoints),
    outline: z
      .string()
      .max(60)
      .default(VIDEO_SCRIPT_LABEL_DEFAULTS.outline)
      .describe("Printed over a block the candidate improvises around"),
    tips: z.string().max(60).default(VIDEO_SCRIPT_LABEL_DEFAULTS.tips),
  })
  // Both levels of default are load-bearing, for the reason spelled out on
  // `interviewLabelsSchema`.
  .default(VIDEO_SCRIPT_LABEL_DEFAULTS);

export const videoScriptSchema = z.object({
  language: z.string().max(10),
  jobTitle: z.string().max(160),
  company: z.string().max(160).default(""),
  totalSeconds: z.number().int().max(1200),
  blocks: z.array(videoBlockSchema).max(14),
  /** Framing, light, pacing: how to record it, not what to say. */
  tips: z.array(z.string().max(240)).max(6).default([]),
  /** The printed sheet's own words, in the script's language. */
  labels: videoScriptLabelsSchema,
});

export type VideoScriptLabels = z.infer<typeof videoScriptLabelsSchema>;
export type VideoBlock = z.infer<typeof videoBlockSchema>;
export type VideoScript = z.infer<typeof videoScriptSchema>;
