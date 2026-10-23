/**
 * Bundles `embedder.worker.ts` (and `@huggingface/transformers`, which it
 * dynamically imports) into a single, standalone `public/embedder.worker.js`
 * — the same move `scripts/copy-pdf-worker.mjs` makes for pdf.js's worker,
 * and for the same reason (see that file's header comment): asking the
 * bundler to turn `new Worker(new URL("./embedder.worker.ts",
 * import.meta.url))` into an emitted, executable chunk is a property of the
 * bundler, not of the code, and verified in practice (`pnpm build` with
 * Turbopack, Next 16.3.0) to silently copy the raw `.ts` source into
 * `/_next/static/media/` as an unprocessed static asset instead of
 * compiling it — which the browser cannot execute, and which fails with no
 * build error anywhere. A file in `public/` is a file in `public/`.
 *
 * `JobsList.tsx` references the output with a plain runtime string —
 * `new Worker("/embedder.worker.js", { type: "module" })` — no
 * `import.meta.url` bundler magic involved at all.
 *
 * Run from `predev` and `prebuild`, so the bundle always matches the
 * installed `@huggingface/transformers` version, same as the pdf.js worker.
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, "app", "(app)", "empleos", "embedder.worker.ts");
const outfile = join(root, "public", "embedder.worker.js");

await mkdir(dirname(outfile), { recursive: true });

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: true,
  logLevel: "info",
});

console.log("Worker de afinidad semántica → public/embedder.worker.js");
