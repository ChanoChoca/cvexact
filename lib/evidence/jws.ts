/**
 * Checking a signed credential in the browser, with what the credential carries and nothing it would have to go and fetch (e5, O20).
 *
 * A credential signed as a compact JWS — `header.payload.signature`, what an Open Badges 3.0 badge is when it is a `VC-JWT` — says in its header
 * which key signed it, and sometimes carries the key: as a `jwk`, or as a `did:jwk` or a `did:key`, which are the key itself written as an
 * identifier. With one of those the signature can be checked here, with Web Crypto, and no request is made. With a key that lives somewhere
 * else — an address, a `did:web` — it cannot, and this says so: fetching it would send the credential's issuer an address that a person looked at.
 *
 * What a valid signature means is narrower than it sounds, and is said wherever it is shown: that the content is the one that was signed with
 * *that* key. A key that arrives inside the file proves nothing about whose it is — anyone can make a key and sign — so this never says the issuer
 * signed it; it says the file was not changed after it was signed with the key it brings.
 *
 * Pure, with the crypto handed in, so that each way it can end is tried: nothing here reads a page, a clock or an address.
 */

export type KeyFrom = "jwk" | "did:jwk" | "did:key";

export type Unchecked =
  /** It carries no key. */
  | "no_key"
  /** The key is somewhere else, and getting it would be a request. */
  | "needs_network"
  /** A type of signature this does not check. */
  | "alg"
  /** Not a signed credential: not three parts, or parts that are not what a JWS has. */
  | "format"
  /** The key is one this does not read, or is not a public one. */
  | "key"
  /** This browser cannot check that algorithm. */
  | "no_crypto";

export type Signature =
  | { state: "valid"; alg: string; keyFrom: KeyFrom }
  | { state: "invalid"; alg: string; keyFrom: KeyFrom }
  | { state: "unchecked"; reason: Unchecked; alg?: string };

export type Checked = {
  header: Record<string, unknown>;
  /** The payload as JSON, or `null` when it is not. */
  payload: Record<string, unknown> | null;
  signature: Signature;
};

// --- base64url and base58 -----------------------------------------------------------------------------

/** The bytes of a base64url text, or `null` when it is not one. */
export function fromBase64Url(raw: string): Uint8Array<ArrayBuffer> | null {
  // A JWS leaves the padding off; a text that kept it is still one.
  const text = raw.replace(/={1,2}$/, "");
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** The bytes of a base58 (bitcoin alphabet) text, or `null` when it is not one. */
export function fromBase58(text: string): Uint8Array<ArrayBuffer> | null {
  if (text === "") return new Uint8Array(0);
  let value = BigInt(0);
  const base = BigInt(58);
  for (const char of text) {
    const digit = B58.indexOf(char);
    if (digit === -1) return null;
    value = value * base + BigInt(digit);
  }
  const bytes: number[] = [];
  const byte = BigInt(256);
  while (value > BigInt(0)) {
    bytes.unshift(Number(value % byte));
    value /= byte;
  }
  // Each leading «1» is a zero byte that the number itself cannot say.
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros += 1;
  const out = new Uint8Array(zeros + bytes.length);
  out.set(bytes, zeros);
  return out;
}

const decoder = new TextDecoder();

function jsonOf(bytes: Uint8Array | null): Record<string, unknown> | null {
  if (!bytes) return null;
  try {
    const parsed: unknown = JSON.parse(decoder.decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// --- the key -----------------------------------------------------------------------------------------

type Key = { jwk: JsonWebKey; from: KeyFrom };

const isString = (value: unknown): value is string => typeof value === "string";

/** `did:jwk:<base64url of a JWK>`, with a fragment or without: the key written as a name. */
function keyOfDidJwk(kid: string): Key | "key" {
  const body = kid.slice("did:jwk:".length).split("#")[0] ?? "";
  const jwk = jsonOf(fromBase64Url(body));
  return jwk ? { jwk: jwk as JsonWebKey, from: "did:jwk" } : "key";
}

/** `did:key:z…`: a multibase base58 of a multicodec prefix and a key. Only the one kind that a JWS can be signed with here: Ed25519 (`0xed 0x01`). */
function keyOfDidKey(kid: string): Key | "key" {
  const body = kid.slice("did:key:".length).split("#")[0] ?? "";
  if (!body.startsWith("z")) return "key";
  const bytes = fromBase58(body.slice(1));
  if (!bytes || bytes.length !== 34 || bytes[0] !== 0xed || bytes[1] !== 0x01) return "key";
  const x = btoa(String.fromCharCode(...bytes.slice(2))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { jwk: { kty: "OKP", crv: "Ed25519", x }, from: "did:key" };
}

/** Where the key is, if it is in the credential: its header's `jwk`, or a `kid` that is the key written as a `did:jwk` or a `did:key`. */
function keyFor(header: Record<string, unknown>): Key | Unchecked {
  const jwk = header.jwk;
  if (jwk && typeof jwk === "object" && !Array.isArray(jwk)) return { jwk: jwk as JsonWebKey, from: "jwk" };
  const kid = header.kid;
  if (isString(kid)) {
    if (kid.startsWith("did:jwk:")) {
      const key = keyOfDidJwk(kid);
      return key === "key" ? "key" : key;
    }
    if (kid.startsWith("did:key:")) {
      const key = keyOfDidKey(kid);
      return key === "key" ? "key" : key;
    }
    // An address, a `did:web`, a `did:ion`: the key is somewhere, and going to get it is a request.
    return "needs_network";
  }
  // A `jku` or an `x5u` is an address too.
  if (isString(header.jku) || isString(header.x5u)) return "needs_network";
  return "no_key";
}

type Algorithm = {
  alg: string;
  /** What `importKey` and `verify` are given. */
  import: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams;
  verify: AlgorithmIdentifier | EcdsaParams;
  /** Whether the JWK is the kind of key this algorithm uses. */
  fits: (jwk: JsonWebKey) => boolean;
};

const ALGORITHMS: Record<string, Algorithm> = {
  ES256: {
    alg: "ES256",
    import: { name: "ECDSA", namedCurve: "P-256" },
    verify: { name: "ECDSA", hash: "SHA-256" },
    fits: (jwk) => jwk.kty === "EC" && jwk.crv === "P-256" && isString(jwk.x) && isString(jwk.y),
  },
  RS256: {
    alg: "RS256",
    import: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    verify: "RSASSA-PKCS1-v1_5",
    fits: (jwk) => jwk.kty === "RSA" && isString(jwk.n) && isString(jwk.e),
  },
  EdDSA: {
    alg: "EdDSA",
    import: { name: "Ed25519" },
    verify: { name: "Ed25519" },
    fits: (jwk) => jwk.kty === "OKP" && jwk.crv === "Ed25519" && isString(jwk.x),
  },
};

// --- the check ---------------------------------------------------------------------------------------

/**
 * Reads a compact JWS and checks its signature with the key it carries. Never throws and never makes a request: whatever it cannot do, it says —
 * the header and the payload are still returned, so that what the credential says can be read even when what signed it cannot be checked.
 */
export async function checkJws(token: string, subtle: SubtleCrypto | null = globalThis.crypto?.subtle ?? null): Promise<Checked | null> {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  const header = jsonOf(fromBase64Url(encodedHeader));
  if (!header) return null;
  const payload = jsonOf(fromBase64Url(encodedPayload));
  const done = (signature: Signature): Checked => ({ header, payload, signature });

  const alg = isString(header.alg) ? header.alg : "";
  // `none` is no signature, and is the one a forger asks to be trusted: it is never a valid one. A header that marks an extension as critical
  // is one that must be understood to be read at all (RFC 7515, 4.1.11), and nothing here understands any.
  const algorithm = Object.hasOwn(ALGORITHMS, alg) ? ALGORITHMS[alg] : undefined;
  if (!algorithm || header.crit !== undefined) return done({ state: "unchecked", reason: "alg", ...(alg ? { alg } : {}) });
  const signature = fromBase64Url(encodedSignature);
  if (!signature || signature.length === 0 || payload === null) return done({ state: "unchecked", reason: "format", alg });

  const key = keyFor(header);
  if (typeof key === "string") return done({ state: "unchecked", reason: key, alg });
  // A private key written into a credential is a mistake to be told of, not one to use.
  if ("d" in key.jwk || !algorithm.fits(key.jwk)) return done({ state: "unchecked", reason: "key", alg });
  if (!subtle) return done({ state: "unchecked", reason: "no_crypto", alg });

  const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  try {
    // Only what a public key is made of: whatever else a JWK carries — `key_ops`, `ext`, `use` — is not for the browser to take as given.
    const { kty, crv, x, y, n, e } = key.jwk;
    const publicKey = await subtle.importKey("jwk", { kty, ...(crv ? { crv } : {}), ...(x ? { x } : {}), ...(y ? { y } : {}), ...(n ? { n } : {}), ...(e ? { e } : {}) }, algorithm.import, false, ["verify"]);
    const valid = await subtle.verify(algorithm.verify, publicKey, signature, signed);
    return done({ state: valid ? "valid" : "invalid", alg, keyFrom: key.from });
  } catch (error) {
    // An algorithm this browser does not have is not a bad signature, and a key that does not import is not a good one.
    const unsupported = error instanceof Error && error.name === "NotSupportedError";
    return done({ state: "unchecked", reason: unsupported ? "no_crypto" : "key", alg });
  }
}
