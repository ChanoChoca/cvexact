import { z } from "zod";
import { profileSchema } from "./profile";

/**
 * What one turn of the old chat-based profile interview produced.
 *
 * That interview (`lib/intake/*`) is retired — the onboarding flow in
 * `lib/onboarding/*` replaced it. This schema stays only so `INTAKE_KEY` data
 * already sitting in a browser's `localStorage`, or in an exported backup,
 * still parses in `lib/storage/local.ts` instead of failing to load. Nothing
 * new is ever written through it.
 */

const bounded = (max: number) => z.string().transform((s) => s.slice(0, max));

/**
 * Caps mirror `lib/schemas/profile.ts` exactly. `profileSchema` truncates
 * rather than rejects, so a longer value would not fail — it would silently
 * lose its tail somewhere the user never sees. Failing here instead means the
 * repair path in `lib/ai/pipeline.ts` gets a chance to ask for a shorter one.
 */
const NAME = 120;
const BULLET = 600;

/**
 * Points at an entity the operation acts on.
 *
 * Two readings, resolved in `applyOperations`:
 *  - an `id` the prompt showed the model, for anything already in the profile;
 *  - an alias the model invents in this same turn (`"new-1"`), for something it
 *    is creating now. Aliases are what let one turn add a role *and* its
 *    bullets — the user tells their whole job in one paragraph, and splitting
 *    that across two round-trips would cost a second model call and a second
 *    question the user already answered.
 */
const ref = bounded(60);

/** Free-text month/year, as `dateish` in the profile schema. */
const dateish = bounded(40);

const experienceFields = {
  company: bounded(NAME).optional(),
  role: bounded(NAME).optional(),
  city: bounded(80).optional(),
  country: bounded(80).optional(),
  start: dateish.optional(),
  end: dateish.optional(),
  current: z.boolean().optional(),
};

const educationFields = {
  institution: bounded(160).optional(),
  degree: bounded(160).optional(),
  city: bounded(80).optional(),
  country: bounded(80).optional(),
  end: dateish.optional(),
  honors: bounded(300).optional(),
  status: z.enum(["completed", "in_progress", "incomplete"]).optional(),
};

/**
 * Which entity a `remove` acts on.
 *
 * Deletions are folded into one operation rather than given one variant each.
 * The union below is already the widest schema this app sends a provider, and
 * every extra variant is another branch Gemini and Cohere have to keep straight
 * (see `lib/ai/cohere-schema.ts` for what a discriminated union already costs
 * with those two). Removals are also the rarest thing a turn does — the user
 * corrects far more often than they delete.
 */
export const REMOVABLE = [
  "experience",
  "education",
  "project",
  "certification",
  "language",
  "link",
  "skill",
  "extra",
  "bullet",
] as const;

export const intakeOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("setBasic"),
    field: z.enum(["fullName", "headline", "city", "country", "phone", "email", "about"]),
    value: bounded(2000),
  }),
  z.object({
    op: z.literal("setPractical"),
    field: z.enum(["availability", "driverLicense", "workEligibility"]),
    value: bounded(200),
  }),
  z.object({
    op: z.literal("setPracticalFlag"),
    field: z.enum(["ownVehicle", "willingToRelocate"]),
    value: z.boolean(),
  }),
  z.object({
    op: z.literal("addLink"),
    label: bounded(60),
    url: bounded(300),
  }),
  z.object({ op: z.literal("addExperience"), ref, ...experienceFields }),
  z.object({ op: z.literal("updateExperience"), ref, ...experienceFields }),
  z.object({ op: z.literal("addBullet"), ref, text: bounded(BULLET) }),
  z.object({
    op: z.literal("updateBullet"),
    ref,
    index: z.number().int().min(0),
    text: bounded(BULLET),
  }),
  z.object({ op: z.literal("addTags"), ref, tags: z.array(bounded(60)).max(30) }),
  z.object({ op: z.literal("addEducation"), ref, ...educationFields }),
  z.object({ op: z.literal("updateEducation"), ref, ...educationFields }),
  z.object({
    op: z.literal("addProject"),
    ref,
    name: bounded(NAME),
    description: bounded(800).optional(),
    url: bounded(300).optional(),
    tags: z.array(bounded(60)).max(30).optional(),
  }),
  z.object({
    op: z.literal("addCertification"),
    ref,
    name: bounded(160),
    issuer: bounded(NAME).optional(),
    date: dateish.optional(),
  }),
  z.object({
    op: z.literal("addLanguage"),
    ref,
    name: bounded(60),
    level: bounded(60).optional(),
  }),
  z.object({ op: z.literal("addSkills"), skills: z.array(bounded(80)).max(40) }),
  z.object({ op: z.literal("addExtra"), text: bounded(1200) }),
  z.object({
    op: z.literal("remove"),
    entity: z.enum(REMOVABLE),
    /** The id for anything that has one; the literal text for a skill or link. */
    ref,
    /** Which bullet, when `entity` is "bullet"; which entry, for "extra". */
    index: z.number().int().min(0).optional(),
  }),
  /**
   * Something the user said that no field fits.
   *
   * The escape hatch that keeps the interview honest. Without it the model's
   * options for an answer it cannot file are to drop it or to force it into the
   * nearest field, and both lose what the user actually said. A note is stored
   * verbatim and surfaced in the ficha under "sin clasificar", where the user
   * decides where it belongs.
   */
  z.object({ op: z.literal("note"), text: bounded(1200) }),
]);

export const intakeTurnSchema = z.object({
  /**
   * What the assistant says. FIRST in the object on purpose: the route streams
   * partial objects to the browser, and a model emits keys in schema order, so
   * putting `reply` first is what makes the text appear while the operations
   * are still being written.
   */
  reply: bounded(700),
  operations: z.array(intakeOperationSchema).max(12).default([]),
  /** Whether everything the current agenda topic needs has now been answered. */
  topicDone: z.boolean().default(false),
  /** What is still missing from the current topic, for the progress hint. */
  missing: z.array(bounded(120)).max(6).default([]),
  /**
   * Which of the pending notes this turn dealt with, by their index in the list
   * the prompt showed.
   *
   * A `note` is something the user said that no field fits. There is no longer a
   * panel where they can file it themselves, so the assistant raises it again in
   * a later turn instead — and without a way to say "done with that one", the
   * same note would be re-sent on every turn for the rest of the interview.
   *
   * Indices rather than ids: the list is numbered in the prompt, and a uuid is
   * noise a model gets wrong. A separate field rather than another variant of
   * `intakeOperationSchema`, which already has eighteen — the size of that union
   * on the wire is the known risk with Gemini and Cohere.
   */
  notesHandled: z.array(z.number().int().min(0)).max(6).default([]),
});

export type IntakeOperation = z.infer<typeof intakeOperationSchema>;
export type IntakeTurn = z.infer<typeof intakeTurnSchema>;
export type Removable = (typeof REMOVABLE)[number];

// --- What the conversation leaves behind ---------------------------------------

/**
 * The interview's own store, kept beside the profile rather than inside it.
 *
 * `Profile` is POSTed to six routes and written to a jsonb column; a transcript
 * living in it would ride along on every one of those. It is also the schema
 * every downstream check is built on, and the safest change to it is none.
 *
 * So the profile keeps the data and this keeps the provenance: what the user
 * actually said, which of their sentences each stored value came from, and
 * enough history to undo a turn. Nothing here is a summary — a summary is
 * precisely what would lose the wording that makes a bullet the candidate's own.
 */

export const INTAKE_KEY = "cvexact.intake.v1";

/** How much history is worth keeping. Snapshots are whole profiles, so few. */
export const MAX_MESSAGES = 400;
export const MAX_SNAPSHOTS = 10;

/**
 * How many operations one recorded turn may account for.
 *
 * Sized for a CV import rather than for a chat turn, which is capped at 12 by
 * `intakeTurnSchema` and will never come near this. It has to be: a turn is
 * recorded *after* its operations have been applied and paid for, so a store
 * that refused to hold the record would lose the import and charge for it.
 */
export const MAX_TURN_RECORD = 60;

const text = (max: number) => z.string().transform((s) => s.slice(0, max));

export const appliedOpSchema = z.object({
  op: z.string().max(40),
  label: text(60),
  value: text(600),
  path: text(120),
  rephrased: z.boolean().optional(),
});

export const rejectedOpSchema = z.object({
  op: z.string().max(40),
  reason: z.enum(["invented", "unknownRef", "outOfRange", "empty"]),
  /** Only "invented" carries these, so optional rather than an empty default. */
  terms: z.array(text(80)).max(20).optional(),
  text: text(600),
});

export const intakeMessageSchema = z.object({
  id: z.string().max(60),
  role: z.enum(["user", "assistant"]),
  /** Verbatim. This is the record of what was actually said. */
  text: text(4000),
  at: z.string().max(40),
  /** Set on an assistant turn, linking it to its snapshot for undo. */
  turnId: z.string().max(60).optional(),
  applied: z.array(appliedOpSchema).max(MAX_TURN_RECORD).default([]),
  rejected: z.array(rejectedOpSchema).max(MAX_TURN_RECORD).default([]),
});

/**
 * One stored value and the sentence it came from.
 *
 * `sourceMessageId` rather than a copy of the text: ten operations from one
 * paragraph would otherwise store that paragraph ten times, and the message is
 * already in `messages` word for word.
 */
export const intakeCaptureSchema = z.object({
  id: z.string().max(60),
  turnId: z.string().max(60),
  sourceMessageId: z.string().max(60),
  /** Where it landed in the profile; null for something left unclassified. */
  path: text(120).nullable(),
  label: text(60),
  value: text(1200),
  rephrased: z.boolean().optional(),
  at: z.string().max(40),
});

/** What `TopicId` in the old `lib/intake/agenda.ts` used to enumerate, kept for old stored progress. */
export const TOPIC_IDS = [
  "identidad",
  "resumen",
  "experiencia",
  "educacion",
  "skills",
  "practico",
] as const;

export const intakeStoreSchema = z.object({
  version: z.literal(1).default(1),
  messages: z.array(intakeMessageSchema).max(MAX_MESSAGES).default([]),
  captures: z.array(intakeCaptureSchema).max(2000).default([]),
  /**
   * The profile as it stood before each recorded turn, newest first. What
   * "deshacer este turno" restores.
   */
  snapshots: z
    .array(z.object({ turnId: z.string().max(60), profile: profileSchema }))
    .max(MAX_SNAPSHOTS)
    .default([]),
  /**
   * Topics the user said do not apply to them.
   *
   * Unknown ids are dropped rather than rejected. `numeros` was a topic until
   * numbers became a per-role button, and a stored `["numeros"]` failing the
   * enum would fail the whole store — which `loadIntake` recovers from by
   * returning an empty one, so one retired id would cost the user their entire
   * transcript and every snapshot they could still undo to.
   */
  skipped: z
    .preprocess(
      (value) =>
        Array.isArray(value)
          ? value.filter((id) => (TOPIC_IDS as readonly unknown[]).includes(id))
          : value,
      z.array(z.enum(TOPIC_IDS)).max(TOPIC_IDS.length),
    )
    .default([]),
});

export type AppliedOp = z.infer<typeof appliedOpSchema>;
export type RejectedOp = z.infer<typeof rejectedOpSchema>;
export type IntakeMessage = z.infer<typeof intakeMessageSchema>;
export type IntakeCapture = z.infer<typeof intakeCaptureSchema>;
export type IntakeStore = z.infer<typeof intakeStoreSchema>;

export const emptyIntake = (): IntakeStore => intakeStoreSchema.parse({});
