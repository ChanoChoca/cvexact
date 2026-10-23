import { addEntry, blankForm, type EntryForm } from "@/lib/onboarding/entries";
import { emptyStoredProfile, type Fact, type Metric, type Source, type StoredEducation, type StoredExperience, type StoredProfile } from "@/lib/schemas/profile-v2";

/**
 * Profiles for the question engine's tests, built from the same pieces a person
 * builds one from: entries as the forms make them, facts as answers make them.
 * `NOW` is fixed so "current" and "last five years" mean the same thing every run.
 */

export const NOW = new Date("2026-09-21T12:00:00.000Z");
export const STAMP = NOW.toISOString();

let counter = 0;
export const newId = () => `id-${++counter}`;

type FactSpec = { kind?: Fact["kind"]; text: string; metric?: Metric };

export type JobSpec = {
  company?: string;
  role?: string;
  from?: { year: number; month?: number };
  to?: { year: number; month?: number } | "current";
  facts?: FactSpec[];
  /**
   * The dates came from a CV, not from the person: a document says "2023" and the person may know the month. What the
   * engine asks about a year with no month depends on which — a date the person entered themselves is not asked again.
   */
  fromCv?: boolean;
};

export function withJob(profile: StoredProfile, spec: JobSpec): StoredExperience {
  const form: EntryForm = {
    ...blankForm("job"),
    what: spec.role ?? "",
    where: spec.company ?? "",
    from: spec.from ?? {},
    to: spec.to && spec.to !== "current" ? spec.to : {},
    current: spec.to === "current",
  };
  const id = addEntry(profile, form, { newId, now: STAMP });
  // A job with only a start, or only an end, or nothing but facts is still a job.
  const job = profile.experience.find((entry) => entry.id === id) ?? addBlankJob(profile);
  if (spec.fromCv) {
    job.start = { ...job.start, source: { kind: "cv", at: STAMP } };
    job.end = { ...job.end, source: { kind: "cv", at: STAMP } };
  }
  for (const fact of spec.facts ?? []) {
    job.facts.push({
      id: newId(),
      kind: fact.kind ?? "responsibility",
      text: fact.text,
      ...(fact.metric ? { metric: fact.metric } : {}),
      source: { kind: "manual", at: STAMP },
      status: "confirmed",
    });
  }
  return job;
}

function addBlankJob(profile: StoredProfile): StoredExperience {
  const id = newId();
  profile.experience.push({
    id,
    company: { value: "", status: "confirmed" },
    role: { value: "", status: "confirmed" },
    city: { value: "", status: "confirmed" },
    country: { value: "", status: "confirmed" },
    start: { value: {}, status: "confirmed" },
    end: { value: {}, status: "confirmed" },
    facts: [],
  });
  return profile.experience[profile.experience.length - 1]!;
}

/**
 * Says where everything of a job came from — its fields and its lines — for a test that needs the whole job to be as old as, or as little
 * looked at as, a source says: «typed in January», «read from a document», «from before the day was kept».
 */
export function fromSource(job: StoredExperience, source: Source): StoredExperience {
  job.company = { ...job.company, source };
  job.role = { ...job.role, source };
  job.city = { ...job.city, source };
  job.country = { ...job.country, source };
  job.start = { ...job.start, source };
  job.end = { ...job.end, source };
  for (const fact of job.facts) fact.source = source;
  return job;
}

export function profileWith(...jobs: JobSpec[]): StoredProfile {
  const profile = emptyStoredProfile();
  profile.onboarding.route = "cv";
  for (const job of jobs) withJob(profile, job);
  return profile;
}

export const freshSession = () => ({ askedThisSession: 0, askedQuick: 0, askedByExperience: {} as Record<string, number>, startedAt: STAMP });

export type StudySpec = {
  degree?: string;
  institution?: string;
  from?: { year: number; month?: number };
  /** `"current"`: still studying — which a study says as its status, not as an end that is "today". */
  to?: { year: number; month?: number } | "current";
  status?: "completed" | "in_progress" | "incomplete";
  /** What the person said stands out of it, one point each. */
  highlights?: string[];
};

/** A study as the form makes it, with the points the person gave it, when they gave any. */
export function withStudy(profile: StoredProfile, spec: StudySpec): StoredEducation {
  const form: EntryForm = {
    ...blankForm("study"),
    what: spec.degree ?? "",
    where: spec.institution ?? "",
    from: spec.from ?? {},
    to: spec.to && spec.to !== "current" ? spec.to : {},
    current: spec.to === "current",
  };
  const id = addEntry(profile, form, { newId, now: STAMP });
  const study = profile.education.find((entry) => entry.id === id)!;
  if (spec.status) study.status = { value: spec.status, status: "confirmed" };
  if (spec.highlights) study.highlights = { value: spec.highlights, status: "edited", source: { kind: "answer", at: STAMP } };
  return study;
}
