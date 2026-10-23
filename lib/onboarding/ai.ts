"use client";

import { ApiError, callGenerator } from "@/lib/api/client";
import { importTextProblem } from "@/lib/ai/import-limits";
import type { DenialReason } from "@/lib/api/client";
import { sha256Hex } from "@/lib/import/extract";
import { PhotoError, preparePhoto } from "@/lib/import/photo";
import { EXTRACT_PROMPT_VERSION, type Extraction } from "@/lib/ai/prompts/extract";
import { IMPROVE_BATCH, IMPROVE_MANY_LIMIT, type ImproveKind, type ImproveManyKind } from "@/lib/ai/prompts/improve";
import { SPLIT_PROMPT_VERSION, type SplitResult } from "@/lib/ai/prompts/split";
import { parseDocument } from "@/lib/parse";
import { trustAgreeing } from "@/lib/parse/agree";
import { knownContact, maskContact } from "@/lib/parse/mask-contact";
import { isStruckOut, redactPersonalData } from "@/lib/parse/redact";
import { verifyExtraction, verifySplit } from "@/lib/parse/verify-extraction";
import type { ParsedContact, ParsedDocument } from "@/lib/parse/types";
import { EXTRACT_CACHE_KEY, SPLIT_CACHE_KEY, loadStoredProfile } from "@/lib/storage/local";
import { ENGINE } from "./config";
import { checkImprovement } from "./improve-guard";
import { ensureOnboardingStoresHydrated, readCollection, writeCollection } from "./stores";

/**
 * The AI pipeline the onboarding uses, on top of `/api/generate/import` and
 * `/api/generate/split`: caches a validated response by the text's own hash,
 * degrades to "no result" rather than throwing, and never trusts a response —
 * `verifyExtraction`/`verifySplit` (`lib/parse/verify-extraction.ts`) run on
 * every result, cached or fresh, so a change to the checking logic benefits an
 * old cache entry too.
 *
 * The cache holds the model's *raw* response, not the verified result: what
 * makes a cache hit worth having is skipping the call, not skipping the
 * (cheap, pure, local) check. It is keyed by a hash of the text, so pasting the
 * same document twice — or reopening "Mejorar la lectura" without having
 * changed anything — never spends a second call on it. Local only: not synced,
 * not in an exported backup, gone with `clearBrowserData`. Losing it costs one
 * repeated call, never a failed one, so every write here is best-effort.
 */

/** Entries kept per cache — a handful of documents and a session's worth of split answers, not a growing log. */
const MAX_ENTRIES = 24;

type CacheEntry<T> = { result: T; at: string };
type Cache<T> = Record<string, CacheEntry<T>>;

type CacheName = typeof EXTRACT_CACHE_KEY | typeof SPLIT_CACHE_KEY;

/** From IndexedDB where there is one, localStorage otherwise — see `./stores`. */
function readCache<T>(key: CacheName): Cache<T> {
  return readCollection<CacheEntry<T>>(key);
}

function rememberInCache<T>(key: CacheName, cacheKey: string, result: T): void {
  const cache = readCache<T>(key);
  cache[cacheKey] = { result, at: new Date().toISOString() };
  // Oldest first, until it fits — the one just written is never the one dropped.
  const ids = Object.keys(cache).sort((a, b) => cache[a]!.at.localeCompare(cache[b]!.at));
  while (ids.length > MAX_ENTRIES) delete cache[ids.shift()!];
  try {
    writeCollection(key, cache);
  } catch {
    // Best-effort; see the module comment.
  }
}

/** Turns a failed call into the one sentence `AiAction` shows. Same convention as `ExtrasPanel`. */
function messageFor(error: unknown): string {
  return error instanceof ApiError ? error.message : "No pudimos usar tu IA en este momento.";
}

/**
 * `AiAction` reacts to `"transfer_consent"` by showing `TransferConsent`
 * instead of the plain error banner — its own "Reintentar" can never
 * succeed against that particular refusal, so it has to know which one this
 * was, not just the sentence describing it.
 */
function reasonFor(error: unknown): DenialReason | undefined {
  return error instanceof ApiError ? error.reason : undefined;
}

export type AiOutcome<T> = { ok: true; result: T; fromCache: boolean } | { ok: false; message: string; reason?: DenialReason };

/**
 * The names to take out of a text before a model reads it: the one the profile already has, and whichever the document itself opens
 * with. Never throws: a browser that will not say what is in its storage has no name to give, and the text goes without one taken out.
 */
function namesFor(opened?: string): string[] {
  let known = "";
  try {
    known = loadStoredProfile().contact.fullName.value;
  } catch {
    // No profile to read: what is taken out is then what is recognised by its shape.
  }
  return [...new Set([known, opened ?? ""].map((name) => name.trim()).filter(Boolean))];
}

/**
 * A reading's contact, made of two things: what the model read of where someone lives and what they do (the city, the country, the line under
 * the name), and what the patterns read of who they are (the name, the email, the phone, the links). The model was never sent the second —
 * `lib/parse/mask-contact.ts` — and whatever it says of them is not used.
 */
function contactOf(read: ParsedContact, known: ParsedContact | null): ParsedContact {
  const pick = <K extends "headline" | "city" | "country">(key: K): Pick<ParsedContact, K> => {
    const value = read[key] ?? known?.[key];
    return (value ? { [key]: value } : {}) as Pick<ParsedContact, K>;
  };
  return {
    ...(known?.fullName ? { fullName: known.fullName } : {}),
    ...(known?.email ? { email: known.email } : {}),
    ...(known?.phone ? { phone: known.phone } : {}),
    ...pick("headline"),
    ...pick("city"),
    ...pick("country"),
    links: known?.links ?? [],
  };
}

/**
 * Reads a document with AI: an extraction, checked, and turned into the same
 * `ParsedDocument` shape the deterministic parsers produce — so everything
 * downstream (`applyParsedDocument`, the review screen, "Ver en el original")
 * treats it exactly the same way, and cannot tell the difference except by the
 * `medium` confidence every AI-derived block carries.
 *
 * What the model is sent is the text without the details the product does not read — a birth date, a document number, a
 * marital status, a references section (`redactPersonalData`) — and without who the person is: their name, their email, their phone
 * and the links that are a profile, each replaced by a mark (`maskContact`). The copy of the document that is kept has the first struck
 * out and nothing else, and the extraction is checked against that: what the model says is put right (`restore`) before it is looked
 * at, so the quote of a block is found there and the lines shown as "the original" are those. The contact of the document is read by
 * the patterns (`knownContact`) and never by the model. The cache is keyed by what was sent, not by what was given.
 */
export async function extractWithAi(text: string, kind: "cv" | "dump", signal?: AbortSignal): Promise<AiOutcome<ParsedDocument>> {
  const { text: given, omitted } = redactPersonalData(text);
  // Before the hash and the call: a text the reading cannot take is said so here, where the cost of knowing is nothing.
  const problem = importTextProblem(given);
  if (problem) return { ok: false, message: problem };
  // A story has no header to read a name from, and what someone says in it of themselves is theirs: only a CV is read for who it is of.
  const known = kind === "cv" ? knownContact(given) : null;
  const masking = maskContact(given, { kind: kind === "cv" ? "document" : "free", names: namesFor(known?.fullName?.value) });
  const sent = masking.text;
  const cacheKey = `${await sha256Hex(sent)}:${kind}:${EXTRACT_PROMPT_VERSION}`;
  const read = (extracted: Extraction): ParsedDocument => {
    const verified = verifyExtraction(given, masking.restore(extracted), kind);
    const checked = { ...verified, contact: contactOf(verified.contact, known), omittedPersonalData: omitted };
    // Off (`ENGINE.aiReading`): a block both this and the app's own patterns read the same would be given as good.
    return ENGINE.aiReading.trustAgreement && kind === "cv" ? trustAgreeing(checked, parseDocument({ text: given })) : checked;
  };
  // Loaded first: a hit found only after the database answers is a call not spent.
  await ensureOnboardingStoresHydrated();
  const cached = readCache<Extraction>(EXTRACT_CACHE_KEY)[cacheKey];
  if (cached) return { ok: true, result: read(cached.result), fromCache: true };

  try {
    const extracted = await callGenerator<Extraction>("/api/generate/import", { text: sent, kind }, signal);
    rememberInCache(EXTRACT_CACHE_KEY, cacheKey, extracted);
    return { ok: true, result: read(extracted), fromCache: false };
  } catch (error) {
    return { ok: false, message: messageFor(error), reason: reasonFor(error) };
  }
}

/**
 * Separates one narrative answer into the facts it states, checked so that
 * "separating" cannot quietly become "rewriting" — see `verifySplit`. Falls
 * back to nothing (never throws): the caller already has the deterministic,
 * one-fact-per-sentence split to use when this comes back empty or failed.
 *
 * Both take an `AbortSignal`: a wait of up to a few minutes is one the person can walk away from, and what they
 * walked away from is not applied (`AiAction` aborts it). A call that was cancelled comes back as a failure like
 * any other, and `AiAction` knows by the signal that it was theirs and says nothing.
 */
export async function splitWithAi(answer: string, signal?: AbortSignal): Promise<AiOutcome<string[]>> {
  // The same promise as a reading: what the product does not use does not go, nor who the person is, and a piece is a run of what was given.
  const { text: given } = redactPersonalData(answer);
  const masking = maskContact(given, { kind: "free", names: namesFor() });
  const sent = masking.text;
  const pieces = (split: SplitResult): string[] => verifySplit(given, masking.restore(split)).filter((piece) => !isStruckOut(piece));
  const cacheKey = `${await sha256Hex(sent)}:${SPLIT_PROMPT_VERSION}`;
  await ensureOnboardingStoresHydrated();
  const cached = readCache<SplitResult>(SPLIT_CACHE_KEY)[cacheKey];
  if (cached) return { ok: true, result: pieces(cached.result), fromCache: true };

  try {
    const split = await callGenerator<SplitResult>("/api/generate/split", { answer: sent }, signal);
    rememberInCache(SPLIT_CACHE_KEY, cacheKey, split);
    return { ok: true, result: pieces(split), fromCache: false };
  } catch (error) {
    return { ok: false, message: messageFor(error), reason: reasonFor(error) };
  }
}

/**
 * "Mejorar con IA": a line of a job, or the description of a project, said better by the person's own model (`/api/generate/improve`) —
 * the same facts, and nothing new. Sent the way a reading is: what the product does not use struck out, who the person is taken out
 * (`maskContact`), and what comes back put right again before it is looked at. Then checked against what was written (`checkImprovement`):
 * a figure the text did not state, and the proposal is gone.
 *
 * A proposal, never a change: it is not applied here, and it is not cached —asking again is asking for another one—; the screen shows it
 * next to the original and the person decides. Never throws: a failure comes back as the sentence `AiAction` shows.
 */
export async function improveWithAi(text: string, kind: ImproveKind, signal?: AbortSignal): Promise<AiOutcome<{ text: string; same: boolean }>> {
  const { text: given } = redactPersonalData(text);
  const masking = maskContact(given, { kind: "free", names: namesFor() });
  try {
    const reply = await callGenerator<{ text: string }>("/api/generate/improve", { text: masking.text, kind }, signal);
    const checked = checkImprovement(text, masking.restore(typeof reply?.text === "string" ? reply.text : ""), kind);
    return checked.ok ? { ok: true, result: { text: checked.text, same: checked.same }, fromCache: false } : { ok: false, message: checked.message };
  } catch (error) {
    return { ok: false, message: messageFor(error), reason: reasonFor(error) };
  }
}

/**
 * `improveWithAi` for all the texts a section of the profile can say better, as few calls as fit (`IMPROVE_BATCH`): the button at the top of an accordion.
 * Each text is sent the way a single one is — what the product does not use struck out, who the person is taken out, and what comes back put right again — and each
 * proposal is checked on its own (`checkImprovement`). What comes back, by the `id` the caller gave, is only what changes something and was not thrown out; if every
 * proposal was thrown out, it is the sentence of the first, and if the model had nothing to say it is an empty list. Not cached, like the single form.
 */
export async function improveManyWithAi(
  items: ReadonlyArray<{ id: string; kind: ImproveManyKind; text: string }>,
  signal?: AbortSignal,
): Promise<AiOutcome<Array<{ id: string; text: string }>>> {
  const names = namesFor();
  const prepared = items
    .map((item) => {
      const masking = maskContact(redactPersonalData(item.text).text, { kind: "free", names });
      return { ...item, masking };
    })
    // shortcut: a text that only stops fitting its field once its details are marked (an address of a few characters becomes «[CORREO_1]») is left as it is, not improved; upgrade if anyone reports one.
    .filter((item) => item.masking.text.length <= IMPROVE_MANY_LIMIT[item.kind]);

  // In order, a call at a time: the person can stop waiting, and a call that was cancelled must not be followed by another.
  const calls: Array<typeof prepared> = [];
  let chars = 0;
  for (const item of prepared) {
    const last = calls[calls.length - 1];
    if (!last || last.length >= IMPROVE_BATCH.items || chars + item.masking.text.length > IMPROVE_BATCH.chars) {
      calls.push([item]);
      chars = 0;
    } else {
      last.push(item);
    }
    chars += item.masking.text.length;
  }

  const proposals: Array<{ id: string; text: string }> = [];
  let firstRejected: string | undefined;
  for (const call of calls) {
    try {
      const reply = await callGenerator<{ items?: Array<{ id?: unknown; text?: unknown }> }>(
        "/api/generate/improve",
        { items: call.map((item, place) => ({ id: String(place), kind: item.kind, text: item.masking.text })) },
        signal,
      );
      for (const answer of Array.isArray(reply?.items) ? reply.items : []) {
        const item = typeof answer?.id === "string" && /^\d+$/.test(answer.id) ? call[Number(answer.id)] : undefined;
        if (!item || typeof answer.text !== "string") continue;
        const checked = checkImprovement(item.text, item.masking.restore(answer.text), item.kind);
        if (!checked.ok) firstRejected ??= checked.message;
        else if (!checked.same) proposals.push({ id: item.id, text: checked.text });
      }
    } catch (error) {
      return { ok: false, message: messageFor(error), reason: reasonFor(error) };
    }
  }
  if (proposals.length === 0 && firstRejected) return { ok: false, message: firstRejected };
  return { ok: true, result: proposals, fromCache: false };
}

/** Less than this is not a page read: the model found nothing to copy, or little enough that a photo of a CV was not what it saw. */
const MIN_PHOTO_TEXT = 60;

/**
 * A photo or a scan of a CV, read into text by the person's own model (`/api/generate/transcribe`).
 *
 * What comes back is a text for the person to look at against their photo, not a reading: it is put where pasted text goes, with
 * a warning, and read into a profile from there like any other text — with everything marked as read with a model, because it
 * was. There is no check here that a model can run on its own work: the only thing a transcription can be compared with is the
 * picture, and only the person has it in front of them. Nothing is cached: the cache is by the hash of a text, and this has none
 * until it is read.
 *
 * The photo goes whole, personal details and all — nothing can be struck out of a picture — and so only with a key of their own;
 * the screen that asks says so (`photoFooter`), and so does the policy (clause 5).
 */
export async function transcribeWithAi(file: File, signal?: AbortSignal): Promise<AiOutcome<string>> {
  let image: Awaited<ReturnType<typeof preparePhoto>>;
  try {
    image = await preparePhoto(file);
  } catch (error) {
    return { ok: false, message: error instanceof PhotoError ? error.message : "No pudimos preparar esa foto. Probá con otra." };
  }
  try {
    const { text } = await callGenerator<{ text: string }>("/api/generate/transcribe", { image: image.base64, mediaType: image.mediaType }, signal);
    const clean = typeof text === "string" ? text.trim() : "";
    if (clean.length < MIN_PHOTO_TEXT) {
      return { ok: false, message: "No encontramos texto en esa foto. Probá con otra, más cerca y con buena luz; o copiá el texto y pegalo." };
    }
    return { ok: true, result: clean, fromCache: false };
  } catch (error) {
    return { ok: false, message: messageFor(error), reason: reasonFor(error) };
  }
}

/**
 * Which of a few fixed questions to ask next, chosen by the person's own model (`/api/generate/followup`): an experiment they turn
 * on. What goes is what they just answered, with the details the product does not use struck out first and who they are taken out
 * (`maskContact`), and the questions; what
 * comes back is the id of one of them, or none — and an id that was not on the list is none: the choice is checked here as well as
 * in the route, because nothing a model says is taken for more than it is. Never cached: it is a choice about this moment.
 */
export async function chooseFollowUpWithAi(answer: string, options: readonly { id: string; about: string }[], signal?: AbortSignal): Promise<AiOutcome<string | null>> {
  const { text: sent } = maskContact(redactPersonalData(answer).text, { kind: "free", names: namesFor() });
  const known = new Set(options.map((option) => option.id));
  try {
    const { choice } = await callGenerator<{ choice: string }>("/api/generate/followup", { answer: sent, options }, signal);
    return { ok: true, result: known.has(choice) ? choice : null, fromCache: false };
  } catch (error) {
    return { ok: false, message: messageFor(error), reason: reasonFor(error) };
  }
}

