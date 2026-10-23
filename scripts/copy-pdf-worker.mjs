/**
 * Copies pdf.js's worker into `public/`, where `lib/import/extract.ts` loads it
 * from by absolute path.
 *
 * Copied at build time rather than imported, because the alternative is asking
 * a bundler to resolve `new URL("pdfjs-dist/build/pdf.worker.min.mjs",
 * import.meta.url)` into an emitted asset. Whether that works is a property of
 * the bundler, it differs between webpack and Turbopack, and when it silently
 * does not the failure is a PDF that never finishes parsing in the browser. A
 * file in `public/` is a file in `public/`.
 *
 * Run from `predev` and `prebuild`, so the copy always matches the installed
 * version — pdf.js refuses to run a worker whose version differs from the API's,
 * and a stale committed copy is exactly how that happens.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const source = join(
  dirname(require.resolve("pdfjs-dist/package.json")),
  "build",
  "pdf.worker.min.mjs",
);
const target = join(root, "public", "pdf.worker.min.mjs");

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
console.log(`pdf.js worker → public/pdf.worker.min.mjs`);
