/**
 * A line that says «cuánto» without saying how much: «Atendía a muchos clientes», «Gestioné varios proyectos», «Respondía
 * consultas a diario».
 *
 * A figure is asked for where a line reports a result (`achievement_no_figure`), and only there. The lines of a job that
 * has volume and no results — the front desk, a shop, a trade — never say a number and are never asked for one, though
 * «muchos» is exactly what a number would make credible. This reads the words that say it, in a short list that is closed on
 * purpose: a pattern wide enough to catch every way of saying «much» would catch «muchas gracias» and «varios años» too,
 * and a question asked about a phrase that was no quantity is the one that tells the person the app did not read it.
 *
 * Reading the words is all it does. It does not decide whether to ask (`detectGaps` does, and not when the line already
 * has a number) and it never rewrites the line: the figure the person gives is kept beside it, as any other.
 */

export type VagueScale = {
  /** The words, as written: «muchos clientes», «cientos de pedidos», «a diario». */
  phrase: string;
  /** `count`: how many of something. `frequency`: how often, which only a number per period can pin down. */
  flavor: "count" | "frequency";
};

/**
 * Quantifiers that say a lot of something, in the forms a CV uses. «Cientos de», «miles de» and the like carry their own
 * «de»: «cientos pedidos» is not said.
 */
const QUANTIFIER =
  "muchos|muchas|varios|varias|numerosos|numerosas|innumerables|cientos\\s+de|miles\\s+de|decenas\\s+de|docenas\\s+de|gran\\s+cantidad\\s+de|gran\\s+n[uú]mero\\s+de|un\\s+mont[oó]n\\s+de|infinidad\\s+de";

/**
 * What the next word is not, when it is not what is counted: a stretch of time, which «varios años» is (when, not how much),
 * and the words that follow «muchas» in a courtesy — «muchas gracias» is no quantity of anything.
 */
const NOT_COUNTED = /^(?:a[ñn]os?|mes(?:es)?|semanas?|d[ií]as?|horas?|minutos?|segundos?|d[eé]cadas?|temporadas?|ratos?|veces|gracias|ganas|suerte|saludos|felicidades|bendiciones)$/i;

/** A count's noun, a word of three letters or more: «de», «y», «en» would be the next thing the sentence says, not what is counted. */
const COUNT = new RegExp(`(?<![\\p{L}\\p{N}])(?:${QUANTIFIER})\\s+(\\p{L}{3,})(?![\\p{L}\\p{N}])`, "iu");

/**
 * How often, without how many. «Todos los días» is not here, and on purpose: it says when something is done and is what half
 * of the lines of a CV say («Atiendo la caja todos los días»), where «a diario» is what people write after something that
 * comes in numbers («Respondía consultas a diario»). A question asked of every regular duty is the one that tells the
 * person the app did not read it.
 */
const FREQUENCY = /(?<![\p{L}\p{N}])(?:a\s+diario|diariamente)(?![\p{L}\p{N}])/iu;

/** The first vague quantity a line says, or `null` when it says none — a number in the line is for the caller to look for. */
export function vagueScaleIn(text: string): VagueScale | null {
  const count = COUNT.exec(text);
  if (count && !NOT_COUNTED.test(count[1]!)) return { phrase: count[0].replace(/\s+/g, " ").trim(), flavor: "count" };
  const frequency = FREQUENCY.exec(text);
  if (frequency) return { phrase: frequency[0].replace(/\s+/g, " ").trim(), flavor: "frequency" };
  return null;
}
