/**
 * What a person does here, counted where they can see it.
 *
 * Nothing in this product measures its own use: there are no events, no identifier and nothing leaves the browser. That
 * leaves two kinds of question with no answer — what to improve next, and, for the person, how much they have got done.
 * This is the part of the answer that costs nothing in privacy: counters, per day, kept in this browser, which the person
 * can read, download (to hand to whoever is testing the product with them) and erase. They are not uploaded with the
 * account and not part of any export that travels. Counting for everyone, anonymously, would be another decision, with
 * the privacy policy in it, and is not made here.
 *
 * Pure: the screens read and write through `./store`, so the words and the arithmetic are tested without a browser.
 */

/** What is counted, with how it reads in the person's own list. A closed set: a counter nobody named cannot appear. */
export const METRICS = {
  question_answered: { one: "pregunta respondida", many: "preguntas respondidas" },
  question_put_off: { one: "pregunta que dejaste para después", many: "preguntas que dejaste para después" },
  review_marked_confirmed: { one: "vez que diste por buenos los puestos marcados", many: "veces que diste por buenos los puestos marcados" },
  document_added: { one: "documento agregado", many: "documentos agregados" },
  cv_downloaded: { one: "CV bajado", many: "CVs bajados" },
  profile_uploaded: { one: "vez que subiste tu perfil a tu cuenta", many: "veces que subiste tu perfil a tu cuenta" },
  profile_pulled: { one: "vez que trajiste tu perfil de tu cuenta", many: "veces que trajiste tu perfil de tu cuenta" },
  followup_ai_chosen: { one: "vez que tu IA eligió la pregunta que seguía", many: "veces que tu IA eligió la pregunta que seguía" },
  followup_ai_none: { one: "vez que tu IA no eligió ninguna pregunta", many: "veces que tu IA no eligió ninguna pregunta" },
  // Whether the profile survives a browser: brought back into one where it was gone, and kept by one that agreed to keep it (I7).
  profile_recovered: { one: "vez que recuperaste tu perfil en un navegador donde no estaba", many: "veces que recuperaste tu perfil en un navegador donde no estaba" },
  persistence_granted: { one: "vez que el navegador aceptó conservar tus datos", many: "veces que el navegador aceptó conservar tus datos" },
  // What the person answers to what an offer asks for and to what was deduced of them (I6): whether what is offered pushes to say yes.
  requirement_claimed: { one: "requisito de una oferta que contaste que sí tenías", many: "requisitos de ofertas que contaste que sí tenías" },
  requirement_declined: { one: "requisito de una oferta que dijiste que no tenías", many: "requisitos de ofertas que dijiste que no tenías" },
  inferred_skill_vetoed: { one: "habilidad deducida que dijiste que no era tuya", many: "habilidades deducidas que dijiste que no eran tuyas" },
  // What the person changed by hand in a CV that the profile does not say, and what they did with it (I6): kept in the profile, left in that CV, or taken back.
  correction_saved: { one: "cambio que hiciste a mano en un CV y guardaste en tu perfil", many: "cambios que hiciste a mano en un CV y guardaste en tu perfil" },
  correction_only_here: { one: "cambio que hiciste a mano en un CV y dejaste solo en ese CV", many: "cambios que hiciste a mano en un CV y dejaste solo en ese CV" },
  correction_mistake: { one: "cambio que hiciste a mano en un CV y era un error", many: "cambios que hiciste a mano en un CV y eran un error" },
  // The one question a posting puts, by what it asked and what was said (I5): which kind of requirement is answered, and which is left, and
  // whether any of them is answered more than the others because of how it is asked.
  ask_tool_done: { one: "herramienta que pedía un aviso y contaste que usaste", many: "herramientas que pedían avisos y contaste que usaste" },
  ask_tool_no: { one: "herramienta que pedía un aviso y dijiste que no usaste", many: "herramientas que pedían avisos y dijiste que no usaste" },
  ask_tool_later: { one: "herramienta que pedía un aviso y dejaste para después", many: "herramientas que pedían avisos y dejaste para después" },
  ask_task_done: { one: "tarea que pedía un aviso y contaste que hiciste", many: "tareas que pedían avisos y contaste que hiciste" },
  ask_task_no: { one: "tarea que pedía un aviso y dijiste que no hiciste", many: "tareas que pedían avisos y dijiste que no hiciste" },
  ask_task_later: { one: "tarea que pedía un aviso y dejaste para después", many: "tareas que pedían avisos y dejaste para después" },
  ask_condition_done: { one: "condición que pedía un aviso y contaste que cumplías", many: "condiciones que pedían avisos y contaste que cumplías" },
  ask_condition_no: { one: "condición que pedía un aviso y dijiste que no cumplías", many: "condiciones que pedían avisos y dijiste que no cumplías" },
  ask_condition_later: { one: "condición que pedía un aviso y dejaste para después", many: "condiciones que pedían avisos y dejaste para después" },
  ask_credential_done: { one: "credencial que pedía un aviso y contaste que tenías", many: "credenciales que pedían avisos y contaste que tenías" },
  ask_credential_no: { one: "credencial que pedía un aviso y dijiste que no tenías", many: "credenciales que pedían avisos y dijiste que no tenías" },
  ask_credential_later: { one: "credencial que pedía un aviso y dejaste para después", many: "credenciales que pedían avisos y dejaste para después" },
} as const;

export type MetricName = keyof typeof METRICS;

export const METRIC_NAMES = Object.keys(METRICS) as MetricName[];

const isMetricName = (value: string): value is MetricName => Object.prototype.hasOwnProperty.call(METRICS, value);

export type DayCounts = Partial<Record<MetricName, number>>;

export type MetricsState = {
  version: 1;
  /** Keyed by the local day, `2026-10-03`. */
  days: Record<string, DayCounts>;
};

/** How long a day is kept. A quarter is enough to see a habit, and keeps the file the person downloads small. */
export const KEEP_DAYS = 90;

/** Past this a counter is a typo or a loop, not a person: it is not stored. */
const MAX_COUNT = 100_000;

export const emptyMetrics = (): MetricsState => ({ version: 1, days: {} });

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pad = (value: number) => String(value).padStart(2, "0");

/** The day of a moment, in the person's own clock: «hoy» is the one on their wall. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day `back` days before `date`, by the calendar and not by 24-hour steps, so a change of clock cannot skip or repeat one. */
function daysBefore(date: Date, back: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - back);
}

/** Reads what was stored, keeping what is valid: an unknown name, a bad day or a number that is not a count is dropped, not an error. */
export function parseMetrics(raw: string | null): MetricsState {
  if (!raw) return emptyMetrics();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return emptyMetrics();
  }
  if (!value || typeof value !== "object") return emptyMetrics();
  const days = (value as { days?: unknown }).days;
  if (!days || typeof days !== "object") return emptyMetrics();
  const state = emptyMetrics();
  for (const [day, counts] of Object.entries(days)) {
    if (!DAY.test(day) || !counts || typeof counts !== "object") continue;
    const kept: DayCounts = {};
    for (const [name, count] of Object.entries(counts)) {
      if (isMetricName(name) && typeof count === "number" && Number.isInteger(count) && count > 0 && count <= MAX_COUNT) kept[name] = count;
    }
    if (Object.keys(kept).length > 0) state.days[day] = kept;
  }
  return state;
}

/** Counts `amount` of `name` on the day of `now`, and drops the days that are older than `KEEP_DAYS`. */
export function recordInto(state: MetricsState, name: MetricName, now: Date, amount = 1): MetricsState {
  if (!Number.isInteger(amount) || amount < 1) return state;
  const oldest = dayKey(daysBefore(now, KEEP_DAYS - 1));
  const days: Record<string, DayCounts> = {};
  for (const [day, counts] of Object.entries(state.days)) if (day >= oldest) days[day] = counts;
  const today = dayKey(now);
  const counts = { ...(days[today] ?? {}) };
  counts[name] = Math.min(MAX_COUNT, (counts[name] ?? 0) + amount);
  days[today] = counts;
  return { version: 1, days };
}

/** The Monday of the week `now` is in, which is how a week begins here. */
export function weekStart(now: Date): Date {
  const sinceMonday = (now.getDay() + 6) % 7;
  return daysBefore(now, sinceMonday);
}

/** Everything counted from the day `from` to the day `to`, both included. */
export function totalsBetween(state: MetricsState, from: Date, to: Date): DayCounts {
  const first = dayKey(from);
  const last = dayKey(to);
  const totals: DayCounts = {};
  for (const [day, counts] of Object.entries(state.days)) {
    if (day < first || day > last) continue;
    for (const name of METRIC_NAMES) if (counts[name]) totals[name] = (totals[name] ?? 0) + counts[name]!;
  }
  return totals;
}

export const thisWeek = (state: MetricsState, now: Date): DayCounts => totalsBetween(state, weekStart(now), now);

const count = (amount: number, one: string, many: string) => `${amount} ${amount === 1 ? one : many}`;

/**
 * «Esta semana respondiste 12 preguntas, dejaste 3 para después y bajaste 1 CV.» Only what there is, said as a person
 * would say it; `null` when the week has nothing, so that an empty week is not reported as one.
 */
export function describeWeek(totals: DayCounts): string | null {
  const parts = [
    totals.question_answered ? `respondiste ${count(totals.question_answered, "pregunta", "preguntas")}` : "",
    totals.question_put_off ? `dejaste ${totals.question_put_off} para después` : "",
    totals.document_added ? `agregaste ${count(totals.document_added, "documento", "documentos")}` : "",
    totals.cv_downloaded ? `bajaste ${count(totals.cv_downloaded, "CV", "CVs")}` : "",
    totals.profile_uploaded ? `subiste tu perfil a tu cuenta ${totals.profile_uploaded === 1 ? "una vez" : `${totals.profile_uploaded} veces`}` : "",
    totals.profile_pulled ? `trajiste tu perfil de tu cuenta ${totals.profile_pulled === 1 ? "una vez" : `${totals.profile_pulled} veces`}` : "",
  ].filter(Boolean);
  if (parts.length === 0) return null;
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
  return `Esta semana ${list}.`;
}

/** What is counted, in full and in the person's words — for the list under the sentence, which also has what the sentence leaves out. */
export function describeTotals(totals: DayCounts): string[] {
  return METRIC_NAMES.filter((name) => totals[name]).map((name) => `${totals[name]} ${totals[name] === 1 ? METRICS[name].one : METRICS[name].many}`);
}

/** The kinds of requirement an offer asks about, and what can be said to what is asked: the template of a question, and the answer it got (I5). */
export const ASK_TYPES = ["tool", "task", "condition", "credential"] as const;
export const ASK_OUTCOMES = ["done", "no", "later"] as const;

/** For each template, how many times it was answered each way, over every day kept. Counts, and nothing that was said. */
export type TemplateCounts = Record<(typeof ASK_TYPES)[number], Record<(typeof ASK_OUTCOMES)[number], number>>;

/**
 * What each template of question got (O21): `ask_tool_done` and its two siblings, for each of the four, added over the days kept — the
 * numbers a team needs to know which wording of a question gets an answer, and none of the words. Zeroes are said: «no se contestó» is a count.
 */
export function templateCounts(state: MetricsState): TemplateCounts {
  const counts = Object.fromEntries(ASK_TYPES.map((type) => [type, { done: 0, no: 0, later: 0 }])) as TemplateCounts;
  for (const day of Object.values(state.days)) {
    for (const type of ASK_TYPES) {
      for (const outcome of ASK_OUTCOMES) counts[type][outcome] += day[`ask_${type}_${outcome}`] ?? 0;
    }
  }
  return counts;
}

const TEMPLATE_LABEL: Record<(typeof ASK_TYPES)[number], string> = {
  tool: "Herramientas",
  task: "Tareas",
  condition: "Condiciones (licencia, vehículo, disponibilidad, permiso)",
  credential: "Credenciales",
};

/** «Herramientas: 2 sí, 1 no, 0 ahora no», one line for each template: exactly what the file carries of them, said so that whoever hands it over can read it first. */
export function describeTemplates(counts: TemplateCounts): string[] {
  return ASK_TYPES.map((type) => `${TEMPLATE_LABEL[type]}: ${counts[type].done} sí, ${counts[type].no} no, ${counts[type].later} ahora no`);
}

export type MetricsExport = {
  kind: "cvexact-usage";
  version: 1;
  exportedAt: string;
  days: MetricsState["days"];
  /** Only when the person is given the choice of handing the counts of each template to whoever is improving the questions. */
  templates?: TemplateCounts;
};

/**
 * The file the person can download: every day kept, as counted, with nothing that says who they are. With `templates`, also the counts of each
 * template of question added up (O21) — what a person can hand to the team if they want to, which this product never sends anywhere.
 */
export function exportMetrics(state: MetricsState, now: Date, options: { templates?: boolean } = {}): MetricsExport {
  const file: MetricsExport = { kind: "cvexact-usage", version: 1, exportedAt: now.toISOString(), days: state.days };
  return options.templates ? { ...file, templates: templateCounts(state) } : file;
}
