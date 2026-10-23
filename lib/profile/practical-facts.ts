import { normalizeForComparison } from "@/lib/text/normalize";
import type { Profile } from "@/lib/schemas/profile";

/**
 * The practical facts a CV or a job posting states in a label-and-value shape:
 * availability, a driving licence, work eligibility, a vehicle, willingness to
 * relocate.
 *
 * Kept dependency-free (no `lib/ai/*`) so the deterministic CV parser can read
 * a line like "Disponibilidad: Full time, Part time" into `profile.practical`
 * without pulling the AI layer into the onboarding bundle — see
 * `lib/parse/cv-heuristic.ts`'s `parsePairs`. `lib/ai/practical.ts` re-exports
 * everything here for its own, larger use: requiring these facts verbatim in a
 * generated CV and imposing them on the result. See that file for why they
 * matter enough to be worth a fixed list rather than left to the model.
 */

export type PracticalFact = {
  field: keyof Profile["practical"];
  /**
   * `text` fields carry a value worth copying. `flag` fields are booleans, and a
   * boolean has no text to copy.
   */
  kind: "text" | "flag";
  /**
   * Matches the label of a row — a CV's pairs section, or a line this app's own
   * parser read as "label: value" — e.g. "Disponibilidad". Tested against a
   * normalised label, so no accents and no case.
   */
  label: RegExp;
  /**
   * Matches a job posting's way of asking about this fact, which is a different
   * vocabulary from the label above: a CV row says "Disponibilidad", an ad says
   * "disponibilidad de jueves a domingo", "turno noche", "fines de semana".
   */
  asks: RegExp;
  /** How a finding names it to the user, mid-sentence and in Spanish. */
  what: string;
};

/**
 * Checked in the direction that survives translation and elaboration — the
 * profile's own value has to appear inside what was written, not the reverse —
 * so "B1 (vehículo propio)" passes against a profile stating "B1", and "Jueves a
 * domingo" does not pass against one stating "Full time, Part time".
 *
 * Certifications and languages are deliberately absent: their values are the
 * ones a document or an output language legitimately rewrites ("Avanzado" →
 * "Advanced"), unlike these five.
 */
export const PRACTICAL_FACTS: readonly PracticalFact[] = [
  {
    field: "availability",
    kind: "text",
    label: /disponibilidad|availability|horario|jornada|schedule|shift|turnos/,
    asks: /disponibilidad|availability|horario|jornada|schedule|shift|turno|turnos|full time|part time|medio tiempo|tiempo completo|fin(es)? de semana|weekend|sabado|sabados|domingo|domingos|noche|nocturno|rotativo/,
    what: "tu disponibilidad",
  },
  {
    // Not "registro" on its own: it labels plenty of things that are not a
    // driving licence, and matching one would compare it against the wrong
    // profile field.
    field: "driverLicense",
    kind: "text",
    label: /licencia|carnet|licen[cs]e/,
    asks: /licencia de conducir|licencia de manejo|carnet de conducir|registro de conducir|driver'?s? licen[cs]e|driving licen[cs]e/,
    what: "tu licencia de conducir",
  },
  {
    field: "workEligibility",
    kind: "text",
    label: /elegibilidad|eligibilidad|eligibility|ciudadan|citizenship|permiso de trabajo/,
    asks: /ciudadan|citizenship|permiso de trabajo|work permit|autorizacion para trabajar|work authorization|residencia legal|eligible to work/,
    what: "tu situación laboral",
  },
  {
    field: "ownVehicle",
    kind: "flag",
    label: /movilidad|vehiculo|veh[ií]culo|auto propio|own vehicle|transporte propio/,
    asks: /movilidad propia|vehiculo propio|auto propio|moto propia|own vehicle|own transport|medio de transporte propio/,
    what: "si tenés vehículo propio",
  },
  {
    field: "willingToRelocate",
    kind: "flag",
    label: /relocaci|reubicaci|mudar|traslad|relocat/,
    asks: /relocaci|reubicaci|mudarse|mudanza|disponibilidad para trasladarse|willing(ness)? to relocate|relocation/,
    what: "si estás dispuesto a mudarte",
  },
];

/** The fact a label refers to, or `undefined` when it refers to none. */
export function practicalFactFor(label: string): PracticalFact | undefined {
  const normalised = normalizeForComparison(label);
  return PRACTICAL_FACTS.find((fact) => fact.label.test(normalised));
}

/** Whether nothing practical has been said at all: no availability, licence, permit, vehicle or wish to move. */
export function isPracticalEmpty(practical: Profile["practical"]): boolean {
  return !practical.availability.trim() && !practical.driverLicense.trim() && !practical.workEligibility.trim() && !practical.ownVehicle && !practical.willingToRelocate;
}

/** What was said about how the person can work, on one line — "Tiempo completo · Licencia B1 · Vehículo propio" — or nothing. */
export function describePractical(practical: Profile["practical"]): string {
  return [
    practical.availability.trim(),
    practical.driverLicense.trim() ? `Licencia ${practical.driverLicense.trim()}` : "",
    practical.workEligibility.trim() ? `Permiso: ${practical.workEligibility.trim()}` : "",
    practical.ownVehicle ? "Vehículo propio" : "",
    practical.willingToRelocate ? "Puede mudarse" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
