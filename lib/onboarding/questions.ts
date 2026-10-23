import type { RepeatedRequirement } from "@/lib/jobs/repeated";
import { spelledDate, type DateValue } from "@/lib/profile/dates";
import { sentencesToPlace } from "@/lib/profile/capture";
import { monthOf, type CredentialReview } from "@/lib/profile/currency";
import { LEVEL_NOTE, levelCode, levelWord } from "@/lib/profile/language-levels";
import { formatRange } from "@/lib/profile/timeline";
import { CEFR_LEVELS, isMeaningfulExperience, type StoredEducation, type StoredExperience, type StoredProfile } from "@/lib/schemas/profile-v2";
import { normalizeForComparison } from "@/lib/text/normalize";
import type { EntryKind } from "./entries";
import { countLine } from "@/lib/jobs/repeated";
import { askedAgainQuestion } from "@/lib/jobs/requirement-ask";
import { bridgeLines, type Gap } from "./gaps";
import type { RuleId } from "./config";
import { companyMatchKey } from "./merge";
import { sentencesAbout } from "./notes";
import { objectiveSuggestions } from "./objective";
import type { Impact } from "./results";

/**
 * A gap, as the question someone is asked.
 *
 * The words are fixed and written once: what a question says is not generated,
 * so it says the same thing to everyone in the same position, and the hints are
 * only ever about *shape* — "qué hacés, para quién, con qué" — never an example
 * of content, which is the one thing a person unsure of what to say would copy.
 */

export type Control =
  | { kind: "skeleton"; field: "start" | "company" | "role" }
  /** The start of several jobs at once, one row for each: three or more asking for the same thing is a table and not three cards. */
  | { kind: "skeleton-batch"; rows: Array<{ gapId: string; experienceId: string; label: string }> }
  /** `initial`: what they said themselves about this job, when they did — a place to start from, never an example. */
  | { kind: "narrative"; initial?: string }
  /** `known`: the results the job already tells, shown above the kinds; `covered`: the kinds they tell. Both empty when it tells none. */
  | { kind: "achievement-types"; covered: Impact[]; known: Array<{ id: string; text: string }> }
  | { kind: "figure"; factId: string; quote: string }
  | { kind: "people" }
  | { kind: "month"; which: "start" | "end"; year: number }
  | { kind: "tools"; tools: string[] }
  | { kind: "skill-uses"; skillId: string; jobs: Array<{ id: string; label: string }> }
  | { kind: "level"; languageId: string }
  | { kind: "overlap"; a: string; b: string }
  /** `decline`: the way out, when "Prefiero no incluirlo" would not fit what was asked. */
  /** `defers`: the control has its own «Ahora no», of the same weight as the other answers, and the card draws no row for putting it off. */
  /** `reasonJobId`: the job that begins after the pause, which a short reason for it would be written on. */
  | { kind: "gap-action"; from: DateValue; to: DateValue; decline?: string; defers?: boolean; reasonJobId?: string }
  /** `kinds` and `decline`: what can be added and the way out, when they are not the ones for work (a practice, a project, volunteering). */
  | { kind: "extra"; kinds?: EntryKind[]; decline?: string }
  /** `suggestions`: the person's own titles, to start from — never an example that could be copied. */
  | { kind: "objective"; suggestions: string[] }
  /** Which of a job's lines the person picks, and the way out when none is: they are marked, and the words stay as they were. */
  | { kind: "pick-facts"; facts: Array<{ id: string; text: string }>; none: string }
  /** What a project was, in the person's words: one answer, kept as the project's description. */
  | { kind: "project"; projectId: string }
  /** What stands out of a study, in the person's words: one answer, kept as that study's points — one for each line or sentence. */
  | { kind: "study"; educationId: string }
  /** The practical facts, to mark or leave: the five fields are fixed, so there is nothing to carry. */
  | { kind: "practical" }
  /** A credential whose date is near or past: renewed — with the new date — or no longer theirs. */
  | { kind: "renewal"; subject: CredentialReview["subject"] }
  /** What was said about how they can work, said long ago: still so, or changed — and then it is edited where it stands. */
  | { kind: "conditions" }
  /** A job that is going on, not looked at for months: still there — as it was, or with something changed — or over, and what happened since. */
  | { kind: "current-job"; jobId: string }
  /** A thing that comes up in several of the offers they analysed (O10): the line, the count of what they saw, and yes, no or not now with the same weight. */
  | { kind: "requirement-ask"; ask: RepeatedRequirement }
  /** A note they wrote down, offered to the job it names (O15): its sentences to tick, and yes — as tasks —, no or not now with the same weight. */
  | { kind: "note-place"; noteId: string; jobId: string; label: string; sentences: string[] }
  /** A skill that nothing has backed for years (O17): still used, no longer, or not now — with the same weight. */
  | { kind: "skill-stale"; skillId: string }
  /** A skill written as its initials (UI-2): it is the whole name — and is renamed —, it is something else, or not now — with the same weight. */
  | { kind: "abbreviation"; skillId: string }
  /** A short reason, in a line, for a short stay (UI-1): written, or «Prefiero no explicarlo». */
  | { kind: "reason"; jobId: string }
  /** How well they know each of their skills (UI-5): a tap for each, and none is required. */
  | { kind: "skill-levels"; skills: Array<{ id: string; name: string }> };

export type Question = {
  id: string;
  rule: RuleId;
  experienceId?: string;
  /** Which job this is about: "Sobre Nubia Retail · puesto actual". */
  context?: string;
  text: string;
  /** How to answer, in shape only. */
  hint?: string;
  control: Control;
};

/** `follow` completes "Contame lo …", the card that asks for each one chosen. */
export const ACHIEVEMENT_TYPES = [
  { value: "sales", label: "Más ventas o ingresos", follow: "de las ventas" },
  { value: "costs", label: "Menos costos", follow: "de los costos" },
  { value: "time", label: "Menos tiempo o errores", follow: "del tiempo o los errores" },
  { value: "launch", label: "Algo nuevo que lanzaste", follow: "de lo que lanzaste" },
  { value: "process", label: "Un proceso mejor", follow: "del proceso" },
  { value: "service", label: "Mejor atención o satisfacción", follow: "de la atención" },
  { value: "quality", label: "Más calidad o seguridad", follow: "de la calidad o la seguridad" },
  { value: "other", label: "Otra cosa", follow: "de eso" },
] as const satisfies ReadonlyArray<{ value: Impact | "other"; label: string; follow: string }>;

export type AchievementType = (typeof ACHIEVEMENT_TYPES)[number]["value"];

/**
 * The kinds of change, in the order the question lists them: first the ones
 * no result of the job tells yet, then the ones already told — still there,
 * for another one of the same kind — and "Otra cosa" last.
 */
export function achievementTypesFor(covered: readonly Impact[]): Array<(typeof ACHIEVEMENT_TYPES)[number] & { told: boolean }> {
  const told = (value: Impact | "other") => value !== "other" && covered.includes(value);
  const kinds = ACHIEVEMENT_TYPES.filter((type) => type.value !== "other");
  return [
    ...kinds.filter((type) => !told(type.value)),
    ...kinds.filter((type) => told(type.value)),
    ...ACHIEVEMENT_TYPES.filter((type) => type.value === "other"),
  ].map((type) => ({ ...type, told: told(type.value) }));
}

/** The levels as the word people use for them, with the framework's code as the small line under it. */
export const LEVEL_OPTIONS = CEFR_LEVELS.map((level) => ({ value: level, label: levelWord(level), hint: levelCode(level) }));

/** A date as it was written: with its month if it had one, and only its year if that is all there was. */
const spelled = (date: DateValue): string => spelledDate(date);

const NARRATIVE_HINT = "Escribilo o dictalo, sin preocuparte por la redacción. Pensá: qué hacés, para quién y con qué.";
const PROJECT_HINT = "Escribilo o dictalo, sin preocuparte por la redacción. Pensá: qué parte hiciste vos, para quién y con qué.";
/**
 * What a study has to say, in the three things people have: what they liked or did best, the work that closed it, and the
 * grade — the last only if they want it seen. Said as a list of kinds and not as examples: an example is what gets copied.
 */
const STUDY_HINT = "Materias o trabajos que te salieron mejor, una tesis o un proyecto final, y el promedio solo si querés que se vea. Una cosa por línea.";

const jobLabel = (job: StoredExperience): string => job.company.value.trim() || job.role.value.trim();

/**
 * Two jobs at one employer: the same company once legal suffixes and spacing are
 * looked past — the way the merge recognises it — or, with no company on either,
 * the same role.
 */
function sameEmployer(a: StoredExperience, b: StoredExperience): boolean {
  const companyA = a.company.value.trim();
  const companyB = b.company.value.trim();
  if (companyA && companyB) return companyMatchKey(companyA) === companyMatchKey(companyB);
  if (companyA || companyB) return false;
  const role = normalizeForComparison(a.role.value);
  return role !== "" && role === normalizeForComparison(b.role.value);
}

/**
 * What a job is called in a question or a list: its company, or its role when there
 * is none. When another job is at the same employer — a promotion, two roles at once —
 * "Acme" would name both, so the role goes with it, and the years too if even the role
 * repeats. `jobs` is the profile's jobs, the one asking included; omitted, nothing can
 * be shared and the name is the plain label.
 */
export function jobName(job: StoredExperience, jobs: readonly StoredExperience[] = []): string {
  const base = jobLabel(job);
  const siblings = jobs.filter((other) => other.id !== job.id && sameEmployer(job, other));
  if (!base || siblings.length === 0) return base;

  const company = job.company.value.trim();
  const role = job.role.value.trim();
  const named = company && role ? `${company} · ${role}` : base;
  const roleKey = normalizeForComparison(role);
  if (!siblings.some((other) => normalizeForComparison(other.role.value) === roleKey)) return named;
  const years = formatRange(job.start.value, job.end.value);
  return years ? `${named} (${years})` : named;
}

/** "Sobre Nubia Retail · puesto actual": which job a question is about. */
export function contextOf(job: StoredExperience, jobs: readonly StoredExperience[] = []): string {
  return `Sobre ${jobName(job, jobs)}${job.end.value.current ? " · puesto actual" : ""}`;
}

const isCurrent = (job: StoredExperience) => Boolean(job.end.value.current);

/** How many jobs asking for their start make a table of them, and how many rows one table holds: more than that is a screen too dense for a phone. */
export const BATCH_MIN = 3;
export const BATCH_MAX = 6;

const startOnly = (found: Gap): boolean => found.rule === "incomplete_skeleton" && (found.payload.missing as string[])[0] === "start" && Boolean(found.experienceId);

/**
 * «¿Cuándo empezaste en cada uno?», as one question, when three or more jobs ask for their start. A document with no dates —
 * or one read by a model that left the fields empty — used to make a run of cards, «¿Cuándo empezaste en X?» for each, with
 * the person answering the same question again and again. `lead` is the question the engine would ask next and `eligible`
 * everything it could ask: the rows are the jobs that still ask for their start, in the order the profile lists them. Nothing
 * here is asked that the cards would not have asked, and a job left blank is left a question.
 *
 * `null` for anything else — a company, a role, fewer than three — and the question is the card it always was.
 */
export function skeletonBatch(lead: Gap, eligible: readonly Gap[], profile: StoredProfile): Question | null {
  if (!startOnly(lead)) return null;
  const jobs = profile.experience.filter(isMeaningfulExperience);
  const asking = eligible.filter(startOnly);
  const rows = asking
    .flatMap((found) => {
      const index = jobs.findIndex((job) => job.id === found.experienceId);
      return index < 0 ? [] : [{ gapId: found.id, experienceId: jobs[index]!.id, label: jobName(jobs[index]!, jobs) || "Un puesto sin nombre", index }];
    })
    .sort((a, b) => a.index - b.index)
    .slice(0, BATCH_MAX);
  if (asking.length < BATCH_MIN || rows.length < BATCH_MIN) return null;
  return {
    id: "incomplete_skeleton:batch:start",
    rule: "incomplete_skeleton",
    text: "¿Cuándo empezaste en cada uno de estos puestos?",
    hint: "Poné el año de cada uno, y el mes si lo recordás. Los que no sepas, dejalos en blanco: te los preguntamos aparte.",
    control: { kind: "skeleton-batch", rows: rows.map(({ gapId, experienceId, label }) => ({ gapId, experienceId, label })) },
  };
}

/** The lines of a job that say what was done: not the tools listed beside them. */
const contentLines = (job: StoredExperience): string[] => job.facts.filter((fact) => fact.kind !== "tool" && fact.text.trim() !== "").map((fact) => fact.text.trim());

const shorten = (text: string, max = 48) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
/** How much of a project's name goes into a question: the whole of most, and not a title that fills the card. */
const PROJECT_NAME_MAX = 60;
/** The same for a study: «Licenciatura en Administración de Empresas», and not the whole line of a long degree. */
const STUDY_NAME_MAX = 60;
/** And for a credential: «Carnet de manipulación de alimentos», whole, and not a certificate's long title. */
const CREDENTIAL_NAME_MAX = 70;
/** What a study is called: its degree, or — when only the place is known — the institution. */
const studyName = (study: StoredEducation | undefined): string => study?.degree.value.trim() || study?.institution.value.trim() || "";

export function questionFor(found: Gap, profile: StoredProfile): Question {
  const job = found.experienceId ? profile.experience.find((entry) => entry.id === found.experienceId) : undefined;
  const jobs = profile.experience.filter(isMeaningfulExperience);
  const base = { id: found.id, rule: found.rule, ...(job ? { experienceId: job.id, context: contextOf(job, jobs) } : {}) };
  const name = job ? jobLabel(job) : "";
  const now = job ? isCurrent(job) : false;

  switch (found.rule) {
    case "incomplete_skeleton": {
      const missing = found.payload.missing as string[];
      // One thing at a time, in the order that reads naturally: when, then where, then what.
      const field = (missing.includes("start") ? "start" : missing.includes("company") ? "company" : "role") as "start" | "company" | "role";
      const text =
        field === "start"
          ? `¿Cuándo empezaste${name ? ` en ${name}` : ""}?`
          : field === "company"
            ? `¿En qué empresa o lugar fue${job?.role.value ? ` lo de «${job.role.value}»` : ""}?`
            : `¿Qué puesto o tarea tenías en ${name}?`;
      return { ...base, text, control: { kind: "skeleton", field } };
    }

    case "no_content": {
      // What they told at the start, without a model to sort it, is here to use: the sentences that name this job, one to a line.
      const said = job ? sentencesAbout(profile, job.id).join("\n") : "";
      return {
        ...base,
        text: `¿De qué ${now ? "te encargás" : "te encargabas"} en ${name}?`,
        hint: NARRATIVE_HINT,
        control: { kind: "narrative", ...(said ? { initial: said } : {}) },
      };
    }

    case "no_achievements":
      return {
        ...base,
        text: `¿Hubo algo que mejorara gracias a tu trabajo en ${name}?`,
        hint: "Elegí lo que encaje; podés marcar más de una.",
        control: { kind: "achievement-types", covered: [], known: [] },
      };

    case "more_achievements": {
      // The results in the person's words go in the control, above the kinds, never in the hint: hints say the shape of an answer, not its content.
      const known = (found.payload.factIds as string[]).flatMap((factId) => {
        const fact = job?.facts.find((entry) => entry.id === factId);
        return fact ? [{ id: fact.id, text: fact.text }] : [];
      });
      return {
        ...base,
        text: `Además de lo que ya contaste, ¿hubo algo más que mejorara gracias a tu trabajo en ${name}?`,
        hint: "Elegí lo que encaje; podés marcar más de una.",
        control: { kind: "achievement-types", covered: found.payload.covered as Impact[], known },
      };
    }

    case "achievement_no_figure": {
      const fact = job?.facts.find((entry) => entry.id === found.payload.factId);
      return {
        ...base,
        text: "¿Tenés una cifra, aunque sea aproximada?",
        control: { kind: "figure", factId: String(found.payload.factId), quote: fact?.text ?? "" },
      };
    }

    case "vague_scale": {
      const fact = job?.facts.find((entry) => entry.id === found.payload.factId);
      // Said as the person wrote it, quoted: what is asked is how much of exactly that. Of a frequency, how much per period.
      const per = found.payload.flavor === "frequency" ? " por día" : "";
      return {
        ...base,
        text: `Dijiste «${String(found.payload.phrase)}»: ¿qué cantidad${per}, más o menos?`,
        hint: "Con su unidad, si es por período: 40 por día, 150 por mes. Una cifra aproximada vale.",
        control: { kind: "figure", factId: String(found.payload.factId), quote: fact?.text ?? "" },
      };
    }

    case "thin_content": {
      // What they said at the start and no task has yet is here to start from, like for «¿De qué te encargabas?».
      const said = job ? sentencesAbout(profile, job.id).join("\n") : "";
      const lines = job ? contentLines(job) : [];
      return {
        ...base,
        // One line is quoted, so that it is clear what «además» is about; several short ones are «lo que ya contaste».
        text:
          lines.length === 1
            ? `Además de «${shorten(lines[0]!)}», ¿qué más ${now ? "hacés" : "hacías"} en ${name}?`
            : `Además de lo que ya contaste, ¿qué más ${now ? "hacés" : "hacías"} en ${name}?`,
        hint: NARRATIVE_HINT,
        control: { kind: "narrative", ...(said ? { initial: said } : {}) },
      };
    }

    case "transferable": {
      const lines = job ? bridgeLines(job) : [];
      return {
        ...base,
        text: `De lo que ${now ? "hacés" : "hacías"} en ${name}, ¿qué te sirve para «${shorten(profile.objective.value.trim(), 60)}»?`,
        hint: "Tildá lo que también vale en ese trabajo. No hace falta que sea todo, ni que lo sepas seguro: lo tenemos en cuenta primero al armar un CV para algo parecido.",
        control: { kind: "pick-facts", facts: lines.map((fact) => ({ id: fact.id, text: fact.text })), none: "Ninguna me sirve" },
      };
    }

    case "scope_unknown":
      return { ...base, text: now ? "¿Tenés personas a cargo?" : "¿Tenías personas a cargo?", control: { kind: "people" } };

    case "imprecise_date": {
      const which = found.payload.which as "start" | "end";
      const year = Number(found.payload.year);
      return {
        ...base,
        text: `¿Te acordás en qué mes ${which === "start" ? "empezaste" : "terminaste"} en ${name}, en ${year}?`,
        control: { kind: "month", which, year },
      };
    }

    case "overlap": {
      const a = profile.experience.find((entry) => entry.id === found.payload.a);
      const b = profile.experience.find((entry) => entry.id === found.payload.b);
      return {
        id: found.id,
        rule: found.rule,
        text: `¿Trabajaste en ${a ? jobName(a, jobs) : "un puesto"} y en ${b ? jobName(b, jobs) : "otro"} a la vez?`,
        hint: "Sus fechas se pisan por más de un mes.",
        control: { kind: "overlap", a: String(found.payload.a), b: String(found.payload.b) },
      };
    }

    case "loose_tool": {
      const tools = found.payload.tools as string[];
      return {
        id: found.id,
        rule: found.rule,
        text: "Mencionaste herramientas que no están en tus habilidades. ¿Las agregamos?",
        hint: "Solo aparecen las que escribiste vos.",
        control: { kind: "tools", tools },
      };
    }

    case "skill_unused":
      return {
        id: found.id,
        rule: found.rule,
        text: `¿Dónde usaste ${found.payload.name}?`,
        control: {
          kind: "skill-uses",
          skillId: String(found.payload.skillId),
          jobs: jobs.map((entry) => ({ id: entry.id, label: jobName(entry, jobs) })),
        },
      };

    case "language_no_level":
      return {
        id: found.id,
        rule: found.rule,
        text: `¿Qué nivel de ${found.payload.name} tenés?`,
        hint: LEVEL_NOTE,
        control: { kind: "level", languageId: String(found.payload.languageId) },
      };

    case "career_gap": {
      const from = found.payload.from as DateValue;
      const to = found.payload.to as DateValue;
      return {
        id: found.id,
        rule: found.rule,
        text: `Entre ${spelled(from)} y ${spelled(to)} no hay nada. ¿Querés agregar algo?`,
        control: { kind: "gap-action", from, to, ...(found.payload.reasonJobId ? { reasonJobId: String(found.payload.reasonJobId) } : {}) },
      };
    }

    case "since_last": {
      const from = found.payload.from as DateValue;
      return {
        id: found.id,
        rule: found.rule,
        text: `Desde ${spelled(from)} no hay nada cargado. ¿Hiciste algo que quieras agregar?`,
        hint: "Cualquier cosa cuenta: un trabajo, un curso, un proyecto, ayudar en una ONG.",
        // Not "Prefiero no incluirlo": the honest answer here is often that there was nothing to include.
        // And not a "no" that sounds like the card's own "Ahora no", which puts it off instead of settling it.
        control: { kind: "gap-action", from, to: {}, decline: "Nada que agregar", defers: true },
      };
    }

    case "objective":
      return {
        id: found.id,
        rule: found.rule,
        text: "¿A qué tipo de puesto querés apuntar?",
        hint: "No va en tu CV. Decide qué preguntarte primero entre tus trabajos y ordena los empleos que te mostramos. Podés cambiarlo cuando quieras.",
        control: { kind: "objective", suggestions: objectiveSuggestions(profile) },
      };

    case "no_work_experience":
      return {
        id: found.id,
        rule: found.rule,
        text: "¿Hiciste alguna práctica, proyecto o voluntariado?",
        hint: "Cualquier cosa cuenta: algo de la facultad, ayudar en una ONG, un emprendimiento.",
        control: { kind: "extra" },
      };

    case "no_certifications":
      return {
        id: found.id,
        rule: found.rule,
        text: "¿Hiciste algún curso o tenés alguna licencia?",
        hint: "Cualquier cosa cuenta: un curso, un taller, una licencia o una credencial.",
        // Not "Nada que agregar" twice in a row with the question above it: this one says what it is about.
        control: { kind: "extra", kinds: ["certification"], decline: "Ninguno" },
      };

    case "project_no_description": {
      const project = profile.projects.find((entry) => entry.id === found.payload.projectId);
      const called = shorten(project?.name.value.trim() ?? "", PROJECT_NAME_MAX);
      return {
        id: found.id,
        rule: found.rule,
        context: `Sobre ${called || "un proyecto"} · proyecto`,
        text: called ? `¿Qué hiciste en «${called}» y con qué?` : "¿Qué hiciste en ese proyecto y con qué?",
        hint: PROJECT_HINT,
        control: { kind: "project", projectId: String(found.payload.projectId) },
      };
    }

    case "study_highlights": {
      const study = profile.education.find((entry) => entry.id === found.payload.educationId);
      const called = shorten(studyName(study), STUDY_NAME_MAX);
      return {
        id: found.id,
        rule: found.rule,
        context: `Sobre ${called || "tus estudios"} · estudios`,
        text: called ? `¿Hay algo para destacar de «${called}»?` : "¿Hay algo para destacar de tus estudios?",
        hint: STUDY_HINT,
        control: { kind: "study", educationId: String(found.payload.educationId) },
      };
    }

    case "practical":
      return {
        id: found.id,
        rule: found.rule,
        text: "¿Querés dejar anotado lo práctico para trabajar?",
        hint: "Disponibilidad, licencia, vehículo y si podés mudarte. Contá solo lo que quieras: nada es obligatorio y después se cambia desde tu perfil.",
        control: { kind: "practical" },
      };

    case "credential_expiry": {
      const name = shorten(String(found.payload.name ?? "una credencial"), CREDENTIAL_NAME_MAX);
      const expires = found.payload.expires as DateValue;
      const lapsed = found.payload.lapsed === true;
      return {
        id: found.id,
        rule: found.rule,
        // «La renovación» and not «¿la renovaste?»: a carnet, a matrícula and a certificado are not the same gender, and the question
        // is the same for each. The date is the one the person gave, said as it was given.
        text: lapsed ? `«${name}» venció en ${spelled(expires)}. ¿Hiciste la renovación?` : `«${name}» vence en ${spelled(expires)}. ¿Ya hiciste la renovación?`,
        hint: "Si la hiciste, poné la fecha nueva. Si todavía no, lo dejamos para después.",
        control: { kind: "renewal", subject: found.payload.subject as CredentialReview["subject"] },
      };
    }

    case "current_job_review": {
      // Who they are with — the company, or the role when there is none — said the way every other question about the job says it.
      const company = job?.company.value.trim() ?? "";
      const role = job?.role.value.trim() ?? "";
      const place = company ? `en ${jobName(job!, jobs)}` : role ? `como ${role}` : "en este puesto";
      const started = job ? spelled(job.start.value) : "";
      const since = typeof found.payload.since === "string" ? monthOf(found.payload.since) : "";
      return {
        ...base,
        text: `¿Seguís ${place}?`,
        // What the profile has of it, as a date: nothing about how long it has been since anyone looked.
        hint: [started ? `Figura en curso desde ${started}.` : "", since ? `Lo último que anotaste de este puesto es de ${since}.` : ""].filter(Boolean).join(" ") || undefined,
        control: { kind: "current-job", jobId: job?.id ?? "" },
      };
    }

    case "conditions_review": {
      const line = String(found.payload.line ?? "").trim();
      return {
        id: found.id,
        rule: found.rule,
        text: "¿Sigue igual lo que anotaste para trabajar?",
        // What they said, as they said it: the question is whether it still holds, so it is shown before it is asked.
        ...(line ? { hint: `Tenés anotado: ${line}.` } : {}),
        control: { kind: "conditions" },
      };
    }

    case "repeated_requirement": {
      const ask = found.payload.ask as RepeatedRequirement;
      // The question of an offer, in the same fixed words; the count of what they saw is the hint, and the line is beside it, in the control.
      // Asked a second time, a year after a «no», the title is that one question — the day, and whether it still is so — and not the first time's under another line.
      return { id: found.id, rule: found.rule, text: ask.again ? askedAgainQuestion(ask.again, new Date()) : ask.question, hint: countLine(ask), control: { kind: "requirement-ask", ask } };
    }

    case "note_to_place": {
      const note = profile.notes.find((entry) => entry.id === found.payload.noteId);
      const day = note?.at ? new Date(note.at) : null;
      // The date is the point of writing it down, and it is the one thing said about it: not how long ago it was.
      const when = day && !Number.isNaN(day.getTime()) ? `La anotaste el ${day.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}.` : "";
      return {
        id: found.id,
        rule: found.rule,
        context: "Sobre lo que anotaste",
        text: `¿Esto va en «${shorten(String(found.payload.label ?? ""), 60)}»?`,
        hint: when || undefined,
        control: { kind: "note-place", noteId: String(found.payload.noteId), jobId: String(found.experienceId ?? ""), label: String(found.payload.label ?? ""), sentences: note ? sentencesToPlace(note) : [] },
      };
    }

    case "abbreviated_skill":
      return {
        id: found.id,
        rule: found.rule,
        text: `¿“${shorten(String(found.payload.short), 24)}” es ${String(found.payload.means)}?`,
        hint: "Si es así, queda con el nombre completo, que es el que suelen pedir los avisos. Lo que escribiste en tus puestos no cambia.",
        control: { kind: "abbreviation", skillId: String(found.payload.skillId) },
      };

    case "short_stint": {
      const job = jobs.find((entry) => entry.id === found.experienceId);
      return {
        id: found.id,
        rule: found.rule,
        context: job ? `Sobre ${jobName(job, jobs)}` : undefined,
        text: "¿Querés agregar un motivo breve?",
        hint: "Va en una línea del CV, debajo del puesto, con tus palabras. Podés no explicarlo.",
        control: { kind: "reason", jobId: String(found.experienceId ?? "") },
      };
    }

    case "skill_levels":
      return {
        id: found.id,
        rule: found.rule,
        text: "¿Cuánto manejás cada una de tus habilidades?",
        hint: "Las fuertes van primero en el CV y las de uso habitual después. Las básicas se quedan en tu perfil y no se imprimen. Solo lo marcás vos.",
        control: { kind: "skill-levels", skills: found.payload.skills as Array<{ id: string; name: string }> },
      };

    case "skill_stale": {
      const name = shorten(String(found.payload.name ?? "esta habilidad"), 48);
      return {
        id: found.id,
        rule: found.rule,
        // The year it counts from, and nothing about how long that is: «lo último que la respalda es de 2021».
        text: `Figura «${name}», pero lo último que la respalda en tu perfil es de ${String(found.payload.since)}. ¿La seguís usando?`,
        hint: "Si ya no, la sacamos de tus CV y queda en la papelera de tu perfil, por si querés recuperarla.",
        control: { kind: "skill-stale", skillId: String(found.payload.skillId) },
      };
    }
  }
}

/** The line for an achievement's figure, whether it is asked or was left without. */
export const figureLabel = (text: string): string => `La cifra de «${shorten(text)}»`;

/**
 * A gap as a line in a list — "Qué hacías en Grupo Lumen" — for the pending ones at
 * the close of a session and in the profile. Short, and the same words for the same gap.
 */
export function labelFor(found: Gap, profile: StoredProfile): string {
  const job = found.experienceId ? profile.experience.find((entry) => entry.id === found.experienceId) : undefined;
  const name = job ? jobName(job, profile.experience.filter(isMeaningfulExperience)) : "";

  switch (found.rule) {
    case "incomplete_skeleton": {
      // One line for each of the three, so that a job with two of them set aside does not list "Datos de X" twice.
      const field = (found.payload.missing as string[])[0];
      if (field === "start") return `Cuándo empezaste en ${name || "un puesto"}`;
      if (field === "company") return `En qué empresa o lugar fue ${job?.role.value.trim() ? `lo de ${job.role.value.trim()}` : "un puesto"}`;
      return `Qué puesto tenías en ${name || "un puesto"}`;
    }
    case "no_content":
      return `Qué hacías en ${name}`;
    case "no_achievements":
      return `Qué mejoró con tu trabajo en ${name}`;
    case "more_achievements":
      return `Qué más mejoró con tu trabajo en ${name}`;
    case "achievement_no_figure":
      return figureLabel(job?.facts.find((entry) => entry.id === found.payload.factId)?.text ?? "un logro");
    case "vague_scale":
      return figureLabel(job?.facts.find((entry) => entry.id === found.payload.factId)?.text ?? "una tarea");
    case "thin_content":
      return `Qué más hacías en ${name}`;
    case "transferable":
      return `Qué te sirve de ${name} para «${shorten(profile.objective.value.trim(), 40)}»`;
    case "scope_unknown":
      return `Personas a cargo en ${name}`;
    case "imprecise_date":
      return `El mes en que ${found.payload.which === "start" ? "empezaste" : "terminaste"} en ${name}`;
    case "overlap":
      return "Si trabajaste en dos lugares a la vez";
    case "loose_tool":
      return "Herramientas para agregar a tus habilidades";
    case "skill_unused":
      return `Dónde usaste ${found.payload.name}`;
    case "language_no_level":
      return `Tu nivel de ${found.payload.name}`;
    case "career_gap":
      return "Un período sin nada cargado";
    case "since_last":
      return `Lo que hiciste desde ${spelled(found.payload.from as DateValue)}`;
    case "objective":
      return "A qué tipo de puesto querés apuntar";
    case "no_work_experience":
      return "Prácticas, proyectos o voluntariado";
    case "no_certifications":
      return "Cursos o licencias";
    case "project_no_description": {
      const project = profile.projects.find((entry) => entry.id === found.payload.projectId);
      return `Qué hiciste en ${shorten(project?.name.value.trim() || "un proyecto", PROJECT_NAME_MAX)}`;
    }
    case "study_highlights":
      return `Qué destacar de ${shorten(studyName(profile.education.find((entry) => entry.id === found.payload.educationId)) || "tus estudios", STUDY_NAME_MAX)}`;
    case "practical":
      return "Lo práctico para trabajar";
    case "credential_expiry":
      return `La renovación de «${shorten(String(found.payload.name ?? "una credencial"), 40)}»: ${found.payload.lapsed === true ? "venció" : "vence"} en ${spelled(found.payload.expires as DateValue)}`;
    case "conditions_review":
      return "Si lo práctico para trabajar sigue igual";
    case "current_job_review":
      return name ? `Si seguís en ${name}` : "Si seguís en este puesto";
    case "repeated_requirement":
      return `Lo que piden varias ofertas: ${shorten(String((found.payload.ask as RepeatedRequirement | undefined)?.thing ?? "algo"), 40)}`;
    case "note_to_place":
      return `Dónde va lo que anotaste: «${shorten(profile.notes.find((entry) => entry.id === found.payload.noteId)?.text.replace(/\s+/g, " ").trim() ?? "una nota", 40)}»`;
    case "abbreviated_skill":
      return `Si “${shorten(String(found.payload.short), 24)}” es ${String(found.payload.means)}`;
    case "short_stint":
      return `Un motivo breve para ${name || "un puesto de menos de un año"}`;
    case "skill_levels":
      return "Cuánto manejás cada habilidad";
    case "skill_stale":
      return `Si todavía usás ${shorten(String(found.payload.name ?? "esta habilidad"), 40)}`;
  }
}
