/**
 * What went wrong when the browser refused to keep something, said in the three
 * ways the UI can act on — whichever of the browser's stores raised it.
 *
 * localStorage throws a DOMException named `QuotaExceededError` (legacy code
 * 22; old Firefox named it `NS_ERROR_DOM_QUOTA_REACHED`, code 1014). IndexedDB
 * reports the same name, but usually as the `error` of the transaction it
 * aborted, which Dexie then wraps: its `AbortError` carries the native one in
 * `inner`. A store the page may not use at all — some private windows, site
 * data blocked by the user — surfaces as a `SecurityError`, an
 * `InvalidStateError`, or Dexie's `MissingAPIError`/`OpenFailedError`.
 *
 * Deliberately a separate module with no imports: `local.ts`, the IndexedDB
 * layer and the stores all classify errors, and none of them may depend on
 * another just for this.
 */
export type StorageErrorKind = "quota" | "unavailable" | "unknown";

const QUOTA_NAMES = new Set(["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"]);
const QUOTA_CODES = new Set([22, 1014]);
const UNAVAILABLE_NAMES = new Set([
  "SecurityError",
  "InvalidStateError",
  "InvalidAccessError",
  "NotSupportedError",
  "UnknownError",
  "VersionError",
  "MissingAPIError",
  "OpenFailedError",
  "DatabaseClosedError",
  "TimeoutError",
]);

/** The error, what it wraps, and what that wraps — Dexie nests through `inner`, standard errors through `cause`. */
function links(error: unknown): unknown[] {
  const seen: unknown[] = [];
  let current: unknown = error;
  while (current && typeof current === "object" && seen.length < 6 && !seen.includes(current)) {
    seen.push(current);
    const next = current as { inner?: unknown; cause?: unknown; failures?: unknown };
    // A Dexie `BulkError` says why each row failed, not why the whole batch did.
    if (Array.isArray(next.failures)) seen.push(...next.failures.slice(0, 5));
    current = next.inner ?? next.cause;
  }
  return seen;
}

/**
 * The message too, not only the name: every engine says "quota" in it —
 * Chrome's «…exceeded the quota.», Firefox's and Safari's «The quota has been
 * exceeded.» — and some paths (a wrapped error, a polyfill, the fakes in the
 * tests) keep the words while losing the name.
 */
const QUOTA_MESSAGE = /quota/i;

export function classifyStorageError(error: unknown): StorageErrorKind {
  let unavailable = false;
  for (const link of links(error)) {
    if (!link || typeof link !== "object") continue;
    const { name, code, message } = link as { name?: unknown; code?: unknown; message?: unknown };
    if (typeof name === "string" && QUOTA_NAMES.has(name)) return "quota";
    if (typeof code === "number" && QUOTA_CODES.has(code)) return "quota";
    if (typeof message === "string" && QUOTA_MESSAGE.test(message)) return "quota";
    if (typeof name === "string" && UNAVAILABLE_NAMES.has(name)) unavailable = true;
  }
  return unavailable ? "unavailable" : "unknown";
}

/**
 * What the person reads. None of it names a browser API: someone who has never
 * heard of localStorage has no use for being told it is full, and every one of
 * these says where the way out is instead.
 */
export const STORAGE_MESSAGES: Record<StorageErrorKind, string> = {
  quota:
    "Este navegador no tiene más espacio para guardar datos de CV Exact. Podés liberar lugar sin perder tu perfil ni tus keys: «Liberar espacio», en el aviso de arriba.",
  unavailable:
    "Este navegador no nos deja guardar datos, algo que pasa en algunas ventanas privadas o con los datos del sitio bloqueados.",
  unknown: "El navegador no pudo guardar el cambio. Probá de nuevo en un momento.",
};

/** Said on `window` when a write was refused for lack of room, for the notice of the app (`SpaceWarning`) to offer the way out wherever the person was. */
export const STORAGE_FULL_EVENT = "cvexact:storage-full";

function announceStorageFull(): void {
  try {
    window.dispatchEvent(new Event(STORAGE_FULL_EVENT));
  } catch {
    // No window to tell (the server, a test): the error itself still reaches whoever caught it.
  }
}

/** A write the browser refused. `kind` says which of the three it was. */
export class StorageWriteError extends Error {
  constructor(
    readonly kind: StorageErrorKind,
    options?: { cause?: unknown },
  ) {
    super(STORAGE_MESSAGES[kind], options);
    this.name = "StorageWriteError";
    if (kind === "quota") announceStorageFull();
  }
}

/**
 * Out of space. The class the rest of the app has always caught by name — every
 * `instanceof StorageFullError` written before `StorageWriteError` existed still
 * means exactly what it meant.
 */
export class StorageFullError extends StorageWriteError {
  constructor(options?: { cause?: unknown }) {
    super("quota", options);
    this.name = "StorageFullError";
  }
}

/** The browser would not let the page write at all, or failed for a reason it did not name. */
export class StorageUnavailableError extends StorageWriteError {
  constructor(kind: Exclude<StorageErrorKind, "quota">, options?: { cause?: unknown }) {
    super(kind, options);
    this.name = "StorageUnavailableError";
  }
}

/** The typed error for a raw failure from any of the browser's stores. */
export function storageWriteError(error: unknown): StorageWriteError {
  if (error instanceof StorageWriteError) return error;
  const kind = classifyStorageError(error);
  return kind === "quota"
    ? new StorageFullError({ cause: error })
    : new StorageUnavailableError(kind, { cause: error });
}
