import { emptyStoredProfile } from "@/lib/schemas/profile-v2";
import { EXTRACT_CACHE_KEY, SPLIT_CACHE_KEY, clearDumpDraft, transformStoredProfile } from "@/lib/storage/local";
import { writeCollection } from "./stores";

/**
 * "Empezar de nuevo": the profile, and what hangs from it, gone — and nothing else.
 *
 * What hangs from it is what was made of the documents that were read: their originals, kept here to look at beside the
 * review, what a model answered about them, and the text half written in the box of the first step. Left behind they
 * would still be the person's CV, in a browser they had just told to forget it. The applications and the settings are
 * not the profile, and are not touched. The copy of the profile that makes this safe is the caller's to make before
 * it: this does not look back.
 *
 * The profile goes first, and the rest only if it did: a profile the browser refused to empty is still there, and
 * its originals with it.
 */
export function startOver(): boolean {
  // The count of saves keeps counting: an empty profile is a newer save, not a step back in time.
  if (!transformStoredProfile((current) => ({ ...emptyStoredProfile(), rev: current.rev }))) return false;
  writeCollection("sources", {});
  writeCollection(EXTRACT_CACHE_KEY, {});
  writeCollection(SPLIT_CACHE_KEY, {});
  clearDumpDraft();
  return true;
}
