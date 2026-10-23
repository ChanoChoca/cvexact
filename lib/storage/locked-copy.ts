/**
 * A copy that cannot be read without a password — for a computer more than one person uses.
 *
 * A copy of the profile is the way back when a browser loses it, and it is also a CV in plain text left in a Downloads
 * folder. On a computer of one's own that is the point; on one that a family or a cybercafé shares, it is the profile handed
 * to whoever opens the folder next — the case in which «Borrar los datos de este navegador» is most worth tapping, and in
 * which the copy it takes first would undo it. So a copy can be locked: the file says what it holds and when it was made,
 * and nothing else is readable without the password.
 *
 * The browser's own cryptography (Web Crypto) and nothing of ours: the password is stretched with PBKDF2-SHA-256 —
 * 600.000 rounds, what OWASP asks of it — into an AES-GCM key, with a salt and an IV of its own for each copy. AES-GCM
 * also says when the password is wrong: what does not decrypt does not authenticate, so a wrong password is never a garbled
 * profile. There is no way to open a copy whose password was forgotten, ours included, and the screens say so before the
 * password is chosen.
 *
 * Pure: no storage and no window, so the round trip is tested as it is.
 */

export const LOCKED_KIND = "cvexact-locked";

/** What a locked copy holds once opened: a profile (`exportProfile`) or the whole account (`exportBackup`). */
export type LockedHolds = "cvexact-profile" | "cvexact-backup";

export type LockedCopy = {
  kind: typeof LOCKED_KIND;
  version: 1;
  /** Said on the outside, so the screen that opens it knows where it goes before asking for the password. */
  holds: LockedHolds;
  exportedAt: string;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
  /** The copy, encrypted, in base64. */
  data: string;
};

/** OWASP's figure for PBKDF2-HMAC-SHA256 (2023). About a second on a phone, once per copy: the price of a guess. */
export const PBKDF2_ROUNDS = 600_000;

/** The shortest password a copy takes. Short enough to type on a phone, long enough not to be guessed by trying. */
export const MIN_PASSWORD_LENGTH = 8;

/** What is wrong with a password chosen for a copy, in a line, or `null` when nothing is. */
export function passwordProblem(password: string, repeated: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `La contraseña tiene que tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (password !== repeated) return "Las dos contraseñas no son iguales.";
  return null;
}

// --- base64, by chunks: a profile can be a megabyte, and spreading that into one call overflows the stack ---

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

async function keyFrom(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** Locks `copy` — a profile file or a whole account's — with `password`. */
export async function lockCopy(copy: { kind: LockedHolds; exportedAt?: string }, password: string, now = new Date()): Promise<LockedCopy> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(password, salt, PBKDF2_ROUNDS);
  const plain = new TextEncoder().encode(JSON.stringify(copy));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  return {
    kind: LOCKED_KIND,
    version: 1,
    holds: copy.kind,
    exportedAt: copy.exportedAt ?? now.toISOString(),
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ROUNDS, salt: toBase64(salt) },
    cipher: { name: "AES-GCM", iv: toBase64(iv) },
    data: toBase64(sealed),
  };
}

/** Whether a parsed file is a locked copy this version can open. */
export function isLockedCopy(value: unknown): value is LockedCopy {
  if (!value || typeof value !== "object") return false;
  const copy = value as Partial<LockedCopy>;
  return (
    copy.kind === LOCKED_KIND &&
    copy.version === 1 &&
    (copy.holds === "cvexact-profile" || copy.holds === "cvexact-backup") &&
    typeof copy.data === "string" &&
    typeof copy.kdf?.salt === "string" &&
    typeof copy.kdf.iterations === "number" &&
    Number.isInteger(copy.kdf.iterations) &&
    copy.kdf.iterations > 0 &&
    typeof copy.cipher?.iv === "string"
  );
}

/** The locked copy a file holds, or `null` when it is not one — to tell it apart before asking for anything. */
export function readLockedCopy(raw: string): LockedCopy | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isLockedCopy(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Opens a locked copy: the file it was, as text — to be read by the same `readProfileFile` or `importBackup` as an open one —
 * or `null` when the password does not open it. A copy that is not well-formed base64 is not one this wrote: also `null`.
 */
export async function unlockCopy(copy: LockedCopy, password: string): Promise<string | null> {
  try {
    const key = await keyFrom(password, fromBase64(copy.kdf.salt), copy.kdf.iterations);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(copy.cipher.iv) }, key, fromBase64(copy.data));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
