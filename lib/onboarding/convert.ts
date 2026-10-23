import { classifyHeading } from "@/lib/parse/sections";
import type { Unassigned } from "@/lib/schemas/profile-v2";
import type { EntryKind } from "./entries";

/**
 * A section of experience that said what the jobs were and never when has no dates for the reader to
 * cut it at, so all of it lands in "Sin asignar" as one text. There is nothing to rewrite: what is left
 * to do with it is to recognise it for what it is — the body of an experience section, not a stray line —
 * so the review can offer the other reader, the one that is not a pattern.
 */

/** Shorter than this is "Sin experiencia", not a section someone wrote about their jobs. */
const MIN_LEFTOVER = 40;

/** What kind of entry the text of an experience section would make — or `null` for anything else the tray holds. */
export function experienceLeftover(item: Pick<Unassigned, "kind" | "heading">): Extract<EntryKind, "job" | "volunteer"> | null {
  if (item.kind !== "other" || !item.heading) return null;
  const section = classifyHeading(item.heading);
  if (section === "experience") return "job";
  if (section === "volunteer") return "volunteer";
  return null;
}

/** Whether this is the body of an experience section — long enough to be one — that was left whole in the tray. */
export const isExperienceLeftover = (item: Pick<Unassigned, "kind" | "heading" | "text">): boolean =>
  experienceLeftover(item) !== null && item.text.trim().length >= MIN_LEFTOVER;
