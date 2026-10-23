import type { DateValue, EndDateValue } from "@/lib/profile/dates";
import { monthIndex } from "@/lib/profile/dates";
import type { StoredExperience } from "@/lib/schemas/profile-v2";
import { companyMatchKey } from "./merge";

/**
 * Jobs one after another at the same employer — a promotion, a change of role — seen as one stretch.
 *
 * Only what stands next to each other in the order a CV lists them: a person who left an employer and came
 * back has two stretches, with whatever they did in between listed between them. The employer is the
 * merge's own idea of one (`companyMatchKey`: legal suffixes, spacing and "(Freelance)" looked past), so
 * what is grouped here is what the merge would have joined had it met them in two documents. A job with no
 * company is never grouped: there is nothing to say it is the same one.
 */

export type EmployerRun<T extends StoredExperience = StoredExperience> = {
  /** The company as the most recent job of the run wrote it. */
  company: string;
  jobs: T[];
};

/** `jobs` in the order a CV lists them (`jobsByRecency`), as runs: each a job, or several at one employer. */
export function employerRuns<T extends StoredExperience>(jobs: readonly T[]): Array<EmployerRun<T>> {
  const runs: Array<EmployerRun<T> & { key: string }> = [];
  for (const job of jobs) {
    const company = job.company.value.trim();
    const key = company ? companyMatchKey(company) : "";
    const last = runs[runs.length - 1];
    if (key && last && last.key === key) last.jobs.push(job);
    else runs.push({ key, company, jobs: [job] });
  }
  return runs.map(({ company, jobs: inRun }) => ({ company, jobs: inRun }));
}

/**
 * The stretch a run covers: from the earliest start any of its jobs has to the latest end — or still going,
 * if any is. A date nobody gave is not guessed; with none at all there is nothing to say.
 */
export function spanOfRun(jobs: readonly StoredExperience[]): { start: DateValue; end: EndDateValue } {
  let start: DateValue = {};
  let end: EndDateValue = {};
  for (const job of jobs) {
    const began = monthIndex(job.start.value);
    if (began !== null && (monthIndex(start) === null || began < monthIndex(start)!)) start = job.start.value;
    if (end.current) continue;
    if (job.end.value.current) {
      end = { current: true };
      continue;
    }
    const ended = monthIndex(job.end.value);
    if (ended !== null && (monthIndex(end) === null || ended > monthIndex(end)!)) end = job.end.value;
  }
  return { start, end };
}
