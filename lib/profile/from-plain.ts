import type { Profile } from "@/lib/schemas/profile";
import {
  type CefrLevel,
  type EmploymentType,
  type Fact,
  type Field,
  type Source,
  type StoredCertification,
  type StoredEducation,
  type StoredExperience,
  type StoredLanguage,
  type StoredProject,
  type StoredSkill,
  type WorkMode,
} from "@/lib/schemas/profile-v2";
import { normalizeForComparison } from "@/lib/text/normalize";
import { toDateValue, withoutCurrent, type DateValue, type EndDateValue } from "./dates";

/**
 * Builds stored entities from their plain counterparts.
 *
 * Two callers need the same conversion and differ only in who they say wrote
 * it: the one-time migration of a profile from before provenance existed
 * (`legacy`, with ids derived from position so the same profile migrates to the
 * same ids on every device and on the server), and the write path, where the
 * old editors and importers still hand over a plain profile and what is new in
 * it is what the user just typed or read in.
 */

type PlainExperience = Profile["experience"][number];
type PlainEducation = Profile["education"][number];
type PlainProject = Profile["projects"][number];
type PlainCertification = Profile["certifications"][number];
type PlainLanguage = Profile["languages"][number];

export type BuildContext = {
  source: Source;
  factId: (experienceId: string, kind: "bullet" | "tool", index: number) => string;
  skillId: (index: number) => string;
};

/** A value someone gave. An empty one has no author, so it carries no source. */
export function textFieldFrom(value: string, source: Source): Field<string> {
  return value ? { value, status: "confirmed", source } : { value: "", status: "confirmed" };
}

export function startFieldFrom(text: string, source: Source): Field<DateValue> {
  const value = withoutCurrent(toDateValue(text));
  return text.trim() ? { value, status: "confirmed", source } : { value, status: "confirmed" };
}

/**
 * `current` is the plain profile's checkbox, and only that. A "Presente"
 * typed in the end box is kept as the text it was but does not set the flag: the
 * two are separate fields on the plain side, and a projection that flipped one
 * because of the other would change what a profile says without anyone editing it.
 */
export function endFieldFrom(text: string, current: boolean, source: Source): Field<EndDateValue> {
  const value: EndDateValue = { ...withoutCurrent(toDateValue(text)), ...(current ? { current: true } : {}) };
  return text.trim() || current
    ? { value, status: "confirmed", source }
    : { value, status: "confirmed" };
}

const NATIVE_WORDS = new Set(["nativo", "nativa", "native", "materna", "lengua materna", "idioma nativo"]);

/** A level is what was written. A CEFR code or "nativo" is also read out of it; nothing else is. */
export function languageLevelFrom(text: string): { cefr?: CefrLevel; raw?: string } {
  const raw = text.trim();
  if (!raw) return {};
  const upper = raw.toUpperCase();
  if (/^(A1|A2|B1|B2|C1|C2)$/.test(upper)) return { cefr: upper as CefrLevel, raw };
  if (NATIVE_WORDS.has(normalizeForComparison(raw))) return { cefr: "native", raw };
  return { raw };
}

export function factFrom(
  id: string,
  kind: Fact["kind"],
  text: string,
  source: Source,
  original?: string,
): Fact {
  return {
    id,
    kind,
    text,
    source,
    status: "confirmed",
    ...(original !== undefined ? { original } : {}),
  };
}

export function experienceFromPlain(job: PlainExperience, ctx: BuildContext): StoredExperience {
  const { source } = ctx;
  const bullets = job.bullets.map((text, index) =>
    factFrom(ctx.factId(job.id, "bullet", index), "responsibility", text, source),
  );
  const tools = job.tags.map((text, index) =>
    factFrom(ctx.factId(job.id, "tool", index), "tool", text, source),
  );
  return {
    id: job.id,
    company: textFieldFrom(job.company, source),
    role: textFieldFrom(job.role, source),
    city: textFieldFrom(job.city, source),
    country: textFieldFrom(job.country, source),
    start: startFieldFrom(job.start, source),
    end: endFieldFrom(job.end, job.current, source),
    facts: [...bullets, ...tools],
    // What kind of job it was and how it was done: kept only when the plain profile said so, as a source says it.
    ...(job.employmentType ? { employmentType: { value: job.employmentType as EmploymentType, status: "confirmed" as const, source } } : {}),
    ...(job.workMode ? { workMode: { value: job.workMode as WorkMode, status: "confirmed" as const, source } } : {}),
    ...(job.note ? { note: { value: job.note, status: "confirmed" as const, source } } : {}),
  };
}

export function educationFromPlain(entry: PlainEducation, ctx: BuildContext): StoredEducation {
  const { source } = ctx;
  return {
    id: entry.id,
    institution: textFieldFrom(entry.institution, source),
    degree: textFieldFrom(entry.degree, source),
    city: textFieldFrom(entry.city, source),
    country: textFieldFrom(entry.country, source),
    start: startFieldFrom(entry.start, source),
    end: startFieldFrom(entry.end, source),
    honors: textFieldFrom(entry.honors, source),
    highlights: entry.highlights.length > 0 ? { value: entry.highlights, status: "confirmed", source } : { value: [], status: "confirmed" },
    status: { value: entry.status, status: "confirmed", source },
  };
}

export function certificationFromPlain(
  entry: PlainCertification,
  ctx: BuildContext,
): StoredCertification {
  const { source } = ctx;
  return {
    id: entry.id,
    name: textFieldFrom(entry.name, source),
    issuer: textFieldFrom(entry.issuer, source),
    date: startFieldFrom(entry.date, source),
  };
}

export function languageFromPlain(entry: PlainLanguage, ctx: BuildContext): StoredLanguage {
  const { source } = ctx;
  const level = languageLevelFrom(entry.level);
  return {
    id: entry.id,
    name: textFieldFrom(entry.name, source),
    level: entry.level.trim()
      ? { value: level, status: "confirmed", source }
      : { value: level, status: "confirmed" },
  };
}

export function projectFromPlain(entry: PlainProject, ctx: BuildContext): StoredProject {
  const { source } = ctx;
  return {
    id: entry.id,
    name: textFieldFrom(entry.name, source),
    description: textFieldFrom(entry.description, source),
    url: textFieldFrom(entry.url, source),
    tags:
      entry.tags.length > 0
        ? { value: entry.tags, status: "confirmed", source }
        : { value: [], status: "confirmed" },
  };
}

export function skillFrom(
  id: string,
  name: string,
  source: Source,
  experienceIds: string[] = [],
): StoredSkill {
  return { id, name: textFieldFrom(name, source), experienceIds };
}

/**
 * Links a skill to the roles that list the same thing as a tool.
 *
 * Only a literal match, compared the way the rest of the app compares skill
 * names ("Node.js" is "Node JS"). A skill is never linked to a role because the
 * job title suggests it: the link is a claim about where the person used it,
 * and only their own list says so.
 */
export function linkSkillsToExperiences(
  skills: StoredSkill[],
  experience: readonly StoredExperience[],
): StoredSkill[] {
  const toolsByRole = experience.map((job) => ({
    id: job.id,
    tools: new Set(
      job.facts.filter((fact) => fact.kind === "tool").map((fact) => normalizeForComparison(fact.text)),
    ),
  }));
  return skills.map((skill) => {
    const name = normalizeForComparison(skill.name.value);
    if (!name) return skill;
    const linked = toolsByRole.filter((role) => role.tools.has(name)).map((role) => role.id);
    return linked.length > 0 ? { ...skill, experienceIds: linked } : skill;
  });
}
