"use client";

import { MAX_PHOTO_BASE64, MAX_PHOTO_FILE_BYTES, PHOTO_MAX_SIDE } from "./photo-limits";

/**
 * A photo or a scan of a CV, made ready to travel to the person's own model (`lib/onboarding/ai.ts#transcribeWithAi`).
 *
 * Made smaller, and written again as a JPEG, in the browser and before anything leaves it. The first is for the connection and
 * for what a model takes in: a phone's photo is several megabytes and the letters on a page are as legible at two thousand pixels
 * on its longest side. The second has a consequence worth having: a picture drawn on a canvas and saved again carries none of the
 * metadata it was taken with — where, when and with what — so that does not go along with it.
 */

/** The size a picture is drawn at: its own, or its longest side brought down to `max`, keeping its proportions. Pure. */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > max)) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** A photo that cannot be made ready, with the sentence that says why and what to do. */
export class PhotoError extends Error {}

const OPEN_FAILED = "No pudimos abrir esa imagen en tu navegador. Probá con una captura de pantalla o con una foto en JPG o PNG.";

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new PhotoError(OPEN_FAILED));
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export async function preparePhoto(file: File): Promise<{ base64: string; mediaType: "image/jpeg" }> {
  if (file.size > MAX_PHOTO_FILE_BYTES) throw new PhotoError("Esa imagen pesa demasiado para ser la foto de una hoja. Probá con una captura o con una foto más liviana.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new PhotoError(OPEN_FAILED);
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new PhotoError(OPEN_FAILED);
    // A PNG with transparency would come out black as a JPEG: a page is white.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new PhotoError(OPEN_FAILED);
    const base64 = await toBase64(blob);
    if (base64.length > MAX_PHOTO_BASE64) throw new PhotoError("Esa imagen sigue pesando demasiado después de achicarla. Probá con una foto de una sola hoja, más cerca.");
    return { base64, mediaType: "image/jpeg" };
  } finally {
    bitmap.close();
  }
}
