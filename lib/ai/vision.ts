import "server-only";

import { APICallError, generateText } from "ai";

import type { GenerationTelemetry } from "./pipeline";
import { redactKeys } from "./provider";
import type { ModelChain } from "./provider";

/**
 * Reading a photo or a scan of a CV into text, with the model the person configured and nothing of ours.
 *
 * One more way of reading, and the least trustworthy of them, so it is kept as small as it can be: the model is asked to copy
 * what it sees — never to understand it — and what comes back is plain text that goes the way a pasted text goes
 * (`lib/onboarding/photo.ts`): it is shown to the person to be looked at against their photo, and only then read into a profile,
 * by the same patterns as any text. Nothing is structured here, and nothing is checked: the only thing a text written from a
 * picture can be checked against is the picture, and the model that wrote it is the only one that looked.
 *
 * Only with the person's own key. A model that cannot read images fails with a sentence that says which kind of model can.
 * The photo is not kept anywhere on our side: it arrives in the request, goes to the provider they chose, and is gone with it.
 *
 * Written in English like every prompt in this app; see the note in `./prompts/shared.ts`.
 */

export const TRANSCRIBE_SYSTEM = `
You are transcribing a photo or a scan of a CV (a résumé) into plain text. You are
copying, not writing.

RULES:
- Write every line of text you can read in the image, in reading order, one line of
  the document per line of your answer. Keep section headings, dates, names of
  companies and places, and bullet points exactly as they are written; a bullet may
  start its line with "- ".
- If the page has columns, finish one column before the next. If there is more than
  one page, go page by page.
- Never summarise, correct, translate, reorder, complete or invent anything. A word
  or a figure you cannot read is written as [ilegible]; never guess it.
- No comments, no explanations, no headings of your own, no markdown fences. The text
  only.
- If the image has no text in it, or is not a CV or a résumé, answer exactly NO_TEXT
  and nothing else.
`.trim();

/** What the model answers when there is nothing to copy. */
export const NO_TEXT = "NO_TEXT";

/** How long one candidate has to read a photo, and how many of the chain's candidates are asked. */
const ATTEMPT_MS = 90_000;
const MAX_CANDIDATES = 2;
const MAX_OUTPUT_TOKENS = 8192;

/** A provider refusing the image itself, in the words they use for it: a model with no eyes. */
const CANNOT_SEE = /image|vision|multimodal|modalit|image_url|unsupported content|content type/i;

export type TranscribedImage = { base64: string; mediaType: string };

/**
 * A reading that could not be done, in the sentence the person is shown and the status the route answers with.
 *
 * Its own and small, on purpose: this call does not go through `generate`, so the classification of failures that `generate`
 * ends in — retired models, plans, cooldowns — is not what it has to say. A photo is read once, by the person's own key, and the
 * handful of things that can go wrong with that each have a sentence of their own and a way out: another model, a smaller photo,
 * or copying the text out of the picture.
 */
export class VisionFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(redactKeys(message));
    this.name = "VisionFailure";
  }
}

const isTimeout = (error: unknown): boolean => error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

function failureOf(error: unknown): VisionFailure {
  if (error instanceof VisionFailure) return error;
  const api = APICallError.isInstance(error) ? error : null;
  const status = api?.statusCode;
  const said = `${error instanceof Error ? error.message : String(error)} ${api?.responseBody ?? ""}`.toLowerCase();
  if ((status === 400 || status === 415 || status === 422) && CANNOT_SEE.test(said)) {
    return new VisionFailure("Ese modelo no lee imágenes. Probá con uno que las lea —Google Gemini, por ejemplo— en Ajustes, o copiá el texto de la foto y pegalo.", 400);
  }
  if (status === 401 || status === 403 || /api key|unauthorized/.test(said)) return new VisionFailure("La API key fue rechazada por el proveedor. Revisala en Ajustes.", 401);
  if (status === 402 || /insufficient|credit|billing/.test(said)) {
    return new VisionFailure("Tu proveedor dice que no tiene saldo para esta lectura. Revisalo en tu cuenta de ese proveedor, o probá con otro en Ajustes.", 402);
  }
  if (status === 413) return new VisionFailure("La imagen es demasiado grande para ese proveedor. Probá con una foto más chica, o copiá el texto y pegalo.", 413);
  if (status === 429) return new VisionFailure("Tu proveedor está limitando los pedidos. Probá de nuevo en un rato, o con otro modelo en Ajustes.", 429);
  if (isTimeout(error)) return new VisionFailure("Tu proveedor tardó demasiado en leer la foto. Probá de nuevo, o copiá el texto y pegalo.", 504);
  return new VisionFailure("No pudimos leer esa foto con tu proveedor. Probá de nuevo, o copiá el texto y pegalo.", 502);
}

/**
 * The text a model reads off `image`, or `NO_TEXT` when it says there is none. The chain's own order and what it has already
 * discarded in this request are respected, but not its repairs and its fallbacks for a broken answer: this answer has no schema
 * to break, and a second try is never worth more than the next candidate's first. Fails with a `VisionFailure`.
 */
export async function transcribeImage(chain: ModelChain, image: TranscribedImage, telemetry: GenerationTelemetry = {}): Promise<string> {
  const candidates = chain.candidates.filter((candidate) => !chain.failed.has(candidate.cooldownKey)).slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) throw failureOf(chain.lastError ?? new Error("No hay un modelo disponible para esta lectura."));

  let last: unknown;
  for (const choice of candidates) {
    chain.used = choice;
    try {
      const timeout = AbortSignal.timeout(ATTEMPT_MS);
      const result = await generateText({
        model: choice.model,
        system: TRANSCRIBE_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", image: image.base64, mediaType: image.mediaType },
              { type: "text", text: "Transcribe this image." },
            ],
          },
        ],
        maxOutputTokens: Math.min(MAX_OUTPUT_TOKENS, choice.maxOutputTokens ?? MAX_OUTPUT_TOKENS),
        abortSignal: chain.signal ? AbortSignal.any([chain.signal, timeout]) : timeout,
        maxRetries: 1,
      });
      telemetry.finishReason = result.finishReason;
      telemetry.inputTokens = result.usage.inputTokens;
      telemetry.outputTokens = result.usage.outputTokens;
      return result.text.trim();
    } catch (error) {
      last = error;
      // Not wanted any more: the person left, or pressed Cancel. Nobody else is asked.
      if (chain.signal?.aborted) break;
      chain.failed.add(choice.cooldownKey);
      chain.lastError = error;
    }
  }
  throw failureOf(last);
}
