/**
 * The header a generation request carries its idempotency key in, and what a
 * key has to look like. Shared by the browser, which makes the key, and the
 * server, which keeps the result under it (`lib/generation/result-cache.ts`).
 *
 * A key is a v4 UUID from `crypto.randomUUID()`: 122 random bits, which is what
 * lets it act as the only credential for its own result — whoever has the key
 * can fetch that one result, and nobody can guess one. Anything else is
 * ignored, and the request is served exactly as it was before keys existed.
 */
export const IDEMPOTENCY_HEADER = "x-cvp-idempotency-key";

/** The generations whose results are kept: the documents an application is made of. */
export type GenerationKind = "cv" | "answers" | "email" | "interview" | "video";

/** How long the server keeps a result — and so how long the browser keeps asking about one. */
export const RESULT_TTL_MS = 24 * 60 * 60 * 1000;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

/** The key a request carries, or null when it carries none worth trusting. */
export function idempotencyKeyOf(headers: Headers): string | null {
  const value = headers.get(IDEMPOTENCY_HEADER);
  return isIdempotencyKey(value) ? value.toLowerCase() : null;
}
