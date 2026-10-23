import { withoutCurrent, type DateValue } from "@/lib/profile/dates";
import { EMPLOYMENT_TYPES, ENTRY_KIND_VALUES, WORK_MODES, emptyField, type EmploymentType, type Source, type StoredProfile, type WorkMode } from "@/lib/schemas/profile-v2";

/**
 * The entries a form makes — "qué, dónde, desde, hasta" — as the
 * profile's own entities.
 *
 * What someone types into a form is what they said, so it is `confirmed` and
 * credited to them (`manual`): there is nothing here for a review to ask about.
 * A date is what the picker gave, a year and maybe a month, with no `raw` text
 * because nothing was written.
 */

export type EntryKind = (typeof ENTRY_KIND_VALUES)[number];

export type EntryForm = {
  kind: EntryKind;
  /** The role, the degree, the project's name. */
  what: string;
  /** The company, the institution. */
  where: string;
  from: DateValue;
  to: DateValue;
  /** "Actualmente": still going. */
  current: boolean;
};

export const blankForm = (kind: EntryKind): EntryForm => ({ kind, what: "", where: "", from: {}, to: {}, current: false });

/** Enough to be an entry: something says what or where. */
export const isFilled = (form: EntryForm): boolean => form.what.trim() !== "" || form.where.trim() !== "";

const EMPLOYMENT: Partial<Record<EntryKind, EmploymentType>> = {
  internship: "internship",
  volunteer: "volunteer",
  teaching: "teaching",
  research: "research",
  student_org: "student_org",
};

export type Ids = { newId: () => string; now: string };

function textOf(value: string, source: Source) {
  const text = value.trim();
  return text ? { value: text, status: "confirmed" as const, source } : emptyField("");
}

function dateOf(value: DateValue, source: Source) {
  const date = withoutCurrent(value);
  return date.year !== undefined ? { value: date, status: "confirmed" as const, source } : emptyField<DateValue>({});
}

/** Adds one entry to `draft` and returns its id, or null when the form is empty. */
export function addEntry(draft: StoredProfile, form: EntryForm, ids: Ids): string | null {
  if (!isFilled(form)) return null;
  const source: Source = { kind: "manual", at: ids.now };
  const id = ids.newId();

  if (form.kind === "study") {
    draft.education.push({
      id,
      institution: textOf(form.where, source),
      degree: textOf(form.what, source),
      city: emptyField(""),
      country: emptyField(""),
      start: dateOf(form.from, source),
      // A study has no "current" flag on its end date; "still studying" is its status.
      end: form.current ? emptyField<DateValue>({}) : dateOf(form.to, source),
      honors: emptyField(""),
      highlights: emptyField<string[]>([]),
      status: form.current
        ? { value: "in_progress", status: "confirmed", source }
        : emptyField("completed" as const),
    });
    return id;
  }

  // A course or a certificate has one date, the day it was finished or given: the form's "Hasta".
  if (form.kind === "certification") {
    draft.certifications.push({
      id,
      name: textOf(form.what, source),
      issuer: textOf(form.where, source),
      date: dateOf(form.to, source),
    });
    return id;
  }

  if (form.kind === "project") {
    draft.projects.push({
      id,
      name: textOf(form.what, source),
      description: textOf(form.where, source),
      url: emptyField(""),
      tags: emptyField([] as string[]),
    });
    return id;
  }

  const employment = EMPLOYMENT[form.kind];
  draft.experience.push({
    id,
    company: textOf(form.where, source),
    role: textOf(form.what, source),
    city: emptyField(""),
    country: emptyField(""),
    start: dateOf(form.from, source),
    end: form.current ? { value: { current: true }, status: "confirmed", source } : dateOf(form.to, source),
    facts: [],
    ...(employment ? { employmentType: { value: employment, status: "confirmed" as const, source } } : {}),
  });
  return id;
}

/**
 * What the two fields of an entry — what it was, and where — are called wherever they are asked:
 * the review's "¿Falta algo?", the question that adds one, and the profile's
 * own "Agregar". It used to be "Qué hacías", "Qué hacías (puesto)", "Puesto o tarea" and "Puesto"
 * for the one field, and a project's "where" — which is kept as its description — was "Contexto",
 * "Dónde o para quién" and "Para quién o dónde".
 */
/**
 * Where a job was done when there was no employer to name: the freelancer, the person who took odd jobs, the one who ran
 * the family shop. It is what the person picks, as the place, from the question that asks for one — never what we
 * conclude from a role — and it is theirs to change like any other place.
 */
export const SELF_EMPLOYED = "Por mi cuenta";

export const ENTRY_LABELS: Record<EntryKind, { what: string; where: string }> = {
  job: { what: "Puesto o tarea principal", where: "Empresa o lugar" },
  internship: { what: "Puesto o tarea principal", where: "Empresa o lugar" },
  volunteer: { what: "Puesto o tarea principal", where: "Empresa o lugar" },
  teaching: { what: "Puesto o tarea principal", where: "Cátedra o institución" },
  research: { what: "Puesto o tarea principal", where: "Grupo o institución" },
  student_org: { what: "Rol que tuviste", where: "Club u organización" },
  study: { what: "Título o estudio", where: "Institución" },
  project: { what: "Nombre", where: "De qué se trata" },
  certification: { what: "Curso o certificado", where: "Quién lo da" },
};

/**
 * What each kind of entry is called wherever the person is asked which one it is: the
 * review's "¿Falta algo?" and the question that adds one. The same word
 * in both — it used to be "Práctica", "Una práctica" and "Práctica" for the same thing.
 */
export const ENTRY_KIND_LABEL: Record<EntryKind, string> = {
  job: "Trabajo",
  study: "Estudio",
  internship: "Práctica",
  project: "Proyecto",
  volunteer: "Voluntariado",
  teaching: "Ayudantía o docencia",
  research: "Investigación",
  student_org: "Club u organización",
  certification: "Curso o certificado",
};

/** The kinds, in the order they are offered. */
export const ENTRY_KINDS: readonly EntryKind[] = ENTRY_KIND_VALUES;

/**
 * The two closed choices of a job, in the words both the profile and the review use — the profile's cards
 * and the review's "Más datos" ask for the same things, in the same words.
 */
export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  full_time: "Jornada completa",
  part_time: "Media jornada",
  freelance: "Freelance",
  contract: "Por contrato",
  internship: "Práctica",
  volunteer: "Voluntariado",
  teaching: "Ayudantía o docencia",
  research: "Investigación",
  student_org: "Club u organización",
  other: "Otro",
};

export const WORK_MODE_LABEL: Record<WorkMode, string> = {
  onsite: "Presencial",
  remote: "Remoto",
  hybrid: "Híbrido",
};

export const EMPLOYMENT_TYPE_OPTIONS = EMPLOYMENT_TYPES.map((value) => ({ value, label: EMPLOYMENT_TYPE_LABEL[value] }));
export const WORK_MODE_OPTIONS = WORK_MODES.map((value) => ({ value, label: WORK_MODE_LABEL[value] }));
