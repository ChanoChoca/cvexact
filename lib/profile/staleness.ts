import { ENGINE } from "@/lib/onboarding/config";
import { mentionsSkill } from "@/lib/onboarding/tools";
import { fold } from "@/lib/parse/dictionaries";
import { isMeaningfulExperience, type StoredExperience, type StoredProfile, type StoredSkill } from "@/lib/schemas/profile-v2";
import { standingAt } from "./currency";

/**
 * A skill that nothing in the profile has backed for years (e5, O17; E4, 4): the question is whether the person still uses it, and it is only ever a
 * question. Nothing here takes a skill out, marks it old or counts it against anyone: «ya no» is the person's, and goes to the same place any removal
 * does, with the way back.
 *
 * What backs a skill is a job it was used in — the one the person linked it to, or one whose own lines name it — or the last time the person stood behind
 * it themselves (they wrote it, or said «sigue igual»). The last of those is the day the question counts from, and a skill nothing dates is not asked
 * about: «lo último que la respalda es de 2021» needs a date to say. A job that is going on, or whose end nobody wrote, backs it today.
 *
 * How long is «years» depends on the kind of skill, because E4 says it does — what is done with the hands is forgotten more slowly than a tool that changes
 * under whoever uses it — and the numbers (`ENGINE.currency.unusedSkillYears`) are the report's, starting values to be tried by segment, not conclusions.
 */

export type SkillSegment = "technical" | "manual";

/**
 * The beginnings of the words for a trade: a thing done with the hands, a machine, a craft. Said folded, with no accents, and matched at the start of a
 * word — `electric` is `electricista` and `electricidad` and not `electrónica`. A guess, and a cheap one to be wrong about: it changes whether the question
 * comes after three years or after five, and nothing else.
 */
const TRADE_STEMS = [
  "soldad", "plomer", "gasist", "electric", "albanil", "carpinter", "herrer", "pintur", "pintor", "mecanic", "chapist", "chapa y pintura",
  "tornero", "tornear", "fresad", "panader", "pasteler", "cocin", "costur", "peluquer", "jardiner", "conduccion", "chofer", "limpieza", "cerrajer",
  "refrigeracion", "aire acondicionado", "autoelevador", "montacarga", "tapicer", "carnicer", "vidrier", "ceramic", "durlock", "yeseria",
];

const TRADE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${TRADE_STEMS.join("|")})`, "u");

/** The kind of a skill, by what it is called: a trade is a manual one, and anything else — a tool, a language, a way of working — a technical one. */
export const skillSegment = (name: string): SkillSegment => (TRADE.test(fold(name)) ? "manual" : "technical");

/** The last day a job backs what was done in it: today for one that is going on or whose end is not written, and the end of the month it ended for the rest. */
function backedBy(job: StoredExperience, now: Date): Date {
  const end = job.end.value;
  if (end.current || end.year === undefined) return now;
  // The day 0 of the next month is the last of this one; a year with no month ends in December.
  return new Date(end.year, end.month ?? 12, 0, 23, 59, 59);
}

const lines = (job: StoredExperience): string[] => job.facts.map((fact) => fact.text);

/** Whether a project names the skill in what it says of itself: a project has no dates, so what it backs, it backs for good. */
const projectNames = (profile: StoredProfile, name: string): boolean =>
  profile.projects.some((project) => mentionsSkill([project.name.value, project.description.value, ...project.tags.value], name));

/**
 * The last day something backed this skill, or nothing when nothing can be said: `null` is not stale, it is unknown. A project that names it, a job still
 * going on that is linked to it, and the person's own word are all «hoy» or a day — never an invention.
 */
export function backedUntil(profile: StoredProfile, skill: StoredSkill, now: Date): Date | null {
  const name = skill.name.value;
  if (name.trim() === "") return null;
  if (projectNames(profile, name)) return now;
  const days: Date[] = [];
  for (const job of profile.experience.filter(isMeaningfulExperience)) {
    if (skill.experienceIds.includes(job.id) || mentionsSkill(lines(job), name)) days.push(backedBy(job, now));
  }
  const stood = standingAt(skill.name);
  if (stood) {
    const day = new Date(stood);
    if (!Number.isNaN(day.getTime())) days.push(day);
  }
  if (days.length === 0) return null;
  return days.reduce((latest, day) => (day > latest ? day : latest));
}

/** Whole years from one day to another: the 3rd of March to the 2nd of March is not yet a year. */
export function wholeYears(from: Date, to: Date): number {
  let years = to.getFullYear() - from.getFullYear();
  const anniversary = new Date(to.getFullYear(), from.getMonth(), from.getDate());
  if (to < anniversary) years -= 1;
  return years;
}

export type StaleSkill = { skill: StoredSkill; name: string; segment: SkillSegment; since: Date; years: number };

/** How many years of nothing backing a skill it takes before it is asked about, for each kind of skill. */
export const staleAfterYears = (segment: SkillSegment): number => ENGINE.currency.unusedSkillYears[segment];

/** The skills whose last backing is further back than their kind allows, the oldest first: each one is a question, and none is a verdict. */
export function staleSkills(profile: StoredProfile, now: Date = new Date()): StaleSkill[] {
  const found: StaleSkill[] = [];
  for (const skill of profile.skills) {
    const name = skill.name.value.trim();
    if (name === "") continue;
    const since = backedUntil(profile, skill, now);
    if (!since) continue;
    const segment = skillSegment(name);
    const years = wholeYears(since, now);
    if (years >= staleAfterYears(segment)) found.push({ skill, name, segment, since, years });
  }
  return found.sort((a, b) => a.since.getTime() - b.since.getTime());
}

/** The id of the question about one skill: the year it counts from is in it, so that «ahora no» turns down this lapse and a later one is asked again. */
export const staleGapId = (stale: Pick<StaleSkill, "skill" | "since">): string => `skill_stale:${stale.skill.id}:${stale.since.getFullYear()}`;
