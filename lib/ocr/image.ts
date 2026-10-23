import { OcrError } from "./failure";

/**
 * From the file the person chose to the pixels the reader looks at (e5, O18). The photo is opened in this browser and drawn on a canvas that nothing else sees: it is
 * not uploaded, not put in storage and not shown back, and what is drawn is erased as soon as it has been read (`eraseCanvas`). Drawing it is also what takes its
 * metadata off — where it was taken, with what — because only the pixels cross.
 */

/** A photo of a card from a phone is a few megabytes; this is for a file that is not one. */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
/** The longest side of what the reader gets: a phone's 12 megapixels are no more legible than this, and take several times as long. */
export const READ_SIDE = 2000;
/** Under this, there is not enough in the picture to read a date. */
export const MIN_SIDE = 400;

/** The size that fits a side, keeping the shape. It only shrinks: a smaller picture is not made bigger, because that adds no text. */
export function fitWithin(width: number, height: number, side: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= side) return { width, height };
  const scale = side / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function open(file: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== "function") throw new OcrError("unsupported");
  try {
    // A photo from a phone can be stored sideways with a note saying so: it is turned the way the note says.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try {
      return await createImageBitmap(file);
    } catch {
      throw new OcrError("not_image");
    }
  }
}

export async function photoToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  if (file.size > MAX_PHOTO_BYTES) throw new OcrError("big");
  if (file.type && !file.type.startsWith("image/")) throw new OcrError("not_image");
  const bitmap = await open(file);
  try {
    if (Math.max(bitmap.width, bitmap.height) < MIN_SIDE) throw new OcrError("small");
    const { width, height } = fitWithin(bitmap.width, bitmap.height, READ_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new OcrError("unsupported");
    // A picture with transparency would otherwise be read on black.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas;
  } finally {
    bitmap.close?.();
  }
}

/** The photo, gone from memory: a canvas with no size has nothing to hold. */
export function eraseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}
