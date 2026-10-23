import { normalizeForComparison } from "@/lib/text/normalize";
import type { ParsedDocument, ParsedEducation, ParsedExperience, Quoted } from "./types";
import type { DateValue, EndDateValue } from "@/lib/profile/dates";

/**
 * Two readers that agree. A document read with a model and read again by the app's own patterns — independent of each other, one
 * reading letters and the other reading a model's words about them — and a block that both make the same: the same company and
 * role, and the same start. That is as much as can be said without a person looking, and it is not much: two readers can share a
 * mistake, which is why a model's reading is marked medium today and nothing here changes that.
 *
 * What this is for is the day it is known to be safe: a block of which both readers say the same could be given as good, and the
 * review would mark fewer of them. That is `ENGINE.aiReading.trustAgreement`, and it is off: this is the rule, tested, and not
 * a behaviour. See M14 in the internal experience analysis: measure before relaxing.
 */

const same = (a: Quoted<string> | undefined, b: Quoted<string> | undefined): boolean => {
  if (!a || !b) return false;
  const left = normalizeForComparison(a.value);
  return left !== "" && left === normalizeForComparison(b.value);
};

const sameStart = (a: Quoted<DateValue> | undefined, b: Quoted<DateValue> | undefined): boolean => a?.value.year !== undefined && a.value.year === b?.value.year && a.value.month === b?.value.month;

const sameEnd = (a: Quoted<EndDateValue> | undefined, b: Quoted<EndDateValue> | undefined): boolean => {
  if (a?.value.current || b?.value.current) return Boolean(a?.value.current) && Boolean(b?.value.current);
  return a?.value.year === b?.value.year && a?.value.month === b?.value.month;
};

/** A job the patterns read as well: the same company and role, the same start, and the same end — or both still going. */
export function jobsAgree(ai: ParsedExperience, patterns: readonly ParsedExperience[]): boolean {
  return patterns.some((other) => same(ai.company, other.company) && same(ai.role, other.role) && sameStart(ai.start, other.start) && sameEnd(ai.end, other.end));
}

/** A study the patterns read as well: the same institution and degree, and the same start and end. */
export function studiesAgree(ai: ParsedEducation, patterns: readonly ParsedEducation[]): boolean {
  return patterns.some((other) => same(ai.institution, other.institution) && same(ai.degree, other.degree) && sameStart(ai.start, other.start) && sameEnd(ai.end, other.end));
}

/**
 * `ai` with the blocks both readers agree on rated `high`, and the rest left as they were. Never lowers a block, and never
 * touches one the patterns could not read: no second reader, no agreement.
 */
export function trustAgreeing(ai: ParsedDocument, patterns: ParsedDocument | null): ParsedDocument {
  if (!patterns) return ai;
  return {
    ...ai,
    experience: ai.experience.map((job) => (jobsAgree(job, patterns.experience) ? { ...job, confidence: "high" as const, doubts: [] } : job)),
    education: ai.education.map((entry) => (studiesAgree(entry, patterns.education) ? { ...entry, confidence: "high" as const, doubts: [] } : entry)),
  };
}
