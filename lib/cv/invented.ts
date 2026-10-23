import { figureMentions, normalize, scaleMentions } from "@/lib/ai/evidence";
import { removalCost, removeItemBullet, removePair, removeProject, removeSectionBullet, parseFieldPath } from "@/lib/cv/edit";
import { pickMetricsRole } from "@/lib/cv/metrics-role";
import type { CVDocument } from "@/lib/schemas/cv";
import type { Experience, Profile } from "@/lib/schemas/profile";
import { splitSentences } from "@/lib/text/sentences";

/**
 * What can be done about a number the CV made up (`inventedFigures`): take its line out, or say it is real and put it in the
 * profile — where it is asked for the way every other figure is, about a job.
 *
 * Pure, and about the CV on the page: whether it was edited or generated, what a person sees is what these read.
 */

/** The CV without the line a figure is in: a bullet, a pair or a project is taken out, and in the summary, the sentence. `null` when that is not a thing that can be taken out. */
export function withoutFigureLine(cv: CVDocument, field: string, figure: string): CVDocument | null {
  const target = parseFieldPath(field);
  if (!target) return null;

  switch (target.kind) {
    case "summary": {
      // Not the whole summary: the sentence the number is in, found by the number.
      const sentences = splitSentences(cv.summary);
      const kept = sentences.filter((sentence) => ![...figureMentions(sentence), ...scaleMentions(sentence)].some((mention) => mention.figure === figure));
      if (kept.length === 0 || kept.length === sentences.length) return null;
      return { ...cv, summary: kept.join(" ") };
    }
    case "itemBullet":
      return removeItemBullet(cv, target.section, target.item, target.bullet);
    case "sectionBullet": {
      // A list that falls under its minimum is dropped whole by the schema: not a thing to do for one number.
      if (removalCost(cv, target.section)?.removesSection) return null;
      return removeSectionBullet(cv, target.section, target.bullet);
    }
    case "pair":
      return removePair(cv, target.section, target.item);
    case "projectDescription":
      return removeProject(cv, target.section, target.item);
    default:
      return null;
  }
}

/** The job of the profile a CV job is, by the company it names: the same match everything here makes, and `undefined` when none fits. */
export function profileJobFor(company: string, profile: Profile): Experience | undefined {
  const wanted = normalize(company);
  if (!wanted) return undefined;
  return profile.experience.find((job) => {
    const known = normalize(job.company);
    return known.length > 0 && (known === wanted || known.includes(wanted) || wanted.includes(known));
  });
}

/**
 * The job of the profile a line of the CV is about: the one its experience entry names, or — for the summary and the lists, which
 * are about the CV as a whole — the one the CV drew most from (`pickMetricsRole`). `null` when the profile has no job to say.
 */
export function roleForField(cv: CVDocument, profile: Profile, field: string, now: Date = new Date()): string | null {
  const target = parseFieldPath(field);
  if (target && (target.kind === "itemBullet" || target.kind === "role")) {
    const section = cv.sections[target.section];
    const company = section?.kind === "experience" ? section.items[target.item]?.company : undefined;
    const match = company ? profileJobFor(company, profile) : undefined;
    if (match) return match.id;
  }
  const index = pickMetricsRole(cv, profile, now);
  return index === null ? null : (profile.experience[index]?.id ?? null);
}
