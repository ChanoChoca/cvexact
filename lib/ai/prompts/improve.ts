import { z } from "zod";

/**
 * "Mejorar con IA": one line of what a person did in a job, or the description of a project, said better.
 *
 * These are the two texts a base CV prints as they stand (`lib/cv/from-profile.ts`), which is why they are the two this is offered on:
 * a model that rewrites them is rewriting what a recruiter reads. So it is held to the narrowest job there is — the same facts, said
 * more clearly — and what it returns is never applied: the browser checks it against what was written (`lib/onboarding/improve-guard.ts`,
 * a number the text did not say is thrown out) and shows it next to the original, and the person decides.
 *
 * There are two forms. One text at a time (`IMPROVE_SYSTEM`) is the button on a line of a job and on a project. Many at once (`IMPROVE_MANY_SYSTEM`) is the button
 * at the top of each section of the profile: one call for all that the section holds that can be said better, because a call is a use of the plan's monthly allowance
 * and one for each line would spend it in a couple of taps. The rules are the same, and so is what stands between the model and a number on somebody's CV.
 *
 * Written in English like every prompt in this app; see the note in `./shared.ts`.
 */

/** What a field can hold: a fact is cut at 600 (`FACT_MAX`), the description of a project at 800. */
export const IMPROVE_LIMIT = { task: 600, project: 800 } as const;
export type ImproveKind = keyof typeof IMPROVE_LIMIT;

/** Rejects instead of cutting, like the other closed answers: an over-long reply is repaired by asking again and not kept with its tail missing. */
export const improveSchema = z.object({ text: z.string().min(1).max(IMPROVE_LIMIT.project) });
export type ImproveResult = z.infer<typeof improveSchema>;

export const IMPROVE_SYSTEM = `
You are improving how one thing a person wrote about their own work reads on their CV. You are
editing, not inventing: you say the same thing better, and nothing else.

You are given either a TASK (one line about what they did in a job) or a PROJECT (the description
of a project of theirs). Return that same text, clearer and more direct, in the voice of a CV.

RULES:
- Keep exactly the same facts. Say nothing the text does not already say.
- Never add a number, percentage, amount, date or quantity. Never drop one that is there either:
  copy every figure exactly as it is written.
- Never add the name of a company, a person, a client, a product or a place, and never add a tool,
  technology, method or certification the text does not already name.
- Never add a result, an impact or a scale ("improved", "increased", "led a team") that the text
  does not claim. Do not turn a task into an achievement, or taking part into leading.
- Keep the language of the text, its person (first person stays first person) and its tense.
  If it is in Spanish, answer in Spanish.
- A TASK stays one statement. A PROJECT keeps its sentences: do not merge them and do not add one.
- Do not make it longer than it was. Shorter is fine. No filler ("responsible for", "dynamic",
  "results-oriented").
- Some details of the person may have been replaced by marks like [CORREO_1] or [ENLACE_1]. A mark
  is part of the text: copy it exactly, brackets and number included, wherever it falls.
- If the text already reads well, return it unchanged. Returning it unchanged is a good answer.

Return JSON matching the schema exactly. No prose outside it.
`.trim();

export function buildImprovePrompt(text: string, kind: ImproveKind): string {
  return `${kind === "task" ? "TASK" : "PROJECT"} (verbatim):\n"""\n${text}\n"""`;
}

/**
 * What the button at the top of a section can ask of: the two above and the texts of the other sections, each with the most its field can hold. A degree,
 * a skill, a language and a certification are `name`; what stands out of a study, what it was honoured with and «Otros datos» are `points`, one to a line.
 */
export const IMPROVE_MANY_LIMIT = { ...IMPROVE_LIMIT, about: 2000, headline: 160, points: 1500, name: 160 } as const;
export type ImproveManyKind = keyof typeof IMPROVE_MANY_LIMIT;

/** What one call takes: more than this is sent as another call, so a long profile is a few and not one that the model cuts short. */
export const IMPROVE_BATCH = { items: 40, chars: 8000 } as const;

/** One text of the list: `id` is only the place in it, to find it again — a path through the profile would not fit. */
export type ImproveItem = { id: string; kind: ImproveManyKind; text: string };

/** Rejects instead of cutting, like the other closed answers; the route drops what was not asked for and what does not fit its field. */
export const improveManySchema = z.object({
  items: z.array(z.object({ id: z.string().min(1).max(20), text: z.string().min(1).max(IMPROVE_MANY_LIMIT.about) })).max(IMPROVE_BATCH.items),
});
export type ImproveManyResult = z.infer<typeof improveManySchema>;

export const IMPROVE_MANY_SYSTEM = `
You are improving how things a person wrote about themselves read on their CV and their profile.
You are editing, not inventing: you say the same thing better, and nothing else.

You are given a list of ITEMS. Each has an id, a KIND and its text. Return every item, with the
same id, improved under the rules below. The items are independent: never move anything from one
to another.

KINDS:
- TASK: one line about what they did in a job. It stays one statement.
- PROJECT: the description of a project of theirs. It keeps its sentences: do not merge them and
  do not add one.
- ABOUT: a few sentences the person wrote about themselves. Their person stays: first person
  stays first person.
- HEADLINE: one line that says what the person does. It stays one line.
- POINTS: short points, one to a line (what stands out of a study, an honour, volunteering,
  interests). One point to a line, the same number of lines, in the same order.
- NAME: the name of a skill, a language, a degree or a certification. Fix spelling, accents,
  capital letters and spacing, and write a well-known acronym or product name the usual way
  ("js" as "JavaScript", "ms excel" as "Microsoft Excel"). If a name could mean more than one
  thing, leave it as it is. Never add a version, a level, an issuer or any word it does not have.
  This is the only kind that may come back longer, and only by being written in full.

RULES:
- Keep exactly the same facts. Say nothing the text does not already say.
- Never add a number, percentage, amount, date or quantity. Never drop one that is there either:
  copy every figure exactly as it is written.
- Never add the name of a company, a person, a client, a product or a place, and never add a tool,
  technology, method or certification the text does not already name.
- Never add a result, an impact or a scale ("improved", "increased", "led a team") that the text
  does not claim. Do not turn a task into an achievement, or taking part into leading.
- Keep the language of the text, its person (first person stays first person) and its tense.
  If it is in Spanish, answer in Spanish.
- Do not make a text longer than it was. Shorter is fine. No filler ("responsible for", "dynamic",
  "results-oriented").
- Some details of the person may have been replaced by marks like [CORREO_1] or [ENLACE_1]. A mark
  is part of the text: copy it exactly, brackets and number included, wherever it falls.
- If a text already reads well, return it unchanged. Returning it unchanged is a good answer.

Return JSON matching the schema exactly. No prose outside it.
`.trim();

export function buildImproveManyPrompt(items: readonly ImproveItem[]): string {
  return items.map((item) => `ITEM ${item.id} · ${item.kind.toUpperCase()} (verbatim):\n"""\n${item.text}\n"""`).join("\n\n");
}

/**
 * What of the answer is a proposal for something that was asked: an id nobody asked about, one given twice, an empty text or one longer than its field could hold
 * is not, and dropping it costs nothing — the text it was about stays as it was. Checked again in the browser, where the profile is.
 */
export function keepProposed(items: readonly ImproveItem[], answer: ImproveManyResult): ImproveManyResult["items"] {
  const ceilings = new Map(items.map((item) => [item.id, IMPROVE_MANY_LIMIT[item.kind]]));
  const seen = new Set<string>();
  const kept: ImproveManyResult["items"] = [];
  for (const { id, text } of answer.items) {
    const ceiling = ceilings.get(id);
    const clean = text.trim();
    if (ceiling === undefined || seen.has(id) || clean === "" || clean.length > ceiling) continue;
    seen.add(id);
    kept.push({ id, text: clean });
  }
  return kept;
}
