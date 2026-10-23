import { mergedMonths, roleSpans } from "@/lib/ai/evidence";
import { meaningfulExperience, type Profile } from "@/lib/schemas/profile";

/**
 * How many A4 sheets a CV may take. One is the product's promise and the default; a long career may ask for two.
 *
 * Said by the person, per application — never by the model and never from the dates alone: the dates only decide whether the choice is
 * offered. Pure and free of the DOM, so the prompt, the fit and the screens agree on what the numbers mean.
 */
export type Sheets = 1 | 2;

/** Ten years of work: where a second sheet stops being padding and starts being what a career takes to tell. */
export const TWO_SHEETS_FROM_MONTHS = 120;

/** Whether the person's dates add up to enough work for «Permitir 2 hojas» to be offered. Overlap counts once, and a job whose dates cannot be read adds nothing. */
export function canAllowTwoSheets(profile: Profile, now: Date = new Date()): boolean {
  return mergedMonths(roleSpans({ ...profile, experience: meaningfulExperience(profile) }, now)) >= TWO_SHEETS_FROM_MONTHS;
}
