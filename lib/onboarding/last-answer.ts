import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { saveDraft } from "./resume";
import { transformStoredProfile } from "@/lib/storage/local";

/**
 * The last thing a person answered, for as long as it can be taken back: what was said of it, in a line, and the profile as it was before.
 *
 * Every answer has a line that says what it did and a way back — «Deshacer» —, wherever it was given: on the next question's card, which is where it
 * was said until now; at the close of a stretch of questions, where the last answer has no next question to be said on; and on the page of an
 * application, where a round is gone as soon as it was answered and what it did would go with it. Those two are handed the answer by the loop that took it
 * (`onExhausted`), and `undoLastAnswer` is how they take it back.
 */
export type LastAnswer = {
  /** What the answer did, as the card said it: «Guardado: vence en mayo de 2028.» */
  receipt: string;
  /** The profile as it was before the answer. */
  before: StoredProfile;
};

/**
 * The profile as it was before an answer. The saved revision keeps counting up: an older copy is written as a newer save, not as a step back in time.
 * With `typed`, the words that answer took out of a box go back into it, to be written again.
 */
export function restoreProfile(before: StoredProfile, typed?: { key: string; text: string } | null): void {
  transformStoredProfile((current) => {
    const restored: StoredProfile = { ...before, rev: current.rev };
    if (typed) saveDraft(restored, typed.key, typed.text);
    return restored;
  });
}

/** «Deshacer», for a screen that was handed the last answer. */
export const undoLastAnswer = (last: Pick<LastAnswer, "before">): void => restoreProfile(last.before);
