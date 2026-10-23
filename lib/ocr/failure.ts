/**
 * Why a photo was not read (e5, O18), and what the person is told. A failure is never the person's fault and never leaves them without a way on: every text
 * ends where they can type the class and the date themselves, which is what this was a shortcut for.
 */

export type OcrFailure =
  /** The browser has no way to run the reader (no Web Workers, no WebAssembly). */
  | "unsupported"
  /** The reader could not be made ready: its files did not arrive, or the browser stopped it. */
  | "engine"
  /** The reader was ready and failed on this photo. */
  | "read"
  /** The person stopped it. */
  | "aborted"
  /** The file is larger than a photo of a card ever is. */
  | "big"
  /** The file is not an image the browser can open. */
  | "not_image"
  /** The image is too small to have anything readable in it. */
  | "small";

export class OcrError extends Error {
  readonly reason: OcrFailure;
  constructor(reason: OcrFailure) {
    super(reason);
    this.name = "OcrError";
    this.reason = reason;
  }
}

export const OCR_FAILURE: Record<OcrFailure, string> = {
  unsupported: "Este navegador no puede leer fotos. Escribí la clase y la fecha a mano.",
  engine: "No pudimos preparar el lector de fotos. Revisá tu conexión y probá de nuevo, o escribí los datos a mano.",
  read: "No pudimos leer esa foto. Probá con otra, con más luz y sin reflejos, o escribí los datos a mano.",
  aborted: "Cancelaste la lectura. No se guardó nada.",
  big: "Esa foto pesa demasiado para ser la de una credencial. Probá con otra.",
  not_image: "No pudimos abrir ese archivo como una foto. Elegí una imagen (JPG, PNG o parecida).",
  small: "Esa imagen es muy chica para leerla. Sacala más cerca, con la credencial llenando la foto.",
};

export const ocrFailureOf = (error: unknown): OcrFailure => (error instanceof OcrError ? error.reason : "read");
