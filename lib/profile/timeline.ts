import type { StoredEducation, StoredExperience } from "@/lib/schemas/profile-v2";
import { formatDateValue, monthIndex, type DateValue, type EndDateValue } from "./dates";

/**
 * Putting dated things in the order a CV wants them, and saying the span.
 * Shared by the base CV and by the review, so the two never disagree about which
 * job comes first.
 */

export const CURRENT_LABEL = "Actualidad";

/** "Marzo 2021 – Actualidad", "2013 – 2017", or whichever end is known. */
export function formatRange(start: DateValue, end: EndDateValue): string {
  const from = formatDateValue(start);
  const to = end.current ? CURRENT_LABEL : formatDateValue(end);
  return from && to ? `${from} – ${to}` : from || to;
}

/**
 * Newest first: what is still going, then by when it ended, then by when it
 * began. Undated things go last, in the order they were given — no date is not a
 * reason to move something.
 */
export function byRecency<T>(items: readonly T[], span: (item: T) => { start: DateValue; end: EndDateValue }): T[] {
  return items
    .map((item, index) => {
      const { start, end } = span(item);
      const ended = end.current ? Number.POSITIVE_INFINITY : (monthIndex(end) ?? Number.NEGATIVE_INFINITY);
      const began = monthIndex(start) ?? Number.NEGATIVE_INFINITY;
      return { item, index, ended, began };
    })
    .sort((a, b) => b.ended - a.ended || b.began - a.began || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * The jobs and studies of a profile in the order a CV wants them, whoever is asking: the base CV, the review,
 * the profile's own cards, and what the generators are given. One criterion, so what the person sees listed is
 * what a CV lists.
 */
export const jobsByRecency = <T extends StoredExperience>(jobs: readonly T[]): T[] => byRecency(jobs, (job) => ({ start: job.start.value, end: job.end.value }));

/**
 * A study still being done has no end to read, and is not over: it counts as going on, not as the oldest thing
 * on the list — a degree in progress is the most recent thing a person is doing. One with an expected end
 * keeps it.
 */
export const studiesByRecency = <T extends StoredEducation>(studies: readonly T[]): T[] =>
  byRecency(studies, (entry) => ({
    start: entry.start.value,
    end: entry.status.value === "in_progress" && monthIndex(entry.end.value) === null ? { current: true } : entry.end.value,
  }));
