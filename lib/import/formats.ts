/**
 * Which files the app can read, and what to say about the ones it cannot.
 *
 * A file that is refused is a person who brought something and is told no, and "no" is worth a sentence of its own:
 * one message for every format sent someone with a `.doc`, a Pages file or a photo of their CV to the same line, and
 * not one of them could tell from it what to do next. Each has an exit that is a few clicks away — save it as a PDF,
 * export it from Pages, copy the text out of the photo — and this says which.
 *
 * Pure, so the wording is tested without a browser; `extract.ts` reads what these accept.
 */

export type FileKind = "pdf" | "docx" | "txt" | "zip";

type NamedFile = { name: string; type: string };

const PDF_TYPES = ["application/pdf"];
const DOCX_TYPES = ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const TXT_TYPES = ["text/plain"];
const ZIP_TYPES = ["application/zip", "application/x-zip-compressed", "application/x-zip"];

const extensionOf = (name: string): string => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";

/**
 * By extension as well as MIME type: a file dragged out of some mail clients arrives as application/octet-stream,
 * and refusing a .pdf because the browser declined to name it would be incomprehensible to the user.
 */
export function kindOfFile(file: NamedFile): FileKind | null {
  const extension = extensionOf(file.name);
  if (PDF_TYPES.includes(file.type) || extension === "pdf") return "pdf";
  if (DOCX_TYPES.includes(file.type) || extension === "docx") return "docx";
  if (TXT_TYPES.includes(file.type) || extension === "txt") return "txt";
  if (ZIP_TYPES.includes(file.type) || extension === "zip") return "zip";
  return null;
}

/**
 * A copy of the profile the person made with «Bajar una copia»: a `.json`. Where a file is brought to be read — the empty start — it is not read as a CV but
 * recovered, and a person who lost their profile is the one most likely to be there with it.
 */
export const isCopyFile = (file: NamedFile): boolean => extensionOf(file.name) === "json" || file.type === "application/json";

/** A photo or a screenshot: it holds a picture of letters, not letters. */
export const isPhoto = (file: NamedFile): boolean =>
  file.type.startsWith("image/") || /^(jpe?g|png|heic|heif|webp|gif|bmp|tiff?|avif)$/.test(extensionOf(file.name));

/**
 * The most a file may weigh to be read in the browser, per kind. A CV is well under a megabyte and a data export
 * of just the profile a few; past these the tab is the one that pays, and it is not a CV anyway.
 */
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_ZIP_BYTES = 100 * 1024 * 1024;

export type Refusal = { reason: "unsupported" | "photo" | "too_large"; message: string };

const SAVE_AS = "guardalo como PDF o como .docx";

/** What to say about a format by name, where it is a common one with a known way out. */
const BY_EXTENSION: Readonly<Record<string, string>> = {
  doc: `Ese archivo es un Word antiguo (.doc), que no sabemos leer. Abrilo en Word y ${SAVE_AS}; o pegá el texto.`,
  odt: `Ese archivo es de OpenOffice o LibreOffice (.odt), que no sabemos leer. Desde ahí, ${SAVE_AS}; o pegá el texto.`,
  rtf: `Ese archivo es de texto enriquecido (.rtf), que no sabemos leer. Abrilo en tu procesador de texto y ${SAVE_AS}; o pegá el texto.`,
  pages: "Ese archivo es de Pages, que no sabemos leer. En Pages: Archivo → Exportar a → PDF (o Word), y subí ese archivo; o pegá el texto.",
  gdoc: "Ese archivo es un acceso directo a Google Docs, que no tiene el texto adentro. En Google Docs: Archivo → Descargar → PDF o Word (.docx); o pegá el texto.",
  // The file someone is most likely to bring by mistake: the copy of their own profile, which is restored, not read as a CV.
  json: "Ese archivo no es un CV. Si es una copia de tu perfil de cvexact, se recupera con «Recuperar una copia», al empezar, en tu perfil o con «Introducir perfil», en Ajustes.",
};

const PHOTO =
  "Eso es una foto, y una foto no tiene letras que podamos leer. Muchos teléfonos permiten copiar el texto de una foto (en iPhone, mantené el dedo sobre el texto; en Android, probá con Google Lens). Después, pegalo acá.";

const megabytes = (bytes: number) => {
  const value = bytes / (1024 * 1024);
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(".", ",");
};

function tooLarge(size: number, kind: FileKind, limit: number): string {
  if (kind === "zip") {
    return `Ese ZIP pesa ${megabytes(size)} MB y el máximo que leemos en tu navegador es ${megabytes(limit)} MB. En LinkedIn pedí solo los datos del perfil, que pesan mucho menos; o subí el PDF de tu perfil.`;
  }
  return `Ese archivo pesa ${megabytes(size)} MB y el máximo que leemos en tu navegador es ${megabytes(limit)} MB. Un CV suele pesar menos de 1 MB: si tiene imágenes grandes, ${SAVE_AS} de nuevo, más liviano; o pegá el texto.`;
}

/**
 * Whether this file can be read at all, and if not, why and what to do. `null` means it can: its kind is one the
 * app reads and it is not too big for the browser that has to read it.
 */
export function refusalFor(file: NamedFile & { size: number }): Refusal | null {
  const kind = kindOfFile(file);
  if (!kind) {
    if (isPhoto(file)) return { reason: "photo", message: PHOTO };
    const known = BY_EXTENSION[extensionOf(file.name)];
    return {
      reason: "unsupported",
      message: known ?? `Ese tipo de archivo no lo podemos leer. Leemos PDF, Word (.docx), texto (.txt) y el ZIP de datos de LinkedIn: ${SAVE_AS}, o pegá el texto.`,
    };
  }
  const limit = kind === "zip" ? MAX_ZIP_BYTES : kind === "txt" ? MAX_TEXT_BYTES : MAX_DOCUMENT_BYTES;
  return file.size > limit ? { reason: "too_large", message: tooLarge(file.size, kind, limit) } : null;
}
