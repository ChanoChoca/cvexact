import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Copied out of node_modules by scripts/copy-pdf-worker.mjs. Minified
    // third-party code — linting it reports a few thousand problems about
    // someone else's build output.
    "public/pdf.worker.min.mjs",
    // Bundled by scripts/build-embedder-worker.mjs from embedder.worker.ts
    // and @huggingface/transformers. Same reasoning as the pdf.js worker
    // above — the source (embedder.worker.ts) is what actually gets linted.
    "public/embedder.worker.js",
    // Copied out of node_modules by scripts/copy-ocr.mjs: the OCR's worker and
    // its two WebAssembly engines, minified third-party code. Same reasoning.
    "public/ocr/**",
    // Copied out of node_modules by scripts/copy-ort-wasm.mjs: the ONNX
    // runtime's WebAssembly engine (a script and a 23 MB binary), minified
    // third-party code. Same reasoning.
    "public/ort/**",
  ]),
]);

export default eslintConfig;
