/**
 * Where each part of the profile can be jumped to: the ids of the hub's sections, shared by whatever points at
 * one — "Escribirlo" under "Falta tu nombre", "Ubicar" under the texts with no place, "Verlo en…" under what the
 * CV leaves out. Spelled once so a link and the section it names cannot drift apart.
 */
export const SECTION_ID = {
  review: "para-revisar",
  tasks: "para-hacer",
  contact: "contacto",
  experience: "experiencia",
  education: "estudios",
  skills: "habilidades",
  projects: "proyectos",
  other: "otros-datos",
  unplaced: "sin-asignar",
} as const;

/**
 * A section brought into view stops under the fixed header and the bar of sections, not behind them. Written out
 * whole here because Tailwind reads classes from source, and builds none it has not seen spelled.
 */
export const ANCHOR = "scroll-mt-[calc(var(--nav-h)+4rem)]";
