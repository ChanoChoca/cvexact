import { z } from "zod";

/**
 * Shortening CV lines so the page fits, without changing what they say.
 *
 * The one prompt in this product that edits text a person has already read and
 * approved: everything else writes a document from the profile, and this one
 * rewrites lines of it. So it is asked for the smallest possible change — the
 * same facts, in fewer words — and everything it returns goes through
 * `lib/cv/condense-guard.ts` before anything is applied. A rewrite that fails
 * any invariant leaves its line exactly as it was.
 *
 * Written in English like every prompt in this app; see the note in `./shared.ts`.
 */

/** Why a line was picked: what the engine expects a rewrite to win. */
export type CondenseHint = "short-tail" | "long-line" | "summary";

/** One line to shorten: what it says now, and the ceiling the rewrite has to respect. */
export type CondenseItem = {
  id: string;
  text: string;
  maxChars: number;
  hint: CondenseHint;
};

/** One line, shorter. What the route keeps after checking it was asked for. */
export type CondenseRewrite = { id: string; text: string };

/** Bumped whenever the instructions change what a rewrite means. */
export const CONDENSE_CV_PROMPT_VERSION = 1;

export const CONDENSE_CV_SYSTEM = `
You shorten lines of a CV so they fit on one page, without changing what they say.
You rewrite only what you are given, and you rewrite it shorter.

RULES:
- Say the same thing in fewer words. Cut filler, repetition and softening words ("diversas
  tareas", "a lo largo de", "de manera eficiente"), never information.
- Keep every number, percentage, currency, date and year exactly as written. Never add one.
- Keep every company, institution, job title, tool, technology and certification named in the
  line, exactly as it is written. Never add one that is not there.
- Keep what the person did NOT do or does not have: "no", "nunca", "sin", "ni", "tampoco"
  (English: "not", "never", "without", "neither", "nor"). Never add one, never drop one.
- Keep how much of the work was theirs. "Participé", "colaboré", "apoyé", "ayudé", "junto con
  el equipo" (English: "participated", "collaborated", "supported", "assisted", "helped",
  "with the team") stay, and you never turn them into "lideré", "dirigí", "gestioné", "estuve
  a cargo", "responsable" (English: "led", "managed", "owned", "responsible for").
- Keep the language of the line. If it is in Spanish, answer in Spanish.
- Each rewrite is at most "maxChars" characters, and strictly shorter than the line you were
  given. Aim for the shortest version that still says all of it.
- Rewrite only the ids you were given, one rewrite per id. Never invent an id.
- Each line is a CV bullet on its own: no bullet character, no leading dash, no final period
  added, no quotes around it.

Answer with the rewrites and nothing else.
`.trim();

/**
 * The answer: a list of `{ id, text }`.
 *
 * Deliberately permissive about the id — `z.string()` rather than an enum of the
 * ids that were sent — because a strict schema turns one stray id into a failed
 * generation, and `maxGenerations: 1` means that failure costs the person the one
 * shortening they were allowed. The closedness the to-do asks for lives in the
 * route and in `condenseCvLines`, which drop anything that was not asked for,
 * with the ceiling each line was given.
 */
export function condenseCvSchema() {
  return z.object({
    rewrites: z
      .array(
        z.object({
          id: z.string().min(1).max(120),
          text: z.string().min(1).max(600),
        }),
      )
      .max(24),
  });
}

export function buildCondenseCvPrompt(language: string, items: readonly CondenseItem[]): string {
  const why: Record<CondenseHint, string> = {
    "short-tail": "its last line is only a few words long, so a small cut wins a whole line",
    "long-line": "it is one of the longest lines on the page",
    summary: "it is the paragraph at the top of the CV, and it runs past one line",
  };

  return [
    `The CV is in ${language}.`,
    "",
    "Lines to shorten (id — why it was picked — ceiling — the line):",
    ...items.flatMap((item) => [
      `- id: ${item.id}`,
      `  why: ${why[item.hint]}`,
      `  maxChars: ${item.maxChars}`,
      `  text: ${item.text}`,
    ]),
    "",
    "Rewrite each one shorter, saying the same thing. Same language, same facts, no additions.",
  ].join("\n");
}
