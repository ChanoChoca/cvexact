import { mentionsSkill } from "@/lib/onboarding/tools";
import { fold } from "@/lib/parse/dictionaries";
import type { InferredSkill } from "@/lib/schemas/job";
import { skillKey } from "@/lib/text/normalize";
import type { DateValue } from "./dates";
import { editContext, editFieldAt, recordChange, type EditContext } from "./edit";
import { pickedLevel } from "./language-levels";
import type {
  CefrLevel,
  StoredCertification,
  StoredLanguage,
  StoredProfile,
  StoredSkill,
} from "@/lib/schemas/profile-v2";
import { emptyField, isMeaningfulExperience } from "@/lib/schemas/profile-v2";

/**
 * The lists that are not jobs — skills, languages, certifications — and moving
 * things in the order the person keeps them. Each addition is the person's own, and
 * each is a step in the history.
 */

const manual = (ctx: EditContext) => ({ kind: "manual" as const, at: ctx.now });

const named = (value: string, ctx: EditContext) => ({ value: value.trim(), status: "confirmed" as const, source: manual(ctx) });

// --- Skills -------------------------------------------------------------------------------

/**
 * A skill, by name. One that is already there — in any case, with or without accents,
 * spaced or dotted differently ("Node.js", "NodeJS") — is not added twice; if a job is
 * given it is linked to it instead.
 */
export function addSkill(draft: StoredProfile, name: string, ctx: EditContext = editContext(), experienceId?: string): StoredSkill | null {
  const clean = name.trim().slice(0, 80);
  if (!clean) return null;
  const existing = draft.skills.find((skill) => skillKey(skill.name.value) === skillKey(clean));
  if (existing) {
    if (experienceId && !existing.experienceIds.includes(experienceId)) {
      existing.experienceIds = [...existing.experienceIds, experienceId];
      recordChange(draft, { op: "set", path: ["skills", existing.id, "experienceIds"], label: clean }, ctx);
    }
    return existing;
  }
  const skill: StoredSkill = { id: ctx.newId(), name: named(clean, ctx), experienceIds: experienceId ? [experienceId] : [] };
  draft.skills.push(skill);
  recordChange(draft, { op: "add", path: ["skills", skill.id], label: clean }, ctx);
  return skill;
}

/**
 * A deduced skill the person says is theirs: a skill of the profile, linked to the jobs whose own lines name what it was deduced from, so that it is
 * not one «sin uso» the first time the profile is asked about its skills.
 */
export function acceptInferredSkill(draft: StoredProfile, inferred: InferredSkill, ctx: EditContext = editContext()): StoredSkill | null {
  const jobs = draft.experience.filter(isMeaningfulExperience).filter((job) => mentionsSkill(job.facts.map((fact) => fact.text), inferred.derivedFrom));
  if (jobs.length === 0) return addSkill(draft, inferred.skill, ctx);
  return jobs.map((job) => addSkill(draft, inferred.skill, ctx, job.id)).at(-1) ?? null;
}

/** A skill no longer counted as used in a job. It stays among the person's skills. */
export function unlinkSkill(draft: StoredProfile, skillId: string, experienceId: string): boolean {
  const skill = draft.skills.find((entry) => entry.id === skillId);
  if (!skill || !skill.experienceIds.includes(experienceId)) return false;
  skill.experienceIds = skill.experienceIds.filter((id) => id !== experienceId);
  return true;
}

// --- Languages -----------------------------------------------------------------------------------

export function addLanguage(draft: StoredProfile, name: string, level: CefrLevel | undefined, ctx: EditContext = editContext()): StoredLanguage | null {
  const clean = name.trim().slice(0, 60);
  if (!clean) return null;
  if (draft.languages.some((language) => fold(language.name.value) === fold(clean))) return null;
  const language: StoredLanguage = {
    id: ctx.newId(),
    name: named(clean, ctx),
    level: level ? { value: pickedLevel(level), status: "confirmed", source: manual(ctx) } : emptyField({}),
  };
  draft.languages.push(language);
  recordChange(draft, { op: "add", path: ["languages", language.id], label: clean }, ctx);
  return language;
}

/** `null` takes the level off. */
export function setLanguageLevel(draft: StoredProfile, id: string, level: CefrLevel | null, ctx: EditContext = editContext()): boolean {
  const next: StoredLanguage["level"]["value"] = level ? pickedLevel(level) : {};
  return editFieldAt(draft, ["languages", id, "level"], next, (value) => !value.cefr && !value.raw, ctx);
}

// --- Certifications ------------------------------------------------------------------------------

/** A date as the picker gives it, kept as a year and its month if it has one; `undefined` when there is no year. */
const pickedDate = (date: DateValue | undefined): DateValue | undefined =>
  date && date.year !== undefined ? { year: date.year, ...(date.month ? { month: date.month } : {}) } : undefined;

export function addCertification(
  draft: StoredProfile,
  values: { name: string; issuer?: string; date?: DateValue; /** Until when it holds, for a credential that lapses. */ expires?: DateValue },
  ctx: EditContext = editContext(),
): StoredCertification | null {
  const name = values.name.trim().slice(0, 160);
  if (!name) return null;
  const issuer = values.issuer?.trim().slice(0, 120) ?? "";
  const date = pickedDate(values.date);
  const expires = pickedDate(values.expires);
  const cert: StoredCertification = {
    id: ctx.newId(),
    name: named(name, ctx),
    issuer: issuer ? named(issuer, ctx) : emptyField(""),
    date: date ? { value: date, status: "confirmed", source: manual(ctx) } : emptyField<DateValue>({}),
    ...(expires ? { expires: { value: expires, status: "confirmed" as const, source: manual(ctx) } } : {}),
  };
  draft.certifications.push(cert);
  recordChange(draft, { op: "add", path: ["certifications", cert.id], label: name }, ctx);
  return cert;
}

// --- Order --------------------------------------------------------------------------------------------

type Ordered = "experience" | "education" | "projects" | "certifications" | "languages" | "skills";

/**
 * Moves an entry one place up or down. For the lists whose order is the person's — the
 * generators read it, and a CV lists things as the profile does — it can be changed by hand.
 * It is not a step in the history: putting it back is moving it back. Jobs and studies are not
 * among them: they are listed by their dates (`storedProfileSchema` puts them in that order
 * whenever the profile is read), so moving one lasts only until the next save.
 */
export function moveEntity(draft: StoredProfile, list: Ordered, id: string, delta: -1 | 1): boolean {
  const entries = draft[list] as Array<{ id: string }>;
  const from = entries.findIndex((entry) => entry.id === id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= entries.length) return false;
  [entries[from], entries[to]] = [entries[to]!, entries[from]!];
  return true;
}
