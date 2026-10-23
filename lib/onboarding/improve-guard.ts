import { figureMentions, statedFigures } from "@/lib/ai/evidence";
import { IMPROVE_MANY_LIMIT, type ImproveManyKind } from "@/lib/ai/prompts/improve";
import { hasMark } from "@/lib/parse/mask-contact";
import { isStruckOut } from "@/lib/parse/redact";

/**
 * Whether what a model proposed for a text of the profile ("Mejorar con IA": a line of a job, the description of a project, a degree, a skill, "Sobre vos"…)
 * can be shown to the person.
 *
 * Pure, and the one thing that stands between a model and a number on somebody's CV: the prompt says "the same facts, no new figure",
 * and this is what holds when a model does not listen. A figure in the proposal that the text did not state —counting each way of writing
 * it, as `statedFigures` does: in words, in thousands, with or without its sign— throws the whole proposal out, and says which. What
 * is not checked is left to the person, who sees it next to what they wrote before anything changes: a name or a tool that was not
 * there, a figure that was dropped. Nothing here is applied; it only decides whether there is a proposal.
 */

export type Improvement = { ok: true; text: string; /** The same words, once the spacing is folded: there is nothing to propose. */ same: boolean } | { ok: false; message: string };

const squash = (text: string): string => text.replace(/\s+/g, " ").trim();

/** `original` is what the person wrote; `proposal` is what came back, with the details that were taken out before sending already put back. */
export function checkImprovement(original: string, proposal: string, kind: ImproveManyKind): Improvement {
  const text = proposal.trim();
  if (!text) return { ok: false, message: "Tu IA no devolvió nada. Probá de nuevo." };
  // A mark the model made up, or the strike-out that stands where a personal detail was, would land in the person's text as it is.
  if (isStruckOut(text) || (hasMark(text) && !hasMark(original))) return { ok: false, message: "Tu IA devolvió algo que no se puede usar. Probá de nuevo." };
  if (text.length > IMPROVE_MANY_LIMIT[kind]) return { ok: false, message: "La versión de tu IA no entra en el cuadro. Probá de nuevo." };
  // A name and a headline are one line: two would land in a box that has room for one.
  if ((kind === "name" || kind === "headline") && text.includes("\n") && !original.includes("\n")) return { ok: false, message: "Tu IA devolvió algo que no se puede usar. Probá de nuevo." };

  const stated = statedFigures([original]);
  const added = figureMentions(text).find((mention) => !stated.has(mention.figure));
  if (added) {
    return { ok: false, message: `Tu IA agregó una cifra que no está en lo que escribiste («${added.raw}»), así que no la usamos. Probá de nuevo o dejalo como está.` };
  }
  return { ok: true, text, same: squash(text) === squash(original) };
}
