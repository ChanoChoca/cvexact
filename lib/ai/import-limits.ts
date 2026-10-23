/**
 * How much text one reading takes, and what to say when there is too little or too much.
 *
 * The route that reads a document with a model accepts a text between a floor and a ceiling, and said the same thing
 * about both when it was refused — «no pudimos leer suficiente texto» — which is the wrong sentence for a twenty-page
 * document: it has more than enough, and the way out is the opposite of the one a short text has. The numbers live
 * here so that the route, which enforces them, and the screen, which can say so before spending a call, agree.
 */

/** Under this it is not a CV nor a real answer. */
export const IMPORT_TEXT_MIN = 40;

/** Over this the prompt costs more than the extraction it wraps, and it is not one document. */
export const IMPORT_TEXT_MAX = 40000;

/** The sentence for a text the reading cannot take, or `null` when it can. */
export function importTextProblem(text: string): string | null {
  const length = text.length;
  if (length < IMPORT_TEXT_MIN) return "Ese texto es muy corto para que la IA lo lea. Escribí o pegá un poco más.";
  if (length > IMPORT_TEXT_MAX) {
    return `Ese documento tiene más texto del que la IA puede leer de una vez (más de ${IMPORT_TEXT_MAX.toLocaleString("es-AR")} caracteres). Pegá solo la parte con tu experiencia y tus estudios.`;
  }
  return null;
}
