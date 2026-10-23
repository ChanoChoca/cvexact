import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OCR_CORE_PLAIN,
  OCR_CORE_SIMD,
  OCR_DIR,
  OCR_DOWNLOAD_MB,
  OCR_LANG,
  OCR_WORKER,
  canRead,
  corePath,
  hasSimd,
  progressOf,
  readText,
  type CreateWorker,
  type OcrProgress,
  type OcrWorker,
  type OcrWorkerOptions,
} from "@/lib/ocr/engine";
import { OCR_FAILURE, OcrError, ocrFailureOf } from "@/lib/ocr/failure";
import { MAX_PHOTO_BYTES, eraseCanvas, fitWithin, photoToCanvas } from "@/lib/ocr/image";

/**
 * The reader of a photo (e5, O18) with a worker that is made up: what it is told to load and from where, that it is ended whatever happens, that it can be stopped, and
 * that nothing here goes to the network or to the log. The real one is tried in the browser (`e2e-pt9`).
 */

const root = join(__dirname, "..");
const IMAGE = {} as unknown as HTMLCanvasElement;

type Fake = { worker: OcrWorker; options: OcrWorkerOptions | null; terminated: number; recognized: unknown[]; parameters: Array<Record<string, string>>; create: CreateWorker; calls: Array<[string, number]> };

/** A worker that reads `text`, and the record of what it was asked. */
function fake(behaviour: { text?: string; recognize?: () => Promise<{ data: { text: string } }>; setParameters?: () => Promise<unknown>; create?: () => Promise<void> } = {}): Fake {
  const state = {
    options: null as OcrWorkerOptions | null,
    terminated: 0,
    recognized: [] as unknown[],
    parameters: [] as Array<Record<string, string>>,
    calls: [] as Array<[string, number]>,
  };
  const worker: OcrWorker = {
    setParameters: async (params) => {
      state.parameters.push(params);
      return behaviour.setParameters ? behaviour.setParameters() : undefined;
    },
    recognize: async (image, options, output) => {
      state.recognized.push([image, options, output]);
      return behaviour.recognize ? behaviour.recognize() : { data: { text: behaviour.text ?? "" } };
    },
    terminate: async () => {
      state.terminated += 1;
    },
  };
  const create: CreateWorker = async (langs, oem, options) => {
    state.calls.push([langs, oem]);
    state.options = options;
    if (behaviour.create) await behaviour.create();
    return worker;
  };
  return {
    worker,
    create,
    get options() {
      return state.options;
    },
    get terminated() {
      return state.terminated;
    },
    get recognized() {
      return state.recognized;
    },
    get parameters() {
      return state.parameters;
    },
    get calls() {
      return state.calls;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("where the reader comes from", () => {
  it("is this site and nowhere else: the worker, the engine and the language are all under /ocr", () => {
    for (const path of [OCR_WORKER, OCR_CORE_SIMD, OCR_CORE_PLAIN]) expect(path.startsWith(`${OCR_DIR}/`)).toBe(true);
    expect(OCR_DIR).toBe("/ocr");
    expect(OCR_LANG).toBe("spa");
    for (const text of [OCR_WORKER, OCR_CORE_SIMD, OCR_CORE_PLAIN, OCR_DIR]) expect(text).not.toMatch(/^https?:|\/\//);
  });

  it("picks the engine with the SIMD instructions only where the browser has them", () => {
    expect(corePath(true)).toBe(OCR_CORE_SIMD);
    expect(corePath(false)).toBe(OCR_CORE_PLAIN);
    expect(typeof hasSimd()).toBe("boolean");
    // This runtime has them, so asking for the one it chooses itself gives the faster.
    expect(corePath()).toBe(hasSimd() ? OCR_CORE_SIMD : OCR_CORE_PLAIN);
  });

  it("is told what it has to run: a worker and WebAssembly", () => {
    expect(canRead({})).toBe(false);
    expect(canRead({ Worker: function () {} })).toBe(false);
    expect(canRead({ WebAssembly: {} })).toBe(false);
    expect(canRead({ Worker: function () {}, WebAssembly: {} })).toBe(true);
  });

  it("tells the person the truth about what it fetches: a few megabytes, once", () => {
    expect(OCR_DOWNLOAD_MB).toBeGreaterThanOrEqual(5);
    expect(OCR_DOWNLOAD_MB).toBeLessThanOrEqual(8);
  });
});

describe("reading", () => {
  it("makes a worker for Spanish, with the network engine only, from our own files, and keeps nothing of the language in the browser", async () => {
    const reader = fake({ text: "CLASE B1" });
    const text = await readText(IMAGE, { create: reader.create });
    expect(text).toBe("CLASE B1");
    expect(reader.calls).toEqual([["spa", 1]]);
    expect(reader.options).toMatchObject({
      workerPath: "/ocr/worker.min.js",
      langPath: "/ocr",
      gzip: true,
      cacheMethod: "none",
      workerBlobURL: false,
    });
    expect([OCR_CORE_SIMD, OCR_CORE_PLAIN]).toContain(reader.options!.corePath);
    // Every path it was given is ours.
    for (const value of [reader.options!.workerPath, reader.options!.corePath, reader.options!.langPath]) expect(value.startsWith("/ocr")).toBe(true);
  });

  it("asks for sparse text, says the resolution a canvas does not, and asks for the text only: not the position of every word", async () => {
    const reader = fake({ text: "x" });
    await readText(IMAGE, { create: reader.create });
    expect(reader.parameters).toEqual([{ tessedit_pageseg_mode: "11", user_defined_dpi: "300" }]);
    expect(reader.recognized).toEqual([[IMAGE, {}, { text: true }]]);
  });

  it("ends the worker when it has read", async () => {
    const reader = fake({ text: "x" });
    await readText(IMAGE, { create: reader.create });
    expect(reader.terminated).toBe(1);
  });

  it("ends the worker when it could not read, and says the reader failed on this photo", async () => {
    const reader = fake({ recognize: () => Promise.reject(new Error("boom")) });
    await expect(readText(IMAGE, { create: reader.create })).rejects.toMatchObject({ name: "OcrError", reason: "read" });
    expect(reader.terminated).toBe(1);
  });

  it("ends the worker when it could not be set up", async () => {
    const reader = fake({ setParameters: () => Promise.reject(new Error("boom")) });
    await expect(readText(IMAGE, { create: reader.create })).rejects.toMatchObject({ reason: "read" });
    expect(reader.terminated).toBe(1);
  });

  it("says the reader could not be made ready when it could not be made", async () => {
    const create: CreateWorker = () => Promise.reject(new Error("no language"));
    await expect(readText(IMAGE, { create })).rejects.toMatchObject({ reason: "engine" });
  });

  it("does not wait for a reader that says it failed: the library never rejects a language that did not load, it calls the error handler", async () => {
    let fail: (() => void) | undefined;
    const create: CreateWorker = (_langs, _oem, options) => {
      fail = () => options.errorHandler("Network error");
      return new Promise(() => {});
    };
    const reading = readText(IMAGE, { create });
    await Promise.resolve();
    fail?.();
    await expect(reading).rejects.toMatchObject({ reason: "engine" });
  });

  it("calls an error after the worker is up an error of reading", async () => {
    let handler: ((error: unknown) => void) | undefined;
    const reader = fake({ recognize: () => new Promise(() => {}) });
    const create: CreateWorker = (langs, oem, options) => {
      handler = options.errorHandler;
      return reader.create(langs, oem, options);
    };
    const reading = readText(IMAGE, { create });
    await vi.waitFor(() => expect(reader.recognized.length).toBe(1));
    handler?.("out of memory");
    await expect(reading).rejects.toMatchObject({ reason: "read" });
    expect(reader.terminated).toBe(1);
  });

  it("says how far it is: preparing while the reader loads and the fraction while it reads", async () => {
    const seen: OcrProgress[] = [];
    const create: CreateWorker = async (_langs, _oem, options) => {
      options.logger({ status: "loading tesseract core", progress: 0 });
      options.logger({ status: "loading language traineddata", progress: 1 });
      options.logger({ status: "recognizing text", progress: 0.4 });
      return fake({ text: "x" }).worker;
    };
    await readText(IMAGE, { create, onProgress: (progress) => seen.push(progress) });
    expect(seen).toEqual([
      { stage: "preparing", fraction: null },
      { stage: "preparing", fraction: null },
      { stage: "reading", fraction: 0.4 },
    ]);
    expect(progressOf({ status: "recognizing text", progress: 7 })).toEqual({ stage: "reading", fraction: 1 });
    expect(progressOf({ status: "recognizing text", progress: -1 })).toEqual({ stage: "reading", fraction: 0 });
    expect(progressOf({})).toEqual({ stage: "preparing", fraction: null });
  });

  it("gives back an empty text when the reader gave none", async () => {
    const reader = fake({ recognize: async () => ({ data: {} as { text: string } }) });
    expect(await readText(IMAGE, { create: reader.create })).toBe("");
  });

  it("does not run in a browser that has no worker, and says so before it tries", async () => {
    vi.stubGlobal("Worker", undefined);
    await expect(readText(IMAGE)).rejects.toMatchObject({ reason: "unsupported" });
  });
});

describe("stopping", () => {
  it("does not start when it was already stopped", async () => {
    const reader = fake();
    const controller = new AbortController();
    controller.abort();
    await expect(readText(IMAGE, { create: reader.create, signal: controller.signal })).rejects.toMatchObject({ reason: "aborted" });
    expect(reader.calls).toEqual([]);
  });

  it("stops while the reader is being made, and ends it when it is made", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reader = fake({ create: () => gate });
    const controller = new AbortController();
    const reading = readText(IMAGE, { create: reader.create, signal: controller.signal });
    await vi.waitFor(() => expect(reader.calls.length).toBe(1));
    controller.abort();
    await expect(reading).rejects.toMatchObject({ reason: "aborted" });
    expect(reader.terminated).toBe(0);
    release();
    await vi.waitFor(() => expect(reader.terminated).toBe(1));
    // And the photo was never looked at.
    expect(reader.recognized).toEqual([]);
  });

  it("stops while it reads, and ends the worker", async () => {
    const reader = fake({ recognize: () => new Promise(() => {}) });
    const controller = new AbortController();
    const reading = readText(IMAGE, { create: reader.create, signal: controller.signal });
    await vi.waitFor(() => expect(reader.recognized.length).toBe(1));
    controller.abort();
    await expect(reading).rejects.toMatchObject({ reason: "aborted" });
    expect(reader.terminated).toBe(1);
  });
});

describe("what it does not do", () => {
  it("makes no request of its own and writes nothing in the log", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "debug")];
    const reader = fake({ text: "LICENCIA\nPEREZ LUCIA\nDNI 30.123.456\nCLASE B1" });
    await readText(IMAGE, { create: reader.create });
    await expect(readText(IMAGE, { create: fake({ recognize: () => Promise.reject(new Error("PEREZ 30.123.456")) }).create })).rejects.toBeInstanceOf(OcrError);
    expect(fetcher).not.toHaveBeenCalled();
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it("does not carry what went wrong in the worker into the error the page sees: it can have the text in it", async () => {
    const reader = fake({ recognize: () => Promise.reject(new Error("DNI 30.123.456 PEREZ")) });
    const error = await readText(IMAGE, { create: reader.create }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OcrError);
    expect(JSON.stringify(error)).not.toContain("30.123.456");
    expect((error as OcrError).message).toBe("read");
  });

  it("has a text for every way it can fail, none of which leaves the person without a way on", () => {
    for (const [reason, text] of Object.entries(OCR_FAILURE)) {
      expect(text.length, reason).toBeGreaterThan(10);
    }
    for (const reason of ["unsupported", "engine", "read", "big", "not_image", "small"] as const) {
      expect(OCR_FAILURE[reason], reason).toMatch(/a mano|Probá|Elegí|Sacala/);
    }
    expect(ocrFailureOf(new OcrError("big"))).toBe("big");
    expect(ocrFailureOf(new Error("x"))).toBe("read");
  });
});

describe("the photo, before the reader", () => {
  it("only shrinks: a long side is brought down to what is read, and a small picture is left as it is", () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(1200, 800, 2000)).toEqual({ width: 1200, height: 800 });
    expect(fitWithin(2000, 2000, 2000)).toEqual({ width: 2000, height: 2000 });
    expect(fitWithin(10000, 10, 2000)).toEqual({ width: 2000, height: 2 });
    expect(fitWithin(10000, 1, 2000).height).toBeGreaterThanOrEqual(1);
  });
});

describe("the file the person chose", () => {
  it("is turned away before anything is opened when it is too big to be the photo of a card", async () => {
    const big = new Blob([new Uint8Array(MAX_PHOTO_BYTES + 1)], { type: "image/jpeg" });
    await expect(photoToCanvas(big)).rejects.toMatchObject({ name: "OcrError", reason: "big" });
  });

  it("is turned away when it says it is not an image, and a browser that cannot open images says so", async () => {
    await expect(photoToCanvas(new Blob(["hola"], { type: "text/plain" }))).rejects.toMatchObject({ reason: "not_image" });
    await expect(photoToCanvas(new Blob(["hola"], { type: "application/pdf" }))).rejects.toMatchObject({ reason: "not_image" });
    // This runtime has no way to open an image, which is what an old browser looks like.
    vi.stubGlobal("createImageBitmap", undefined);
    await expect(photoToCanvas(new Blob([new Uint8Array(10)], { type: "image/png" }))).rejects.toMatchObject({ reason: "unsupported" });
  });

  it("is opened without the metadata a phone writes in a photo, and what was drawn is erased once read", async () => {
    const closed: string[] = [];
    vi.stubGlobal("createImageBitmap", async (_file: unknown, options?: { imageOrientation?: string }) => {
      // A browser that knows how to turn a photo the way its note says is asked to; one that does not is asked plainly.
      if (options && options.imageOrientation === "from-image") throw new TypeError("sin opciones");
      return { width: 3000, height: 2000, close: () => void closed.push("bitmap") };
    });
    const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: () => context };
    vi.stubGlobal("document", { createElement: () => canvas });
    const drawn = await photoToCanvas(new Blob([new Uint8Array(10)], { type: "image/jpeg" }));
    expect(drawn).toBe(canvas);
    // Shrunk to what is read, and the bitmap is let go.
    expect([canvas.width, canvas.height]).toEqual([2000, 1333]);
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2000, 1333);
    expect(closed).toEqual(["bitmap"]);
    eraseCanvas(drawn);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it("is turned away when it is too small to have anything to read", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 120, height: 90, close: () => {} }));
    await expect(photoToCanvas(new Blob([new Uint8Array(10)], { type: "image/png" }))).rejects.toMatchObject({ reason: "small" });
  });
});

describe("the files it loads", () => {
  const script = readFileSync(join(root, "scripts/copy-ocr.mjs"), "utf8");
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> };

  it("are exactly the ones the copy script puts in public/ocr, by name", () => {
    for (const path of [OCR_WORKER, OCR_CORE_SIMD, OCR_CORE_PLAIN]) {
      const name = path.slice(OCR_DIR.length + 1);
      expect(script, name).toContain(`"${name}"`);
    }
    expect(script).toContain(`"${OCR_LANG}.traineddata.gz"`);
  });

  it("exist where the script takes them from, in the versions installed", () => {
    // In pnpm's layout the package is a link, and its engine sits next to where the link points; the script resolves it the same way.
    const tesseract = realpathSync(join(root, "node_modules/tesseract.js"));
    expect(existsSync(join(tesseract, "dist/worker.min.js"))).toBe(true);
    // The bundled browser file the engine imports (and the type shim names).
    expect(existsSync(join(tesseract, "dist/tesseract.min.js"))).toBe(true);
    expect(readFileSync(join(root, "lib/ocr/engine.ts"), "utf8")).toContain('import("tesseract.js/dist/tesseract.min.js")');
    expect(readFileSync(join(root, "types/tesseract.d.ts"), "utf8")).toContain('declare module "tesseract.js/dist/tesseract.min.js"');
    const core = join(tesseract, "..", "tesseract.js-core");
    for (const name of ["tesseract-core-simd-lstm.wasm.js", "tesseract-core-lstm.wasm.js"]) expect(existsSync(join(core, name)), name).toBe(true);
    expect(existsSync(join(root, "node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz"))).toBe(true);
  });

  it("are copied before the app runs and before it is built, and are not in git", () => {
    expect(packageJson.scripts.predev).toContain("scripts/copy-ocr.mjs");
    expect(packageJson.scripts.prebuild).toContain("scripts/copy-ocr.mjs");
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toMatch(/^\/public\/ocr\/$/m);
  });

  it("come with the versions pinned: the engine and its language are programs that run in the person's browser", () => {
    expect(packageJson.dependencies["tesseract.js"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.devDependencies["@tesseract.js-data/spa"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("are never asked of anyone else: nothing in lib/ocr or its component names a CDN", () => {
    for (const file of ["lib/ocr/engine.ts", "lib/ocr/image.ts", "lib/ocr/credential.ts", "lib/ocr/failure.ts", "components/profile/hub/CredentialPhoto.tsx"]) {
      const path = join(root, file);
      if (!existsSync(path)) continue;
      expect(readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), file).not.toMatch(/jsdelivr|unpkg|cdnjs|https?:\/\//);
    }
  });
});
