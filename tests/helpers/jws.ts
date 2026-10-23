/**
 * Keys and signed credentials for the tests of what checks a signature (`lib/evidence/jws.ts`, `lib/evidence/badge.ts`): real keys and real signatures,
 * made here with Web Crypto, so that what is called valid is, and what was changed after signing is not.
 */

export const subtle = crypto.subtle;
export const encoder = new TextEncoder();

export const b64url = (bytes: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
export const json = (value: unknown): string => b64url(encoder.encode(JSON.stringify(value)));

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function toBase58(bytes: Uint8Array): string {
  let value = BigInt(0);
  for (const byte of bytes) value = value * BigInt(256) + BigInt(byte);
  let out = "";
  while (value > BigInt(0)) {
    out = B58[Number(value % BigInt(58))]! + out;
    value /= BigInt(58);
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

export const PAYLOAD = { "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiableCredential", "OpenBadgeCredential"], name: "Curso de Excel" };

export type Pair = { publicJwk: JsonWebKey; sign: (data: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>; raw: ArrayBuffer };

export async function es256(): Promise<Pair> {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return {
    publicJwk: await subtle.exportKey("jwk", pair.publicKey),
    sign: (data) => subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data),
    raw: await subtle.exportKey("raw", pair.publicKey),
  };
}
export async function ed25519(): Promise<Pair> {
  const pair = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  return {
    publicJwk: await subtle.exportKey("jwk", pair.publicKey),
    sign: (data) => subtle.sign({ name: "Ed25519" }, pair.privateKey, data),
    raw: await subtle.exportKey("raw", pair.publicKey),
  };
}
export async function rs256(): Promise<Pair> {
  const pair = await subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  return {
    publicJwk: await subtle.exportKey("jwk", pair.publicKey),
    sign: (data) => subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, data),
    raw: new ArrayBuffer(0),
  };
}

/** A compact JWS signed with `key`, with the header the caller says. */
export async function signed(key: Pair, header: Record<string, unknown>, payload: unknown = PAYLOAD): Promise<string> {
  const input = `${json(header)}.${json(payload)}`;
  const signature = await key.sign(encoder.encode(input));
  return `${input}.${b64url(signature)}`;
}

/** The public part of a JWK, as a header carries it. */
export const pub = (jwk: JsonWebKey): JsonWebKey => ({ kty: jwk.kty, ...(jwk.crv ? { crv: jwk.crv } : {}), ...(jwk.x ? { x: jwk.x } : {}), ...(jwk.y ? { y: jwk.y } : {}), ...(jwk.n ? { n: jwk.n } : {}), ...(jwk.e ? { e: jwk.e } : {}) });

