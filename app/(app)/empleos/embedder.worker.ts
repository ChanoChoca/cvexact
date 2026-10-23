/**
 * Runs `multilingual-e5-small` entirely in the browser, off the main thread,
 * for `/empleos`'s optional "afinidad semántica" toggle — see
 * `useSemanticJobsEnabled` in `lib/storage/hooks.ts` and the blending math in
 * `lib/jobs/semantic.ts`, which this worker is the only caller of the model
 * side of.
 *
 * A Web Worker, not a main-thread call, because downloading the model
 * (~110–130 MB the first time) and running inference on a page of postings
 * would otherwise freeze scrolling and typing in the feed for however long
 * either takes. A worker, not the server: embedding the profile server-side
 * would mean sending it there, which is the one thing `/api/jobs/feed` and
 * `lib/jobs/score.ts` are built to never require — see the comment on
 * `jobPosting` in `lib/db/schema.ts`.
 *
 * `@huggingface/transformers` is imported dynamically, inside this file only.
 * `scripts/build-embedder-worker.mjs` bundles this file (transformers and
 * all) into a standalone `public/embedder.worker.js` at build time — see
 * that script for why it is not loaded via a bundler-resolved `new
 * URL(import.meta.url)` the way this file's own `new Worker(...)` call site
 * in `JobsList.tsx` might suggest. Either way, the network fetch only
 * happens once `JobsList.tsx` actually constructs the worker, which only
 * happens once the toggle is on — nobody who leaves it off downloads any of
 * this.
 *
 * Protocol, all `postMessage`d as plain JSON. `kind` discriminates rather
 * than `id`: `id` is a caller-chosen request id (a UUID from `JobsList.tsx`),
 * a plain `string` too wide a type for `"status"` to narrow safely against.
 *   in  → { id: string, texts: string[] }
 *   out → { kind: "status", state: "loading" | "ready" | "computing" }
 *       | { kind: "result", id: string, embeddings: number[][] }
 *       | { kind: "error", id: string, error: string }
 *
 * Every status update is a message this worker chooses to send, never
 * something `JobsList.tsx` infers on its own — that is what keeps its effect
 * from ever calling `setState` synchronously in its own body (a `computing`
 * status arrives as a message like any other, even on the fast path where
 * the model was already loaded by an earlier page).
 */

type InMessage = { id: string; texts: string[] };
type OutMessage =
  | { kind: "status"; state: "loading" | "ready" | "computing" }
  | { kind: "result"; id: string; embeddings: number[][] }
  | { kind: "error"; id: string; error: string };

// `FeatureExtractionPipeline` isn't imported as a type here on purpose: doing
// so would pull the package's types (and, depending on the bundler, a chunk
// of the package itself) into every file that imports this worker's message
// types, not just this one. `unknown`, narrowed with `as never` at the one
// call site below, keeps that boundary real.
let extractor: unknown = null;
let loading: Promise<unknown> | null = null;

async function getExtractor() {
  if (extractor) return extractor;
  if (!loading) {
    self.postMessage({ kind: "status", state: "loading" } satisfies OutMessage);
    loading = import("@huggingface/transformers").then(({ env, pipeline }) => {
      // The ONNX runtime's WASM engine (a script and a 23 MB binary) defaults
      // to cdn.jsdelivr.net, which the page's CSP rightly does not allow — the
      // model download then succeeded and the engine load was blocked, so the
      // toggle always ended in "No se pudo calcular". `scripts/copy-ort-wasm.mjs`
      // puts the same two files under `/ort/` on our own origin. Two things
      // have to hold together for that to pass the CSP:
      //  - `wasmPaths` points at those files, named exactly as the library
      //    would ask for them (`ort-wasm-simd-threaded.asyncify.*`), and
      //  - `useWasmCache` is off: with it on, the library fetches the script
      //    and re-imports it from a `blob:` URL, and `script-src` has no `blob:`.
      const wasm = env.backends.onnx.wasm;
      if (wasm) {
        wasm.wasmPaths = {
          mjs: `${self.location.origin}/ort/ort-wasm-simd-threaded.asyncify.mjs`,
          wasm: `${self.location.origin}/ort/ort-wasm-simd-threaded.asyncify.wasm`,
        };
      }
      env.useWasmCache = false;
      // q8: the quantized ONNX weights Xenova/multilingual-e5-small publishes
      // — a fraction of the full-precision download, at a quality cost
      // `blendScores`'s minority weighting is built to absorb.
      return pipeline("feature-extraction", "Xenova/multilingual-e5-small", { dtype: "q8" });
    });
  }
  extractor = await loading;
  self.postMessage({ kind: "status", state: "ready" } satisfies OutMessage);
  return extractor;
}

self.onmessage = async (event: MessageEvent<InMessage>) => {
  const { id, texts } = event.data;
  try {
    const model = (await getExtractor()) as (
      texts: string[],
      options: { pooling: "mean"; normalize: boolean },
    ) => Promise<{ tolist(): number[][] }>;
    self.postMessage({ kind: "status", state: "computing" } satisfies OutMessage);
    const output = await model(texts, { pooling: "mean", normalize: true });
    self.postMessage({ kind: "result", id, embeddings: output.tolist() } satisfies OutMessage);
  } catch (error) {
    self.postMessage({
      kind: "error",
      id,
      error: error instanceof Error ? error.message : "No se pudo calcular la afinidad semántica.",
    } satisfies OutMessage);
  }
};
