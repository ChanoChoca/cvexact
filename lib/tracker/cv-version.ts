"use client";

import type { CVDocument } from "@/lib/schemas/cv";

/**
 * De qué CV es "versión" otro, para la métrica estrella del tracker
 * (conversión por versión de CV). Corre en el navegador: el servidor nunca
 * ve el documento, sólo el fingerprint que sale de acá.
 *
 * No es un hash del documento completo — cada CV está adaptado al aviso al
 * que responde, así que dos generaciones del mismo CV base casi nunca son
 * bit a bit iguales (el resumen cambia, el orden de las secciones cambia, el
 * texto de los bullets cambia). Un hash de contenido daría una fila nueva por
 * postulación y la métrica sería puro n=1, inútil.
 *
 * Lo que sí es estable entre adaptaciones de un mismo CV base es *qué
 * experiencias entraron*: las empresas y los roles de la sección de
 * experiencia, en el orden en que aparecen. Dos generaciones que muestran el
 * mismo conjunto de experiencia, aunque una haya reescrito los bullets para
 * un aviso de backend y otra para uno de frontend, son la misma "versión" en
 * el sentido que le importa al usuario: es el mismo currículum de base.
 */
export function cvVersionFingerprint(cv: CVDocument): string {
  const experienceKey = cv.sections
    .filter((section): section is Extract<typeof section, { kind: "experience" }> =>
      section.kind === "experience",
    )
    .flatMap((section) =>
      section.items.map((item) => `${normalize(item.company)}|${normalize(item.role)}`),
    )
    .join(";");

  // Sin experiencia (un CV de perfil junior, por ejemplo) el fingerprint cae
  // en la educación, para no colapsar todos los CVs sin experiencia en una
  // sola "versión" sin sentido.
  const fallbackKey = cv.sections
    .filter((section): section is Extract<typeof section, { kind: "education" }> =>
      section.kind === "education",
    )
    .flatMap((section) => section.items.map((item) => normalize(item.institution)))
    .join(";");

  return fnv1a(experienceKey || fallbackKey || normalize(cv.header.fullName));
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/**
 * FNV-1a de 32 bits. No es criptográfico ni hace falta que lo sea — sólo
 * agrupa fingerprints iguales bajo la misma clave corta, sin traer una
 * dependencia ni usar `node:crypto` desde un módulo de cliente. Exportada
 * porque `lib/cv/review-hash.ts` reutiliza el mismo hasheo de bytes para un
 * propósito distinto (contenido completo, no el fingerprint agrupador de acá).
 */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Etiqueta sugerida para una versión nueva, a partir del rol más reciente en
 *  la sección de experiencia — el usuario puede renombrarla después. */
export function suggestCvVersionLabel(cv: CVDocument): string {
  const experience = cv.sections.find(
    (section): section is Extract<typeof section, { kind: "experience" }> =>
      section.kind === "experience",
  );
  const role = experience?.items[0]?.role?.trim();
  return role ? `CV ${role}` : "CV sin título";
}
