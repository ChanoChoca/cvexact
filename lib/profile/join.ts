import { linkKey, practicalSchema } from "@/lib/schemas/profile";
import { declinedKey } from "./declined";
import { jsonEqual } from "./edit";
import { joinEvidence } from "./evidence";
import type { DateValue } from "./dates";
import {
  certificationSchema,
  educationSchema,
  experienceSchema,
  factSchema,
  languageSchema,
  noteSchema,
  projectSchema,
  skillSchema,
  storedProfileSchema,
  type Declined,
  type Field,
  type StoredEducation,
  type StoredExperience,
  type StoredProfile,
} from "@/lib/schemas/profile-v2";
import { normalizeForComparison, skillKey } from "@/lib/text/normalize";
import type { z } from "zod";

/**
 * Two versions of one profile — this browser's and the one the account was left with from another device — in a single one.
 *
 * What a person does on two devices is not a conflict to be settled by choosing a side: each has things the other lacks. So
 * what this does is the safe half of a merge, which is to add. From the account it takes what this browser does not have —
 * a job, a task of a job both have, a study, a skill, a note, a contact field this browser left empty — and nothing of what
 * the browser already says is touched: where both say something different about the same thing, the browser's stays. There
 * is no way to tell which of two edits is newer (a field carries no time), so none is guessed, and the screen that offers
 * this says so and copies the account's version down first.
 *
 * The same thing found on both sides is one thing. A CV imported on the phone and again on the laptop makes two jobs, each with
 * ids of its own, that say the same: they are told apart by what they say — the company, the role and the year it began; the
 * institution and the degree; a name; the words of a task — and not by their ids, or joining would double everything the two
 * devices had in common.
 *
 * The one thing that is compared by time is what both say the same about, and it only decides which day counts: a field carries the day
 * the person last stood behind it (`confirmedAt`), and a value both sides hold is the later of the two — a confirmation of the same
 * thing is not a conflict, and it is what the next «¿sigue igual?» counts from. Where they say something different the browser's still
 * stays, and its day with it.
 *
 * What the person removed here is not brought back. The account's copy has no history and no archive (`forSync`), so by
 * itself it cannot tell a job that was deleted on this browser from one that was never here; this browser's own archive can,
 * and whatever is in it — a task, a job, a whole document and what it brought — is left where it is.
 *
 * Pure, so what it adds is tested; the screens do the asking and the saving.
 */

export type JoinCounts = {
  jobs: number;
  tasks: number;
  studies: number;
  certifications: number;
  languages: number;
  projects: number;
  skills: number;
  notes: number;
  /** What the account has that the person said no to, and this browser does not know. */
  declined: number;
  /** What shows a thing both have — a page, a register, a signed badge — that this browser does not know of. */
  evidence: number;
  /** Fields of the contact, the summary and the like that this browser had empty and the account did not. */
  fields: number;
};

const none = (): JoinCounts => ({ jobs: 0, tasks: 0, studies: 0, certifications: 0, languages: 0, projects: 0, skills: 0, notes: 0, declined: 0, evidence: 0, fields: 0 });

const sameText = (a: string, b: string): boolean => {
  const left = normalizeForComparison(a);
  return left !== "" && left === normalizeForComparison(b);
};

type Same<T> = (a: T, b: T) => boolean;
const sameJob: Same<StoredExperience> = (a, b) =>
  sameText(a.company.value, b.company.value) && sameText(a.role.value, b.role.value) && a.start.value.year !== undefined && a.start.value.year === b.start.value.year;
const sameStudy: Same<StoredEducation> = (a, b) => sameText(a.institution.value, b.institution.value) && sameText(a.degree.value, b.degree.value);
const sameFact: Same<{ text: string }> = (a, b) => sameText(a.text, b.text);
const sameName: Same<{ name: Field<string> }> = (a, b) => sameText(a.name.value, b.name.value);
const sameWords: Same<{ text: string }> = (a, b) => sameText(a.text, b.text);

/** What the person removed from this browser, of one kind, read back as what it was: ids are random, but a thing is also recognised by what it says. */
function removed<S extends z.ZodType>(profile: StoredProfile, schema: S, kinds: readonly string[]): Array<z.infer<S>> {
  const found: Array<z.infer<S>> = [];
  const take = (entity: unknown): void => {
    const parsed = schema.safeParse(entity);
    if (parsed.success) found.push(parsed.data);
  };
  for (const entry of profile.archive) {
    if (kinds.includes(entry.kind)) take(entry.entity);
    // A whole document and what it brought, taken out in one piece: its lists hold the same kinds.
    if (entry.kind === "source" && entry.entity && typeof entry.entity === "object") {
      for (const list of Object.values(entry.entity as Record<string, unknown>)) {
        if (!Array.isArray(list)) continue;
        for (const item of list) {
          if (item && typeof item === "object") take((item as { entity?: unknown; fact?: unknown }).entity ?? (item as { fact?: unknown }).fact);
        }
      }
    }
  }
  return found;
}

/**
 * `theirs` that this browser has no counterpart of — by id or by what it says — and did not remove. A removed thing has no
 * counterpart in `mine` any more, so it is recognised by what the archive kept of it.
 */
function missingFrom<T extends { id: string }>(mine: readonly T[], theirs: readonly T[], gone: readonly T[], same: Same<T>): T[] {
  return theirs.filter((entry) => !mine.some((have) => have.id === entry.id || same(have, entry)) && !gone.some((out) => out.id === entry.id || same(out, entry)));
}

const isBlank = (value: string): boolean => value.trim() === "";

/** A thing both copies have: this browser's, with the evidence the account has of it that this browser does not, and what the account took off. */
function withTheirEvidence<T extends { evidence?: StoredEducation["evidence"] }>(mine: T, theirs: T | undefined, counts: JoinCounts): T {
  if (!theirs?.evidence || theirs.evidence.length === 0) return mine;
  const joined = joinEvidence(mine.evidence, theirs.evidence);
  counts.evidence += joined.added;
  return jsonEqual(joined.list, mine.evidence) ? mine : { ...mine, evidence: joined.list };
}

/**
 * `mine`, with the later of the two days the person stood behind it when `theirs` says the very same thing. A different value is not
 * this: it is the browser's, as it was. Nothing is made up — a day only moves when the other side has one that is later.
 */
function latestConfirmation<T extends { confirmedAt?: string | undefined }>(mine: T, theirs: T | undefined, same: (a: T, b: T) => boolean): T {
  if (!theirs?.confirmedAt || !same(mine, theirs)) return mine;
  return !mine.confirmedAt || theirs.confirmedAt > mine.confirmedAt ? { ...mine, confirmedAt: theirs.confirmedAt } : mine;
}

const sameValue = <T>(a: Field<T>, b: Field<T>): boolean => jsonEqual(a.value, b.value);

/** `theirs` in the place of `mine` when `mine` has nothing and `theirs` has something. */
function filled<T>(mine: Field<T>, theirs: Field<T>, empty: (value: T) => boolean): { field: Field<T>; filled: boolean } {
  return empty(mine.value) && !empty(theirs.value) ? { field: theirs, filled: true } : { field: latestConfirmation(mine, theirs, sameValue), filled: false };
}

const JOB_FIELDS = ["company", "role", "city", "country", "start", "end", "employmentType", "workMode"] as const;

/** A job both have: its own fields and its tasks, each with the later day when both say the same of it. */
function withLatestConfirmations(job: StoredExperience, theirs: StoredExperience): StoredExperience {
  let next = job;
  for (const key of JOB_FIELDS) {
    const mine = job[key] as Field<unknown> | undefined;
    const other = theirs[key] as Field<unknown> | undefined;
    if (!mine) continue;
    const merged = latestConfirmation(mine, other, sameValue);
    if (merged !== mine) next = { ...next, [key]: merged };
  }
  const facts = job.facts.map((fact) => latestConfirmation(fact, theirs.facts.find((other) => sameFact(fact, other)), (a, b) => sameFact(a, b)));
  return facts.some((fact, index) => fact !== job.facts[index]) ? { ...next, facts } : next;
}

/** The last thing the person did with a «no»: said it, or took it back. Later is what they think now. */
const lastWord = (entry: Declined): string => (entry.withdrawnAt && entry.withdrawnAt > entry.at ? entry.withdrawnAt : entry.at);

/**
 * What they said no to, by what it is — its kind and its name — and not by an id the other device made up for it. Where both have it, the one
 * said or taken back later stands, and this browser's wins a tie, keeping its own id: the history here points at it. What only the account has
 * is brought, and counted. One taken back here is kept, inert, in this list: that is how a copy of the profile learns it was taken back and does
 * not bring it again.
 */
function joinDeclined(mine: readonly Declined[], theirs: readonly Declined[]): { list: Declined[]; added: number } {
  const list = [...mine];
  let added = 0;
  for (const entry of theirs) {
    const key = declinedKey(entry.kind, entry.text);
    const index = list.findIndex((candidate) => declinedKey(candidate.kind, candidate.text) === key);
    if (index === -1) {
      list.push(entry);
      if (!entry.withdrawnAt) added += 1;
    } else if (lastWord(entry) > lastWord(list[index]!)) {
      list[index] = { ...entry, id: list[index]!.id };
    }
  }
  return { list, added };
}

const EMPTY_PRACTICAL = JSON.stringify(practicalSchema.parse({}));

export function joinProfiles(local: StoredProfile, account: StoredProfile): { profile: StoredProfile; added: JoinCounts } {
  const added = none();
  const goneJobs = removed(local, experienceSchema, ["experience"]);
  const goneFacts = removed(local, factSchema, ["fact"]);

  // A job both have — by id, or because it says the same — brings only the tasks the other lacks. The account's id for it is the
  // browser's own from here on: what was linked to it there is linked to it here.
  const twinOf = (theirs: StoredExperience) => local.experience.find((job) => job.id === theirs.id || sameJob(job, theirs));
  const twins = new Map<string, string>();
  const counterpart = new Map<string, StoredExperience>();
  const newJobs: StoredExperience[] = [];
  const extraTasks = new Map<string, StoredExperience["facts"]>();
  for (const theirs of account.experience) {
    const twin = twinOf(theirs);
    if (!twin) {
      if (!goneJobs.some((out) => out.id === theirs.id || sameJob(out, theirs))) newJobs.push(theirs);
      continue;
    }
    twins.set(theirs.id, twin.id);
    counterpart.set(twin.id, theirs);
    const more = missingFrom(twin.facts, theirs.facts, goneFacts, sameFact);
    if (more.length > 0) extraTasks.set(twin.id, more);
  }
  const experience = [
    ...local.experience.map((own) => {
      const other = counterpart.get(own.id);
      const job = other ? withTheirEvidence(withLatestConfirmations(own, other), other, added) : own;
      const more = extraTasks.get(job.id);
      if (!more) return job;
      added.tasks += more.length;
      return { ...job, facts: [...job.facts, ...more] };
    }),
    ...newJobs,
  ];
  added.jobs = newJobs.length;
  const jobIds = new Set(experience.map((job) => job.id));

  const studies = local.education.map((own) => withTheirEvidence(own, account.education.find((entry) => entry.id === own.id || sameStudy(own, entry)), added));
  const education = [...studies, ...missingFrom(local.education, account.education, removed(local, educationSchema, ["education"]), sameStudy)];
  added.studies = education.length - local.education.length;
  const certifications = [
    ...local.certifications.map((own) => {
      const other = account.certifications.find((entry) => entry.id === own.id || sameName(own, entry));
      if (!other) return own;
      let next = own;
      for (const key of ["name", "issuer", "date", "expires"] as const) {
        const mine = own[key] as Field<unknown> | undefined;
        const merged = mine ? latestConfirmation(mine, other[key] as Field<unknown> | undefined, sameValue) : mine;
        if (merged !== mine) next = { ...next, [key]: merged };
      }
      // A date for a credential this browser has none for, and the account has: that is something the other device knew.
      if (!own.expires && other.expires && !own.excluded) {
        added.fields += 1;
        next = { ...next, expires: other.expires };
      }
      return withTheirEvidence(next, other, added);
    }),
    ...missingFrom(local.certifications, account.certifications, removed(local, certificationSchema, ["certification"]), sameName),
  ];
  added.certifications = certifications.length - local.certifications.length;
  const languages = [...local.languages, ...missingFrom(local.languages, account.languages, removed(local, languageSchema, ["language"]), sameName)];
  added.languages = languages.length - local.languages.length;
  const ownProjects = local.projects.map((own) => withTheirEvidence(own, account.projects.find((entry) => entry.id === own.id || sameName(own, entry)), added));
  const projects = [...ownProjects, ...missingFrom(local.projects, account.projects, removed(local, projectSchema, ["project"]), sameName)];
  added.projects = projects.length - local.projects.length;

  // A skill is the same skill by its name, not by an id the other device made up for it. Where both have it, the jobs it was
  // used in are both's.
  const goneSkills = removed(local, skillSchema, ["skill"]);
  const theirSkills = new Map(account.skills.map((skill) => [skillKey(skill.name.value), skill]));
  const mySkillKeys = new Set(local.skills.map((skill) => skillKey(skill.name.value)));
  const goneSkillKeys = new Set(goneSkills.map((skill) => skillKey(skill.name.value)));
  const linksOf = (skill: { experienceIds: string[] }) => skill.experienceIds.map((id) => twins.get(id) ?? id).filter((id) => jobIds.has(id));
  const linked = local.skills.map((skill) => {
    const theirs = theirSkills.get(skillKey(skill.name.value));
    const links = theirs ? linksOf(theirs).filter((id) => !skill.experienceIds.includes(id)) : [];
    return links.length > 0 ? { ...skill, experienceIds: [...skill.experienceIds, ...links] } : skill;
  });
  const newSkills = account.skills
    .filter((skill) => skillKey(skill.name.value) !== "" && !mySkillKeys.has(skillKey(skill.name.value)) && !goneSkillKeys.has(skillKey(skill.name.value)))
    .map((skill) => ({ ...skill, experienceIds: linksOf(skill) }));
  added.skills = newSkills.length;

  // A note one copy has dealt with is dealt with in the other: the day it was settled is not lost, and the note is not asked about again there.
  const ownNotes = local.notes.map((own) => {
    const other = account.notes.find((entry) => entry.id === own.id || sameWords(own, entry));
    return !own.settledAt && other?.settledAt ? { ...own, settledAt: other.settledAt } : own;
  });
  const notes = [...ownNotes, ...missingFrom(local.notes, account.notes, removed(local, noteSchema, ["note"]), sameWords)];
  added.notes = notes.length - local.notes.length;
  const unassigned = [...local.unassigned, ...missingFrom(local.unassigned, account.unassigned, [], sameWords)];
  const said = joinDeclined(local.declined, account.declined);
  added.declined = said.added;

  // What this browser left empty and the account did not.
  const take = <T>(mine: Field<T>, theirs: Field<T>, empty: (value: T) => boolean): Field<T> => {
    const result = filled(mine, theirs, empty);
    if (result.filled) added.fields += 1;
    return result.field;
  };
  const text = (value: string) => isBlank(value);
  const known = new Set(local.contact.links.value.map((link) => linkKey(link.url)));
  const newLinks = account.contact.links.value.filter((link) => !known.has(linkKey(link.url)));
  if (newLinks.length > 0) added.fields += 1;
  const extras = new Set(local.legacy.extras.value);
  const newExtras = account.legacy.extras.value.filter((extra) => !extras.has(extra));
  if (newExtras.length > 0) added.fields += 1;

  const licenceExpiry = (): { driverLicenseExpires?: Field<DateValue> } => {
    const mine = local.legacy.driverLicenseExpires;
    const theirs = account.legacy.driverLicenseExpires;
    if (mine) return { driverLicenseExpires: latestConfirmation(mine, theirs, sameValue) };
    if (theirs && theirs.value.year !== undefined) {
      added.fields += 1;
      return { driverLicenseExpires: theirs };
    }
    return {};
  };

  const profile = storedProfileSchema.parse({
    ...local,
    experience,
    education,
    certifications,
    languages,
    projects,
    skills: [...linked, ...newSkills],
    notes,
    unassigned,
    declined: said.list,
    objective: take(local.objective, account.objective, text),
    contact: {
      ...local.contact,
      fullName: take(local.contact.fullName, account.contact.fullName, text),
      email: take(local.contact.email, account.contact.email, text),
      phone: take(local.contact.phone, account.contact.phone, text),
      city: take(local.contact.city, account.contact.city, text),
      country: take(local.contact.country, account.contact.country, text),
      links: newLinks.length > 0 ? { ...local.contact.links, value: [...local.contact.links.value, ...newLinks] } : local.contact.links,
    },
    legacy: {
      ...local.legacy,
      headline: take(local.legacy.headline, account.legacy.headline, text),
      about: take(local.legacy.about, account.legacy.about, text),
      extras: newExtras.length > 0 ? { ...local.legacy.extras, value: [...local.legacy.extras.value, ...newExtras] } : local.legacy.extras,
      practical: take(local.legacy.practical, account.legacy.practical, (value) => JSON.stringify(value) === EMPTY_PRACTICAL),
      // Until when the licence holds: this browser's if it has one — with the later day, if the account says the same — and the account's if it has none.
      ...licenceExpiry(),
    },
  });
  return { profile, added };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What joining adds, in words — «1 puesto, 2 tareas y 1 estudio» — or `""` when the account has nothing this browser lacks. */
export function describeJoin(added: JoinCounts): string {
  const parts = [
    added.jobs > 0 ? plural(added.jobs, "puesto", "puestos") : "",
    added.tasks > 0 ? plural(added.tasks, "tarea", "tareas") : "",
    added.studies > 0 ? plural(added.studies, "estudio", "estudios") : "",
    added.certifications > 0 ? plural(added.certifications, "curso o certificado", "cursos o certificados") : "",
    added.languages > 0 ? plural(added.languages, "idioma", "idiomas") : "",
    added.projects > 0 ? plural(added.projects, "proyecto", "proyectos") : "",
    added.skills > 0 ? plural(added.skills, "habilidad", "habilidades") : "",
    added.notes > 0 ? plural(added.notes, "nota", "notas") : "",
    added.declined > 0 ? plural(added.declined, "«no» anotado", "«no» anotados") : "",
    added.evidence > 0 ? plural(added.evidence, "respaldo", "respaldos") : "",
    added.fields > 0 ? plural(added.fields, "dato suelto", "datos sueltos") : "",
  ].filter(Boolean);
  if (parts.length === 0) return "";
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}
