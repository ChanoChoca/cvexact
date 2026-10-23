"use client";

import { ApiError } from "./client";
import { requestHeaders } from "./client";
import { IDEMPOTENCY_HEADER } from "@/lib/generation/idempotency";
import type { ClientCandidateAttempt, DenialReason } from "./client";
import { recordProviderNotes } from "@/lib/storage/local";

/**
 * Browser-side reader for the one endpoint that streams.
 *
 * `callGenerator` in ./client.ts awaits a whole JSON body, which is the right
 * shape for the five generators that produce a document. The interview answers
 * NDJSON, one frame per line, so the reply can be painted while the rest of the
 * turn is still being written.
 *
 * BYOK travels in the same headers for the same reason it does there: a key in
 * a request header is a key that never lands in a logged or persisted payload.
 */

/**
 * A frame the route emits.
 *
 * The three the reader itself acts on. Routes are free to send others — the CV
 * narrates its stages and its provider fallbacks this way — and those reach the
 * caller through `onFrame` rather than being decoded here, so adding one is a
 * change to the route and its caller and to nothing in between.
 */
type Frame<T> =
  | { type: "partial"; value: Partial<T> }
  | { type: "done"; value: T }
  | { type: "error"; message: string; attempts?: ClientCandidateAttempt[]; untried?: number }
  | { type: string; [key: string]: unknown };

export async function streamGenerator<T>(
  endpoint: string,
  body: unknown,
  options: {
    /** Called for every partial object, so the UI can paint as it arrives. */
    onPartial?: (partial: Partial<T>) => void;
    /**
     * Called for every frame this reader does not handle itself, so a caller
     * can act on whatever its own route sends — progress, a fallback notice.
     */
    onFrame?: (frame: { type: string } & Record<string, unknown>) => void;
    signal?: AbortSignal;
    /**
     * Names this generation to the server, which keeps its result under the key
     * for a while — see `lib/applications/pending.ts` for what that recovers.
     */
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  const headers = requestHeaders();
  if (options.idempotencyKey) headers[IDEMPOTENCY_HEADER] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("No pudimos conectar con el servidor. Revisá tu conexión.", 0);
  }

  // Anything that failed before the stream opened is still an ordinary HTTP
  // error with a JSON body — quota, a bad key, an invalid request. It carries the
  // reason the server gave, as `callGenerator` does: it was dropped here, and so
  // `/postular` — the one screen that reads the CV this way — never reached the
  // denial that offers the way out (`LimitReached`), and showed the bare message
  // instead, which for a missing key says to go and find Ajustes.
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      quota?: { used: number; allowance: number };
      reason?: DenialReason;
      attempts?: ClientCandidateAttempt[];
      untried?: number;
    };
    if (payload.attempts) recordProviderNotes(payload.attempts);
    throw new ApiError(
      payload.error ?? "Ocurrió un error al generar.",
      response.status,
      payload.quota,
      payload.reason,
      payload.attempts,
      payload.untried,
    );
  }

  if (!response.body) {
    throw new ApiError("La respuesta del servidor llegó vacía.", 502);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: T | undefined;

  const handle = (line: string) => {
    if (!line.trim()) return;

    let frame: Frame<T>;
    try {
      frame = JSON.parse(line) as Frame<T>;
    } catch {
      // A truncated line is the tail of a stream that was cut off. The `done`
      // frame is what decides success, so a fragment is simply not one.
      return;
    }

    if (frame.type === "partial") options.onPartial?.((frame as { value: Partial<T> }).value);
    else if (frame.type === "done") done = (frame as { value: T }).value;
    // A route that has already sent its headers reports failure in-band; it is
    // still a failure, so it is raised the way an HTTP one would have been.
    else if (frame.type === "error") {
      const errorFrame = frame as {
        message: string;
        attempts?: ClientCandidateAttempt[];
        untried?: number;
      };
      if (errorFrame.attempts) recordProviderNotes(errorFrame.attempts);
      throw new ApiError(
        errorFrame.message,
        502,
        undefined,
        undefined,
        errorFrame.attempts,
        errorFrame.untried,
      );
    } else options.onFrame?.(frame as { type: string } & Record<string, unknown>);
  };

  try {
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // The last element is whatever came after the final newline: either an
      // empty string or half a frame that the next chunk completes.
      buffer = lines.pop() ?? "";
      for (const line of lines) handle(line);
    }
    buffer += decoder.decode();
    handle(buffer);
  } finally {
    reader.cancel().catch(() => {});
  }

  if (done === undefined) {
    throw new ApiError("La respuesta se cortó antes de terminar. Probá de nuevo.", 502);
  }
  return done;
}
