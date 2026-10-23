import type { Profile } from "@/lib/schemas/profile";
import {
  isBlankProfile,
  newSource,
  storedProfileSchema,
  type StoredProfile,
} from "@/lib/schemas/profile-v2";
import {
  certificationFromPlain,
  educationFromPlain,
  experienceFromPlain,
  languageFromPlain,
  linkSkillsToExperiences,
  projectFromPlain,
  skillFrom,
  textFieldFrom,
  type BuildContext,
} from "./from-plain";

/**
 * A profile from before provenance existed, as a stored one.
 *
 * Nothing is inferred and nothing is dropped. Every existing value becomes a
 * `confirmed` value from the `legacy` source — the honest description of data
 * whose author (the person, a model reading their CV, the old interview) was
 * never recorded — and `toPlainProfile(migrateV1(p))` reproduces `p`. That
 * property is the migration's whole contract, and `tests/profile-migrate.test.ts`
 * holds it against real profiles.
 *
 * Ids the plain profile never had (facts, skills) are derived from position, so
 * migrating the same profile twice — on two devices, or on the server every
 * time a synced row is read — yields the same ids. Random ones would make every
 * read look like a change.
 */

/** Gives repeated or empty ids a suffix, so every entity can be addressed by its id. */
function uniqueIds<T extends { id: string }>(items: readonly T[], prefix: string): T[] {
  const seen = new Set<string>();
  return items.map((item, index) => {
    let id = item.id || `${prefix}-${index}`;
    for (let n = 1; seen.has(id); n++) id = `${item.id || prefix}-${n}`;
    seen.add(id);
    return id === item.id ? item : { ...item, id };
  });
}

export function migrateV1(plain: Profile, opts: { now?: string } = {}): StoredProfile {
  const now = opts.now ?? new Date().toISOString();
  // No timestamp on the source: when a legacy value was entered is unknown, and
  // the moment of migration is not it.
  const source = newSource("legacy", "");
  const ctx: BuildContext = {
    source,
    factId: (experienceId, kind, index) => `${experienceId}-${kind === "bullet" ? "b" : "t"}${index}`,
    skillId: (index) => `skill-${index}`,
  };

  const experience = uniqueIds(plain.experience, "exp").map((job) =>
    experienceFromPlain(job, ctx),
  );
  const skills = linkSkillsToExperiences(
    plain.skills.map((name, index) => skillFrom(ctx.skillId(index), name, source)),
    experience,
  );

  const stored = storedProfileSchema.parse({
    version: 2,
    rev: 0,
    updatedAt: now,
    contact: {
      fullName: textFieldFrom(plain.fullName, source),
      email: textFieldFrom(plain.email, source),
      phone: textFieldFrom(plain.phone, source),
      city: textFieldFrom(plain.city, source),
      country: textFieldFrom(plain.country, source),
      links:
        plain.links.length > 0
          ? { value: plain.links, status: "confirmed", source }
          : { value: [], status: "confirmed" },
    },
    experience,
    education: uniqueIds(plain.education, "edu").map((entry) => educationFromPlain(entry, ctx)),
    certifications: uniqueIds(plain.certifications, "cert").map((entry) =>
      certificationFromPlain(entry, ctx),
    ),
    languages: uniqueIds(plain.languages, "lang").map((entry) => languageFromPlain(entry, ctx)),
    projects: uniqueIds(plain.projects, "proj").map((entry) => projectFromPlain(entry, ctx)),
    skills,
    objective: textFieldFrom(plain.objective, source),
    legacy: {
      headline: textFieldFrom(plain.headline, source),
      about: textFieldFrom(plain.about, source),
      extras:
        plain.extras.length > 0
          ? { value: plain.extras, status: "confirmed", source }
          : { value: [], status: "confirmed" },
      practical: { value: plain.practical, status: "confirmed", source },
    },
  });

  // Someone who already has a profile has been through setup, in the only way
  // there was. Sending them into the first-run flow would be the migration
  // asking them to start over.
  return isBlankProfile(stored)
    ? stored
    : { ...stored, onboarding: { ...stored.onboarding, step: "done", done: true } };
}
