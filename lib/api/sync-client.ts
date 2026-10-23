"use client";

import { fetchAccountProfile } from "@/lib/api/account-profile";
import { recordMetric } from "@/lib/metrics/store";
import { joinProfiles, type JoinCounts } from "@/lib/profile/join";
import { parseAnyProfile } from "@/lib/profile/parse";
import { PULL_ACCOUNT_INTO_NOTHING, hasSubstance, joinPrompt, pullAccountPrompt, pullReplacesPrompt, uploadReplacesPrompt } from "@/lib/profile/replace-guard";
import { forSync } from "@/lib/profile/sync";
import { syncStatus } from "@/lib/profile/sync-status";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { listApplications, loadDeletedApplicationIds, loadStoredProfile, recordDeletedApplicationIds, replaceApplicationsFromAccount, saveStoredProfile, transformStoredProfile } from "@/lib/storage/local";
import { withoutFitTrace } from "@/lib/storage/applications/normalize";
import { recordBackupMade } from "@/lib/storage/backup-reminder";
import { downloadAccountBackup } from "@/lib/storage/download";
import { STORAGE_MESSAGES } from "@/lib/storage/errors";
import { saveProfileFile } from "@/lib/storage/profile-copy";
import { readSyncState, recordSynced, setAutoSync, settleAccountVersion } from "@/lib/storage/sync-state";

/**
 * `POST /api/sync`, in one place: Ajustes' "Subir a mi cuenta" and the
 * first-run flow's own save prompt both send the same request and read the
 * same server contract, so the two can never drift into showing a different
 * outcome for the same click.
 *
 * Reads the profile and the applications from storage directly rather than
 * taking them as arguments — "read now, not from a render's copy" applies to
 * both: this is an explicit upload of whatever is on disk at the moment of
 * the click, and a caller with no applications state of its own (the
 * onboarding has none) gets the same correct behaviour as one that does.
 *
 * Sent in batches. The server takes at most 1 MiB per request, 500
 * applications and 500 deleted ids (`app/api/sync/route.ts`), and a history of
 * a few dozen applications already passed the first of those: the upload
 * answered 413 and nothing went up at all. The server's upload is additive — it
 * never removes rows a request does not mention — so a history split across
 * requests lands exactly as one request would have left it.
 */

export type SyncPushResult = {
  /** How many applications the server actually kept. */
  applications: number;
  skippedOversize: number;
  skippedFull: number;
};

/** Under the server's 1 MiB with room for headers and rounding — see `MAX_BODY_BYTES` in the route. */
export const MAX_BATCH_BYTES = 900 * 1024;

/** The route's `.max(500)` on both arrays. */
export const MAX_BATCH_ITEMS = 500;

const encoder = new TextEncoder();
const byteLength = (value: unknown) => encoder.encode(JSON.stringify(value)).length;

/**
 * Splits applications into requests that each fit beside `fixedBytes` (the
 * profile and whatever else every request carries). One that cannot fit even on
 * its own is left out and counted, rather than failing the batch it lands in.
 */
export function batchApplications(
  applications: readonly unknown[],
  fixedBytes: number,
  maxBytes = MAX_BATCH_BYTES,
  maxItems = MAX_BATCH_ITEMS,
): { batches: unknown[][]; tooLarge: number } {
  const budget = maxBytes - fixedBytes;
  const batches: unknown[][] = [];
  let current: unknown[] = [];
  let size = 0;
  let tooLarge = 0;
  for (const application of applications) {
    // +1 for the comma between array elements.
    const bytes = byteLength(application) + 1;
    if (bytes > budget) {
      tooLarge += 1;
      continue;
    }
    if (current.length > 0 && (size + bytes > budget || current.length >= maxItems)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(application);
    size += bytes;
  }
  if (current.length > 0) batches.push(current);
  return { batches, tooLarge };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

/**
 * Throws with a message meant to be shown as-is — every caller already displays `error.message` the same way every other
 * action on these screens does.
 *
 * `userId` is the account it goes to: what this browser remembers of the meeting (`recordSynced`) is about that account
 * and no other. It is remembered with the `rev` the profile had when it was read to be sent, not the one it has by the
 * time the answer arrives: a change made while it was going up is not in what went up.
 */
export async function uploadProfile(userId: string): Promise<SyncPushResult> {
  const sent = loadStoredProfile();
  const profileV2 = forSync(sent);
  // The fitting trace does not travel: it belongs to this browser's flow and to
  // the CV it was taken from, and the account has no use for either field.
  const applications = (await listApplications()).map(withoutFitTrace);
  const deletedChunks = chunk(loadDeletedApplicationIds(), MAX_BATCH_ITEMS);

  // What every request carries besides its applications, measured with the
  // largest deleted-ids chunk so no request can come out bigger than planned.
  const fixedBytes = byteLength({ profileV2, applications: [], deletedIds: deletedChunks[0] ?? [] });
  const { batches, tooLarge } = batchApplications(applications, fixedBytes);
  const requests = Math.max(batches.length, deletedChunks.length, 1);

  const result: SyncPushResult = { applications: 0, skippedOversize: tooLarge, skippedFull: 0 };
  for (let index = 0; index < requests; index++) {
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileV2,
        applications: batches[index] ?? [],
        ...(deletedChunks[index] ? { deletedIds: deletedChunks[index] } : {}),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = typeof payload.error === "string" ? payload.error : "Error al subir.";
      if (index === 0) throw new Error(reason);
      // Some of it is up. Saying "falló" as if nothing were would send the
      // person to retry from scratch, which is harmless but confusing; saying
      // how far it got is the truth.
      throw new Error(
        `Subimos ${result.applications} postulaciones y después falló: ${reason} Volvé a intentar para subir el resto.`,
      );
    }
    // Every request carries the profile, so the first one that was accepted is the one that put it there: the applications
    // that follow can fail without the account lacking it.
    if (index === 0) {
      recordSynced(userId, sent.rev, sent.updatedAt);
      recordMetric("profile_uploaded");
    }
    result.applications += typeof payload.applications === "number" ? payload.applications : 0;
    result.skippedOversize += typeof payload.skippedOversize === "number" ? payload.skippedOversize : 0;
    result.skippedFull += typeof payload.skippedFull === "number" ? payload.skippedFull : 0;
  }

  recordBackupMade(applications.length);
  return result;
}

type Ask = (message: string, options?: { title?: string; confirmLabel?: string; confirmTone?: "danger" | "primary" }) => Promise<boolean>;

export type UploadOutcome = { status: "uploaded"; result: SyncPushResult } | { status: "cancelled" };

/**
 * «Subir», the way every screen that offers it does it: over a profile the account already has this replaces it, so that
 * is said first, with both side by side, and the one that goes is written down before it does. Ajustes, the end of the
 * first-run flow and the list of what is left to do on the profile all did it, or should have, in the same words — one
 * place, so none of them can come to do it differently.
 */
export async function uploadWithGuard(userId: string, ask: Ask): Promise<UploadOutcome> {
  const account = await fetchAccountProfile();
  if (account) {
    const proceed = await ask(uploadReplacesPrompt(account, loadStoredProfile()), {
      title: "Reemplazar el perfil de tu cuenta",
      confirmLabel: "Bajar la copia y reemplazar",
    });
    if (!proceed) return { status: "cancelled" };
    saveProfileFile(account, "perfil-de-tu-cuenta");
  }
  return { status: "uploaded", result: await uploadProfile(userId) };
}

/**
 * The account's profile, in the place of this browser's. The caller has asked and, where something is replaced, has the
 * copy: this only does it, and remembers that the account and this browser now say the same thing.
 *
 * Throws what the browser says when it cannot keep it (`StorageWriteError`): the profile in this browser is then the
 * one it had, which is better said than hidden.
 */
export function adoptAccountProfile(userId: string, account: StoredProfile): void {
  const hadNothing = !hasSubstance(loadStoredProfile());
  saveStoredProfile(account);
  recordSynced(userId, loadStoredProfile().rev, account.updatedAt);
  recordMetric("profile_pulled");
  // Brought back into a browser where it was not: the one way to know, from here, that a profile was lost and found (I7).
  if (hadNothing && hasSubstance(account)) recordMetric("profile_recovered");
}

export type PullOutcome = { status: "brought" } | { status: "cancelled" };

/**
 * «Traerlo»: asks the account for its profile again — what was on screen may be minutes old — and, where it replaces
 * something worth keeping, says so and writes the replaced profile down first, as «Subir» does the other way round.
 */
export async function pullWithGuard(userId: string, ask: Ask): Promise<PullOutcome> {
  const account = await fetchAccountProfile();
  // What is offered is a profile with something in it (`accountOffer`): the account's can have changed since, and a name with
  // nothing else is not worth putting in the place of anything.
  if (!account || !hasSubstance(account)) throw new Error("Tu cuenta ya no tiene un perfil guardado, o no pudimos consultarla. Probá de nuevo en un rato.");
  const local = loadStoredProfile();
  if (hasSubstance(local)) {
    const proceed = await ask(pullReplacesPrompt(local, account), {
      title: "Reemplazar el perfil de este navegador",
      confirmLabel: "Bajar la copia y reemplazar",
    });
    if (!proceed) return { status: "cancelled" };
    saveProfileFile(local, "perfil-de-este-navegador");
  }
  adoptAccountProfile(userId, account);
  return { status: "brought" };
}

/** What `GET /api/sync?export=account` answers: the account's profile and postings, and what else the account holds that is the person's to have. */
export type AccountPayload = {
  profileV2?: unknown;
  profile?: unknown;
  applications?: unknown[];
  deletedIds?: string[];
  account?: unknown;
  sessions?: unknown[];
  creditPurchases?: unknown[];
  consents?: unknown[];
  legalRequests?: unknown[];
  error?: string;
};

export type PullAllOutcome = { status: "brought"; payload: AccountPayload; profile: StoredProfile | null } | { status: "cancelled" };

/**
 * «Bajar de mi cuenta»: every posting of the account in the place of this browser's, and its profile when it has one. It replaces both,
 * so it does what every other tap that replaces something does: asks the account first (what is on screen may be minutes old), says what it
 * will replace by what with both sides in numbers, and writes down what goes before it does — the whole of this browser, profile and
 * postings. Where this browser has nothing worth a copy it only asks whether to bring it.
 *
 * The postings go first, in one step: they are the big write, the one a browser with no room refuses, and when it does nothing else has
 * changed. Throws with a sentence meant to be shown as it is. The caller has the rest of what the account answered, to hand over as the file of
 * everything it holds — what the privacy policy promises this button does — and to reload over what was written.
 */
export async function pullAllWithGuard(userId: string, ask: Ask): Promise<PullAllOutcome> {
  const response = await fetch("/api/sync?export=account");
  const payload = ((await response.json().catch(() => ({}))) ?? {}) as AccountPayload;
  if (!response.ok) throw new Error(payload.error ?? "Error al bajar.");

  // Deletions made on another device must land here too, or the next upload would resurrect what was erased there.
  const deletedIds = payload.deletedIds ?? [];
  const deleted = new Set(deletedIds);
  const applications = (payload.applications ?? []).filter((application) => {
    const id = application && typeof application === "object" ? (application as { id?: unknown }).id : undefined;
    return !(typeof id === "string" && deleted.has(id));
  });
  // `profileV2` is what current servers send; `profile` (plain) is what they send beside it for browsers still running the build from before
  // provenance. Either reads as a stored profile, and neither — an account that never uploaded one — leaves this browser's profile alone.
  const account = parseAnyProfile(payload.profileV2 ?? payload.profile);

  const here = { profile: loadStoredProfile(), applications: (await listApplications()).length };
  const somethingToKeep = hasSubstance(here.profile) || here.applications > 0;
  const proceed = await ask(
    somethingToKeep ? pullAccountPrompt(here, { profile: account, applications: applications.length }) : PULL_ACCOUNT_INTO_NOTHING,
    somethingToKeep ? { title: "Bajar de mi cuenta", confirmLabel: "Bajar la copia y reemplazar" } : { title: "Bajar de mi cuenta", confirmLabel: "Bajar", confirmTone: "primary" },
  );
  if (!proceed) return { status: "cancelled" };
  if (somethingToKeep) await downloadAccountBackup();

  const outcome = await replaceApplicationsFromAccount(applications);
  if (!outcome.ok) {
    throw new Error(`No pudimos guardar las postulaciones de tu cuenta en este navegador, y no cambiamos nada. ${STORAGE_MESSAGES[outcome.kind]}`);
  }
  if (account) adoptAccountProfile(userId, account);
  recordDeletedApplicationIds(deletedIds);
  return { status: "brought", payload, profile: account };
}

/** The sentence Ajustes has always shown after a push — factored out so a second caller builds the same one. */
export function describeUpload(result: SyncPushResult): string {
  const skipped = [
    result.skippedOversize > 0 ? `${result.skippedOversize} demasiado grandes (máximo 64 KB cada una)` : null,
    result.skippedFull > 0 ? `${result.skippedFull} porque ya tenés 500 guardadas en tu cuenta` : null,
  ].filter((entry): entry is string => entry !== null);
  return (
    `Subimos tu perfil y ${result.applications} postulaciones.` +
    (skipped.length > 0 ? ` No se subieron: ${skipped.join(" y ")}.` : "")
  );
}

/**
 * The profile alone, in one request: what «Mantener sincronizado» sends each time. The applications are many and big, and a change
 * in one of them is not a change of the profile; they go when the person taps «Subir a mi cuenta». What the account has of them
 * is left as it is — the server's upload is additive.
 *
 * Remembered with the `rev` the profile had when it was read to be sent, as `uploadProfile` does. Throws with a sentence meant
 * to be shown as it is.
 */
export async function uploadProfileOnly(userId: string): Promise<void> {
  const sent = loadStoredProfile();
  const response = await fetch("/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profileV2: forSync(sent), applications: [] }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "No pudimos subir tus cambios.");
  recordSynced(userId, sent.rev, sent.updatedAt);
}

/** What is asked before «Mantener sincronizado» is turned on: it is the permission, so it says what it will do and what it will not. */
export const AUTO_SYNC_ASK = {
  title: "Mantener sincronizado",
  confirmLabel: "Activar",
  /** Nothing is lost by saying yes, and the button should not look as if something were. */
  confirmTone: "primary",
  message:
    "Si lo activás, subimos tu perfil a tu cuenta cada vez que lo cambies, sin que lo pidas, hasta que lo apagues. " +
    "Antes de cada subida miramos que tu cuenta no tenga cambios hechos desde otro celular o computadora: si los tiene, frenamos y te preguntamos, sin borrar nada. " +
    "Tus postulaciones no se suben solas: siguen subiéndose cuando tocás «Subir a mi cuenta». ¿Lo activamos?",
} as const;

export type EnableOutcome = { status: "on"; uploaded: SyncPushResult | null } | { status: "cancelled" };

/**
 * «Mantener sincronizado», turned on: the permission first, said in words, and then — if this browser and the account have not
 * met since the profile last changed — the upload that makes them say the same, with the guard every upload has. Keeping it up
 * to date starts from an account that is up to date, so there is nothing for the first automatic upload to overwrite.
 */
export async function enableAutoSync(userId: string, ask: Ask): Promise<EnableOutcome> {
  if (!(await ask(AUTO_SYNC_ASK.message, { title: AUTO_SYNC_ASK.title, confirmLabel: AUTO_SYNC_ASK.confirmLabel, confirmTone: AUTO_SYNC_ASK.confirmTone }))) return { status: "cancelled" };
  let uploaded: SyncPushResult | null = null;
  if (syncStatus(loadStoredProfile(), readSyncState(), userId) !== "synced") {
    const outcome = await uploadWithGuard(userId, ask);
    if (outcome.status === "cancelled") return { status: "cancelled" };
    uploaded = outcome.result;
  }
  setAutoSync(userId, true);
  return { status: "on", uploaded };
}

/** Turned off: what is already up there stays, and nothing more goes on its own. */
export function disableAutoSync(userId: string): void {
  setAutoSync(userId, false);
}

export type JoinOutcome = { status: "joined"; added: JoinCounts } | { status: "cancelled" };

/**
 * «Juntar los dos»: the account was changed from another device and this browser has changes of its own, and neither is to be
 * thrown away. What the account has that this browser lacks is added (`joinProfiles`), the account's own version is written
 * down first — the upload that follows replaces it — and the result goes up. The account's version is then the one this browser
 * has settled, so the next automatic upload does not take it for a change from somewhere else.
 *
 * Throws what the browser says when it cannot keep the result (`StorageWriteError`), and what the server says when the upload
 * fails: the joined profile is then in this browser, and the account is as it was.
 */
export async function joinWithAccount(userId: string, ask: Ask): Promise<JoinOutcome> {
  const account = await fetchAccountProfile();
  if (!account) throw new Error("Tu cuenta no tiene un perfil guardado, o no pudimos consultarla. Probá de nuevo en un rato.");
  const local = loadStoredProfile();
  const proceed = await ask(joinPrompt(local, account, joinProfiles(local, account).added), {
    title: "Juntar los dos perfiles",
    confirmLabel: "Juntarlos y subir",
    confirmTone: "primary",
  });
  if (!proceed) return { status: "cancelled" };
  saveProfileFile(account, "perfil-de-tu-cuenta");
  // Joined with the profile as it is now, not as it was when the question was asked: it can have changed while it was open.
  let added: JoinCounts | null = null;
  const saved = transformStoredProfile((current) => {
    const joined = joinProfiles(current, account);
    added = joined.added;
    return joined.profile;
  });
  if (!saved || !added) throw new Error("No pudimos guardar el perfil que resultó de juntarlos. Tu cuenta quedó como estaba.");
  settleAccountVersion(account.updatedAt);
  await uploadProfileOnly(userId);
  return { status: "joined", added };
}

