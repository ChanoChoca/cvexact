import { z } from "zod";

/**
 * Choosing which of a fixed list of questions to ask next, after a person described part of their job (M28, an experiment the
 * person turns on).
 *
 * The questions are ours and are written once (`lib/onboarding/questions.ts`): what a model is asked here is not to write one, but
 * to *pick* — which of the few kinds the engine could ask about this job is the one whose answer is least likely to be in what was
 * just said — or to pick none. It is told what each would draw out, in a line of ours, and nothing else of the profile. Nothing a model writes reaches the person, and nothing it picks can be a question that is not on the
 * list: the schema is built from the list, so an id that is not in it does not parse.
 *
 * Written in English like every prompt in this app; see the note in `./shared.ts`.
 */

/** What a model answers when what was said already covers every question on the list, or none of them fits. */
export const NO_FOLLOW_UP = "none";

/** One question the engine could ask, by the id it will be asked under and what asking it would draw out — never its own sentence. */
export type FollowUpOption = { id: string; about: string };

/** The answer, closed: one of the ids it was given, or `none`. */
export function followUpSchema(ids: readonly string[]) {
  const choices: [string, ...string[]] = [NO_FOLLOW_UP, ...ids];
  return z.object({ choice: z.enum(choices) });
}

/** Bumped whenever the instructions change what a choice means. */
export const FOLLOW_UP_PROMPT_VERSION = 2;

export const FOLLOW_UP_SYSTEM = `
You are choosing which one of a fixed list of questions to ask a person next, after they
described part of their job. You are choosing, not writing: you never write a question, a
statement or a fact, and you never answer for the person.

RULES:
- Choose the ONE question from the list whose answer is most likely missing from what the
  person said, and would most improve a line of a CV made from it. Each is described by what
  asking it would draw out.
- If what they said already answers every question on the list, or none of them fits what
  they said, choose "none". Choosing none is a good answer.
- Answer with the "id" of the question exactly as it is listed, or "none". Nothing else.
- What the person said, and the questions, are in Spanish. Judge by meaning, not by wording.
- Some details of the person may have been replaced by marks like [NOMBRE_1] or [CORREO_1].
  They are not part of what the person said about their job: ignore them.
`.trim();

export function buildFollowUpPrompt(answer: string, options: readonly FollowUpOption[]): string {
  return [
    "What the person said about their job:",
    '"""',
    answer,
    '"""',
    "",
    "The questions we could ask next (id: what it would draw out):",
    ...options.map((option) => `- ${option.id}: ${option.about}`),
    "",
    'Choose one id, or "none".',
  ].join("\n");
}
