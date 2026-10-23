/**
 * What a photo of a CV may weigh by the time it travels: the browser makes it smaller first (`photo.ts`), and the route refuses
 * what is bigger than any reasonable result of that — base64 characters, for a request that is JSON like every other.
 */
export const MAX_PHOTO_BASE64 = 6_000_000;

/** The longest side of the picture that is sent, in pixels: letters are still letters at this size, and a photo is not a megabyte more. */
export const PHOTO_MAX_SIDE = 2000;

/** The largest file the browser agrees to open as a photo: past this it is not a photo of a page. */
export const MAX_PHOTO_FILE_BYTES = 25 * 1024 * 1024;
