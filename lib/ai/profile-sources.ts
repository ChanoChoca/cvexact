import { matchesKnown, textOverlap } from "@/lib/ai/evidence";
import { withoutOffFieldCredentials, withProfilePractical } from "@/lib/ai/practical";
import { profileMaterial, projectHasSubstance } from "@/lib/ai/prompts/shared";
import type { Finding } from "@/lib/ai/verify";
import { localizedRole, sameRole } from "@/lib/cv/role-title";
import { careerStage, stageOrder } from "@/lib/cv/stage";
import { MONTH_NAMES_ES, parseDateText } from "@/lib/profile/dates";
import { CURRENT_LABEL } from "@/lib/profile/timeline";
import {
  activityFromProfile,
  headerFromProfile,
  PROJECT_DESCRIPTION_MAX,
  projectFromProfile,
  TEMPLATE_SECTION_TITLES,
  type CVActivityItem,
  type CVDocument,
  type CVEducationItem,
  type CVExperienceItem,
  type CVProjectItem,
  type CVSection,
} from "@/lib/schemas/cv";
import type { JobAnalysis } from "@/lib/schemas/job";
import { meaningfulExperience, type Education, type Experience, type Profile } from "@/lib/schemas/profile";
import { normalizeForComparison } from "@/lib/text/normalize";

/**
 * What the model writes about a project is only which one. The name, the description and the link are the profile's:
 * a free-text claim about a project ("lideré el desarrollo") is the one thing no check here can tell from the truth,
 * so none is accepted — the person improves the description at its source, where they decide.
 *
 * The model points at a project by its `[Pn]` label (`serializeProfile`'s `projectRefs`), and when a provider's relaxed
 * schema drops the label, by its name — but only a name that is the profile's alone. What cannot be tied to exactly one
 * project of the profile, or repeats one already placed, is taken out: a shorter CV before a project nobody can vouch for.
 * A section left with nothing goes with it.
 */
export function withProfileProjects(cv: CVDocument, profile: Profile): CVDocument {
  if (!cv.sections.some((section) => section.kind === "projects")) return cv;

  const named = profile.projects.flatMap((project, index) => (projectHasSubstance(project) ? [index] : []));
  const nameKey = (at: number) => normalizeForComparison(profile.projects[at]!.name);

  const resolve = (item: CVProjectItem): number => {
    const label = /^\[?\s*P(\d+)\s*\]?$/i.exec(item.ref.trim());
    const byRef = label ? Number(label[1]) - 1 : -1;
    if (named.includes(byRef)) return byRef;

    const key = normalizeForComparison(item.name);
    const same = key ? named.filter((at) => nameKey(at) === key) : [];
    return same.length === 1 ? same[0]! : -1;
  };

  const placed = new Set<number>();
  const sections = cv.sections.flatMap((section): CVSection[] => {
    if (section.kind !== "projects") return [section];

    const items = section.items.flatMap((item) => {
      const at = resolve(item);
      if (at < 0 || placed.has(at)) return [];
      placed.add(at);
      return [projectFromProfile(`P${at + 1}`, profile.projects[at]!)];
    });
    return items.length > 0 ? [{ ...section, items }] : [];
  });

  // A description is cut where the CV has room for it; the base CV says so (`baseCv`), and so does this one, first in the report so
  // that the ten the schema keeps never leave it out.
  const cut = [...placed].filter((at) => profile.projects[at]!.description.replace(/\s+/g, " ").trim().length > PROJECT_DESCRIPTION_MAX).length;
  const omitted = cut === 0 ? cv.coverage.omitted : [
    { item: `${cut} ${cut === 1 ? "descripción de proyecto acortada" : "descripciones de proyectos acortadas"}`, reason: `Cada una muestra hasta ${PROJECT_DESCRIPTION_MAX} caracteres.` },
    ...cv.coverage.omitted,
  ];
  return { ...cv, sections, coverage: { ...cv.coverage, omitted } };
}

/**
 * What the model writes about an activity is only which one: the same move as a project's, over the profile's `extras`. The model
 * points at a line by its `[On]` label (`serializeProfile`'s `projectRefs`), and when a provider's relaxed schema drops the label,
 * by writing the line as it is — but only a line that is the profile's alone. What cannot be tied to exactly one line, or repeats
 * one already placed, is taken out, and a section left with nothing goes with it. The text printed is the profile's.
 */
export function withProfileActivities(cv: CVDocument, profile: Profile): CVDocument {
  if (!cv.sections.some((section) => section.kind === "activities")) return cv;

  const lines = profile.extras.flatMap((extra, index) => (extra.trim() ? [index] : []));
  const key = (at: number) => normalizeForComparison(profile.extras[at]!);

  const resolve = (item: CVActivityItem): number => {
    const label = /^\[?\s*O(\d+)\s*\]?$/i.exec(item.ref.trim());
    const byRef = label ? Number(label[1]) - 1 : -1;
    if (lines.includes(byRef)) return byRef;

    const wanted = normalizeForComparison(item.text);
    const same = wanted ? lines.filter((at) => key(at) === wanted) : [];
    return same.length === 1 ? same[0]! : -1;
  };

  const placed = new Set<number>();
  const sections = cv.sections.flatMap((section): CVSection[] => {
    if (section.kind !== "activities") return [section];

    const items = section.items.flatMap((item) => {
      const at = resolve(item);
      if (at < 0 || placed.has(at)) return [];
      placed.add(at);
      return [activityFromProfile(`O${at + 1}`, profile.extras[at]!)];
    });
    return items.length > 0 ? [{ ...section, items }] : [];
  });

  return { ...cv, sections };
}

/** How close a CV job's title is to a role of the profile: 2 the same title (in either language), 1 some word in common, 0 none. */
const closeness = (item: CVExperienceItem, role: Experience) => (sameRole(item.role, role.role) ? 2 : textOverlap(item.role, role.role) > 0 ? 1 : 0);

/**
 * The one role of the profile with no employer that a CV job is, by title, or -1. A job whose employer the profile lacks needs the very
 * same title to be that freelance (a renamed company must not slip in as one); a blank one needs only a similar title.
 */
function freelanceFor(item: CVExperienceItem, roles: readonly Experience[]): number {
  const needed = item.company.trim() ? 2 : 1;
  const bare = roles.flatMap((role, at) => (!role.company.trim() && closeness(item, role) >= needed ? [at] : []));
  return bare.length === 1 ? bare[0]! : -1;
}

/**
 * The `cap` bullets that most answer the profile's own tasks, in the order the model wrote them. How much of a bullet is a task's
 * words (`textOverlap`, as `verbatimBullets` measures) is what tells a task reworded for the posting from one that is not in the
 * profile; a tie keeps the earlier one, since the model writes the most relevant first.
 */
function mostSupported(bullets: readonly string[], tasks: readonly string[], cap: number): string[] {
  const support = bullets.map((bullet) => Math.max(0, ...tasks.map((task) => textOverlap(bullet, task))));
  return bullets
    .map((_, at) => at)
    .sort((a, b) => support[b]! - support[a]! || a - b)
    .slice(0, cap)
    .sort((a, b) => a - b)
    .map((at) => bullets[at]!);
}

/**
 * A job never carries more bullets than the profile gives it.
 *
 * The prompt says so and so does the budget, and an instruction is what the quota that invented a groundskeeper's
 * experience beat: the one thing that does not depend on the model obeying is cutting what it wrote past the count. The
 * profile's tasks (a repeated one counted once) are the ceiling, and what stays is what answers them (`mostSupported`) — the
 * first N would keep an invented task the model put first and cut the real one it put last. It cuts, it does not judge:
 * whether a bullet that stays is true is `verifyCV`'s job.
 *
 * A job is found by its employer, with the same match `verifyCV` makes; one with no employer, or whose employer is not the
 * profile's, only by title and only as the profile's one freelance (`freelanceFor`). One the profile does not have is left as
 * it is — that one is already an error — and so is one that matches everything.
 *
 * shortcut: two profile roles at one employer give their sum to each CV job there, looser than either's own count;
 * split by role title if that ever shows up in a generated CV.
 */
export function withinProfileBullets(cv: CVDocument, profile: Profile): CVDocument {
  const roles = meaningfulExperience(profile);
  const given = profileMaterial(profile).roleBullets;
  let changed = false;

  const sections = cv.sections.map((section) => {
    if (section.kind !== "experience") return section;

    const items = section.items.map((item) => {
      const byEmployer = item.company.trim() ? roles.flatMap((role, at) => (matchesKnown(item.company, [role.company]) ? [at] : [])) : [];
      const freelance = byEmployer.length === 0 ? freelanceFor(item, roles) : -1;
      const matches = freelance >= 0 ? [freelance] : byEmployer;
      if (matches.length === 0) return item;

      const cap = matches.reduce((sum, at) => sum + given[at]!, 0);
      if (item.bullets.length <= cap) return item;
      changed = true;
      return { ...item, bullets: mostSupported(item.bullets, matches.flatMap((at) => roles[at]!.bullets), cap) };
    });
    return { ...section, items };
  });

  return changed ? { ...cv, sections } : cv;
}

/** A date as the CV writes it: «Marzo 2021», «March 2021» or «2021» — the month only when the profile has one. */
function writeDate(text: string, lang: "es" | "en"): string {
  const parsed = parseDateText(text);
  if (parsed.kind !== "date") return text.trim();
  if (parsed.month === undefined) return String(parsed.year);
  if (lang === "es") return `${MONTH_NAMES_ES[parsed.month - 1]} ${parsed.year}`;
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(parsed.year, parsed.month - 1, 1)));
}

function writeRange(start: string, end: string, current: boolean, lang: "es" | "en"): string {
  const from = writeDate(start, lang);
  const to = current ? (lang === "es" ? CURRENT_LABEL : "Present") : writeDate(end, lang);
  return from && to ? `${from} – ${to}` : from || to;
}

/** A study still going says so: «2022 – 2027 (en curso)» is an expected end, not a finished degree. */
function studyDate(study: Education, lang: "es" | "en"): string {
  const ongoing = study.status === "in_progress";
  const range = writeRange(study.start, study.end, ongoing && !study.end && Boolean(study.start), lang);
  return ongoing && study.end ? `${range} (${lang === "es" ? "en curso" : "in progress"})` : range;
}

const place = (entry: { city: string; country: string }) => [entry.city, entry.country].filter(Boolean).join(", ");

/**
 * The profile's role for a CV job, or -1: by employer with the same match `verifyCV` makes, then by how close the title is
 * when one employer holds several. A job whose employer the profile does not have is placed only if it matches the one
 * role of the profile that has no employer at all (a freelance), by title; otherwise it is -1, a renamed company included.
 */
function roleFor(item: CVExperienceItem, roles: readonly Experience[], taken: ReadonlySet<number>): number {
  let pool = item.company.trim() ? roles.flatMap((role, at) => (role.company.trim() && matchesKnown(item.company, [role.company]) ? [at] : [])) : [];
  if (pool.length === 0) {
    const freelance = freelanceFor(item, roles);
    pool = freelance < 0 ? [] : [freelance];
  }
  const free = pool.filter((at) => !taken.has(at));
  const from = free.length > 0 ? free : pool;
  return from.reduce((best, at) => (closeness(item, roles[at]!) > closeness(item, roles[best]!) ? at : best), from[0] ?? -1);
}

/** The study of the profile for a CV study: by institution, then by degree when one institution holds several. -1 when none. */
function studyFor(item: CVEducationItem, studies: readonly Education[], taken: ReadonlySet<number>): number {
  const pool = studies.flatMap((study, at) => (item.institution.trim() && study.institution.trim() && matchesKnown(item.institution, [study.institution]) ? [at] : []));
  const free = pool.filter((at) => !taken.has(at));
  if (free.length === 0) return -1;
  return free.reduce((best, at) => (textOverlap(item.degree, studies[at]!.degree) > textOverlap(item.degree, studies[best]!.degree) ? at : best), free[0]!);
}

/**
 * Employer, place, dates and studies are the profile's, not the model's: the one kind of claim a CV is checked against with
 * a reference in hand, and the one a model moves most quietly (a month stretched, a «Senior» added, a degree shown as done).
 *
 * The model keeps what it is good at — which jobs, in which order, with which bullets — and each job is found again in the
 * profile and printed as the profile has it. What cannot be tied to the profile (a project passed off as a job, an employer
 * nobody has) is taken out and said, a shorter CV before one that claims a job the person never had; when that leaves no
 * studies at all, the profile's own go in, which is what the retry for a missing education asked the model for.
 *
 * Titles are the profile's unless the model wrote the same title in the CV's language — see `localizedRole`. Dates are
 * written in Spanish or English only; in another language the model's stay, with everything else.
 *
 * shortcut: a job with no employer in the profile keeps the employer the model wrote (it prints empty otherwise, and a
 * title in its place would not pass `verifyCV`); fix both together if freelances show up wrong in generated CVs.
 */
export function withProfileHistory(cv: CVDocument, profile: Profile, relevance: JobAnalysis["relevance"]): { cv: CVDocument; findings: Finding[] } {
  const lang = cv.language.trim().toLowerCase().slice(0, 2);
  const dated = lang === "es" || lang === "en" ? lang : undefined;
  const roles = meaningfulExperience(profile);
  const studies = profile.education;
  const projects = profile.projects.map((project) => project.name).filter(Boolean);
  const findings: Finding[] = [];

  const sections = cv.sections.flatMap((section, s): CVSection[] => {
    if (section.kind === "experience") {
      const taken = new Set<number>();
      const where = new Map<number, number>();
      const items: CVExperienceItem[] = [];

      for (const [i, item] of section.items.entries()) {
        const at = roleFor(item, roles, taken);
        if (at < 0) {
          const name = item.company.trim() || item.role.trim() || "un puesto";
          findings.push({
            severity: "warning",
            field: `sections[${s}].items[${i}]`,
            detail: item.company.trim() && matchesKnown(item.company, projects) ? `«${name}» es un proyecto, no un puesto: se quitó de la experiencia.` : `Se quitó «${name}» de la experiencia: no está en tu perfil.`,
          });
          continue;
        }

        const role = roles[at]!;
        if (where.has(at)) {
          const first = items[where.get(at)!]!;
          first.bullets = [...first.bullets, ...item.bullets.filter((bullet) => !first.bullets.includes(bullet))];
          continue;
        }

        const title = localizedRole(role.role, item.role, lang);
        if (title.unsure) {
          findings.push({ severity: "warning", field: `sections[${s}].items[${i}].role`, detail: `No pudimos traducir tu cargo «${role.role}» sin cambiarle el sentido. Quedó como en tu perfil; revisalo antes de descargar.` });
        }
        taken.add(at);
        where.set(at, items.length);
        items.push({
          ...item,
          company: role.company.trim() ? role.company : item.company,
          role: title.role,
          location: place(role),
          dateRange: dated ? writeRange(role.start, role.end, role.current, dated) : item.dateRange,
          // The person's own words, or nothing: a reason the model wrote for a short stay is the one thing it cannot know.
          note: role.note,
        });
      }
      return items.length > 0 ? [{ ...section, items }] : [];
    }

    if (section.kind === "education") {
      const taken = new Set<number>();
      const items = section.items.flatMap((item): CVEducationItem[] => {
        const at = studyFor(item, studies, taken);
        if (at < 0) return [];
        taken.add(at);
        const study = studies[at]!;
        return [{ ...item, institution: study.institution, degree: study.degree, location: place(study), date: dated ? studyDate(study, dated) : item.date }];
      });
      return items.length > 0 ? [{ ...section, items }] : [];
    }

    return [section];
  });

  const edited = { ...cv, sections };
  if (studies.length === 0 || relevance === "unrelated" || sections.some((section) => section.kind === "education")) return { cv: edited, findings };

  const restoreLang = dated ?? "en";
  const education: CVSection = {
    kind: "education",
    title: (TEMPLATE_SECTION_TITLES[restoreLang]?.education ?? "EDUCATION"),
    items: studies.slice(0, 8).map((study) => ({ institution: study.institution, degree: study.degree, location: place(study), date: studyDate(study, restoreLang), honors: study.honors })),
  };
  const after = sections.findIndex((section) => section.kind === "experience") + 1;
  return { cv: { ...edited, sections: [...sections.slice(0, after), education, ...sections.slice(after)] }, findings };
}

/**
 * Everything of the CV that is the profile's rather than the model's, in the order it is applied: the header and the jobs
 * and studies first (so the bullet ceiling sees the employers as the profile spells them), then the ceiling, the projects and
 * the activities, the practical rows and the credentials that do not belong, and last the order of the sections, from the stage
 * the person is at (`careerStage`) — except for a posting outside their field, where the model reorders on purpose. Run before
 * `cvGaps` and `verifyCV`, so neither spends a retry or an error on what is already fixed; the findings are what was taken out
 * on the way.
 */
export function composeFromProfile(
  generated: CVDocument,
  profile: Profile,
  analysis: Pick<JobAnalysis, "relevance" | "title" | "domain" | "keywords" | "requirements" | "responsibilities"> & Partial<Pick<JobAnalysis, "seniority">>,
  now: Date = new Date(),
): { cv: CVDocument; findings: Finding[] } {
  // Ordered before the history too: its findings point at sections by position, and that is the position the person will see.
  const inOrder = (cv: CVDocument) => (analysis.relevance === "unrelated" ? cv : stageOrder(cv, careerStage(profile, { seniority: analysis.seniority ?? "unknown" }, now)));
  const history = withProfileHistory(inOrder({ ...generated, header: headerFromProfile(profile, { relevance: analysis.relevance }) }), profile, analysis.relevance);
  const composed = withoutOffFieldCredentials(
    withProfilePractical(withProfileActivities(withProfileProjects(withinProfileBullets(history.cv, profile), profile), profile), profile),
    profile,
    analysis,
  );
  return { cv: inOrder(composed), findings: history.findings };
}
