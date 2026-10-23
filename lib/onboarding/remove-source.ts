import { archiveEntity, clone, editContext, recordChange, type EditContext } from "@/lib/profile/edit";
import {
  emptyStoredProfile,
  type Conflict,
  type Fact,
  type ImportedSource,
  type Source,
  type SourceBundle,
  type Status,
  type StoredEducation,
  type StoredExperience,
  type StoredProfile,
} from "@/lib/schemas/profile-v2";
import { CONFLICT_PATH } from "./review";

/**
 * "Quitar este documento y lo que trajo": the way back from the wrong CV.
 *
 * What goes is what is still exactly as the document gave it, and that no other document says. What the
 * person has touched stays — an edited field, a task they wrote or answered, a job they corrected —
 * because it is theirs now, whatever it started as. What another document also says stays as it is: a
 * job two readings agree on is a job whichever of them is removed, and the one that only repeated it
 * left nothing to tell by except `ImportedSource.alsoSaid`. A job the removed document did not make has
 * only its own part taken out of it. And everything that goes goes into the archive as one piece
 * (`SourceBundle`), so that one tap takes it all back.
 *
 * The browser's copy of the original is left where it is: it is what "Ver el original" shows, and a
 * restored document would be missing it. The store caps its size by dropping the oldest.
 */

/** What can be taken out as "a document": something read from a file or a paste — what someone said has its own notes to remove. */
export const isRemovableSource = (source: Pick<ImportedSource, "kind">): boolean => source.kind !== "dump";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function said(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

type Holder = Record<string, { value?: unknown; status?: Status; source?: Source | undefined } | undefined>;

/** Takes the entries `goes` picks out of a list, in place, with the place each had — for the bundle to put them back. */
function takeOut<T extends { id: string }>(list: T[], goes: (entry: T) => boolean): Array<{ entity: T; index: number }> {
  const out: Array<{ entity: T; index: number }> = [];
  const stays: T[] = [];
  list.forEach((entry, index) => {
    if (goes(entry)) out.push({ entity: clone(entry), index });
    else stays.push(entry);
  });
  list.splice(0, list.length, ...stays);
  return out;
}

export function removeSource(draft: StoredProfile, sourceId: string, ctx: EditContext = editContext()): boolean {
  const sourceIndex = draft.sources.findIndex((entry) => entry.id === sourceId);
  const source = draft.sources[sourceIndex];
  if (!source || !isRemovableSource(source)) return false;

  const bundle: SourceBundle = {
    id: sourceId,
    source: clone(source),
    sourceIndex,
    experience: [],
    education: [],
    facts: [],
    skills: [],
    languages: [],
    certifications: [],
    projects: [],
    unassigned: [],
    conflicts: [],
    skillLinks: [],
    resets: [],
  };

  const from = (field: { source?: Source | undefined } | undefined): boolean => field?.source?.docId === sourceId;
  const edited = (field: { status: Status } | undefined): boolean => field?.status === "edited";
  /** Said by a document that is not this one. */
  const fromOther = (field: { source?: Source | undefined } | undefined): boolean => field?.source?.docId !== undefined && field.source.docId !== sourceId;
  /** A task the person wrote, answered or changed: theirs, whatever else it says. */
  const theirs = (fact: Fact): boolean => fact.status === "edited" || fact.source.kind === "answer" || fact.source.kind === "manual";
  /** Another document that is staying also said this one: it is not only this document's. */
  const corroborated = (id: string): boolean => draft.sources.some((other) => other.id !== sourceId && other.alsoSaid?.includes(id));

  /** Empties a field this document filled in and nobody has confirmed since, remembering what it said. */
  const emptyIf = (holder: object, key: string, path: string[], empty: unknown, when: (field: NonNullable<Holder[string]>) => boolean): void => {
    const fields = holder as Holder;
    const field = fields[key];
    if (!field || !from(field) || !when(field)) return;
    bundle.resets.push({ path, before: clone(field) });
    fields[key] = { value: clone(empty), status: "confirmed" };
  };
  const proposed = (field: { status?: Status }) => field.status === "proposed";
  const unedited = (field: { status?: Status }) => field.status !== "edited";
  /** An optional field (type of job, mode) has no empty state: it goes. */
  const dropIfProposed = (holder: object, key: string, path: string[]): void => {
    const fields = holder as Holder;
    const field = fields[key];
    if (!field || !from(field) || !proposed(field)) return;
    bundle.resets.push({ path, before: clone(field) });
    delete fields[key];
  };

  // --- Jobs: the document's own, untouched, go whole; the rest has only this document's part taken out ---
  const jobIdentity = (job: StoredExperience) => (job.company.value.trim() ? job.company : job.role);
  const jobEdited = (job: StoredExperience) =>
    [job.company, job.role, job.city, job.country, job.start, job.end, job.employmentType, job.workMode].some(edited) || job.facts.some(theirs);
  const jobAlsoFromOthers = (job: StoredExperience) =>
    job.facts.some((fact) => fromOther({ source: fact.source })) ||
    [job.role, job.city, job.country, job.start, job.end, job.employmentType, job.workMode].some(fromOther);

  const jobShared = (job: StoredExperience) => corroborated(job.id) || jobAlsoFromOthers(job);
  bundle.experience = takeOut(draft.experience, (job) => from(jobIdentity(job)) && !jobEdited(job) && !jobShared(job));
  const goneJobs = new Set(bundle.experience.map(({ entity }) => entity.id));
  let keptEdited = 0;
  let keptShared = 0;
  for (const job of draft.experience) {
    // The document's own, and still standing: the person's edits, or another document's word, are why.
    if (from(jobIdentity(job)) && (jobEdited(job) || jobShared(job))) {
      if (jobEdited(job)) keptEdited += 1;
      else keptShared += 1;
      continue;
    }
    const stays: Fact[] = [];
    job.facts.forEach((fact, index) => {
      if (fact.source.docId === sourceId && !theirs(fact)) bundle.facts.push({ experienceId: job.id, fact: clone(fact), index });
      else stays.push(fact);
    });
    job.facts = stays;
    for (const key of ["role", "city", "country"] as const) emptyIf(job, key, ["experience", job.id, key], "", proposed);
    for (const key of ["start", "end"] as const) emptyIf(job, key, ["experience", job.id, key], {}, proposed);
    for (const key of ["employmentType", "workMode"] as const) dropIfProposed(job, key, ["experience", job.id, key]);
  }

  // --- Studies: the same ---
  const studyIdentity = (entry: StoredEducation) => (entry.institution.value.trim() ? entry.institution : entry.degree);
  // What stands out of a study is only ever the person's: a study with points of its own stays when the document that named it goes.
  const studyEdited = (entry: StoredEducation) =>
    [entry.institution, entry.degree, entry.city, entry.country, entry.start, entry.end, entry.honors, entry.status].some(edited) || entry.highlights.value.length > 0;
  const studyAlsoFromOthers = (entry: StoredEducation) => [entry.degree, entry.city, entry.country, entry.start, entry.end, entry.honors].some(fromOther);

  const studyShared = (entry: StoredEducation) => corroborated(entry.id) || studyAlsoFromOthers(entry);
  bundle.education = takeOut(draft.education, (entry) => from(studyIdentity(entry)) && !studyEdited(entry) && !studyShared(entry));
  const goneStudies = new Set(bundle.education.map(({ entity }) => entity.id));
  for (const entry of draft.education) {
    if (from(studyIdentity(entry)) && (studyEdited(entry) || studyShared(entry))) {
      if (studyEdited(entry)) keptEdited += 1;
      else keptShared += 1;
      continue;
    }
    for (const key of ["degree", "city", "country", "honors"] as const) emptyIf(entry, key, ["education", entry.id, key], "", proposed);
    for (const key of ["start", "end"] as const) emptyIf(entry, key, ["education", entry.id, key], {}, proposed);
  }

  // --- The lists a document fills: what is still only its own goes; what is shared loses only what this one filled ---
  bundle.skills = takeOut(
    draft.skills,
    (skill) => from(skill.name) && !edited(skill.name) && !corroborated(skill.id) && skill.experienceIds.every((id) => goneJobs.has(id)),
  );
  for (const skill of draft.skills) {
    const linkedToGone = skill.experienceIds.filter((id) => goneJobs.has(id));
    if (linkedToGone.length === 0) continue;
    bundle.skillLinks.push({ skillId: skill.id, experienceIds: [...skill.experienceIds] });
    skill.experienceIds = skill.experienceIds.filter((id) => !goneJobs.has(id));
  }

  const goneLanguages = new Set<string>();
  bundle.languages = takeOut(
    draft.languages,
    (language) => from(language.name) && !edited(language.name) && !edited(language.level) && !fromOther(language.level) && !corroborated(language.id),
  );
  for (const { entity } of bundle.languages) goneLanguages.add(entity.id);
  for (const language of draft.languages) emptyIf(language, "level", ["languages", language.id, "level"], {}, proposed);

  bundle.certifications = takeOut(
    draft.certifications,
    (cert) => from(cert.name) && ![cert.name, cert.issuer, cert.date].some(edited) && !fromOther(cert.issuer) && !fromOther(cert.date) && !corroborated(cert.id),
  );
  for (const cert of draft.certifications) {
    emptyIf(cert, "issuer", ["certifications", cert.id, "issuer"], "", proposed);
    emptyIf(cert, "date", ["certifications", cert.id, "date"], {}, proposed);
  }

  bundle.projects = takeOut(
    draft.projects,
    (project) =>
      from(project.name) && ![project.name, project.description, project.url].some(edited) && !fromOther(project.description) && !fromOther(project.url) && !corroborated(project.id),
  );
  for (const project of draft.projects) {
    emptyIf(project, "description", ["projects", project.id, "description"], "", proposed);
    emptyIf(project, "url", ["projects", project.id, "url"], "", proposed);
  }

  bundle.unassigned = takeOut(draft.unassigned, (item) => item.sourceId === sourceId);

  // --- Who they are: what this document said, if it is still as it said it ---
  const stillOnlyThis = (id: string) => (field: { status?: Status }) => unedited(field) && !corroborated(id);
  for (const key of ["fullName", "email", "phone", "city", "country"] as const) {
    emptyIf(draft.contact, key, ["contact", key], "", stillOnlyThis(`contact:${key}`));
  }
  emptyIf(draft.legacy, "headline", ["legacy", "headline"], "", stillOnlyThis("legacy:headline"));
  emptyIf(draft.legacy, "about", ["legacy", "about"], "", stillOnlyThis("legacy:about"));
  emptyIf(draft.legacy, "practical", ["legacy", "practical"], emptyStoredProfile().legacy.practical.value, unedited);
  // The links are one list that every document adds to and only the last to add is named: emptied only when this is the only one.
  if (draft.sources.filter(isRemovableSource).length === 1) emptyIf(draft.contact, "links", ["contact", "links"], [], unedited);

  // --- Disagreements: gone with what they were about, or with the side this document was ---
  const emptied = new Set(bundle.resets.map((reset) => reset.path.join("/")));
  const conflictGoes = (conflict: Conflict): boolean =>
    (conflict.entity === "experience" && goneJobs.has(conflict.entityId)) ||
    (conflict.entity === "education" && goneStudies.has(conflict.entityId)) ||
    (conflict.entity === "language" && goneLanguages.has(conflict.entityId)) ||
    conflict.incoming.source?.docId === sourceId ||
    emptied.has(CONFLICT_PATH[conflict.entity](conflict.entityId, conflict.field).join("/"));
  bundle.conflicts = takeOut(draft.conflicts, conflictGoes);

  draft.sources.splice(sourceIndex, 1);

  const tasks = bundle.experience.reduce((total, { entity }) => total + entity.facts.length, 0) + bundle.facts.length;
  const counted = (list: readonly unknown[], one: string, many: string) => (list.length > 0 ? plural(list.length, one, many) : "");
  const brought = said(
    [
      counted(bundle.experience, "puesto", "puestos"),
      counted(bundle.education, "estudio", "estudios"),
      tasks > 0 ? plural(tasks, "tarea", "tareas") : "",
      counted(bundle.skills, "habilidad", "habilidades"),
      counted(bundle.languages, "idioma", "idiomas"),
      counted(bundle.certifications, "certificación", "certificaciones"),
      counted(bundle.projects, "proyecto", "proyectos"),
    ].filter(Boolean),
  );
  const stays = [keptEdited > 0 ? "lo que editaste" : "", keptShared > 0 ? "lo que otro documento también dice" : ""].filter(Boolean);
  const label = [source.name.trim() || "tu documento", brought, stays.length > 0 ? `se quedó ${stays.join(" y ")}` : ""].filter(Boolean).join(" · ");

  const archived = archiveEntity(draft, "source", ["sources"], bundle, label, ctx, sourceIndex);
  recordChange(draft, { op: "remove", path: ["sources", sourceId], label, before: { archiveId: archived.id } }, ctx);
  return true;
}
