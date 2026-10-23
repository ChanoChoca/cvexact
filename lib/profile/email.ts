/**
 * Whether what was read or typed as an email looks like one — to say so beside the field, never to
 * refuse it. An address a document had, or a person typed, is theirs to keep; a browser's own check
 * on a form that stops "Seguir" without saying why is worse than one line under the box.
 */
const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** `null` when it is empty or looks fine; otherwise what to tell the person. */
export function emailProblem(value: string): string | null {
  const email = value.trim();
  if (!email || SHAPE.test(email)) return null;
  return "No parece un correo: revisá el @ y el dominio (por ejemplo, nombre@correo.com).";
}
