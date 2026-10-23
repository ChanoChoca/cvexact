/**
 * Copies the ONNX runtime's WASM engine into `public/ort/`, where
 * `app/(app)/empleos/embedder.worker.ts` loads it from.
 *
 * `@huggingface/transformers` fetches these two files from cdn.jsdelivr.net by
 * default. The page's CSP allows neither that origin for scripts nor for
 * `fetch`, and opening it would let a third party's code run in the page, so
 * the files are served from our own origin instead — the same move
 * `scripts/copy-pdf-worker.mjs` makes for pdf.js's worker.
 *
 * `onnxruntime-web` is a dependency of `@huggingface/transformers`, not of
 * ours, and pnpm does not hoist it, so it is resolved from where transformers
 * itself resolves it. Copied at `predev`/`prebuild` so it always matches the
 * installed version. Only the variant the library asks for in a browser
 * (`asyncify`; see `embedder.worker.ts`) is copied: the others are another
 * ~50 MB nobody requests.
 */
import { copyFile, mkdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// transformers' `exports` map hides its package.json from `require.resolve`, so
// go by location: its real path is `<node_modules>/@huggingface/transformers`
// (a symlink into `.pnpm/` under pnpm), and its dependency sits next to it, two
// levels up, in both pnpm's and npm's layouts.
const transformers = await realpath(join(root, "node_modules", "@huggingface", "transformers"));
const dist = join(transformers, "..", "..", "onnxruntime-web", "dist");
const targetDir = join(root, "public", "ort");

await mkdir(targetDir, { recursive: true });
for (const file of ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"]) {
  await copyFile(join(dist, file), join(targetDir, file));
}
console.log("ONNX runtime WASM → public/ort/");
