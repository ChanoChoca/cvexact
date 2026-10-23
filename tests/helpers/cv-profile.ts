import { parseCv } from "@/lib/parse/cv-heuristic";
import { linesFromText } from "@/lib/parse/lines";
import { applyParsedDocument } from "@/lib/parse/to-profile";
import { emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";

let counter = 0;

/** A profile as a CV leaves it the moment it goes in: read by the heuristic parser, nobody has said anything about it yet. */
export function profileFrom(text: string): StoredProfile {
  return applyParsedDocument(
    emptyStoredProfile(),
    parseCv(linesFromText(text)),
    { name: "cv.pdf", fileHash: `h-${text.length}`, pasted: false, chars: 1 },
    { sourceId: "src-1", now: "2026-09-21T12:00:00.000Z", newId: () => `id-${++counter}` },
  ).profile;
}
