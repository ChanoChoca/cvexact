import { weakest, type Confidence, type ParsedDocument } from "./types";

/**
 * A document whose text a model wrote from a photo of it, and that the app's own patterns then read.
 *
 * The patterns would rate a block `high` — and a block rated `high` goes into the profile already confirmed — on the strength
 * of lines that were never in a file: a model read them off a picture, and a date or a figure can be one it misread, which no
 * check against that same text can catch. So it is marked as read with a model, like every document one reads, and nothing in
 * it is rated above `medium`: all of it is proposed, to be looked at, and the review says where it came from (`ImportedSource.photo`).
 */
export function readByAi(parsed: ParsedDocument): ParsedDocument {
  const capped = <T extends { confidence: Confidence }>(block: T): T => ({ ...block, confidence: weakest(block.confidence, "medium") });
  return {
    ...parsed,
    via: "ai",
    confidence: weakest(parsed.confidence, "medium"),
    experience: parsed.experience.map(capped),
    education: parsed.education.map(capped),
  };
}
