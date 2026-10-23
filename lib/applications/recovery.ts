"use client";

import { getApplication, listApplications, newApplication, saveApplication, type Application } from "@/lib/storage/local";
import { sameJson } from "@/lib/storage/applications/normalize";
import {
  applyCvResult,
  EXTRA_FIELD,
  EXTRA_PATCH,
  fetchGenerationResult,
  isExtraKind,
  type CVResponse,
  type ExtraKind,
  type ExtraResults,
} from "./generation";
import { listPendingGenerations, resolvePendingGeneration, type PendingGeneration } from "./pending";

/**
 * Brings back results that were generated but never stored — once per page
 * load, after the applications are read.
 *
 * Never replaces newer work. A result is applied only to an application that
 * has not changed since its generation started; one that has (the person
 * regenerated, edited, answered something else meanwhile) is left as it is and
 * the marker dropped. A first CV whose application does not exist at all is
 * created, with the id it was always going to have.
 */

let started = false;

function patchFor(kind: ExtraKind, value: unknown): Partial<Application> {
  switch (kind) {
    case "answers":
      return EXTRA_PATCH.answers(value as ExtraResults["answers"]);
    case "email":
      return EXTRA_PATCH.email(value as ExtraResults["email"]);
    case "interview":
      return EXTRA_PATCH.interview(value as ExtraResults["interview"]);
    case "video":
      return EXTRA_PATCH.video(value as ExtraResults["video"]);
  }
}

async function recoverOne(entry: PendingGeneration): Promise<boolean> {
  const result = await fetchGenerationResult(entry.key);
  if (result.status === "missing") {
    // Never finished, already expired, or refused: nothing on the server to bring back.
    resolvePendingGeneration(entry.key);
    return false;
  }
  // Still being written, or the server could not be asked: the next load tries again.
  if (result.status !== "done") return false;

  const current = getApplication(entry.applicationId);
  const untouched = current !== undefined && current.updatedAt < entry.startedAt;
  let next: Application | null = null;

  if (entry.kind === "cv") {
    const value = result.value as CVResponse;
    // A question put before the CV, not a CV: with no answer there is nothing to bring back.
    if (!value.cv) {
      resolvePendingGeneration(entry.key);
      return false;
    }
    if (!current) {
      // Cannot rebuild an application without the posting it was for.
      if (!result.jobText) {
        resolvePendingGeneration(entry.key);
        return false;
      }
      const base = { ...newApplication(result.jobText, "Postulación", entry.applicationId), createdAt: entry.startedAt };
      next = applyCvResult(base, value, result.jobText);
    } else if (untouched && !sameJson(current.cv, value.cv)) {
      next = applyCvResult(current, value, current.jobText);
    }
  } else if (isExtraKind(entry.kind) && current && untouched) {
    const patch = patchFor(entry.kind, result.value);
    const field = EXTRA_FIELD[entry.kind];
    if (!sameJson(current[field], patch[field])) next = { ...current, ...patch };
  }

  if (!next) {
    resolvePendingGeneration(entry.key);
    return false;
  }
  const outcome = await saveApplication(next);
  // A refused save leaves the marker: the application is in memory and waiting
  // (see the applications store), and the server copy is still there for the
  // next load if the waiting copy is lost too.
  if (outcome.ok) resolvePendingGeneration(entry.key);
  return true;
}

/** Returns how many results were brought back. Safe to call more than once: only the first call does anything. */
export async function recoverPendingGenerations(): Promise<number> {
  if (started || typeof window === "undefined") return 0;
  started = true;
  const pending = listPendingGenerations();
  if (pending.length === 0) return 0;
  await listApplications();
  let recovered = 0;
  for (const entry of pending) {
    try {
      if (await recoverOne(entry)) recovered += 1;
    } catch (error) {
      console.warn("[recovery] No pudimos recuperar una generación pendiente.", error);
    }
  }
  return recovered;
}
