"use client";

import { profileSchema, type Profile } from "@/lib/schemas/profile";
import {
  storedProfileSchema,
  type SourceKind,
  type StoredProfile,
} from "@/lib/schemas/profile-v2";
import { migrateV1 } from "@/lib/profile/migrate";
import { parseAnyProfile, readStoredProfile } from "@/lib/profile/parse";
import { toPlainProfile } from "@/lib/profile/project";
import { reconcileFromPlain } from "@/lib/profile/reconcile";
import { INTAKE_KEY, intakeStoreSchema, type IntakeStore } from "@/lib/schemas/intake";
import type { JobAnalysis, InferredSkill } from "@/lib/schemas/job";
import { DEFAULT_MODEL, type ProviderId } from "@/lib/ai/provider-catalog";
import { isGenerationErrorKind, type GenerationErrorKind } from "@/lib/ai/error-kind";
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABEL,
  isApplicationStatus,
  type ApplicationStatus,
} from "@/lib/tracker/status";
import { EXPERIMENTS_KEY } from "@/lib/experiments";
import { SHARE_CACHE } from "@/lib/notes/share";
import { applicationSchema, type Application } from "./application";
import {
  STORAGE_MESSAGES,
  StorageFullError,
  StorageWriteError,
  storageWriteError,
  type StorageErrorKind,
} from "./errors";
import { APPLICATIONS_KEY } from "./applications/keys";
import {
  clearApplicationRecords,
  getApplicationRecord,
  listApplicationRecords,
  mergeApplicationRecords,
  onLegacyApplicationsReleased,
  quarantineApplicationRows,
  removeApplicationRecords,
  replaceAllApplicationRecords,
  saveApplicationRecord,
  wipeApplicationRecords,
  type SaveOutcome,
} from "./applications/store";
import { normalizeStoredApplication, withoutFitTrace } from "./applications/normalize";
import { loadLegacySnapshot } from "./applications/snapshot";
import { clearAppDatabase, clearDatabaseTables, openAppDatabase } from "./db";

/**
 * Browser-first persistence. Everything the user has lives here first; an
 * account is optional and syncs this up rather than replacing it.
 *
 * Two stores, by size and by how they are read:
 *
 * - localStorage, for what is small and read synchronously on every request or
 *   render: the profile, the BYOK keys, drafts, preferences, caches.
 * - IndexedDB (through `./applications/store`), for the applications. This
 *   comment used to say localStorage was enough for "a profile plus a few dozen
 *   applications" and that this module was the seam to swap stores behind "if
 *   that ever stops being true". It stopped: a real history of ~200 filled the
 *   5 MiB every browser gives localStorage, after which a CV the model had
 *   already written could not be saved and the page reported «Ocurrió un error
 *   inesperado». Applications now live in memory first and reach storage
 *   through a queue, so a refused write is a state of one record — shown, kept,
 *   retried — and never a lost document.
 */

export { applicationSchema, type Application };
export { StorageFullError, StorageWriteError };
export { StorageUnavailableError, classifyStorageError, type StorageErrorKind } from "./errors";
export { APPLICATIONS_KEY };
export type { SaveOutcome, ApplicationsStatus, UnsavedApplication } from "./applications/store";

/**
 * The profile as it is stored: every value with its provenance. Read the
 * comments in `lib/schemas/profile-v2.ts`; what the generators get is the plain
 * projection of it, `loadProfile()` below.
 */
export const PROFILE_KEY = "cvexact.profile.v2";
/**
 * The profile as it was before provenance. Nothing writes it any more; it is
 * read once, by `migrateProfileToV2`, and what it held is kept under
 * `PROFILE_V1_BACKUP_KEY`.
 */
export const PROFILE_V1_KEY = "cvexact.profile.v1";
/** The last v1 profile this browser held, kept whole and never read back by the app. */
export const PROFILE_V1_BACKUP_KEY = "cvexact.profile.v1.bak";
/**
 * A stored profile that would not parse, set aside untouched. The current key is
 * about to be overwritten by whatever the user does next, and their only copy
 * must not go with it.
 */
export const PROFILE_CORRUPT_KEY = "cvexact.profile.v2.corrupt";
/**
 * The documents the user brought, line by line, kept only in this browser so the
 * review can show the original next to what was read. Never synced: what it holds
 * is the whole text of a CV, and the profile's own values already carry the
 * fragments that matter.
 */
export const SOURCES_KEY = "cvexact.sources.v1";
export const SETTINGS_KEY = "cvexact.settings.v1";
export const DRAFT_JOB_TEXT_KEY = "cvexact.draftJobText.v1";
export const DISMISSED_JOBS_KEY = "cvexact.dismissedJobs.v1";
/** Whether `/empleos` may reorder the feed by semantic similarity — off by
 *  default, since turning it on makes the browser download an embedding
 *  model. See `useSemanticJobsEnabled` and `lib/jobs/semantic.ts`. */
export const SEMANTIC_JOBS_KEY = "cvexact.semanticJobs.v1";
/**
 * Ids of deleted applications, kept so a later sync knows to remove them from
 * the account instead of resurrecting them. Tombstones are never removed by a
 * delete — only a restore (importBackup) or a pull that replaces the store
 * retires the ones it re-adds.
 */
export const DELETED_APPLICATIONS_KEY = "cvexact.deletedApplications.v1";
/**
 * AI extraction responses, and AI-split narrative answers, cached by a hash of
 * the text sent — so pasting the same document twice, or asking to "separate"
 * an answer that has not changed, never spends a second call. See
 * `lib/onboarding/ai.ts`, the only reader and writer of either. Local only:
 * not synced, not in an exported backup.
 */
export const EXTRACT_CACHE_KEY = "cvexact.extractCache.v1";
export const SPLIT_CACHE_KEY = "cvexact.splitCache.v1";

/**
 * "Contame tu recorrido" (`DumpStep`), autosaved the same way the draft job
 * text in Postular is — a document open for less than a paragraph is still a
 * document, and the flow's own "todo se guarda automáticamente" promise does
 * not carve out an exception for this one field. Local only: not synced, not
 * in an exported backup.
 */
export const DUMP_DRAFT_KEY = "cvexact.dumpDraft.v1";
/** What was half written in the review's forms and the paste box — `lib/onboarding/drafts.ts`. Cleared with the rest. */
export const FORM_DRAFTS_KEY = "cvexact.formDrafts.v1";

/**
 * Generations whose result has not reached storage yet, by the idempotency key
 * the server knows them by (see `lib/applications/pending.ts`). A key, a kind
 * and an application id each: small enough to fit where a CV no longer does.
 */
export const PENDING_GENERATIONS_KEY = "cvexact.pendingGenerations.v1";

/** When a copy of the history was last made — export, archive or upload — for the reminder in /postulaciones. */
export const BACKUP_REMINDER_KEY = "cvexact.backupReminder.v1";

/**
 * What this browser knows of its profile's last meeting with an account: with whom, at which `rev`, when. Kept apart
 * from the profile because it is about this browser and this account and means nothing anywhere else — it is not synced,
 * not in a backup — and apart from `BACKUP_REMINDER_KEY` because a copy to a file and an upload are not the same thing.
 */
export const SYNC_STATE_KEY = "cvexact.syncState.v1";

/** What the person has done here, counted per day, to read, download or erase — `lib/metrics/counters.ts`. Local only. */
export const METRICS_KEY = "cvexact.metrics.v1";

/**
 * Until when «Ahora no» silences the offer of the review of what changed (`lib/profile/return.ts`). About this browser and not about
 * the profile — it is not synced and not in a copy — and apart from the profile because saying «ahora no» is not an edit of it.
 */
export const RETURN_REVIEW_KEY = "cvexact.returnReview.v1";

/**
 * What the person said about the AI when it was offered (`lib/storage/ai-choice.ts`): «Sigo sin IA», so that the offer of a key does not come back at the end of every
 * session. About this browser and not about the profile — not synced, not in a copy — and it holds no key and nothing of what is sent to a model.
 */
export const AI_CHOICE_KEY = "cvexact.aiChoice.v1";

/**
 * Which applications were already asked what they were asked at the interview (`components/postulaciones/InterviewQuestion.tsx`, O12): one question
 * for each, and not again if the status goes back and forth. About this browser and not about the profile — not synced, not in a copy.
 */
export const INTERVIEW_ASKED_KEY = "cvexact.interviewAsked.v1";

/**
 * What the person left «solo en este CV» when the card of what they changed by hand asked (`components/wizard/CorrectionsSection.tsx`, O11): for each
 * application, which changes — by what they are counted by — are not asked again. About this browser and about one CV, and not about the profile:
 * not synced, not in a copy.
 */
export const CORRECTIONS_SETTLED_KEY = "cvexact.correctionsSettled.v1";

/**
 * A profile the browser refused to store, kept in sessionStorage until it takes
 * it (see `pendingProfile` below). sessionStorage has a quota of its own, so it
 * usually still has room when localStorage has none, and it survives the reload
 * that a refused write most needs to survive.
 */
export const PROFILE_PENDING_KEY = "cvexact.profilePending.v1";

export { APPLICATION_STATUSES, APPLICATION_STATUS_LABEL, isApplicationStatus };
export type { ApplicationStatus };

/** One provider the user has configured. */
export type ProviderEntry = {
  /** Empty means the row exists but has not been filled in yet. */
  provider: ProviderId | "";
  apiKey: string;
  /**
   * The model id, or empty for AUTO.
   *
   * Empty is the state most rows are in, and it is deliberately never
   * rewritten: the resolved id is computed per request by `resolvedModel`
   * below, so a row that never named a model keeps inheriting `DEFAULT_MODEL`
   * — which is what lets a release fix a retired or tier-blocked default for
   * every such user without them touching Ajustes. Persisting what the default
   * happened to be would turn that inheritance into a choice nobody made.
   */
  model: string;
  /**
   * The second identifier the providers in `ACCOUNT_ID_LABEL` need — today only
   * Cloudflare, whose account is part of its base URL rather than of its key.
   *
   * Optional so that every settings object already in a browser's
   * `localStorage` keeps parsing untouched, and so the other eleven providers
   * never carry a field that means nothing to them.
   */
  accountId?: string;
};

/**
 * BYOK settings. The API key never leaves the browser except as a request
 * header.
 *
 * A list rather than one provider, in preference order: when the first runs out
 * of quota, refuses for want of credit, or turns out to have a per-minute
 * budget too small for a CV, the server moves down it instead of failing. See
 * `ModelChain` in `@/lib/ai/provider`.
 */
export type Settings = {
  entries: ProviderEntry[];
};

export const emptyEntry = (): ProviderEntry => ({ provider: "", apiKey: "", model: "" });

/**
 * The model id a row actually resolves to, matching what a generation would
 * ask for.
 *
 * Read-only by contract: this is where AUTO is decided (empty → the provider's
 * pinned default), and the answer is never written back into settings. The
 * three legs of that contract — empty in storage, omitted from the request
 * (`requestHeaders` in `@/lib/api/client` sends the raw field, undefined and
 * all), default resolved on the server (`candidatesFor` in `@/lib/ai/provider`)
 * — are pinned by `tests/settings-auto.test.ts` and `tests/model-chain.test.ts`.
 */
export function resolvedModel(entry: Pick<ProviderEntry, "provider" | "model">): string {
  if (!entry.provider) return entry.model.trim();
  return entry.model.trim() || DEFAULT_MODEL[entry.provider];
}

export const emptySettings = (): Settings => ({ entries: [] });

/**
 * Subscription plumbing for the hooks in ./hooks.ts. The browser's `storage`
 * event only fires in *other* tabs, so same-tab writes are broadcast through
 * this listener set — otherwise saving a profile would not refresh the page
 * that saved it.
 */
const listeners = new Set<() => void>();

export function subscribeToStorage(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function readRaw(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function read<T>(key: string, fallback: T): T {
  const raw = readRaw(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt or unparseable entry: fall back rather than crash the page.
    return fallback;
  }
}

/**
 * Exported so other storage modules write their own keys through the same path:
 * a refused write surfaces as a `StorageWriteError` rather than vanishing —
 * `StorageFullError` when the quota is gone, `StorageUnavailableError` when the
 * browser will not let the page store anything — and every
 * `useSyncExternalStore` subscriber is notified in the tab that wrote.
 *
 * It used to call every failure «full» and tell the person to delete old
 * applications. Those no longer live here, and «the browser is blocking this
 * site» was never fixed by deleting anything.
 */
export function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    throw storageWriteError(error);
  } finally {
    listeners.forEach((listener) => listener());
  }
}

/**
 * Tells every subscriber something changed, for the writers whose state is not a
 * localStorage key — the pending profile below lives in module memory and would
 * otherwise repaint nothing on its own.
 */
export function notifyStorageListeners(): void {
  listeners.forEach((listener) => listener());
}

// --- Profile ------------------------------------------------------------------

/**
 * Sets aside a profile that could not be read.
 *
 * Copied, not moved: the app carries on with an empty profile and a save would
 * write over the current key, so this copy is what stands between a corrupt
 * read and a lost profile. The first one is kept — a later, emptier state must
 * not replace the evidence.
 */
function quarantineProfile(raw: string | null): void {
  if (raw === null || readRaw(PROFILE_CORRUPT_KEY) !== null) return;
  try {
    window.localStorage.setItem(PROFILE_CORRUPT_KEY, raw);
  } catch {
    // Nowhere to put it either. The current key is still untouched until a save.
  }
}

/** The raw text of a quarantined profile, for the user to download. */
export function readCorruptProfile(): string | null {
  return readRaw(PROFILE_CORRUPT_KEY);
}

/** The user has the copy and no longer needs it kept here. */
export function discardCorruptProfile(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PROFILE_CORRUPT_KEY);
  } catch {
    // Nothing to remove if the store is unavailable.
  }
  listeners.forEach((listener) => listener());
}

/**
 * A profile the browser refused to store — the last one anything tried to save.
 *
 * Without this, a refused write left the old profile on disk and the editors
 * re-read it: what the person had just typed disappeared from the screen, and
 * the next edit was built on the old version, losing the first one for good.
 * Now the refused profile stays the current one — `loadStoredProfile` returns
 * it, the hooks show it — until a later write gets it to disk: the next save,
 * the tab coming back into view, or `retryPendingProfile`.
 */
let pendingProfile: StoredProfile | null = null;
let pendingProfileKind: StorageErrorKind | null = null;

function setPendingProfile(profile: StoredProfile, kind: StorageErrorKind): void {
  pendingProfile = profile;
  pendingProfileKind = kind;
  try {
    window.sessionStorage.setItem(PROFILE_PENDING_KEY, JSON.stringify(profile));
  } catch {
    // Memory still has it for as long as this tab is open.
  }
}

/** Forgets the pending profile. True when there was one to forget. */
function clearPendingProfile(): boolean {
  if (pendingProfile === null && pendingProfileKind === null) return false;
  pendingProfile = null;
  pendingProfileKind = null;
  try {
    window.sessionStorage.removeItem(PROFILE_PENDING_KEY);
  } catch {
    // Nothing to remove from a store that cannot be reached.
  }
  return true;
}

/** Why the current profile is not on disk, or null when it is. For the notice that says so. */
export function pendingProfileProblem(): StorageErrorKind | null {
  return pendingProfile ? pendingProfileKind : null;
}

/** The pending profile itself, for the hooks: they must show it, not the older one on disk. */
export function pendingProfileSnapshot(): StoredProfile | null {
  return pendingProfile;
}

/** Tries to store the pending profile again. True when there is nothing left pending. */
export function retryPendingProfile(): boolean {
  if (!pendingProfile) return true;
  try {
    write(PROFILE_KEY, pendingProfile);
    clearPendingProfile();
    notifyStorageListeners();
    return true;
  } catch (error) {
    pendingProfileKind = storageWriteError(error).kind;
    notifyStorageListeners();
    return false;
  }
}

/**
 * A profile left waiting by a reload: taken back only when it is newer than
 * what is on disk (a later save in another tab wins), and tried again at once.
 */
function recoverPendingProfile(): void {
  if (typeof window === "undefined") return;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(PROFILE_PENDING_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  const parsed = storedProfileSchema.safeParse(parseJsonOrNull(raw));
  if (!parsed.success) return;
  const onDisk = readStoredProfile(readRaw(PROFILE_KEY), readRaw(PROFILE_V1_KEY)).profile;
  if (parsed.data.updatedAt <= onDisk.updatedAt) {
    try {
      window.sessionStorage.removeItem(PROFILE_PENDING_KEY);
    } catch {
      // Harmless: the next recovery compares again.
    }
    return;
  }
  pendingProfile = parsed.data;
  pendingProfileKind = "unknown";
  retryPendingProfile();
}

/**
 * The stored profile. Never throws; an unreadable one comes back empty *and*
 * quarantined, so "empty" cannot be mistaken for "nothing was there". A profile
 * the browser refused to store is the current one until it is stored.
 */
export function loadStoredProfile(): StoredProfile {
  if (pendingProfile) return pendingProfile;
  const rawV2 = readRaw(PROFILE_KEY);
  const rawV1 = readRaw(PROFILE_V1_KEY);
  const { profile, corrupt } = readStoredProfile(rawV2, rawV1);
  if (corrupt) quarantineProfile(rawV2 ?? rawV1);
  return profile;
}

/** Whether what is stored is unreadable — for the notice that says where the copy is. */
export function isProfileCorrupt(): boolean {
  return readStoredProfile(readRaw(PROFILE_KEY), readRaw(PROFILE_V1_KEY)).corrupt;
}

/**
 * Writes a stored profile, counting the save.
 *
 * `rev` and `updatedAt` are bumped here and nowhere else: one save, one step,
 * however many edits went into it.
 */
export function saveStoredProfile(profile: StoredProfile): void {
  const next = storedProfileSchema.parse({
    ...profile,
    rev: profile.rev + 1,
    updatedAt: new Date().toISOString(),
  });
  try {
    write(PROFILE_KEY, next);
  } catch (error) {
    // Still thrown, for the callers that say something specific about it
    // (`useImport`, the section drafts) — but the profile is kept either way.
    const typed = storageWriteError(error);
    setPendingProfile(next, typed.kind);
    notifyStorageListeners();
    throw typed;
  }
  // `write` notified while the old pending profile was still the current one,
  // and a subscriber that read it then saw nothing change. Tell them again.
  if (clearPendingProfile()) notifyStorageListeners();
}

/**
 * The profile as the generators, the scorers and the old editors see it: plain
 * values, no provenance. Derived from the stored one on every read.
 */
export function loadProfile(): Profile {
  return toPlainProfile(loadStoredProfile());
}

/**
 * Changes the stored profile: reads what is there now, lets `change` edit a copy,
 * and saves it. Read at the moment of the call, not from a render's copy — the
 * same rule as `writeSection`, and for the same reason: a file takes seconds to
 * read and the profile can change underneath it.
 */
export function updateStoredProfile(change: (draft: StoredProfile) => void): boolean {
  const draft = structuredClone(loadStoredProfile());
  change(draft);
  return saveWithoutThrowing(draft);
}

/**
 * Replaces the stored profile with what `change` makes of the current one. For
 * operations that already return a whole profile (applying a document, merging
 * two) rather than editing one in place.
 */
export function transformStoredProfile(change: (current: StoredProfile) => StoredProfile): boolean {
  return saveWithoutThrowing(change(loadStoredProfile()));
}

/**
 * The two helpers above are what some thirty click handlers across the
 * onboarding and the profile hub call, none of them inside a `try`. A refused
 * write used to throw out of every one of them — lost silently in a handler, or
 * taking the page down from an effect. It is reported through
 * `pendingProfileProblem` instead, and the change is kept (see `pendingProfile`).
 * Returns whether it reached disk.
 */
function saveWithoutThrowing(profile: StoredProfile): boolean {
  try {
    saveStoredProfile(profile);
    return true;
  } catch (error) {
    if (error instanceof StorageWriteError) return false;
    throw error;
  }
}

/**
 * Saves a plain profile onto the stored one — see `reconcileFromPlain` for what
 * that keeps and what it records. `origin` says who to credit for what is new in
 * it: the editors that type it in leave it at `manual`, an importer says `cv`.
 * A save that changes nothing writes nothing.
 */
export function saveProfile(profile: Profile, options: { origin?: SourceKind } = {}): void {
  const prev = loadStoredProfile();
  const next = reconcileFromPlain(prev, profileSchema.parse(profile), options);
  if (next === prev) return;
  saveStoredProfile(next);
}

/**
 * Brings a profile written before provenance into the current format.
 *
 * Runs at module evaluation, so every reader finds
 * the new key already there. The order is the safety: the migrated profile is
 * written first, the old text is copied to the backup key second, and only then
 * is the old key removed — a failure at any step leaves the old key in place,
 * and the next load tries again from the start.
 *
 * An old key that turns up *after* a migration was written by a tab still running
 * the previous build. What it holds is that tab's view of the profile, so it is
 * applied as an edit on top of the current one instead of being dropped: the
 * alternative is the person's last changes vanishing because a tab was left open
 * across a deploy.
 */
export function migrateProfileToV2(): void {
  if (typeof window === "undefined") return;
  const rawV1 = readRaw(PROFILE_V1_KEY);
  if (rawV1 === null) return;
  try {
    const parsed = profileSchema.safeParse(JSON.parse(rawV1));
    // Unreadable: leave it exactly where it is. `loadStoredProfile` quarantines
    // it if it ever has to fall back on it.
    if (!parsed.success) return;

    const rawV2 = readRaw(PROFILE_KEY);
    if (rawV2 === null) {
      write(PROFILE_KEY, migrateV1(parsed.data));
    } else {
      const current = readStoredProfile(rawV2).profile;
      const merged = reconcileFromPlain(current, parsed.data, { origin: "legacy" });
      if (merged !== current) saveStoredProfile(merged);
    }

    // The first backup is the pre-migration profile; a later one is a stale tab's
    // write, already folded in above.
    if (readRaw(PROFILE_V1_BACKUP_KEY) === null) {
      window.localStorage.setItem(PROFILE_V1_BACKUP_KEY, rawV1);
    }
    window.localStorage.removeItem(PROFILE_V1_KEY);
  } catch {
    // Storage full, or unavailable. Nothing was removed; the next load retries.
  }
}

migrateProfileToV2();

/**
 * The history just moved out of localStorage, and with it the ~5 MiB it held.
 * On a browser as full as the one this was built for, `migrateProfileToV2`
 * above failed for want of room on every load — «the next load retries», and
 * the next one failed the same way. It gets its chance now, in this session.
 */
onLegacyApplicationsReleased(() => {
  migrateProfileToV2();
  retryPendingProfile();
  notifyStorageListeners();
});

recoverPendingProfile();

// A profile waiting for room gets another try whenever the person comes back to
// the tab — the moment they may have freed some elsewhere.
// Guarded on the method, not just the object: every page imports this module,
// and nothing it does at load may throw — not even under a partial `document`.
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && pendingProfile) retryPendingProfile();
  });
}

/**
 * Sets aside an unreadable profile as soon as the module loads.
 *
 * The reactive hooks decide "empty or unreadable" from the raw text alone and
 * must not write while rendering, so nothing on the read side would ever make
 * the copy: the person would see an empty profile, the quarantine would not
 * exist, and the first save would overwrite the only record. Doing it here
 * means the copy is there before any component has rendered — and `saveProfile`
 * repeats the check on its own way in, for a profile that went bad after load.
 */
function quarantineUnreadableProfile(): void {
  if (typeof window === "undefined") return;
  const rawV2 = readRaw(PROFILE_KEY);
  const rawV1 = readRaw(PROFILE_V1_KEY);
  if (readStoredProfile(rawV2, rawV1).corrupt) quarantineProfile(rawV2 ?? rawV1);
}

quarantineUnreadableProfile();

// --- Applications -------------------------------------------------------------

/**
 * The applications, through `./applications/store` — see the header of this
 * file for why they no longer live in localStorage.
 *
 * Every read of the whole list is asynchronous now, because the first one has
 * to wait for the browser database (and, once, for the migration into it).
 * Components read reactively instead, through `useApplications` in `./hooks`,
 * which is synchronous from memory once `ready`.
 */
export function listApplications(): Promise<Application[]> {
  return listApplicationRecords();
}

/**
 * The latest version of one application, from memory — for code that is about
 * to change it and must build on what is there *now*, not on the copy a render
 * captured before a thirty-second generation started (see `persist` in
 * `Wizard.tsx`). Undefined before the applications are read.
 */
export function getApplication(id: string): Application | undefined {
  return getApplicationRecord(id);
}

export { retryUnsavedApplications, ensureApplicationsHydrated } from "./applications/store";

/**
 * Saves an application. Never throws: the new version is in memory — on screen,
 * exportable — as soon as this returns, and the promise says whether the browser
 * also kept it. A refusal leaves it `unsaved` (see `useApplicationsStatus`),
 * which the UI reports and retries without regenerating anything.
 */
export function saveApplication(app: Application): Promise<SaveOutcome> {
  return saveApplicationRecord(app);
}

/**
 * Tombstones, best-effort. A deletion has already happened by the time this
 * runs; failing to remember it for the next upload must not undo it or turn it
 * into an error on screen. The cost of losing one is an application a later
 * «Bajar de mi cuenta» can bring back — said in the console, since nothing on
 * screen could fix it.
 */
function rememberDeleted(ids: string[]): void {
  try {
    recordDeletedApplicationIds(ids);
  } catch (error) {
    console.warn("[storage] No pudimos registrar el borrado para la próxima subida a la cuenta.", error);
  }
}

export async function deleteApplication(id: string): Promise<SaveOutcome> {
  return deleteApplications([id]);
}

export async function deleteApplications(ids: string[]): Promise<SaveOutcome> {
  if (ids.length === 0) return { ok: true };
  const outcome = await removeApplicationRecords(ids);
  if (outcome.ok) rememberDeleted(ids);
  return outcome;
}

/**
 * Takes applications out of this browser after they were saved to a file.
 *
 * Not a deletion, so no tombstones: the person still has them, in the archive
 * they just downloaded and possibly in their account, and a later upload must
 * not remove them from there. See `exportArchive` / `importArchive` below.
 */
export async function archiveApplications(ids: string[]): Promise<SaveOutcome> {
  return removeApplicationRecords(ids);
}

export async function clearApplications(): Promise<SaveOutcome> {
  const all = await listApplicationRecords();
  const outcome = await clearApplicationRecords();
  if (outcome.ok) rememberDeleted(all.map((a) => a.id));
  return outcome;
}

// --- Deleted application tombstones ------------------------------------------

export function loadDeletedApplicationIds(): string[] {
  return read<string[]>(DELETED_APPLICATIONS_KEY, []);
}

/** Adds ids to the tombstone set. Never removes — a delete is permanent. */
export function recordDeletedApplicationIds(ids: string[]): void {
  if (ids.length === 0) return;
  write(
    DELETED_APPLICATIONS_KEY,
    Array.from(new Set([...loadDeletedApplicationIds(), ...ids])),
  );
}

/**
 * A new, empty application. `id` is given when the caller needs to know it
 * before the application exists — a generation names the record it will
 * create up front, so a result recovered after a crash lands on that same
 * record instead of creating a second one (see `lib/applications/pending.ts`).
 */
export function newApplication(jobText: string, label: string, id: string = crypto.randomUUID()): Application {
  const now = new Date().toISOString();
  return { id, createdAt: now, updatedAt: now, jobText, label };
}

// --- Draft job text -------------------------------------------------------------

/** Scratch draft for the job text being composed in Postular, before it
 * becomes a real Application (which only happens once generation succeeds). */
export function loadDraftJobText(): string {
  return read<string>(DRAFT_JOB_TEXT_KEY, "");
}

export function saveDraftJobText(text: string): void {
  write(DRAFT_JOB_TEXT_KEY, text);
}

export function clearDraftJobText(): void {
  write(DRAFT_JOB_TEXT_KEY, "");
}

// --- Draft "Contame tu recorrido" -------------------------------------------------

/** Scratch draft for `DumpStep`'s free-text box, so leaving the tab or reloading mid-write loses nothing. */
export function loadDumpDraft(): string {
  return read<string>(DUMP_DRAFT_KEY, "");
}

export function saveDumpDraft(text: string): void {
  write(DUMP_DRAFT_KEY, text);
}

export function clearDumpDraft(): void {
  write(DUMP_DRAFT_KEY, "");
}

// --- Dismissed jobs -------------------------------------------------------------

/**
 * "Not interested" on `/empleos`, per browser. Deliberately not part of the
 * account backup/sync (`Backup`, `/api/sync`, below): unlike a profile or an
 * application, this is disposable — hiding a posting again after restoring
 * on a new device costs the user nothing, and giving every UI preference a
 * server row is how a sync payload grows without anyone deciding it should.
 */
export function loadDismissedJobIds(): string[] {
  return read<string[]>(DISMISSED_JOBS_KEY, []);
}

export function dismissJob(id: string): void {
  const ids = loadDismissedJobIds();
  if (!ids.includes(id)) write(DISMISSED_JOBS_KEY, [...ids, id]);
}

export function undismissJob(id: string): void {
  write(
    DISMISSED_JOBS_KEY,
    loadDismissedJobIds().filter((existing) => existing !== id),
  );
}

// --- Semantic job ranking ---------------------------------------------------

/** Per-browser, like `dismissJob` above and for the same reason: it is a UI
 *  preference about how to look at the feed, not data worth an account row. */
export function loadSemanticJobsEnabled(): boolean {
  return read<boolean>(SEMANTIC_JOBS_KEY, false);
}

export function setSemanticJobsEnabled(enabled: boolean): void {
  write(SEMANTIC_JOBS_KEY, enabled);
}

// --- Local-only notice ---------------------------------------------------------

const LOCAL_ONLY_NOTICE_KEY = "cvexact.localOnlyNoticeDismissed.v1";

/**
 * Whether the "this lives only in this browser" tip on `/postulaciones` has
 * already been shown and dismissed once. Everything the app stores really
 * does live only in `localStorage`, and the subtitle under the page heading
 * says so in one line nobody reads until they lose it — this is the same
 * fact said once, at the point it starts being true for more than a toy
 * amount of work (see `ApplicationsList`), and then never again.
 */
export function hasSeenLocalOnlyNotice(): boolean {
  return read<boolean>(LOCAL_ONLY_NOTICE_KEY, false);
}

export function dismissLocalOnlyNotice(): void {
  write(LOCAL_ONLY_NOTICE_KEY, true);
}

// --- Tracker settings section ---------------------------------------------------

const TRACKER_SETTINGS_OPEN_KEY = "cvexact.tracker.settingsOpen.v1";

/**
 * Whether the "Configuración de seguimiento" collapsible on /postulaciones
 * is expanded, remembered per browser. `null` means the user has never
 * toggled it — callers treat that as "expanded", the same first-visit
 * default that makes sense for someone who hasn't configured anything yet.
 */
export function loadTrackerSettingsOpen(): boolean | null {
  const raw = readRaw(TRACKER_SETTINGS_OPEN_KEY);
  if (raw === null) return null;
  return raw === "true";
}

export function saveTrackerSettingsOpen(open: boolean): void {
  write(TRACKER_SETTINGS_OPEN_KEY, open);
}

// --- Derived-work cache ---------------------------------------------------------

/**
 * Model output that depends only on inputs we already have, kept so a second
 * application does not pay for it again.
 *
 * `inferSkills` is the one that matters: it reads the profile and nothing else
 * — `lib/ai/prompts/infer-skills.ts` says so in as many words — yet it ran once
 * per application, a whole model call on the critical path producing an answer
 * identical to the last one. `analyzeJob` is here too, though it earns much
 * less: its prompt includes the whole profile, so it can only ever hit for the
 * same person pasting the same posting twice.
 *
 * In the browser rather than on the server, for three reasons. The route
 * already accepts both as optional body fields and skips the call when they
 * arrive, so nothing server-side has to change. localStorage is already this
 * app's source of truth, and unlike a per-process map it survives restarts and
 * does not care which replica answers. And keyed to one person's profile by
 * construction, it raises no question about one user's work reaching another.
 *
 * Not included in `exportBackup`: it is derived, and a restore that arrives
 * without it simply pays for the next generation once.
 */
export const DERIVED_CACHE_KEY = "cvexact.derived.v1";

/** How many postings' analyses to keep before dropping the oldest. */
const MAX_CACHED_ANALYSES = 20;

type DerivedCache = {
  /**
   * The profile these entries were derived from. Held once for the whole cache
   * rather than per entry: everything in here depends on the profile, so a
   * profile edit invalidates all of it at once and there is no way to end up
   * serving one field's stale answer beside another's fresh one.
   */
  profileHash: string;
  inferredSkills?: InferredSkill[];
  /** Keyed by a fingerprint of the posting text, newest last. */
  analyses?: Array<{ jobHash: string; analysis: JobAnalysis }>;
};

/**
 * A stable fingerprint of a value, for cache identity only.
 *
 * Two 32-bit FNV-1a passes with different offsets, concatenated. Not a
 * cryptographic digest and not trying to be: nothing here is a secret, and the
 * cost of the collision it cannot rule out is one stale derivation, which the
 * next profile edit clears anyway.
 */
function fingerprint(value: unknown): string {
  const text = stableStringify(value);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x811c9dc5);
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

/**
 * `JSON.stringify` with object keys in a fixed order.
 *
 * Key order is an accident of how an object was built — a profile straight from
 * the store and the same profile after an edit that spread it are equal and can
 * serialise differently. Hashing the accident would miss cache hits, silently
 * and only for the users who had edited something.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function loadDerived(profile: Profile): DerivedCache | null {
  const stored = read<DerivedCache | null>(DERIVED_CACHE_KEY, null);
  if (!stored || stored.profileHash !== fingerprint(profile)) return null;
  return stored;
}

/**
 * Writes never throw.
 *
 * `write` raises `StorageFullError` when the quota is gone, and that is the
 * right behaviour for the user's own work. This is not the user's work: losing
 * a cache entry costs one model call, and failing a generation that has already
 * succeeded because its optional cache would not fit is a strictly worse trade.
 */
function saveDerived(next: DerivedCache): void {
  try {
    write(DERIVED_CACHE_KEY, next);
  } catch {
    // Full, or unavailable. The next generation pays for itself, as before.
  }
}

// --- What each configured key was last seen doing ------------------------------

/**
 * The last time a provider entry refused work, and what it said.
 *
 * A rejected key or a retired model id costs a failed call on every generation
 * until someone fixes it in Ajustes — and until this existed, nothing ever told
 * them to. The fallback did its job silently, the CV arrived, and the only
 * trace was a `switches` array nobody rendered.
 *
 * Written from `meta.switches`, which every generation already returns, so
 * there is no endpoint to call and nothing to ask the server. Only failures are
 * recorded: a candidate that works produces no switch, and the absence of a
 * note is what "fine" looks like.
 */
export const PROVIDER_NOTES_KEY = "cvexact.providerNotes.v1";

export type ProviderNote = {
  /** `asGenerationError`'s status, so the UI can phrase it briefly. */
  status: number;
  /**
   * Which failure this is, from `@/lib/ai/error-kind`. Optional because the
   * notes outlive a version: one written by an older release has only the
   * status, and one written by a *newer* one may carry a kind this build has
   * never heard of. `loadProviderNotes` drops an unrecognised kind and keeps
   * the rest of the note — the status is what every policy here reads, and
   * discarding it over a label would un-sink a row that is still broken.
   */
  kind?: GenerationErrorKind;
  message: string;
  at: string;
};

/** Keyed by `provider:modelId`, matching a settings row once its model resolves. */
type ProviderNotes = Record<string, ProviderNote>;

/**
 * The stored notes, with any kind this version does not know stripped out.
 *
 * The two cases that produce an unknown kind — a browser that saw a newer
 * release, and a hand-edited `localStorage` — both leave behind a note whose
 * status and message are still perfectly usable. What is *not* usable is a
 * label this build would have to render as blank, so only that field is
 * dropped; `noteHeadline` then falls back to the status, which is exactly what
 * a note from an older version gets anyway.
 */
export function loadProviderNotes(): ProviderNotes {
  const stored = read<ProviderNotes>(PROVIDER_NOTES_KEY, {});
  const notes: ProviderNotes = {};
  for (const [key, note] of Object.entries(stored)) {
    if (typeof note !== "object" || note === null) continue;
    notes[key] = isGenerationErrorKind(note.kind)
      ? note
      : { status: note.status, message: note.message, at: note.at };
  }
  return notes;
}

/**
 * Whether the last attempt to write these notes failed.
 *
 * `write` throws `StorageFullError` when the browser's quota is gone, and this
 * module is the only place that knows what losing the write costs: the notes
 * are what reorder the chain, so the loss is not a missing diagnostic — it
 * freezes the order of Ajustes, and every generation after it pays the same
 * failed calls in the same order while the page keeps showing yesterday's
 * reasons.
 *
 * Kept in module memory rather than in a storage key because it describes the
 * write, not the value, and read through `useProviderNotesWritable` in
 * `./hooks`. Reporting it never fails a generation: the catch below still
 * swallows the error, it just stops being silent.
 */
let notesWriteFailure: string | null = null;
let notesFailureLogged = false;

export function providerNotesWritable(): boolean {
  return notesWriteFailure === null;
}

function reportNotesWriteFailure(error: unknown): void {
  notesWriteFailure =
    error instanceof StorageWriteError
      ? error.message
      : "No pudimos guardar el estado de tus keys en este navegador.";
  if (!notesFailureLogged) {
    notesFailureLogged = true;
    console.warn(
      `[notes] ${notesWriteFailure} La cadena de proveedores no va a reordenarse sola ` +
        "hasta que se libere espacio.",
    );
  }
  // `write` notified on its way out, before this ran; the flag is part of no
  // key, so the second notification is what repaints the warning.
  notifyStorageListeners();
}

function clearNotesWriteFailure(): void {
  if (notesWriteFailure === null) return;
  notesWriteFailure = null;
  notesFailureLogged = false;
  notifyStorageListeners();
}

export function recordProviderNotes(
  switches: Array<{
    provider: string;
    modelId: string;
    status: number;
    message: string;
    kind?: GenerationErrorKind;
  }>,
): void {
  if (switches.length === 0) return;
  const next = { ...loadProviderNotes() };
  const at = new Date().toISOString();
  for (const event of switches) {
    next[`${event.provider}:${event.modelId}`] = {
      status: event.status,
      kind: isGenerationErrorKind(event.kind) ? event.kind : undefined,
      message: event.message,
      at,
    };
  }
  try {
    write(PROVIDER_NOTES_KEY, next);
    clearNotesWriteFailure();
  } catch (error) {
    // Diagnostics are never worth failing a generation that already succeeded
    // — but they are worth reporting, for the reason above.
    reportNotesWriteFailure(error);
  }
}

/** Forgotten when the user edits the row it was about. */
export function clearProviderNote(provider: string, modelId: string): void {
  const notes = loadProviderNotes();
  const key = `${provider}:${modelId}`;
  if (!(key in notes)) return;
  const rest = { ...notes };
  delete rest[key];
  try {
    write(PROVIDER_NOTES_KEY, rest);
    clearNotesWriteFailure();
  } catch (error) {
    // As above: the row the user just edited is not reordered either, so the
    // same reporting applies.
    reportNotesWriteFailure(error);
  }
}

/**
 * How long a fresh failure note is still believed, by the status
 * `asGenerationError` assigned it. This is the memory `lib/ai/cooldown.ts`
 * cannot keep — that one lives in the server process's memory and is scoped
 * to minutes, thrown away on restart, because the cost of losing it early is
 * one wasted call. Losing this one early costs a wasted call on every
 * generation of every session until the user happens to reorder Ajustes by
 * hand, so it is trusted for hours or days rather than minutes: long enough to
 * survive a reload and the gap between one application and the next, short
 * enough that a topped-up balance or a fixed key is believed again without a
 * restart.
 */
const NOTE_TRUST_MS: Record<number, number> = {
  // Rejected key, retired model: nothing about topping up a balance fixes
  // these, so they are trusted until the user edits the row — which already
  // clears the note outright via `clearProviderNote` — or, failing that, for a
  // week.
  401: 7 * 24 * 60 * 60 * 1000,
  400: 7 * 24 * 60 * 60 * 1000,
  // Empty balance, a per-minute budget too small for one CV: fixed by topping
  // up, which happens in hours, not minutes.
  402: 12 * 60 * 60 * 1000,
  413: 12 * 60 * 60 * 1000,
  // Rate limit, momentary saturation, overran its attempt budget: the group
  // here that clears on its own. Trusted for an hour so it survives the time
  // it takes to notice and retry, not so long that a key which recovered stays
  // sunk all day.
  429: 60 * 60 * 1000,
  503: 60 * 60 * 1000,
  504: 60 * 60 * 1000,
};

function noteFor(entry: ProviderEntry, notes: ProviderNotes): ProviderNote | undefined {
  if (!entry.provider) return undefined;
  return notes[`${entry.provider}:${resolvedModel(entry)}`];
}

/**
 * Whether a note is still inside its `NOTE_TRUST_MS` window — the one place
 * that judgement is made, so `orderedChain` and the "N of M show a recent
 * error" summary in Ajustes never drift apart on what counts as current.
 */
export function noteIsFresh(note: ProviderNote | undefined, now = Date.now()): boolean {
  if (!note) return false;
  const trust = NOTE_TRUST_MS[note.status] ?? NOTE_TRUST_MS[429];
  return now - new Date(note.at).getTime() < trust;
}

/**
 * The statuses `NOTE_TRUST_MS` trusts for hours or days rather than minutes —
 * a rejected key or an empty balance is very unlikely to have fixed itself
 * inside that window, unlike a rate limit or a momentary overload. Worth
 * skipping outright in `orderedChain` rather than paying a 25-90s attempt
 * timeout on every generation to relearn what is already known.
 */
const SKIP_ON_SIGHT = new Set([401, 400, 402, 413]);

/**
 * The user's chain, with a recent failure noted sinking a row to the end —
 * or, for the failures in `SKIP_ON_SIGHT`, dropping it outright.
 *
 * Sinking alone still spends the full attempt timeout (up to 90s for a CV) on
 * a key the browser already knows is broken, which is most of why a chain
 * with several dead entries can take over a minute to fail end to end. A
 * rejected key or an empty balance will not fix itself between one request
 * and the next, so there is nothing left to learn by asking again — unlike a
 * rate limit or an overload, which still only sink, since those may have
 * cleared.
 *
 * Never drops to nothing, though: a request with zero candidates explains
 * nothing, while one more real attempt at least produces a specific error the
 * user can act on. If every entry would be skipped, none are — they fall back
 * to sinking instead, same as before this distinction existed.
 *
 * Otherwise only ever demotes or drops, never promotes: the user's own order
 * is a judgement about *quality* — they put their best key first — and
 * ranking an untested row ahead of one they chose deliberately would quietly
 * overrule that. Stable within each bucket, same as `candidateOrder` in
 * `lib/ai/pipeline.ts`: only demonstrated bad behaviour moves anything.
 */
export function orderedChain(entries: ProviderEntry[], now = Date.now()): ProviderEntry[] {
  const notes = loadProviderNotes();
  const clean: ProviderEntry[] = [];
  const sunk: ProviderEntry[] = [];
  const skipped: ProviderEntry[] = [];
  for (const entry of entries) {
    const note = noteFor(entry, notes);
    if (!note || !noteIsFresh(note, now)) {
      clean.push(entry);
    } else if (SKIP_ON_SIGHT.has(note.status)) {
      skipped.push(entry);
    } else {
      sunk.push(entry);
    }
  }
  // Skipping every entry would trade a real, specific error for a chain with
  // nothing left to try — fall back to the sink-only behavior instead.
  if (clean.length === 0 && sunk.length === 0) return skipped;
  return [...clean, ...sunk];
}

export function loadCachedInferredSkills(profile: Profile): InferredSkill[] | null {
  return loadDerived(profile)?.inferredSkills ?? null;
}

export function saveCachedInferredSkills(profile: Profile, skills: InferredSkill[]): void {
  const hash = fingerprint(profile);
  const existing = loadDerived(profile);
  saveDerived({ ...(existing ?? { profileHash: hash }), inferredSkills: skills });
}

export function loadCachedAnalysis(profile: Profile, jobText: string): JobAnalysis | null {
  const jobHash = fingerprint(jobText.trim());
  return loadDerived(profile)?.analyses?.find((e) => e.jobHash === jobHash)?.analysis ?? null;
}

export function saveCachedAnalysis(
  profile: Profile,
  jobText: string,
  analysis: JobAnalysis,
): void {
  const hash = fingerprint(profile);
  const jobHash = fingerprint(jobText.trim());
  const existing = loadDerived(profile);
  const analyses = [
    ...(existing?.analyses ?? []).filter((e) => e.jobHash !== jobHash),
    { jobHash, analysis },
  ].slice(-MAX_CACHED_ANALYSES);
  saveDerived({ ...(existing ?? { profileHash: hash }), analyses });
}

// --- Settings -----------------------------------------------------------------

/**
 * The single-provider shape this store held before the chain existed. Read
 * here because it is a change of *shape*, not of key: the entry converts in
 * place, and a browser that never opens Ajustes again should still keep
 * generating with the key it already had.
 */
type LegacySettings = { provider?: ProviderId | ""; apiKey?: string; model?: string };

export function loadSettings(): Settings {
  const stored = read<Settings & LegacySettings>(SETTINGS_KEY, emptySettings());
  if (Array.isArray(stored.entries)) return { entries: stored.entries };
  if (stored.provider && stored.apiKey) {
    return {
      entries: [
        { provider: stored.provider, apiKey: stored.apiKey, model: stored.model ?? "" },
      ],
    };
  }
  return emptySettings();
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_KEY, settings);
}

// --- Clearing this browser ------------------------------------------------------

/**
 * Removes everything this browser holds about the user, for the shared-machine
 * exit: "cerrar sesión y borrar mis datos de este navegador".
 *
 * `DELETED_APPLICATIONS_KEY` is the one key deliberately kept. Its tombstones
 * are what stop a later "Subir a mi cuenta" from resurrecting applications the
 * user deleted here before wiping — losing them would undo deletions, not save
 * anyone anything. The derived cache and the provider notes go with the rest:
 * both are keyed to a profile that no longer exists here, and both are rebuilt
 * from nothing as the user works.
 *
 * Asynchronous because the applications, the imported documents and the AI
 * caches live in the browser database now; the sign-out waits for it so the
 * reload that follows cannot show what was just asked to be removed.
 */
export async function clearBrowserData(): Promise<void> {
  if (typeof window === "undefined") return;
  for (const key of [
    PROFILE_KEY,
    PROFILE_V1_KEY,
    PROFILE_V1_BACKUP_KEY,
    PROFILE_CORRUPT_KEY,
    SOURCES_KEY,
    SETTINGS_KEY,
    DRAFT_JOB_TEXT_KEY,
    INTAKE_KEY,
    DERIVED_CACHE_KEY,
    PROVIDER_NOTES_KEY,
    EXTRACT_CACHE_KEY,
    SPLIT_CACHE_KEY,
    DUMP_DRAFT_KEY,
    FORM_DRAFTS_KEY,
    PENDING_GENERATIONS_KEY,
    BACKUP_REMINDER_KEY,
    SYNC_STATE_KEY,
    METRICS_KEY,
    RETURN_REVIEW_KEY,
    AI_CHOICE_KEY,
    INTERVIEW_ASKED_KEY,
    CORRECTIONS_SETTLED_KEY,
    EXPERIMENTS_KEY,
  ]) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Storage unavailable has nothing to remove, and the sign-out reload
      // presents the same empty app it would have presented anyway.
    }
  }
  try {
    window.sessionStorage.removeItem(PROFILE_PENDING_KEY);
    window.sessionStorage.removeItem(PENDING_GENERATIONS_KEY);
  } catch {
    // As above.
  }
  clearPendingProfile();
  // The applications (memory, database, the waiting copies and every old
  // localStorage spelling of them), then everything else in the database.
  await wipeApplicationRecords();
  await clearAppDatabase();
  // What was shared to the app and has not been read yet waits in a cache of its own (`public/share-sw.js`, e5, O15): it is the person's text, and goes with the rest.
  try {
    await window.caches?.delete(SHARE_CACHE);
  } catch {
    // A browser with no such cache has nothing of it to delete.
  }
  // Every reader of this store subscribes through `useSyncExternalStore`; tell
  // them it just became empty even though a reload follows the sign-out.
  listeners.forEach((listener) => listener());
}

/**
 * Makes room when the browser has none left, and keeps what a person cannot make again: the profile (and the documents it was read from), the keys, the
 * choice of AI and the account's sync state. What goes is the postings saved here (with the copies waiting to be saved), the drafts, the caches of the AI, the
 * notes on the keys, the counters of activity and the copy of the history from before the last update. The caller takes the complete copy first
 * (`FreeSpaceButton`): the postings are the person's work. Nothing here writes a tombstone, so the account keeps its own postings: uploading from an emptied
 * browser adds, it does not delete.
 */
export async function freeSpace(): Promise<void> {
  if (typeof window === "undefined") return;
  for (const key of [
    DRAFT_JOB_TEXT_KEY,
    DUMP_DRAFT_KEY,
    FORM_DRAFTS_KEY,
    DERIVED_CACHE_KEY,
    PROVIDER_NOTES_KEY,
    EXTRACT_CACHE_KEY,
    SPLIT_CACHE_KEY,
    METRICS_KEY,
    RETURN_REVIEW_KEY,
    INTERVIEW_ASKED_KEY,
    CORRECTIONS_SETTLED_KEY,
  ]) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Storage unavailable has nothing to remove.
    }
  }
  await wipeApplicationRecords();
  await clearDatabaseTables(["aiCache", "legacySnapshot"]);
  listeners.forEach((listener) => listener());
}

// --- Export / import ----------------------------------------------------------

export type Backup = {
  kind: "cvexact-backup";
  /**
   * 2: `profile` is the stored profile, with provenance. A version-1 file (its
   * profile is the plain shape) is still accepted on the way in.
   */
  version: 2;
  exportedAt: string;
  profile: StoredProfile;
  applications: Application[];
  /**
   * The profile interview: transcript, provenance and undo history.
   *
   * Optional, and absent from every backup written before the chat existed —
   * which is why `importBackup` treats a missing one as "leave what is there"
   * rather than as an empty conversation to restore.
   *
   * Included at all because export/import is how an anonymous user moves
   * between devices, and a profile that arrives without the conversation that
   * built it loses the record of what the person actually said. The structured
   * data would survive; the wording it came from would not.
   */
  intake?: IntakeStore;
};

/**
 * The whole local account as one file. Includes the applications this browser
 * has not managed to store: downloading this is one of the ways out the UI
 * offers when the browser refuses to keep one.
 */
export async function exportBackup(profileOverride?: StoredProfile): Promise<Backup> {
  const backup: Backup = {
    kind: "cvexact-backup",
    version: 2,
    exportedAt: new Date().toISOString(),
    profile: profileOverride ?? loadStoredProfile(),
    /**
     * Without the fitting trace: `fitSession` and `fitUndo` belong to the flow of
     * *this* browser and to the CV they were taken from (`withoutFitTrace`), and
     * `fitUndo` is a second copy of a CV — the file already doubles every
     * document it carries.
     */
    applications: (await listApplicationRecords()).map(withoutFitTrace),
  };

  const raw = readRaw(INTAKE_KEY);
  if (raw) {
    // The chat-based interview that wrote this key is retired; this is
    // read-only backward compatibility for whatever a browser still has
    // under it, so old backups keep including it.
    const parsed = intakeStoreSchema.safeParse(parseJsonOrNull(raw));
    if (parsed.success) backup.intake = parsed.data;
  }

  return backup;
}

function parseJsonOrNull(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Splits what a file says are applications into the ones that validate and the ones that do not. */
function readApplicationsFrom(items: unknown[]): {
  valid: Application[];
  invalid: Array<{ id: string | undefined; raw: unknown; reason: string }>;
} {
  const valid: Application[] = [];
  const invalid: Array<{ id: string | undefined; raw: unknown; reason: string }> = [];
  for (const item of items) {
    const parsed = applicationSchema.safeParse(item);
    if (parsed.success) valid.push(normalizeStoredApplication(parsed.data));
    else {
      const id = item && typeof item === "object" ? (item as { id?: unknown }).id : undefined;
      invalid.push({ id: typeof id === "string" ? id : undefined, raw: item, reason: "invalid" });
    }
  }
  return { valid, invalid };
}

/**
 * Restores a full backup. Returns an error message, or null when it succeeded.
 *
 * Replaces what is here, as it always has — this is «restaurar», not «sumar»;
 * adding without replacing is what an archive is for (`importArchive`).
 *
 * Nothing is written until the whole file has been read and validated, and the
 * applications go first, in one step: they are the big write, the one a full
 * browser refuses, and when it is refused nothing else has changed. It used to
 * be the other way round — the profile replaced, then the applications failing
 * — which left half a restore and no way to tell which half.
 */
export async function importBackup(raw: string): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "El archivo no es JSON válido.";
  }

  const backup = parsed as Partial<Omit<Backup, "profile">> & { kind?: string; profile?: unknown };
  if (backup?.kind !== "cvexact-backup") {
    // The one wrong-file mistake this app can actually cause: the profile-only
    // export from the ficha's own menu looks enough like this one to try here
    // first. Naming where it does belong beats a generic "not a cvexact file"
    // for a file that, in every other sense, is one.
    if (backup?.kind === "cvexact-profile") {
      return "Ese archivo es una copia de tu perfil, no la copia completa. Se recupera con «Recuperar una copia».";
    }
    if (backup?.kind === "cvexact-locked") return "Ese archivo tiene contraseña: hace falta abrirlo con ella.";
    return "El archivo no es una copia de cvexact.";
  }

  const profile = parseAnyProfile(backup.profile);
  if (!profile) return "El perfil del archivo no tiene un formato válido.";

  if (Array.isArray(backup.applications)) {
    const { valid, invalid } = readApplicationsFrom(backup.applications);
    const outcome = await replaceAllApplicationRecords(valid);
    if (!outcome.ok) {
      return `No pudimos restaurar las postulaciones, y no cambiamos nada. ${STORAGE_MESSAGES[outcome.kind]}`;
    }
    void quarantineApplicationRows(invalid, "import:backup");
    // A restore brings ids back, so it retires their tombstones: pushing after
    // a restore must not delete the very applications the backup reinstated.
    retireTombstones(valid.map((app) => app.id));
  }

  try {
    saveStoredProfile(profile);
  } catch (error) {
    const message = error instanceof StorageWriteError ? error.message : STORAGE_MESSAGES.unknown;
    return `Restauramos tus postulaciones, pero no tu perfil. ${message}`;
  }

  // A backup written before the interview existed carries no `intake`. Writing
  // an empty one for it would wipe the conversation already in this browser,
  // so absent means "leave it alone" — only a conversation that is actually in
  // the file replaces the one that is here.
  if (backup.intake !== undefined) {
    const intake = intakeStoreSchema.safeParse(backup.intake);
    if (intake.success) {
      try {
        write(INTAKE_KEY, intake.data);
      } catch {
        // Retired, read-only history; the rest of the restore stands without it.
      }
    }
  }

  return null;
}

/**
 * Every application replaced with the account's copy — «Bajar de mi cuenta».
 * Validated like an import: rows that do not parse are kept aside, never
 * written as if they were applications and never silently dropped.
 */
export async function replaceApplicationsFromAccount(items: unknown[]): Promise<SaveOutcome> {
  const { valid, invalid } = readApplicationsFrom(items);
  const outcome = await replaceAllApplicationRecords(valid);
  if (outcome.ok) void quarantineApplicationRows(invalid, "import:account");
  return outcome;
}

/** Tombstones for ids that are back: best-effort, like `rememberDeleted`. */
function retireTombstones(ids: string[]): void {
  if (ids.length === 0) return;
  const back = new Set(ids);
  try {
    write(
      DELETED_APPLICATIONS_KEY,
      loadDeletedApplicationIds().filter((id) => !back.has(id)),
    );
  } catch (error) {
    console.warn("[storage] No pudimos actualizar los borrados pendientes de sincronizar.", error);
  }
}

// --- Archives -----------------------------------------------------------------

/**
 * Applications, and only applications, saved to a file so they can leave this
 * browser — «Archivar seleccionadas» in /postulaciones, and the pre-migration
 * copy Ajustes offers for a while after the move to IndexedDB.
 *
 * Unlike a backup, bringing one back ADDS: an archive is a part of the history,
 * and replacing everything with a part of it would delete the rest.
 */
export type ApplicationsArchive = {
  kind: "cvexact-archive";
  version: 1;
  exportedAt: string;
  /** Unvalidated on purpose for the pre-migration copy: it carries every row exactly as it was. */
  applications: unknown[];
};

export function buildArchive(applications: unknown[]): ApplicationsArchive {
  return { kind: "cvexact-archive", version: 1, exportedAt: new Date().toISOString(), applications };
}

export type ArchiveImport = { added: number; updated: number; skipped: number; failed: number };

/**
 * Merges an archive in: an application not here is added, one that is here is
 * replaced only by a newer version. Rows that do not validate are skipped and
 * kept aside. Returns what happened, or an error message.
 */
export async function importArchive(archive: { applications?: unknown }): Promise<ArchiveImport | string> {
  if (!Array.isArray(archive.applications)) return "El archivo no tiene postulaciones.";
  const { valid, invalid } = readApplicationsFrom(archive.applications);
  const { added, updated, outcomes } = await mergeApplicationRecords(valid);
  void quarantineApplicationRows(invalid, "import:archive");
  retireTombstones(valid.map((app) => app.id));
  return { added, updated, skipped: invalid.length, failed: outcomes.filter((outcome) => !outcome.ok).length };
}

/**
 * The history as localStorage held it before the move to IndexedDB, while that
 * copy is kept (`SNAPSHOT_TTL_MS`). Null once it is gone, or where there never
 * was one.
 */
export async function legacySnapshotInfo(): Promise<{ count: number; expiresAt: string } | null> {
  const { db } = await openAppDatabase();
  if (!db) return null;
  const snapshot = await loadLegacySnapshot(db);
  return snapshot ? { count: snapshot.items.length, expiresAt: snapshot.expiresAt } : null;
}

export async function exportLegacySnapshot(): Promise<ApplicationsArchive | null> {
  const { db } = await openAppDatabase();
  if (!db) return null;
  const snapshot = await loadLegacySnapshot(db);
  return snapshot ? buildArchive(snapshot.items) : null;
}

/**
 * The one import Ajustes offers, for either kind of file: a backup restores, an
 * archive adds. Returns what to tell the person.
 */
export async function importFile(raw: string): Promise<{ ok: boolean; message: string }> {
  const parsed = parseJsonOrNull(raw) as { kind?: unknown } | null;
  if (parsed?.kind === "cvexact-archive") {
    const result = await importArchive(parsed as { applications?: unknown });
    if (typeof result === "string") return { ok: false, message: result };
    const parts = [`Agregamos ${result.added} ${result.added === 1 ? "postulación" : "postulaciones"}`];
    if (result.updated > 0) parts.push(`actualizamos ${result.updated}`);
    let message = parts.join(" y ") + ".";
    if (result.skipped > 0) message += ` ${result.skipped} no tenían un formato válido y quedaron aparte.`;
    if (result.failed > 0) {
      message += ` ${result.failed} todavía no se pudieron guardar en este navegador: las ves marcadas «Sin guardar».`;
    }
    return { ok: result.failed === 0, message };
  }
  const error = await importBackup(raw);
  return error ? { ok: false, message: error } : { ok: true, message: "Restauramos tu copia." };
}

/**
 * The profile alone, for the ficha's own menu.
 *
 * `Backup` above is deliberately not reused for this: it carries applications
 * and the assistant's transcript along with the profile, because that is the
 * right shape for "move my whole account to another device". Someone who
 * opens the profile page and asks it to export a copy is asking for the
 * profile, and a file that also silently carries their postulaciones is more
 * than they asked for — the fuller export belongs in Ajustes, not here.
 */
export type ProfileBackup = {
  kind: "cvexact-profile";
  /** 2: the stored profile. A version-1 file (the plain shape) is still accepted. */
  version: 2;
  exportedAt: string;
  profile: StoredProfile;
};

export function exportProfile(profileOverride?: StoredProfile): ProfileBackup {
  return {
    kind: "cvexact-profile",
    version: 2,
    exportedAt: new Date().toISOString(),
    profile: profileOverride ?? loadStoredProfile(),
  };
}

/** What a profile file holds, read without applying it: the profile, or why it cannot be used. */
export type ProfileFileRead = { ok: true; profile: StoredProfile } | { ok: false; error: string };

/**
 * Reads a profile file and checks it, and touches nothing. It is what lets a screen say what is in the file before
 * it replaces what is here; `importProfile` is this, and then the replacing.
 */
export function readProfileFile(raw: string): ProfileFileRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "El archivo no es JSON válido." };
  }

  // Read as a plain, unliteral shape first: asserting straight to
  // `Partial<ProfileBackup>` fixes `kind`'s type to its one literal, which
  // makes every comparison below except the true case look like a mistake to
  // the checker — this file's `kind` at runtime is not that.
  const body = parsed as { kind?: unknown; profile?: unknown };
  const kind = typeof body.kind === "string" ? body.kind : undefined;

  // The account backup is the file someone actually has if they reach for
  // this from the wrong screen — naming where it does go beats a generic
  // rejection.
  if (kind === "cvexact-backup") {
    return { ok: false, error: "Ese archivo es una copia de tu cuenta completa. Restauralo desde Ajustes." };
  }
  // Opened before it gets here (`openCopy`): a screen that hands one over closed has skipped asking for its password.
  if (kind === "cvexact-locked") {
    return { ok: false, error: "Ese archivo tiene contraseña: hace falta abrirlo con ella." };
  }
  if (kind !== "cvexact-profile") {
    return { ok: false, error: "El archivo no es una copia de tu perfil." };
  }

  const profile = parseAnyProfile(body.profile);
  if (!profile) return { ok: false, error: "El perfil del archivo no tiene un formato válido." };
  return { ok: true, profile };
}

/** Returns an error message, or null when the import succeeded. */
export function importProfile(raw: string): string | null {
  const read = readProfileFile(raw);
  if (!read.ok) return read.error;
  saveStoredProfile(read.profile);
  return null;
}
