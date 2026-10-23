/**
 * Names for the files the user takes away. Shared by the .docx download, which
 * is built in the browser, and the PDF route, which builds it on the server —
 * so a CV and its Word version arrive named the same way.
 *
 * No `server-only` here on purpose: both sides import it.
 */

/** Trims what Windows, macOS and Linux all refuse inside a filename. */
export function sanitizeFilenamePart(part: string): string {
  return part
    .replace(/[/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Joins the parts that have something in them, e.g. "CV - Ana Pérez - Cajera". */
export function documentFilename(parts: string[], extension: string): string {
  const name = parts.map(sanitizeFilenamePart).filter(Boolean).join(" - ");
  // 120 chars leaves room for the extension under every filesystem's limit.
  return `${name.slice(0, 120)}.${extension}`;
}

/** The role of an application's label, which reads «título · empresa»: the company is where the CV is sent, not what it says. */
export function cvRole(label: string): string {
  return (label.split(" · ")[0] ?? "").trim();
}

/** «Desarrollador/a Mobile (Junior)» as «DesarrolladorMobile»: no accents, symbols, gender endings or parentheses, one word per part. */
function camelCase(text: string): string {
  return text
    .replace(/\([^)]*\)/g, " ")
    .replace(/\/(?:r?as?|es)(?![\p{L}\p{N}])/giu, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join("");
}

/** The name a CV is taken away under, `NombreApellido-Rol.pdf`: what a recruiter's folder reads, without the employer it is sent to. */
export function cvFilename(fullName: string, label: string, extension: string): string {
  const name = [camelCase(fullName), camelCase(cvRole(label))].filter(Boolean).join("-");
  return `${name.slice(0, 60) || "CV"}.${extension}`;
}
