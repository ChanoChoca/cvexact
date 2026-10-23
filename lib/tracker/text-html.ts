/**
 * Utilidades de texto compartidas por el parser genérico (`jsonld.ts`) y las
 * reglas de sitio (`site-rules/`) — separadas en su propio módulo para que
 * ninguna de las dos importe de la otra.
 */

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Como `stripHtml`, pero para el texto de una publicación del feed de
 * LinkedIn (`site-rules/linkedin-post.ts`) — ahí, a diferencia de la
 * descripción de un aviso, los saltos de línea importan: es lo único que
 * distingue "Job Title: X" de "Work Location: Y" en líneas separadas para la
 * heurística de título/ubicación, y `stripHtml` los colapsa a un espacio.
 *
 * También saca el botón "… más" (`data-testid="expandable-text-button"`)
 * que LinkedIn deja *dentro* del `<span>` de texto, visible sólo cuando la
 * publicación está colapsada — sin esto, todo `jdText` termina en "… más".
 */
export function stripPostText(html: string): string {
  return html
    .replace(/<button\b[^>]*\bdata-testid="expandable-text-button"[^>]*>[\s\S]*?<\/button>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const EMPLOYMENT_TYPE_ENUM: Record<string, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACTOR: "Contract",
  TEMPORARY: "Temporary",
  INTERN: "Internship",
  VOLUNTEER: "Volunteer",
  PER_DIEM: "Per diem",
  OTHER: "Other",
};

/**
 * schema.org define `employmentType` como texto libre o un enum en
 * MAYÚSCULAS_CON_GUIONES_BAJOS ("FULL_TIME") — algunos sitios (Get on Board)
 * ponen el enum crudo, otros ya mandan texto legible. Normaliza el primer
 * caso al mismo formato de display que ya usan las reglas de sitio
 * ("Full-time"); si no reconoce el valor, lo deja pasar tal cual en vez de
 * descartarlo — puede ser un texto legible en otro idioma.
 */
export function normalizeEmploymentType(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const key = trimmed.toUpperCase().replace(/[\s-]+/g, "_");
  return EMPLOYMENT_TYPE_ENUM[key] ?? trimmed;
}
