import { IMPROVE_MANY_LIMIT, type ImproveManyKind } from "@/lib/ai/prompts/improve";
import { fold } from "@/lib/parse/dictionaries";
import { EXTRA_LIMIT } from "@/lib/schemas/profile";
import { STUDY_HIGHLIGHT_MAX, isMeaningfulExperience, type StoredProfile } from "@/lib/schemas/profile-v2";
import { skillKey } from "@/lib/text/normalize";
import { editFieldAt, isBlankList, isBlankText, type Path } from "./edit";
import { editFactText, factPath } from "./facts";
import { jobsByRecency, studiesByRecency } from "./timeline";

/**
 * What «Mejorar con IA» can be asked of in each section of the profile: the texts the person wrote that a model could say better, each with where it is
 * written and how. Pure — it only reads the profile — so what the button does is decided here and can be tested without a screen.
 *
 * What is not here is not sent: the name of a company, a school, an issuer or a project, and the contact. A text is in only if the field could hold it back
 * once rewritten, and a line left out of the CVs (a job, a task, a certification) is not worth a use of the plan's allowance.
 */

export type ImproveSectionName = "experience" | "education" | "skills" | "projects" | "other";

/** One change to the stored profile, with the place the way back to it is taken from (`editWithUndo`). */
export type Write = { path: Path; change: (draft: StoredProfile) => void };

export type Improvable = {
  /** Through a path of the profile, not through its place in a list: it is how the text is found again once the answer is back. */
  id: string;
  kind: ImproveManyKind;
  /** What is written now, as it was sent. */
  text: string;
  /** Which text it is, for whoever reads it next to its new version. */
  label: string;
  /** Whether the profile can take this text in place of the one it has — not one that would leave two skills of one name. */
  allows: (improved: string) => boolean;
  /** What to write for the improved text. */
  writes: (improved: string) => Write[];
};

const lines = (text: string, max: number): string[] =>
  text
    .split("\n")
    .map((line) => line.trim().slice(0, max))
    .filter(Boolean);

const anyway = () => true;

/** A text of a field, written back the way a person who edits it does. */
function field(id: string, kind: ImproveManyKind, label: string, text: string, path: Path, empty: (value: string) => boolean = isBlankText): Improvable | null {
  if (!text.trim() || text.length > IMPROVE_MANY_LIMIT[kind]) return null;
  return { id, kind, text, label, allows: anyway, writes: (improved) => [{ path, change: (draft) => void editFieldAt(draft, path, improved.trim(), empty) }] };
}

/** A list of short lines held in one field, one to a line: what stands out of a study, «Otros datos». */
function list(id: string, label: string, value: readonly string[], path: Path, max: number): Improvable | null {
  const text = value.map((line) => line.trim()).filter(Boolean).join("\n");
  if (!text || text.length > IMPROVE_MANY_LIMIT.points) return null;
  return { id, kind: "points", text, label, allows: anyway, writes: (improved) => [{ path, change: (draft) => void editFieldAt(draft, path, lines(improved, max), isBlankList) }] };
}

const joined = (...parts: string[]) => parts.map((part) => part.trim()).filter(Boolean).join(" · ");

function experience(profile: StoredProfile): Improvable[] {
  return jobsByRecency(profile.experience.filter(isMeaningfulExperience).filter((job) => !job.excluded)).flatMap((job) => {
    const label = joined(job.role.value, job.company.value) || "Puesto";
    return job.facts
      .filter((fact) => fact.kind !== "tool" && !fact.excluded && fact.text.trim() && fact.text.length <= IMPROVE_MANY_LIMIT.task)
      .map<Improvable>((fact) => ({
        id: `fact:${job.id}:${fact.id}`,
        kind: "task",
        text: fact.text,
        label,
        allows: anyway,
        writes: (improved) => [{ path: factPath(job.id, fact.id), change: (draft) => void editFactText(draft, job.id, fact.id, improved) }],
      }));
  });
}

function education(profile: StoredProfile): Improvable[] {
  return studiesByRecency(profile.education).flatMap((entry) => {
    const at = ["education", entry.id];
    const study = joined(entry.degree.value, entry.institution.value) || "Estudio";
    return [
      field(`study:${entry.id}:degree`, "name", `Título · ${entry.institution.value.trim() || "Formación"}`, entry.degree.value, [...at, "degree"]),
      field(`study:${entry.id}:honors`, "points", `Menciones · ${study}`, entry.honors.value, [...at, "honors"]),
      list(`study:${entry.id}:highlights`, `Destacados · ${study}`, entry.highlights.value, [...at, "highlights"], STUDY_HIGHLIGHT_MAX),
    ].filter((item): item is Improvable => item !== null);
  });
}

function skills(profile: StoredProfile): Improvable[] {
  const found: Improvable[] = [];
  for (const skill of profile.skills) {
    const item = field(`skill:${skill.id}`, "name", "Habilidad", skill.name.value, ["skills", skill.id, "name"]);
    if (!item) continue;
    const before = skillKey(skill.name.value);
    found.push({
      ...item,
      // Two skills of one name are one skill said twice.
      allows: (improved) => !profile.skills.some((other) => other.id !== skill.id && skillKey(other.name.value) === skillKey(improved)),
      // A tool of a job that `toolsOfJob` counts as this skill is renamed with it, or the job would list the tool twice.
      writes: (improved) => [
        ...item.writes(improved),
        ...(skillKey(improved) === before
          ? []
          : profile.experience.flatMap((job) =>
              job.facts
                .filter((fact) => fact.kind === "tool" && skillKey(fact.text) === before)
                .map<Write>((fact) => ({ path: factPath(job.id, fact.id), change: (draft) => void editFactText(draft, job.id, fact.id, improved) })),
            )),
      ],
    });
  }
  for (const language of profile.languages) {
    const item = field(`language:${language.id}`, "name", "Idioma", language.name.value, ["languages", language.id, "name"]);
    if (item) found.push({ ...item, allows: (improved) => !profile.languages.some((other) => other.id !== language.id && fold(other.name.value) === fold(improved)) });
  }
  for (const cert of profile.certifications.filter((entry) => !entry.excluded)) {
    const item = field(`certification:${cert.id}`, "name", "Certificación", cert.name.value, ["certifications", cert.id, "name"]);
    if (item) found.push(item);
  }
  return found;
}

function projects(profile: StoredProfile): Improvable[] {
  return profile.projects
    .map((project) => field(`project:${project.id}`, "project", project.name.value.trim() || "Proyecto", project.description.value, ["projects", project.id, "description"]))
    .filter((item): item is Improvable => item !== null);
}

function other(profile: StoredProfile): Improvable[] {
  const { legacy } = profile;
  return [
    field("legacy:headline", "headline", "Titular", legacy.headline.value, ["legacy", "headline"]),
    field("legacy:about", "about", "Sobre vos", legacy.about.value, ["legacy", "about"]),
    list("legacy:extras", "Otros datos", legacy.extras.value, ["legacy", "extras"], EXTRA_LIMIT),
  ].filter((item): item is Improvable => item !== null);
}

const COLLECT: Record<ImproveSectionName, (profile: StoredProfile) => Improvable[]> = { experience, education, skills, projects, other };

export const improvablesOf = (profile: StoredProfile, section: ImproveSectionName): Improvable[] => COLLECT[section](profile);
