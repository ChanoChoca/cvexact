import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { confirmFieldAt } from "./edit";

/**
 * «Sí, sigo»: the person says a job that is going on is still going on. Nothing in it changes; the day they last stood behind what it is
 * — its company, its role, when it began, that it has not ended — does, and that is what the next «¿Seguís en…?» counts from
 * (`currentJobReviews`). The lines told of the job are not stamped: they were not asked about, and saying the job goes on is not saying
 * each of them is still so. A field the job does not have, or has empty, says nothing and is passed over.
 */
const JOB_FIELDS = ["company", "role", "city", "country", "start", "end", "employmentType", "workMode"] as const;

export function standBehindJob(draft: StoredProfile, jobId: string, now: string): boolean {
  const job = draft.experience.find((entry) => entry.id === jobId);
  if (!job) return false;
  for (const key of JOB_FIELDS) confirmFieldAt(draft, ["experience", jobId, key], now);
  return true;
}
