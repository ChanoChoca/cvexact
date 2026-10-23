import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The semantic-affinity toggle only works if the ONNX runtime's WASM engine
 * comes from our own origin: the page's CSP allows neither jsDelivr scripts
 * nor `fetch`es, and `@huggingface/transformers` defaults to jsDelivr. When
 * that default was left in place the model downloaded fine and the engine
 * load was blocked, so the toggle always ended in "No se pudo calcular" —
 * with no build error and no test failing. This pins the two ends together.
 */
const root = join(__dirname, "..");
const worker = readFileSync(join(root, "app/(app)/empleos/embedder.worker.ts"), "utf8");
const copier = readFileSync(join(root, "scripts/copy-ort-wasm.mjs"), "utf8");
const csp = readFileSync(join(root, "next.config.ts"), "utf8");
const list = readFileSync(join(root, "app/(app)/empleos/JobsList.tsx"), "utf8");

describe("embedder worker WASM engine", () => {
  it("points wasmPaths at files under /ort/ on our own origin", () => {
    expect(worker).toContain("wasm.wasmPaths");
    expect(worker).toMatch(/\/ort\/ort-wasm-simd-threaded\.asyncify\.mjs/);
    expect(worker).toMatch(/\/ort\/ort-wasm-simd-threaded\.asyncify\.wasm/);
    expect(worker).not.toMatch(/["`]https:\/\/cdn\.jsdelivr/);
  });

  it("turns the wasm cache off, since script-src has no blob:", () => {
    expect(worker).toContain("env.useWasmCache = false");
    expect(csp).not.toMatch(/script-src[^`]*blob:/);
  });

  it("is copied to public/ort/ under exactly the names the worker asks for", () => {
    for (const file of ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"]) {
      expect(worker).toContain(file);
      expect(copier).toContain(file);
    }
    expect(copier).toContain('"public", "ort"');
  });

  it("does not open the CSP to a CDN", () => {
    expect(csp).not.toMatch(/`connect-src[^`]*jsdelivr/);
    expect(csp).not.toMatch(/`script-src[^`]*jsdelivr/);
  });

  it("versions the worker URL so a deploy is not shadowed by a cached copy", () => {
    expect(list).toMatch(/\/embedder\.worker\.js\?v=\$\{process\.env\.NEXT_PUBLIC_EMBEDDER_WORKER_V\}/);
    expect(csp).toContain("NEXT_PUBLIC_EMBEDDER_WORKER_V");
  });
});
