import type { FigureAnswer } from "./answer";

/**
 * A figure, as someone writes it in one line: "20 %", "20-25 %", "150 clientes", "aprox. 1.500 pesos".
 *
 * Reading it is only recognising the shape — a number or two, what the number counts, and whether it
 * says it is approximate. The digits are kept exactly as typed, never parsed or reformatted: "1.500"
 * is nobody's to decide is a thousand and a half or one and a half. What it could not read it says it
 * could not, rather than guess; and what it read is shown back before anything is saved
 * (`describeReading`), so the one case a line can be read two ways costs a look and not a wrong number.
 */

/** A plain run of digits, or grouped by thousands with either separator, with an optional decimal tail. */
export const FIGURE_NUMBER = /^\d+(?:[.,]\d{3})*(?:[.,]\d+)?$/;
const N = FIGURE_NUMBER.source.slice(1, -1);

/** A number as a line of a CV writes it: `150`, `1.500`, `12,5`, `35%` — not the digits that end a name, like the 2 of OAuth2. */
const NUMBER_IN_TEXT = /(?<![\p{L}\d])\d[\d.,]*\s*%?/gu;
const YEAR = /^(?:19\d\d|20\d\d|2100)$/;
/** What written right before a number makes a quantity of it: "$2000", "USD 2000", "+2000", "unos 2000". */
const BEFORE_QUANTITY = /(?:[$€+~≈]|US\$|U\$S|\bUSD|\bARS|\bEUR|\baprox\.?|\bunos|\bunas|\bcasi|\bm[aá]s de|\bcerca de)\s*$/i;
/** What written right after it does: a unit, a magnitude, or the thing that is counted. */
const AFTER_QUANTITY =
  /^\s*(?:%|k\b|mil\b|millones?\b|usd\b|ars\b|eur\b|pesos?\b|d[oó]lares?\b|euros?\b|(?:personas?|clientes?|usuarios?|ventas?|pedidos?|unidades?|productos?|proyectos?|casos?|tickets?|equipos?|empleados?|sucursales|locales|tiendas?|visitas?|seguidores|leads?|horas?|minutos?|d[ií]as?|semanas?|meses|veces|kg|km|litros?|toneladas?|ms|gb|mb|tb)(?![\p{L}\d]))/iu;

/**
 * The numbers of a line that count something: every one but the years.
 *
 * "Aumenté las ventas en 2022" has a number in it and no figure: 2022 says when, not how much, and a line that only says
 * when still wants its figure asked for. So a bare number from 1900 to 2100 is read as a year, unless something beside it
 * makes it a quantity — a `%`, a currency, "mil" or "k", or what it counts ("2000 clientes", "$2000"). Any other number
 * is a figure, as it always was. The one case this gets wrong, it gets wrong the safe way: a quantity written with
 * nothing beside it ("hice 2000") is taken for a year, and asked about again.
 */
export function quantitiesIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(NUMBER_IN_TEXT)) {
    const digits = match[0].replace(/[^\d.,]/g, "").replace(/[.,]+$/, "");
    if (!digits) continue;
    if (!match[0].includes("%") && YEAR.test(digits)) {
      const at = match.index ?? 0;
      const before = text.slice(Math.max(0, at - 14), at);
      const after = text.slice(at + match[0].length);
      if (!BEFORE_QUANTITY.test(before) && !AFTER_QUANTITY.test(after)) continue;
    }
    found.push(digits);
  }
  return found;
}

/** Whether a line states a figure — a number that counts something, not a year. */
export const statesQuantity = (text: string): boolean => quantitiesIn(text).length > 0;

/** What is offered to count a bare number in: the units most figures of a CV are in. */
export const FIGURE_UNITS = ["%", "$", "USD", "personas", "clientes", "horas", "días", "veces", "proyectos"] as const;

/** `metricSchema.unit` is cut at 24 characters; a longer one would lose its tail without a word. */
const UNIT_MAX = 24;

type Measured = Extract<FigureAnswer, { kind: "exact" | "range" }>;

export type FigureReading =
  | { kind: "empty" }
  | { kind: "read"; answer: Measured }
  /** `why` says what to change, in the words the card shows. */
  | { kind: "unclear"; why: string };

const NOT_A_NUMBER = "No encontramos el número. Poné una cifra, como 20, un rango, como 20-25, o una cifra con su unidad, como 150 clientes.";
const TWO_NUMBERS = "Hay más de un número. Poné uno solo, o un rango como 20-25.";
const LONG_UNIT = "La unidad es larga: dejá una o dos palabras, como %, personas u horas.";
const HALF_A_RANGE = "Falta el segundo número del rango.";
/** What a range is left on when its second number has not been typed yet. */
const DANGLING = /^(?:[-–—]|a|y|hasta|entre|de)$/i;

/** Words that say "about", before the number. Followed by a space or a digit, so "casa" is not "casi". */
const APPROX = /^(?:~|≈|aprox\.?|aproximadamente|approx\.?|ca\.|unos|unas|casi|cerca\s+de|alrededor\s+de|m[aá]s\s+o\s+menos|about|around)(?=[\s\d$€~]|US\$|U\$S|$)\s*/i;
const BETWEEN = /^(entre|de)\s+(?=\d|[$€]|US\$|U\$S)/i;
const CURRENCY = /^(US\$|U\$S|\$|€|USD|ARS|EUR)\s*(?=\d)/i;
const PERCENT_WORD = /^(?:por\s*ciento|porciento|percent|pct\.?)(?![\p{L}\p{N}])/iu;

const currency = (symbol: string): string => {
  const upper = symbol.toUpperCase();
  return upper === "U$S" ? "US$" : /^[A-Z]+$/.test(upper) ? upper : symbol;
};

/** What the number counts: whatever follows it, as short as a unit is — or why what follows is not one. */
function unitOf(prefix: string, tail: string): { unit: string } | { why: string } {
  let rest = tail.trim().replace(/[.,;:!]+$/, "").trim();
  // "150 de clientes" counts clientes; "20 de 100" counts something that is not a unit, and is caught below.
  rest = rest.replace(/^de\s+(?=\p{L})/iu, "");
  rest = rest.replace(PERCENT_WORD, "%");
  if (/\d/.test(rest)) return { why: TWO_NUMBERS };
  const unit = [prefix, rest].filter(Boolean).join(" ");
  return unit.length > UNIT_MAX ? { why: LONG_UNIT } : { unit };
}

export function readFigure(input: string): FigureReading {
  let rest = input.trim().replace(/\s+/g, " ");
  if (!rest) return { kind: "empty" };

  let approx = false;
  const marked = APPROX.exec(rest);
  if (marked) {
    approx = true;
    rest = rest.slice(marked[0].length);
  }

  const between = BETWEEN.exec(rest);
  if (between) rest = rest.slice(between[0].length);

  let prefix = "";
  const priced = CURRENCY.exec(rest);
  if (priced) {
    prefix = currency(priced[1]!);
    rest = rest.slice(priced[0].length);
  }

  // A range: "20-25", "20 a 25", "20 hasta 25", and "entre 20 y 25" — the "y" only after an "entre".
  const joiner = between && between[1]!.toLowerCase() === "entre" ? "a|hasta|y" : "a|hasta";
  const range = new RegExp(`^(${N})\\s*(%)?(?:\\s*[-–—]\\s*|\\s+(?:${joiner})\\s+)(${N})\\s*(.*)$`, "i").exec(rest);
  if (range) {
    const [, from, firstPercent, to, tail] = range;
    const unit = unitOf(prefix, firstPercent && !tail?.trim() ? "%" : (tail ?? ""));
    if ("why" in unit) return { kind: "unclear", why: unit.why };
    return { kind: "read", answer: { kind: "range", from: from!, to: to!, unit: unit.unit } };
  }

  const single = new RegExp(`^(${N})\\s*(.*)$`).exec(rest);
  if (!single) return { kind: "unclear", why: NOT_A_NUMBER };
  if (DANGLING.test((single[2] ?? "").trim())) return { kind: "unclear", why: HALF_A_RANGE };
  const unit = unitOf(prefix, single[2] ?? "");
  if ("why" in unit) return { kind: "unclear", why: unit.why };
  return { kind: "read", answer: { kind: "exact", value: single[1]!, unit: unit.unit, ...(approx ? { approx: true } : {}) } };
}

/** The figure as it reads on a line: "20 %", "20–25 %", "150 clientes". */
export function figureText(answer: Measured): string {
  if (answer.kind === "exact") return [answer.value.trim(), answer.unit.trim()].filter(Boolean).join(" ");
  return `${answer.from.trim()}–${answer.to.trim()} ${answer.unit.trim()}`.trim();
}

/** Whether what is kept says it is approximate: a range always does, a single figure when it was said so. */
export const isApproximate = (answer: Measured): boolean => answer.kind === "range" || answer.approx === true;

/**
 * What a reading will be saved as, said before saving: the one place a person sees what the app made
 * of their line, so a line that reads two ways is caught here and not in their profile.
 */
export function describeReading(answer: Measured): string {
  const text = figureText(answer);
  const unitless = answer.unit.trim() === "";
  return `Se guarda${isApproximate(answer) ? " como aproximado" : ""}: ${text}${unitless ? " (sin unidad)" : ""}.`;
}

/** What was saved, as the receipt of the answer says it. */
export function describeFigure(answer: FigureAnswer): string {
  if (answer.kind === "unknown") return "Lo guardamos sin cifra. Si la encontrás, podés agregarla desde tu perfil.";
  if (answer.kind === "measureless") return "Listo, no te pedimos más cifras. Si cambiás de idea, «Volver a preguntar lo pendiente», en tu perfil, las trae de nuevo.";
  return `Guardado${isApproximate(answer) ? " como aproximado" : ""}: ${figureText(answer)}.`;
}
