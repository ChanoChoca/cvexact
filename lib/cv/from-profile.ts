import { formatDateValue } from "@/lib/profile/dates";
import { factToBullet, languageLevelText, toPlainProfile } from "@/lib/profile/project";
import { formatRange, jobsByRecency, studiesByRecency } from "@/lib/profile/timeline";
import { ACTIVITY_MAX, activityFromProfile, CV_LABEL_DEFAULTS, headerFromProfile, PROJECT_DESCRIPTION_MAX, projectFromProfile, type CVDocument, type CVEducationItem, type CVExperienceItem, type CVPairItem, type CVProjectItem, type CVSection } from "@/lib/schemas/cv";
import { isMeaningfulExperience, type StoredCertification, type StoredEducation, type StoredExperience, type StoredProfile, type StoredProject } from "@/lib/schemas/profile-v2";

/**
 * The profile as a CV, with nothing written by anyone but the person.
 *
 * This is the "base CV" the onboarding shows the moment there is a skeleton to
 * show: same template as every generated CV, filled in from the profile's facts
 * in their own words. It costs nothing and cannot invent anything — there is no
 * model in it — which is why it can appear before an account, before a key,
 * before a single question. The tailored CV, written per posting, is a different
 * thing made later from the same facts.
 */

const MAX_JOBS = 10;
const MAX_STUDIES = 8;
const MAX_BULLET = 400;
const MAX_BULLETS = 8;
const MAX_PAIRS = 8;
const MAX_PAIR_VALUE = 160;
const MAX_PROJECTS = 4;
const MAX_ACTIVITIES = 4;

const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** A job that goes on the CV: one that says something, and that the person did not mark «No usar en CVs». */
const onTheCv = (job: StoredExperience): boolean => isMeaningfulExperience(job) && !job.excluded;
/** A credential with a name that the person has not set aside: one that is no longer theirs stays in the profile and is in no CV. */
const certificationOnTheCv = (cert: StoredCertification): boolean => cert.name.value.trim() !== "" && !cert.excluded;

/** Every fact of a job that could be a CV bullet, in order: not a tool, not blank, and not one left out of the CVs. */
const bulletCandidates = (job: StoredExperience) => job.facts.filter((fact) => fact.kind !== "tool" && fact.text.trim() !== "" && !fact.excluded);

/** Which of a job's facts become CV bullets, in order — shared with `previewFactRefs` so the two can never disagree about what line is at what position. */
function bulletFacts(job: StoredExperience) {
  return bulletCandidates(job).slice(0, MAX_BULLETS);
}

/**
 * A list on one line that stops at an item, not in the middle of one: what fits whole, and how many did not.
 * The first item is shown even if it alone is too long — cut, as any text is.
 */
function fitList(items: readonly string[], max: number, separator = ", "): { text: string; left: number } {
  let text = "";
  let shown = 0;
  for (const item of items) {
    const next = shown === 0 ? item : `${text}${separator}${item}`;
    if (shown > 0 && next.length > max) break;
    text = next;
    shown += 1;
  }
  return { text: truncate(text, max), left: items.length - shown };
}

/**
 * Something the base CV leaves out of a profile, in the schema's own terms for it (`coverage.omitted`: a label and the
 * reason) plus the part of the profile it is in, so whoever says it can point at where it still is.
 */
export type BaseCvOmission = { item: string; reason: string; section: "experience" | "education" | "skills" | "projects" | "other" };

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function experienceItem(job: StoredExperience): CVExperienceItem {
  const company = job.company.value.trim();
  const role = job.role.value.trim();
  return {
    // A job with no company is still a job: the role stands where the company would.
    company: company || role,
    role: company ? role : "",
    location: [job.city.value, job.country.value].filter(Boolean).join(", "),
    dateRange: formatRange(job.start.value, job.end.value),
    bullets: bulletFacts(job).map((fact) => truncate(factToBullet(fact), MAX_BULLET)),
    note: job.note?.value.trim() ?? "",
  };
}

/** What a study's line can hold: the schema's own limit for it. */
const MAX_STUDY_LINE = 300;

/**
 * The line under a study: what it was honoured with, then the points the person said stand out of it, as many as fit
 * whole — and how many did not. For someone with no work to show, this is most of what the study says.
 */
function studyLine(entry: StoredEducation): { text: string; left: number } {
  const honors = entry.honors.value.trim();
  const points = entry.highlights.value.map((point) => point.trim()).filter(Boolean);
  return fitList([...(honors ? [honors] : []), ...points], MAX_STUDY_LINE, " · ");
}

function educationItem(entry: StoredEducation): CVEducationItem {
  const end = entry.end.value;
  return {
    institution: entry.institution.value.trim() || entry.degree.value.trim(),
    degree: entry.institution.value.trim() ? entry.degree.value.trim() : "",
    location: [entry.city.value, entry.country.value].filter(Boolean).join(", "),
    date: formatRange(entry.start.value, end) || formatDateValue(end),
    honors: studyLine(entry).text,
  };
}

/** A project that goes on the CV: one with a name, which is all the profile is sure to have. */
const projectOnTheCv = (project: StoredProject): boolean => project.name.value.trim() !== "";

/** A project's description as the CV holds it: one line of text, as long as the schema allows. */
const projectDescription = (project: StoredProject): string => project.description.value.replace(/\s+/g, " ").trim();

/**
 * The project as the CV prints it, everything from the profile: `ref` is the profile's own id, the link is the one the
 * person gave, and a project with no description shows its name (and link) alone — nothing is written to fill it.
 */
function projectItem(project: StoredProject): CVProjectItem {
  return projectFromProfile(project.id, { name: project.name.value, description: project.description.value, url: project.url.value });
}

/**
 * The CV and what it had no room for, from one pass over the profile. What does not fit the page is said, not dropped
 * in silence: the template has room for ten jobs, eight studies, eight tasks a job, four projects and eight short lines for the rest,
 * and a profile can have more of each.
 */
export function baseCv(stored: StoredProfile): { document: CVDocument; omissions: BaseCvOmission[] } {
  const plain = toPlainProfile(stored);
  const sections: CVSection[] = [];
  const omitted: BaseCvOmission[] = [];

  const jobs = jobsByRecency(stored.experience.filter(onTheCv));
  if (jobs.length > 0) {
    sections.push({ kind: "experience", title: "EXPERIENCIA PROFESIONAL", items: jobs.slice(0, MAX_JOBS).map(experienceItem) });
    if (jobs.length > MAX_JOBS) {
      omitted.push({ item: count(jobs.length - MAX_JOBS, "puesto más antiguo", "puestos más antiguos"), reason: `El CV base muestra los ${MAX_JOBS} más recientes.`, section: "experience" });
    }
    const shownJobs = jobs.slice(0, MAX_JOBS);
    const tasksLeft = shownJobs.reduce((sum, job) => sum + Math.max(0, bulletCandidates(job).length - MAX_BULLETS), 0);
    if (tasksLeft > 0) omitted.push({ item: count(tasksLeft, "tarea", "tareas"), reason: `El CV base muestra hasta ${MAX_BULLETS} por puesto.`, section: "experience" });
    const tasksCut = shownJobs.reduce((sum, job) => sum + bulletFacts(job).filter((fact) => factToBullet(fact).length > MAX_BULLET).length, 0);
    if (tasksCut > 0) omitted.push({ item: count(tasksCut, "tarea acortada", "tareas acortadas"), reason: `Cada tarea muestra hasta ${MAX_BULLET} caracteres.`, section: "experience" });
  }

  const studies = studiesByRecency(stored.education.filter((entry) => entry.institution.value.trim() || entry.degree.value.trim()));
  if (studies.length > 0) {
    sections.push({ kind: "education", title: "EDUCACIÓN", items: studies.slice(0, MAX_STUDIES).map(educationItem) });
    if (studies.length > MAX_STUDIES) {
      omitted.push({ item: count(studies.length - MAX_STUDIES, "estudio más antiguo", "estudios más antiguos"), reason: `El CV base muestra los ${MAX_STUDIES} más recientes.`, section: "education" });
    }
    const pointsLeft = studies.slice(0, MAX_STUDIES).reduce((sum, entry) => sum + studyLine(entry).left, 0);
    if (pointsLeft > 0) {
      omitted.push({ item: count(pointsLeft, "destacado de tus estudios", "destacados de tus estudios"), reason: `La línea de cada estudio muestra hasta ${MAX_STUDY_LINE} caracteres.`, section: "education" });
    }
  }

  // Projects have a section of their own, between the studies and the short labelled facts below.
  const projects = stored.projects.filter(projectOnTheCv);
  if (projects.length > 0) {
    const shownProjects = projects.slice(0, MAX_PROJECTS);
    sections.push({ kind: "projects", title: "PROYECTOS", items: shownProjects.map(projectItem) });
    if (projects.length > MAX_PROJECTS) {
      omitted.push({ item: count(projects.length - MAX_PROJECTS, "proyecto", "proyectos"), reason: `La sección de proyectos muestra hasta ${MAX_PROJECTS}.`, section: "projects" });
    }
    const described = shownProjects.filter((project) => projectDescription(project).length > PROJECT_DESCRIPTION_MAX).length;
    if (described > 0) {
      omitted.push({ item: count(described, "descripción de proyecto acortada", "descripciones de proyectos acortadas"), reason: `Cada una muestra hasta ${PROJECT_DESCRIPTION_MAX} caracteres.`, section: "projects" });
    }
  }

  // What the person keeps under «otros datos» — volunteering, a club, classes they give — has a section of its own, after the
  // projects. The reference is the line's place in the list, as a generated CV points at it.
  const activities = stored.legacy.extras.value.flatMap((extra, at) => (extra.trim() ? [{ at, extra }] : []));
  if (activities.length > 0) {
    const shownActivities = activities.slice(0, MAX_ACTIVITIES);
    sections.push({ kind: "activities", title: "ACTIVIDADES", items: shownActivities.map(({ at, extra }) => activityFromProfile(`O${at + 1}`, extra)) });
    if (activities.length > MAX_ACTIVITIES) {
      omitted.push({ item: count(activities.length - MAX_ACTIVITIES, "actividad", "actividades"), reason: `La sección de actividades muestra hasta ${MAX_ACTIVITIES}.`, section: "other" });
    }
    const cut = shownActivities.filter(({ extra }) => extra.replace(/\s+/g, " ").trim().length > ACTIVITY_MAX).length;
    if (cut > 0) {
      omitted.push({ item: count(cut, "actividad acortada", "actividades acortadas"), reason: `Cada una muestra hasta ${ACTIVITY_MAX} caracteres.`, section: "other" });
    }
  }

  // Skills, languages and certifications are short labelled facts, and the template has one place for those — eight
  // lines in all. They are gathered by kind first, so that what the eight go to is a choice and not just whatever came first.
  type Kind = "skills" | "languages" | "certifications";
  const lines: Array<{ kind: Kind; pair: CVPairItem }> = [];
  // The ones the person marked as strong come first and the basic ones stay in the profile: that is what the marks are for.
  const LEVEL_ORDER = { strong: 0, working: 1 } as const;
  const skills = stored.skills
    .filter((skill) => skill.level?.value !== "basic")
    .sort((a, b) => (LEVEL_ORDER[a.level?.value as keyof typeof LEVEL_ORDER] ?? 2) - (LEVEL_ORDER[b.level?.value as keyof typeof LEVEL_ORDER] ?? 2))
    .map((skill) => skill.name.value.trim())
    .filter(Boolean);
  if (skills.length > 0) {
    const fit = fitList(skills, MAX_PAIR_VALUE);
    lines.push({ kind: "skills", pair: { label: "Habilidades", value: fit.text } });
    if (fit.left > 0) omitted.push({ item: count(fit.left, "habilidad", "habilidades"), reason: `La línea de habilidades muestra hasta ${MAX_PAIR_VALUE} caracteres.`, section: "skills" });
  }
  for (const language of stored.languages.filter((entry) => entry.name.value.trim())) {
    lines.push({ kind: "languages", pair: { label: language.name.value.trim(), value: truncate(languageLevelText(language), MAX_PAIR_VALUE) } });
  }
  for (const cert of stored.certifications.filter(certificationOnTheCv)) {
    const year = cert.date.value.year !== undefined ? String(cert.date.value.year) : "";
    lines.push({ kind: "certifications", pair: { label: cert.name.value.trim(), value: truncate([cert.issuer.value.trim(), year].filter(Boolean).join(", "), MAX_PAIR_VALUE) } });
  }

  // When there are more lines than room, the order above stands: the skills line first, then the languages, then the
  // certifications. What stays is listed in that order.
  const shown = lines.slice(0, MAX_PAIRS);
  const NOUN: Record<Exclude<Kind, "skills">, [string, string]> = {
    languages: ["idioma", "idiomas"],
    certifications: ["certificación", "certificaciones"],
  };
  for (const kind of ["languages", "certifications"] as const) {
    const left = lines.slice(MAX_PAIRS).filter((line) => line.kind === kind).length;
    if (left > 0) {
      omitted.push({
        item: count(left, NOUN[kind][0], NOUN[kind][1]),
        reason: `Entre habilidades, idiomas y certificaciones entran ${MAX_PAIRS} líneas.`,
        section: "other",
      });
    }
  }
  if (shown.length > 0) {
    // The title names what is on the page, not what the profile has: a kind whose every line was left out is not in it.
    const TITLE: Record<Kind, string> = { skills: "HABILIDADES", languages: "IDIOMAS", certifications: "CERTIFICACIONES" };
    const titles = (Object.keys(TITLE) as Kind[]).filter((kind) => shown.some((line) => line.kind === kind)).map((kind) => TITLE[kind]);
    sections.push({ kind: "pairs", title: titles.join(" · ").slice(0, 60), items: shown.map((line) => line.pair) });
  }

  const document: CVDocument = {
    language: "es",
    header: headerFromProfile(plain),
    summary: "",
    sections,
    // The line under a study holds what stands out of it, when the person said something: not only honours.
    labels: { honors: studies.some((entry) => entry.highlights.value.some((point) => point.trim() !== "")) ? "Destacados" : CV_LABEL_DEFAULTS.honors },
    coverage: { requirements: [], omitted: omitted.map(({ item, reason }) => ({ item, reason })) },
  };
  return { document, omissions: omitted };
}

export function profileToCVDocument(stored: StoredProfile): CVDocument {
  return baseCv(stored).document;
}

export type PreviewFactRef = { experienceId: string; factId: string };

/**
 * Where each line of `profileToCVDocument`'s "EXPERIENCIA PROFESIONAL" section
 * came from, keyed the same way `CVDocument` indexes a click there —
 * `${itemIndex}:${bulletIndex}` — built by the same job selection and the same
 * `bulletFacts` so the two can never drift apart. Only the onboarding's own
 * deterministic preview has one fact behind every line; a tailored, model-written
 * CV does not, and never gets this passed to it.
 */
export function previewFactRefs(stored: StoredProfile): Map<string, PreviewFactRef> {
  const jobs = jobsByRecency(stored.experience.filter(onTheCv));
  const refs = new Map<string, PreviewFactRef>();
  jobs.slice(0, 10).forEach((job, itemIndex) => {
    bulletFacts(job).forEach((fact, bulletIndex) => {
      refs.set(`${itemIndex}:${bulletIndex}`, { experienceId: job.id, factId: fact.id });
    });
  });
  return refs;
}

/**
 * How many entries the profile has to build a CV around: jobs, studies, and the projects and certifications that
 * stand in a CV's last sections. A profile of projects is a CV (`profileToCVDocument` makes a "PROYECTOS" section of
 * it), and someone who has only that has not too little to show but a start to show.
 */
export function previewEntryCount(stored: StoredProfile): number {
  return (
    stored.experience.filter(onTheCv).length +
    stored.education.filter((entry) => entry.institution.value.trim() || entry.degree.value.trim()).length +
    stored.projects.filter((project) => project.name.value.trim()).length +
    stored.certifications.filter(certificationOnTheCv).length
  );
}

/** Whether the profile has a career to show in it — a job or a study — apart from whatever else it holds. */
export function hasCareerEntries(stored: StoredProfile): boolean {
  return (
    stored.experience.some(onTheCv) ||
    stored.education.some((entry) => entry.institution.value.trim() || entry.degree.value.trim())
  );
}

/**
 * Whether there is enough to show a CV instead of an empty page: one entry, from wherever it came. It used to be
 * one from a document and two from someone building by hand — so the review showed a CV that the next screen
 * then said was "too little" — and now every screen asks this one question. A CV of a single entry is shown as
 * what it is, and says so (`isThinPreview`): a start, not a mistake.
 */
export function isPreviewReady(stored: StoredProfile): boolean {
  return previewEntryCount(stored) >= 1;
}

/** A CV with one entry: worth showing, and worth saying that one more makes it better. */
export function isThinPreview(stored: StoredProfile): boolean {
  return previewEntryCount(stored) === 1;
}
