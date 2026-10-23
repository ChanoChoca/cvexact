import type { DateValue } from "@/lib/profile/dates";
import { checkEvidenceUrl } from "@/lib/profile/evidence";
import { checkJws, type Signature } from "./jws";

/**
 * An Open Badges 3.0 credential, read from a file or a pasted text (e5, O20): what it is called, who says they gave it, and from when until when.
 *
 * Two forms of the same credential are read, the two that need no network to be read:
 *  - the credential as JSON (`OpenBadgeCredential`, a Verifiable Credential), which may carry a `proof` of its own;
 *  - the credential as a compact JWS (`VC-JWT`: `header.payload.signature`), whose signature `checkJws` checks when the key comes with it.
 *
 * What this does not do is the point of it. It makes no request: the address a credential has — where its issuer would confirm it — is kept as an
 * address for the person to open, and is never opened here. It does not check a `proof` that needs the credential's JSON-LD contexts to be canonicalised
 * (`eddsa-rdfc-2022` and its kind), because that is a request for each context, and says so. And it reads a badge written into an image — a
 * «baked» PNG or SVG — as nothing: the file is a credential or it is not.
 *
 * What it reads becomes a certification only when the person says so, with each of its fields theirs to change before: the badge says, and the person
 * decides. Nothing of the credential is kept but what that certification says, and — when its signature checked — that it did.
 */

/** A credential can carry its image inside it: what is read is no more than this, and a file larger than this is not a badge. */
export const MAX_BADGE_CHARS = 2_000_000;

export type BadgeSignature = Signature | { state: "none" };

export type Badge = {
  format: "json" | "jwt";
  /** The achievement the credential is for: «Curso de Excel avanzado». Empty when it does not say. */
  name: string;
  /** Who it says gave it, by name when it has one, by its address's host when that is all it has. Empty when it does not say. */
  issuer: string;
  issuedOn: DateValue;
  validUntil: DateValue;
  /** The credential's own page, when it has one and it is a page anyone can open. Never opened by this. */
  pageUrl: string;
  signature: BadgeSignature;
};

export type BadgeFailure = "empty" | "big" | "encrypted" | "unreadable" | "not_a_badge" | "no_name";

export const BADGE_FAILURE: Record<BadgeFailure, string> = {
  empty: "No hay nada para leer: elegí el archivo de la insignia o pegá su contenido.",
  big: "Ese archivo es demasiado grande para ser una insignia.",
  encrypted: "Esa insignia está cifrada y no la podemos leer.",
  unreadable: "No pudimos leer eso como una insignia: tiene que ser el archivo .json de la insignia, o su texto firmado (tres partes separadas por puntos).",
  not_a_badge: "Eso se lee, pero no es una insignia de Open Badges 3.0.",
  no_name: "La insignia no dice cómo se llama lo que acredita.",
};

// --- reading loose JSON ---------------------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The first thing that is an object, of what may be one or a list of them: a credential's subject and its achievement can be either. */
const firstObject = (value: unknown): Record<string, unknown> | undefined => (Array.isArray(value) ? value.find(isObject) : isObject(value) ? value : undefined);

/** Text, from what a Verifiable Credential allows in its place: a string, a `{ "@value": … }`, a language map, or a list of them. */
function textOf(value: unknown, depth = 0): string {
  if (depth > 3) return "";
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = textOf(item, depth + 1);
      if (text) return text;
    }
    return "";
  }
  if (isObject(value)) {
    if ("@value" in value) return textOf(value["@value"], depth + 1);
    if ("value" in value) return textOf(value.value, depth + 1);
    for (const item of Object.values(value)) {
      const text = textOf(item, depth + 1);
      if (text) return text;
    }
  }
  return "";
}

/** A year and its month, from an ISO date or the seconds a JWT keeps its times in; nothing when it is neither. */
function dateOf(value: unknown): DateValue {
  let date: Date | null = null;
  if (typeof value === "number" && Number.isFinite(value)) date = new Date(value * 1000);
  else if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(value.trim());
    if (match) return validYear(Number(match[1]), Number(match[2]));
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }
  return date && !Number.isNaN(date.getTime()) ? validYear(date.getUTCFullYear(), date.getUTCMonth() + 1) : {};
}

const validYear = (year: number, month: number): DateValue => (year >= 1900 && year <= 2100 ? { year, ...(month >= 1 && month <= 12 ? { month } : {}) } : {});

const typesOf = (value: unknown): string[] => (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase());

/** What an issuer given only as an address or a name for one is called: the host of an address, the domain of a `did:web`, and nothing otherwise. */
function nameOfAddress(address: string): string {
  if (address.startsWith("did:web:")) return decodeURIComponent(address.slice("did:web:".length).split(":")[0] ?? "");
  try {
    const url = new URL(address);
    return url.protocol === "https:" || url.protocol === "http:" ? url.hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}

function issuerOf(issuer: unknown, fallback: unknown): string {
  const subject = isObject(issuer) ? issuer : undefined;
  const named = subject ? textOf(subject.name) : "";
  if (named) return named.slice(0, 120);
  const address = typeof issuer === "string" ? issuer : subject && typeof subject.url === "string" ? subject.url : subject && typeof subject.id === "string" ? subject.id : typeof fallback === "string" ? fallback : "";
  return nameOfAddress(address).slice(0, 120);
}

/** The credential's own page, when what it calls its `id` is one: an address anyone can open, and not a `urn:uuid` or a `did`. */
function pageOf(id: unknown): string {
  if (typeof id !== "string") return "";
  const checked = checkEvidenceUrl(id);
  return checked.ok ? checked.url : "";
}

// --- reading a badge -----------------------------------------------------------------------------------

const COMPACT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const FIVE_PARTS = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*){4}$/;

/** What kind of badge the credential says it is: both names an Open Badges 3.0 credential goes by. */
const isBadge = (credential: Record<string, unknown>): boolean => typesOf(credential.type).some((type) => type === "openbadgecredential" || type === "achievementcredential");

function proofOf(credential: Record<string, unknown>): BadgeSignature {
  const proof = firstObject(credential.proof);
  if (!proof) return { state: "none" };
  // A proof of the kind that needs the credential canonicalised against its JSON-LD contexts is checked by fetching them: not here.
  const suite = typeof proof.cryptosuite === "string" ? proof.cryptosuite : typeof proof.type === "string" ? proof.type : "";
  return { state: "unchecked", reason: "alg", ...(suite ? { alg: suite.slice(0, 40) } : {}) };
}

function readCredential(credential: Record<string, unknown>, format: Badge["format"], signature: BadgeSignature, jwt?: Record<string, unknown>): Badge | BadgeFailure {
  if (!isBadge(credential)) return "not_a_badge";
  const subject = firstObject(credential.credentialSubject);
  const achievement = firstObject(subject?.achievement);
  const name = (textOf(achievement?.name) || textOf(credential.name)).slice(0, 160);
  if (!name) return "no_name";
  return {
    format,
    name,
    issuer: issuerOf(credential.issuer, jwt?.iss),
    issuedOn: dateOf(credential.validFrom ?? credential.issuanceDate ?? jwt?.nbf ?? jwt?.iat),
    validUntil: dateOf(credential.validUntil ?? credential.expirationDate ?? jwt?.exp),
    pageUrl: pageOf(credential.id),
    signature,
  };
}

/**
 * What a text says if it is a badge. Never throws, never makes a request, and is never given a chance to: the only thing that touches the network
 * is what it does not do. `subtle` is handed in for the tests.
 */
export async function readBadge(text: string, subtle?: SubtleCrypto): Promise<{ ok: true; badge: Badge } | { ok: false; reason: BadgeFailure }> {
  const body = text.trim();
  if (body === "") return { ok: false, reason: "empty" };
  if (body.length > MAX_BADGE_CHARS) return { ok: false, reason: "big" };
  if (FIVE_PARTS.test(body)) return { ok: false, reason: "encrypted" };

  if (COMPACT.test(body)) {
    const checked = await checkJws(body, subtle ?? globalThis.crypto?.subtle ?? null);
    if (!checked || !checked.payload) return { ok: false, reason: "unreadable" };
    // A VC-JWT carries the credential in `vc`; a newer one is the credential itself, with the claims of a JWT beside it.
    const credential = isObject(checked.payload.vc) ? checked.payload.vc : checked.payload;
    const read = readCredential(credential, "jwt", checked.signature, checked.payload);
    return typeof read === "string" ? { ok: false, reason: read } : { ok: true, badge: read };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  if (!isObject(parsed)) return { ok: false, reason: "unreadable" };
  const read = readCredential(parsed, "json", proofOf(parsed));
  return typeof read === "string" ? { ok: false, reason: read } : { ok: true, badge: read };
}

// --- saying what was found ---------------------------------------------------------------------------

export type SignatureSays = { tone: "good" | "warn" | "neutral"; text: string };

/** What the signature of a badge came to, in words — and, for each way it could not be checked, why. */
export function describeSignature(signature: BadgeSignature): SignatureSays {
  switch (signature.state) {
    case "valid":
      return { tone: "good", text: `La firma está bien con la clave que trae el archivo (${signature.alg}).` };
    case "invalid":
      return { tone: "warn", text: "La firma no coincide con lo que dice el archivo: cambió después de firmarse, o no es el original." };
    case "none":
      return { tone: "neutral", text: "No trae firma." };
    case "unchecked":
      switch (signature.reason) {
        case "no_key":
          return { tone: "neutral", text: "No trae la clave para comprobar la firma." };
        case "needs_network":
          return { tone: "neutral", text: "La clave está en internet. Comprobarla obligaría a pedírsela a otro sitio, y no lo hacemos." };
        case "alg":
          return { tone: "neutral", text: "Usa un tipo de firma que no sabemos comprobar acá." };
        case "format":
          return { tone: "neutral", text: "La firma no tiene el formato que esperábamos." };
        case "key":
          return { tone: "neutral", text: "Trae una clave que no sabemos leer." };
        case "no_crypto":
          return { tone: "neutral", text: "Este navegador no puede comprobar este tipo de firma." };
      }
  }
}
