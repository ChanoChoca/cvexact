import { INTERVIEW_ASKED_KEY, readRaw, write } from "./local";

/**
 * Which applications were asked what they were asked at the interview (O12): once for each, whatever was answered, and not again if the status goes to
 * «entrevista», back, and to «entrevista» again. Kept in this browser, apart from the profile and from the applications — it is not synced and not
 * in a copy — and small: the last few hundred, since an application that old is not going to be moved to an interview.
 */

const KEEP = 300;

type Asked = Record<string, string>;

function read(): Asked {
  const raw = readRaw(INTERVIEW_ASKED_KEY);
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

export const wasInterviewAsked = (applicationId: string): boolean => applicationId in read();

/** It was asked, now. A browser that cannot remember it asks once more, which is the worst that can happen. */
export function markInterviewAsked(applicationId: string, now = new Date()): void {
  try {
    const entries = Object.entries({ ...read(), [applicationId]: now.toISOString() }).sort((a, b) => a[1].localeCompare(b[1]));
    write(INTERVIEW_ASKED_KEY, Object.fromEntries(entries.slice(-KEEP)));
  } catch {
    // Nothing worse than being asked once more.
  }
}
