import { fold } from "@/lib/parse/dictionaries";
import type { Fact } from "@/lib/schemas/profile-v2";

/**
 * Results in the person's own words: whether a line reports one, and which
 * kind of change it reports. Nothing in a document says either — imported
 * lines are all stored as duties — so both are read from the words, the same
 * way `tools.ts` reads the tools a line names.
 */

/**
 * Words that say something changed because of the person — the result a line
 * of a CV already reports ("…reduciendo el tiempo de respuesta en un 40%"), as
 * opposed to a duty ("Administré un servidor Linux"). Imported lines are all
 * stored as duties (nothing in a document says which kind a line is), so
 * without this every imported job was asked "¿Hubo algo que mejorara…?" right
 * under the results it already listed.
 *
 * Verbs only, in the forms a CV reports a result in — the past ("reduje",
 * "redujo", "redujimos") and the gerund ("reduciendo") — never the infinitive
 * of a goal ("encargado de reducir costos"), nor the nouns that are also
 * everyday things in some line of work: "cajas de ahorro", "aumentos
 * salariales", "mejora continua", "eliminación de residuos". "Subir" and
 * "bajar" stay out too: "subí los productos a la tienda", "bajé la mercadería".
 * Where dropping the accent would turn the verb into another word
 * ("aumentó"/"aumento", "logré"/"logre", "alcancé"/"alcance"), only the
 * accented form counts. Missing a result here only means asking, as before —
 * the cheap mistake of the two.
 */
const RESULT_ACCENTED = [
  "aument[éó]", "increment[éó]", "mejor[éó]", "optimic[é]", "optimiz[ó]", "ahorr[éó]", "dupliqu[é]", "duplic[ó]",
  "tripliqu[é]", "triplic[ó]", "multipliqu[é]", "multiplic[ó]", "logr[éó]", "super[éó]", "alcanc[é]", "alcanz[ó]",
  "aceler[éó]", "acort[éó]", "evit[éó]", "maximic[é]", "maximiz[ó]", "minimic[é]", "minimiz[ó]", "potenci[éó]",
];
const RESULT_FOLDED = [
  // Spanish forms no accent can confuse with another word.
  "reduje", "redujo", "redujimos", "reduciendo", "reduccion", "disminui", "disminuyo", "disminuimos", "disminuyendo", "disminucion",
  "aumentamos", "aumentando", "incrementamos", "incrementando", "mejoramos", "mejorando", "optimizamos", "optimizando",
  "ahorramos", "ahorrando", "duplicamos", "triplicamos", "triplicando", "logramos", "logrando", "superamos", "superando",
  "alcanzamos", "alcanzando", "aceleramos", "acelerando", "acortamos", "acortando", "evitamos", "evitando",
  "maximizamos", "maximizando", "minimizamos", "minimizando", "potenciamos", "potenciando",
  "consegui", "consiguio", "conseguimos", "consiguiendo", "resultando en",
  // English.
  "reduced", "reducing", "decreased", "decreasing", "lowered", "increased", "increasing", "improved", "improving",
  "boosted", "boosting", "doubled", "tripled", "achieved", "achieving", "exceeded", "exceeding", "surpassed",
  "optimi[sz]ed", "optimi[sz]ing", "accelerated", "accelerating", "minimi[sz]ed", "maximi[sz]ed", "resulting in",
];
const RESULT_ACCENTED_PATTERN = new RegExp(`(?<![\\p{L}\\p{N}])(?:${RESULT_ACCENTED.join("|")})(?![\\p{L}\\p{N}])`, "u");
const RESULT_FOLDED_PATTERN = new RegExp(`(?<![a-z0-9])(?:${RESULT_FOLDED.map((word) => word.replace(/ /g, "\\s+")).join("|")})(?![a-z0-9])`);
/** A share is how a result is measured far more often than how a duty is described: "95% de satisfacción". */
const PERCENTAGE = /\d\s*%|\d\s*(?:por\s*ciento|percent)(?![\p{L}])/iu;

/** Whether a line, in the person's own words, already reports a result. */
export function readsAsResult(text: string): boolean {
  if (!text.trim()) return false;
  return PERCENTAGE.test(text) || RESULT_ACCENTED_PATTERN.test(text.normalize("NFC").toLowerCase()) || RESULT_FOLDED_PATTERN.test(fold(text));
}

/**
 * A fact that reports a result: one told as an achievement, or a duty whose own
 * words already say what changed. What counts as "there is an achievement" for
 * the question engine, the figure it asks for, and the progress it reports —
 * one test, so the three can never disagree about the same line.
 */
export const isResultFact = (fact: Fact): boolean => fact.kind === "achievement" || (fact.kind === "responsibility" && readsAsResult(fact.text));

// --- Which kind of change ---------------------------------------------------------------------

/**
 * The kinds of change the question about achievements offers, apart from "Otra cosa". The first
 * five are the ones a business measures; `service` and `quality` are for the rest of the ways a job
 * can leave something better — a patient, a student or a customer who was looked after, a place that
 * got safer — which would otherwise all be told as "Otra cosa".
 */
export const IMPACTS = ["sales", "costs", "time", "launch", "process", "service", "quality"] as const;
export type Impact = (typeof IMPACTS)[number];

/**
 * The things each kind of change is measured in, in any line of work: sales
 * and income, costs and waste, time and errors, something launched, a way of
 * working. Nouns and the verbs that are the change itself ("lancé",
 * "automaticé") — never a verb of improving on its own, which says that
 * something changed but not what.
 *
 * Only what reads one way: a line counted under a kind it does not tell is the
 * app claiming the person said something they did not, while a line counted
 * under none only leaves that kind among the ones still offered. So "pedidos"
 * (orders to sell, or to prepare), "presupuesto" (a budget run, or saved on),
 * "precios", "leads" ("costo por lead") and a bare English "time" ("for the
 * first time") are left out.
 */
const IMPACT_TERMS: Record<Impact, readonly string[]> = {
  sales: [
    "ventas?", "ingresos", "facturacion", "conversion(?:es)?", "tasa de cierre", "ticket promedio", "rentabilidad", "ganancias?",
    "clientes? nuev[oa]s?", "nuev[oa]s? clientes?", "cuentas nuevas", "nuevas cuentas", "captacion de clientes",
    "cartera de clientes", "cuota de mercado", "participacion de mercado", "recompras?", "retencion de clientes",
    "abandono de carritos?", "suscriptores", "suscripciones", "recaud(?:e|o|amos|ando|acion)", "donaciones",
    // English.
    "sales", "revenues?", "income", "conversions?", "profits?", "profitability", "market share", "subscribers",
    "new (?:clients|customers|accounts)", "repeat (?:clients|customers|purchases)", "upsell(?:ing)?", "cross-?sell(?:ing)?",
    "win rate", "churn",
  ],
  costs: [
    "costos?", "costes?", "gastos?", "ahorros?", "ahorr(?:e|amos|ando)", "mermas?", "desperdicios?", "horas extras?", "insumos",
    "consumo (?:de )?(?:energia|energetico|electrico|electricidad|combustible|agua|papel)",
    // English.
    "costs?", "spend(?:ing)?", "expenses?", "savings", "waste", "overhead", "overtime",
  ],
  time: [
    "tiempos?", "demoras?", "retrasos?", "atrasos?", "esperas?", "plazos?", "velocidad", "rapidez", "mas rapid[oa]s?",
    "agilic[e]", "agiliz(?:o|amos|ando|acion)", "latencia", "errores", "error", "fallas?", "fallos?", "incidentes?",
    "incidencias?", "reclamos?", "quejas?", "regresion(?:es)?", "bugs?", "defectos?", "reprocesos?", "retrabajos?", "devoluciones",
    // English: a kind of time, never a bare "time".
    "(?:response|load|loading|wait|waiting|lead|cycle|delivery|processing|turnaround|resolution|handling|build|deploy(?:ment)?|page|query|setup|review|approval) times?",
    "time[- ]to[- ](?:market|hire|value|fill|resolution)", "faster", "speed", "latency", "delays?", "turnaround", "downtime",
    "errors?", "defects?", "incidents?", "complaints?", "rework", "failures?", "regressions?",
  ],
  launch: [
    "lance", "lanz(?:o|amos|ando|amientos?)", "(?:puse|pusimos|puso|poniendo|puesta) en marcha", "inaugur(?:e|o|amos|ando|acion)",
    "desde cero", "(?:co)?fund(?:e|amos)",
    "apertura de (?:(?:la|el|una|un|\\d+) )?(?:nuev[oa]s? )?(?:sucursal(?:es)?|locales?|tiendas?|oficinas?|sedes?|filial(?:es)?|restaurantes?)",
    "nuev[oa]s? (?:productos?|servicios?|lineas?|canal(?:es)?|unidad(?:es)? de negocios?)",
    "(?:productos?|servicios?|lineas?|canal(?:es)?) nuev[oa]s?",
    // English.
    "launch(?:ed|ing)?", "rolled out", "(?:co-?)?founded", "from scratch", "went live",
  ],
  process: [
    "procesos?", "procedimientos?", "flujos? de trabajo", "automatic[e]", "automatiz(?:o|amos|ando|acion|aciones)",
    "estandaric[e]", "estandariz(?:o|amos|ando|acion)", "digitalic[e]", "digitaliz(?:o|amos|ando|acion)", "sin papel",
    "coordinacion", "metodologias?", "buenas practicas",
    // English.
    "process(?:es)?", "workflows?", "procedures?", "automat(?:ed|ing|ion)", "streamlin(?:ed|ing)", "standardi[sz](?:ed|ing)",
    "digiti[sz](?:ed|ing)", "coordination",
  ],
  // How someone was looked after, by the words of those who were: satisfaction and its surveys, the
  // service itself. Left out because they read another way too: "atención" alone (it is also how many
  // people were seen, a volume), "calificaciones" (grades), "valoraciones" (appraisals), "reviews" (code
  // reviews), and loyalty and retention, which are told under `sales`.
  service: [
    "satisfaccion", "satisfech[oa]s", "nps", "csat", "encuestas? de satisfaccion",
    "atencion (?:al|a los|a las|a la) (?:clientes?|pacientes?|publico|usuarios?|alumnos?|familias|huespedes|comensales)",
    "atencion personalizada", "calidad (?:de|del) (?:la )?(?:atencion|servicio)",
    "experiencia (?:del|de los) (?:clientes?|pacientes?|alumnos?|huespedes|comensales)", "resenas?", "felicitaciones",
    // English.
    "satisfaction", "customer (?:experience|satisfaction)", "patient (?:experience|satisfaction)",
  ],
  // Safety, hygiene and what a place is held to: fewer accidents, a better inspection, a better product.
  quality: [
    "calidad", "seguridad", "accidentes", "siniestros", "lesiones", "inocuidad", "bioseguridad", "higiene",
    "auditorias?", "inspecciones", "habilitacion(?:es)?", "cumplimiento (?:de )?(?:normas|normativas?|protocolos|estandares|requisitos|regulaciones)",
    "certificacion (?:iso|de calidad)",
    // English.
    "quality", "safety", "accidents", "injuries", "hygiene", "compliance", "audits?", "inspections?",
  ],
};

/**
 * Words that contain a term and mean something else: a point of sale is a
 * place, "en tiempo real" is how a board refreshes, a "plazo fijo" is a
 * deposit, and "ahorré diez horas" saved time, not money.
 */
const NOT_A_CHANGE = [
  /(?<![a-z0-9])(?:puntos? de venta|post[- ]?venta|pre[- ]venta|ingresos brutos|plazos? fijos?|seguridad social)(?![a-z0-9])/g,
  /(?<![a-z0-9])(?:(?:a )?tiempo (?:real|completo|parcial)|medio tiempo|al mismo tiempo|en poco tiempo|(?:full|part|real)[- ]time)(?![a-z0-9])/g,
  /(?<![a-z0-9])ahorr[a-z]*(?=(?:\s+\S+){0,3}?\s+(?:tiempo|horas?|dias?|minutos?|semanas?)(?![a-z0-9]))/g,
];

const IMPACT_PATTERN = new RegExp(
  IMPACTS.map((impact) => `(?<${impact}>(?<![a-z0-9])(?:${IMPACT_TERMS[impact].map((term) => term.replace(/ /g, "\\s+")).join("|")})(?![a-z0-9]))`).join("|"),
  "g",
);

/**
 * What joins a noun to the one it describes: "los errores de facturación" are
 * errors, not sales, and "el tiempo de espera" is one time, not two.
 */
const DESCRIBES = /^\s+(?:del?|de\s+(?:la|las|los)|en|en\s+(?:el|la|las|los))\s+$/;

/**
 * The kinds of change a line tells, in `IMPACTS` order: "…reduciendo el tiempo
 * de respuesta en un 40%" is time. A term that only describes the one before
 * it counts for that one, not for its own kind — see `DESCRIBES`.
 */
export function impactsOf(text: string): Impact[] {
  let folded = fold(text);
  // Blanked, not removed: what is left keeps its positions, and its gaps.
  for (const pattern of NOT_A_CHANGE) folded = folded.replace(pattern, (match) => " ".repeat(match.length));

  const found = new Set<Impact>();
  let previousEnd = -1;
  for (const match of folded.matchAll(IMPACT_PATTERN)) {
    const impact = IMPACTS.find((candidate) => match.groups?.[candidate] !== undefined);
    const describes = previousEnd >= 0 && DESCRIBES.test(folded.slice(previousEnd, match.index));
    previousEnd = match.index + match[0].length;
    if (impact && !describes) found.add(impact);
  }
  return IMPACTS.filter((impact) => found.has(impact));
}

/** The kinds of change a set of results already tells between them, in `IMPACTS` order. */
export function coveredImpacts(facts: readonly Fact[]): Impact[] {
  const told = new Set(facts.flatMap((fact) => impactsOf(fact.text)));
  return IMPACTS.filter((impact) => told.has(impact));
}
