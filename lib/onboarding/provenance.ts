import type { Source, Status } from "@/lib/schemas/profile-v2";

/**
 * How a value's origin is said to the person, in the four words the spec allows
 * plus the one honest description of data that predates provenance.
 *
 * A label says what the person cannot know from having done it: which document a value came from, whether a model read it, that it was there
 * before provenance, that they changed what a document said. What they typed or answered themselves carries none —«Lo dijiste vos» next to a name
 * they just wrote is noise, and so is «Editado por vos» for a value they wrote and then corrected.
 *
 * Something the user edited that came from elsewhere says so, whatever it was before: what they see is
 * their own correction, and "De tu CV" next to a value they changed would be
 * a claim about the wrong thing.
 */
export type ProvenanceTone = "cv" | "linkedin" | "said" | "edited" | "legacy";

export type Provenance = { label: string; tone: ProvenanceTone };

/** What follows the origin when a model, not a pattern, did the reading. */
export const READ_WITH_AI = "leído con IA";

export function provenanceOf(status: Status, source: Source | undefined): Provenance | null {
  if (source?.kind === "manual" || source?.kind === "answer") return null;
  if (status === "edited") return { label: "Editado por vos", tone: "edited" };
  // Said after the origin, and only for a document: what someone typed or answered was not read by anything.
  const how = source?.via === "ai" ? ` · ${READ_WITH_AI}` : "";
  switch (source?.kind) {
    case "cv":
      return { label: `De tu CV${how}`, tone: "cv" };
    case "linkedin_pdf":
    case "linkedin_csv":
      return { label: `De LinkedIn${how}`, tone: "linkedin" };
    case "dump":
      return { label: `Lo dijiste vos${how}`, tone: "said" };
    case "legacy":
      return { label: "Ya estaba en tu perfil", tone: "legacy" };
    default:
      return null;
  }
}
