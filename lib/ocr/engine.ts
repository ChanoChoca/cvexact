import { OcrError } from "./failure";

/**
 * The reader of a photo, in this browser (e5, O18).
 *
 * `tesseract.js` runs in a Web Worker and, left to itself, fetches its three pieces — the worker, the engine it runs and the Spanish language data — from a CDN.
 * None of that may happen here: the page's content policy names no third party for scripts or requests, and a script from outside would run in the page that holds the
 * profile. None of it is needed either: `scripts/copy-ocr.mjs` puts the three in `public/ocr/` and this points the library at them, as `scripts/copy-ort-wasm.mjs`
 * does for the ONNX runtime. The photo goes from the page to the worker in the browser's memory, and the text comes back the same way: no request carries either, and nothing
 * is stored — `cacheMethod: "none"` keeps even the language data out of IndexedDB.
 *
 * The library is the one file its authors bundle for a browser (`dist/tesseract.min.js`, a UMD with everything inside) and not its package entry: that entry is the Node source and
 * relies on a bundler choosing the browser's version of half of it, which is a guess that this file has no need to make. (Not the `.esm.min.js` beside it: that one has `export`
 * in a package that does not say it is a module, and Turbopack refuses it.)
 *
 * Nothing here knows what the text is for: `credential.ts` takes from it what the profile keeps.
 */

export const OCR_DIR = "/ocr";
export const OCR_WORKER = `${OCR_DIR}/worker.min.js`;
/** The engine in its two forms: with the WebAssembly SIMD instructions, which most browsers have and read faster, and without. Each reads with the neural network only. */
export const OCR_CORE_SIMD = `${OCR_DIR}/tesseract-core-simd-lstm.wasm.js`;
export const OCR_CORE_PLAIN = `${OCR_DIR}/tesseract-core-lstm.wasm.js`;
export const OCR_LANG = "spa";
/** About what the browser fetches the first time, in megabytes: the worker (0.1), the engine (3.7) and the language (2.0). Said before it is asked for. */
export const OCR_DOWNLOAD_MB = 6;

/** The neural network only (`OEM.LSTM_ONLY`): the only engine that was copied, and the one the small language data is made for. */
const OEM_LSTM_ONLY = 1;
/** Sparse text (`PSM.SPARSE_TEXT`): find all the text there is, in no order: a card has its words in boxes here and there, not in columns. */
const PAGE_SEGMENTATION = "11";
/** What a picture drawn on a canvas does not say about itself: its resolution. Without it the engine guesses, and says so in the console every time. */
const RESOLUTION = "300";

/** A tiny WebAssembly module that uses a SIMD instruction: it validates only where the browser has them. */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

export function hasSimd(): boolean {
  try {
    return typeof WebAssembly === "object" && WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

export const corePath = (simd: boolean = hasSimd()): string => (simd ? OCR_CORE_SIMD : OCR_CORE_PLAIN);

/** Whether this browser can run a worker and WebAssembly, which is what the reader is. */
export const canRead = (env: { Worker?: unknown; WebAssembly?: unknown } = globalThis): boolean => typeof env.Worker === "function" && typeof env.WebAssembly === "object";

export type OcrImage = HTMLCanvasElement | OffscreenCanvas | Blob;

export type OcrProgress =
  /** Making the reader ready: the first time it downloads its files. No fraction: the library does not say how far. */
  | { stage: "preparing"; fraction: null }
  /** Reading the photo, from 0 to 1. */
  | { stage: "reading"; fraction: number };

/** The slice of the library's worker that this uses, so that a test can stand one in. */
export type OcrWorker = {
  setParameters(params: Record<string, string>): Promise<unknown>;
  recognize(image: OcrImage, options?: Record<string, never>, output?: { text: boolean }): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
};

export type OcrWorkerOptions = {
  workerPath: string;
  corePath: string;
  langPath: string;
  gzip: boolean;
  cacheMethod: string;
  workerBlobURL: boolean;
  logger: (message: { status?: string; progress?: number }) => void;
  errorHandler: (error: unknown) => void;
};

export type CreateWorker = (langs: string, oem: number, options: OcrWorkerOptions) => Promise<OcrWorker>;

export type OcrOptions = {
  onProgress?: (progress: OcrProgress) => void;
  /** Stops the reading: the worker is ended and the photo is not looked at again. */
  signal?: AbortSignal;
  /** The library's `createWorker`. Tests give theirs. */
  create?: CreateWorker;
};

async function loadCreateWorker(): Promise<CreateWorker> {
  const loaded = await import("tesseract.js/dist/tesseract.min.js");
  // A bundler hands a CommonJS file's exports as `default`, and some as the namespace too.
  const library = loaded.default ?? loaded;
  return library.createWorker as unknown as CreateWorker;
}

/** What the library says about how far it is, as far as the person is concerned: there is the wait for the reader, and then the reading. */
export function progressOf(message: { status?: string; progress?: number }): OcrProgress {
  if (message.status === "recognizing text" && typeof message.progress === "number") {
    return { stage: "reading", fraction: Math.min(1, Math.max(0, message.progress)) };
  }
  return { stage: "preparing", fraction: null };
}

/** Ends a worker and does not wait for it, and does not mind that it is already gone. */
function end(worker: OcrWorker): void {
  try {
    void Promise.resolve(worker.terminate()).catch(() => {});
  } catch {
    // Already gone.
  }
}

/**
 * The text an OCR reads in a photo. The worker is made for this one photo and ended when it is read, whatever happened — a reader left running would be holding it —
 * and the text is returned to whoever asked and to nobody else: it is not logged here and not kept. The first call in a browser downloads the reader's files from this
 * site; the browser's own cache keeps them for the next.
 */
export async function readText(image: OcrImage, options: OcrOptions = {}): Promise<string> {
  const { signal, onProgress } = options;
  if (signal?.aborted) throw new OcrError("aborted");
  if (!options.create && !canRead()) throw new OcrError("unsupported");

  let worker: OcrWorker | null = null;
  let creating: Promise<OcrWorker> | null = null;
  // The worker reporting an error, or the person stopping it, ends the wait for whatever is being awaited.
  let interrupt: (error: OcrError) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    interrupt = reject;
  });
  interrupted.catch(() => {});
  const onAbort = () => interrupt(new OcrError("aborted"));
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const create = options.create ?? (await loadCreateWorker());
    if (signal?.aborted) throw new OcrError("aborted");
    creating = create(OCR_LANG, OEM_LSTM_ONLY, {
      workerPath: OCR_WORKER,
      corePath: corePath(),
      langPath: OCR_DIR,
      gzip: true,
      cacheMethod: "none",
      workerBlobURL: false,
      logger: (message) => onProgress?.(progressOf(message)),
      errorHandler: () => interrupt(new OcrError(worker ? "read" : "engine")),
    });
    worker = await Promise.race([creating, interrupted]);
    await Promise.race([worker.setParameters({ tessedit_pageseg_mode: PAGE_SEGMENTATION, user_defined_dpi: RESOLUTION }), interrupted]);
    const { data } = await Promise.race([worker.recognize(image, {}, { text: true }), interrupted]);
    return typeof data?.text === "string" ? data.text : "";
  } catch (error) {
    throw error instanceof OcrError ? error : new OcrError(worker ? "read" : "engine");
  } finally {
    signal?.removeEventListener("abort", onAbort);
    // Ended whatever happened; and one that was still being made is ended when it is done.
    if (worker) end(worker);
    else void creating?.then(end, () => {});
  }
}
