/**
 * Copies what reads a photo in the browser into `public/ocr/`, where `lib/ocr/engine.ts` loads it from (e5, O18).
 *
 * `tesseract.js` fetches its three pieces from cdn.jsdelivr.net by default: the worker, the engine it runs (WebAssembly, written into a script) and the
 * language data. The page's CSP allows that origin neither for scripts nor for `fetch`, and opening it would let a third party's code run in the page that holds
 * the profile, so the pieces are served from our own origin — the same move `scripts/copy-ort-wasm.mjs` makes for the ONNX runtime and
 * `scripts/copy-pdf-worker.mjs` makes for pdf.js's worker. Nothing about the person's photo goes anywhere near any of it: these are programs and a language.
 *
 * What is copied is only what a browser asks for:
 *  - `worker.min.js`, from `tesseract.js`;
 *  - the engine in its two variants that `lib/ocr/engine.ts` picks between — with the WebAssembly SIMD instructions and without — each of them the one that
 *    reads text with the neural network only (`lstm`), about 3.9 MB: the other variants are another ~20 MB that nobody requests;
 *  - the Spanish data, the small integer model (`4.0.0_best_int`, 2.1 MB, which is the one made for the network-only engine).
 *
 * The engine is a dependency of `tesseract.js`, not of ours, and pnpm does not hoist it, so it is resolved from where `tesseract.js` resolves it; the data is
 * a dependency of ours for this one purpose. Copied at `predev`/`prebuild` so that it always matches the installed versions, and ignored by git.
 */
import { copyFile, mkdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tesseract = await realpath(join(root, "node_modules", "tesseract.js"));
// Its engine sits next to it, one level up, in both pnpm's and npm's layouts.
const core = join(tesseract, "..", "tesseract.js-core");
const data = join(root, "node_modules", "@tesseract.js-data", "spa", "4.0.0_best_int");
const targetDir = join(root, "public", "ocr");

await mkdir(targetDir, { recursive: true });
const files = [
  [join(tesseract, "dist", "worker.min.js"), "worker.min.js"],
  [join(core, "tesseract-core-simd-lstm.wasm.js"), "tesseract-core-simd-lstm.wasm.js"],
  [join(core, "tesseract-core-lstm.wasm.js"), "tesseract-core-lstm.wasm.js"],
  [join(data, "spa.traineddata.gz"), "spa.traineddata.gz"],
];
for (const [from, name] of files) await copyFile(from, join(targetDir, name));
console.log("OCR (worker, engine, Spanish data) → public/ocr/");
