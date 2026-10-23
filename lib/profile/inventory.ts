import { contentFacts } from "@/lib/onboarding/gaps";
import { statesQuantity } from "@/lib/onboarding/figure";
import { isMeaningfulExperience, type Fact, type StoredExperience, type StoredProfile } from "@/lib/schemas/profile-v2";

/**
 * What a profile already has, counted: the other half of a list of what is left to do.
 *
 * A profile only ever tells its owner what it lacks — "Para hacer", "Para revisar" — and for someone who comes
 * back and sees nothing but a list of what is missing, it looks like all of it is. A line of what is already there is
 * the same list from the other side. Counts and nothing else: no percentage and no score, which is the one number that
 * makes people fill everything in (`ProfileHub`).
 */
export type Inventory = {
  jobs: number;
  /** What was done in them: the lines, not the tools listed beside them. */
  tasks: number;
  /** Of those, the ones with a figure — a number kept beside the line, or one in its words that counts something, not a year. */
  withFigure: number;
  studies: number;
  skills: number;
};

/** Whether a task carries a figure: one kept beside the line, or one in its own words that counts something — a year is not one. */
export const hasFigure = (fact: Fact): boolean => Boolean(fact.metric && "value" in fact.metric) || statesQuantity(fact.text);

/**
 * What a single job holds, in the same counts: «5 tareas · 2 con cifra». The tasks that say what was done, and not the tools listed beside
 * them, and of those the ones with a number — the two halves of «con y sin cifra» that the profile of a person says about each job, and that
 * never become a percentage of anything.
 */
export function figuresIn(job: StoredExperience): { tasks: number; withFigure: number } {
  const facts = contentFacts(job);
  return { tasks: facts.length, withFigure: facts.filter(hasFigure).length };
}

export function inventoryOf(profile: StoredProfile): Inventory {
  const jobs = profile.experience.filter(isMeaningfulExperience);
  const facts = jobs.flatMap(contentFacts);
  return {
    jobs: jobs.length,
    tasks: facts.length,
    withFigure: facts.filter(hasFigure).length,
    studies: profile.education.filter((entry) => entry.institution.value.trim() || entry.degree.value.trim()).length,
    skills: profile.skills.filter((skill) => skill.name.value.trim()).length,
  };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "Ya tenés: 5 puestos, 23 tareas, 4 con cifra, 2 estudios, 8 habilidades." — only what there is; `null` when there is nothing to count. */
export function inventoryLine(inventory: Inventory): string | null {
  const parts = [
    inventory.jobs > 0 ? plural(inventory.jobs, "puesto", "puestos") : "",
    inventory.tasks > 0 ? plural(inventory.tasks, "tarea", "tareas") : "",
    inventory.withFigure > 0 ? `${inventory.withFigure} con cifra` : "",
    inventory.studies > 0 ? plural(inventory.studies, "estudio", "estudios") : "",
    inventory.skills > 0 ? plural(inventory.skills, "habilidad", "habilidades") : "",
  ].filter(Boolean);
  return parts.length > 0 ? `Ya tenés: ${parts.join(", ")}.` : null;
}
