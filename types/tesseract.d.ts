/**
 * The browser build of tesseract.js is one file with everything it needs inside, and its authors ship no types for it: the ones that describe the package
 * describe the same thing under its main entry, so this says it is that (`lib/ocr/engine.ts` reads it for why that file and not the package's own entry).
 */
declare module "tesseract.js/dist/tesseract.min.js" {
  import type Tesseract from "tesseract.js";
  export const createWorker: typeof Tesseract.createWorker;
  const bundle: typeof Tesseract;
  export default bundle;
}
