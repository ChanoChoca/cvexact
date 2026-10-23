import { describe, expect, it } from "vitest";
import { checkJws, fromBase58, fromBase64Url } from "@/lib/evidence/jws";
import { PAYLOAD, b64url, ed25519, encoder, es256, json, pub, rs256, signed, subtle, toBase58 } from "./helpers/jws";

/**
 * Checking a signed credential with the key it carries (e5, O20): with real keys and real signatures, so that what is called valid is, and what was
 * changed after signing is not. And each way it cannot be checked says why, instead of saying it is fine.
 */

describe("base64url and base58", () => {
  it("reads base64url, with or without padding, and nothing that is not", () => {
    expect(Array.from(fromBase64Url("aG9sYQ")!)).toEqual([104, 111, 108, 97]);
    expect(Array.from(fromBase64Url("aG9sYQ==")!)).toEqual([104, 111, 108, 97]);
    expect(fromBase64Url("a+b/")).toBeNull();
    expect(fromBase64Url("a")).toBeNull();
    expect(fromBase64Url("")).toEqual(new Uint8Array(0));
  });

  it("reads base58 as the did:key of the W3C's own example says it is: Ed25519, thirty-two bytes behind its prefix", () => {
    const bytes = fromBase58("6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK")!;
    expect(bytes).toHaveLength(34);
    expect([bytes[0], bytes[1]]).toEqual([0xed, 0x01]);
    expect(fromBase58("0OIl")).toBeNull();
    expect(Array.from(fromBase58("112")!)).toEqual([0, 0, 1]);
  });
});

describe("a signature with the key it carries", () => {
  it("is valid with a key in the header, for each of the three algorithms", async () => {
    for (const [alg, make] of [["ES256", es256], ["EdDSA", ed25519], ["RS256", rs256]] as const) {
      const key = await make();
      const token = await signed(key, { alg, jwk: pub(key.publicJwk) });
      const result = await checkJws(token, subtle);
      expect(result?.signature, alg).toEqual({ state: "valid", alg, keyFrom: "jwk" });
      expect(result?.payload?.name).toBe("Curso de Excel");
    }
  });

  it("is valid with the key written as a did:jwk, and as a did:key for Ed25519", async () => {
    const p256 = await es256();
    const kid = `did:jwk:${json(pub(p256.publicJwk))}#0`;
    expect((await checkJws(await signed(p256, { alg: "ES256", kid }), subtle))?.signature).toEqual({ state: "valid", alg: "ES256", keyFrom: "did:jwk" });

    const edwards = await ed25519();
    const prefixed = new Uint8Array(34);
    prefixed.set([0xed, 0x01]);
    prefixed.set(new Uint8Array(edwards.raw), 2);
    const didKey = `did:key:z${toBase58(prefixed)}`;
    const result = await checkJws(await signed(edwards, { alg: "EdDSA", kid: `${didKey}#${didKey.slice(8)}` }), subtle);
    expect(result?.signature).toEqual({ state: "valid", alg: "EdDSA", keyFrom: "did:key" });
  });

  it("is invalid when the content was changed after it was signed", async () => {
    const key = await es256();
    const [header, , signature] = (await signed(key, { alg: "ES256", jwk: pub(key.publicJwk) })).split(".");
    const forged = `${header}.${json({ ...PAYLOAD, name: "Máster en Nada" })}.${signature}`;
    expect((await checkJws(forged, subtle))?.signature).toEqual({ state: "invalid", alg: "ES256", keyFrom: "jwk" });
  });

  it("is invalid when it was signed with another key than the one it carries — which is all a key in the file can say", async () => {
    const signer = await es256();
    const other = await es256();
    const token = await signed(signer, { alg: "ES256", jwk: pub(other.publicJwk) });
    expect((await checkJws(token, subtle))?.signature).toMatchObject({ state: "invalid" });
  });

  it("is valid for anyone's own key, and does not say whose it is: a file can bring any key it likes", async () => {
    const someone = await es256();
    const token = await signed(someone, { alg: "ES256", jwk: pub(someone.publicJwk) }, { ...PAYLOAD, issuer: { name: "Universidad de Oxford" } });
    // This is exactly why the screen says «no dice de quién es esa clave»: nothing here can tell Oxford from a stranger.
    expect((await checkJws(token, subtle))?.signature.state).toBe("valid");
  });
});

describe("what it does not check, and says so", () => {
  it("says there is no key when there is none", async () => {
    const key = await es256();
    expect((await checkJws(await signed(key, { alg: "ES256" }), subtle))?.signature).toEqual({ state: "unchecked", reason: "no_key", alg: "ES256" });
  });

  it("says the key is somewhere else when it is an address or a did:web, and never goes to get it", async () => {
    const key = await es256();
    for (const header of [{ alg: "ES256", kid: "https://emisor.example.com/keys/1" }, { alg: "ES256", kid: "did:web:emisor.example.com#key-1" }, { alg: "ES256", jku: "https://emisor.example.com/jwks.json" }]) {
      expect((await checkJws(await signed(key, header), subtle))?.signature, JSON.stringify(header)).toMatchObject({ state: "unchecked", reason: "needs_network" });
    }
  });

  it("does not accept none, an algorithm it does not know, or a header that asks for an extension it cannot read", async () => {
    const key = await es256();
    for (const header of [{ alg: "none" }, { alg: "HS256", jwk: pub(key.publicJwk) }, { alg: "ES384", jwk: pub(key.publicJwk) }, { alg: "ES256", jwk: pub(key.publicJwk), crit: ["exp"] }, {}]) {
      const token = `${json(header)}.${json(PAYLOAD)}.${b64url(new Uint8Array([1, 2, 3]))}`;
      expect((await checkJws(token, subtle))?.signature, JSON.stringify(header)).toMatchObject({ state: "unchecked", reason: "alg" });
    }
  });

  it("does not use a private key written into a credential, nor a key that is not the kind the algorithm uses", async () => {
    const key = await es256();
    const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
    const withPrivate = await subtle.exportKey("jwk", pair.privateKey);
    expect((await checkJws(await signed(key, { alg: "ES256", jwk: withPrivate }), subtle))?.signature).toMatchObject({ state: "unchecked", reason: "key" });
    const edwards = await ed25519();
    expect((await checkJws(await signed(key, { alg: "ES256", jwk: pub(edwards.publicJwk) }), subtle))?.signature).toMatchObject({ state: "unchecked", reason: "key" });
    expect((await checkJws(await signed(key, { alg: "ES256", kid: "did:jwk:no-es-base64" }), subtle))?.signature).toMatchObject({ state: "unchecked", reason: "key" });
    // A did:key of a kind it does not read (a P-256 key is a different prefix).
    expect((await checkJws(await signed(key, { alg: "ES256", kid: "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169" }), subtle))?.signature).toMatchObject({ state: "unchecked", reason: "key" });
  });

  it("says when this browser cannot check at all", async () => {
    const key = await es256();
    const token = await signed(key, { alg: "ES256", jwk: pub(key.publicJwk) });
    expect((await checkJws(token, null))?.signature).toMatchObject({ state: "unchecked", reason: "no_crypto" });
    const notSupported = { importKey: () => Promise.reject(Object.assign(new Error("no"), { name: "NotSupportedError" })) } as unknown as SubtleCrypto;
    expect((await checkJws(token, notSupported))?.signature).toMatchObject({ state: "unchecked", reason: "no_crypto" });
    const broken = { importKey: () => Promise.reject(new Error("mala clave")) } as unknown as SubtleCrypto;
    expect((await checkJws(token, broken))?.signature).toMatchObject({ state: "unchecked", reason: "key" });
  });

  it("is not a signed credential when it is not three parts that are JSON, and a payload that is not JSON is not read", async () => {
    expect(await checkJws("uno.dos", subtle)).toBeNull();
    expect(await checkJws("a.b.c.d", subtle)).toBeNull();
    expect(await checkJws(`${b64url(encoder.encode("no es json"))}.e30.AAAA`, subtle)).toBeNull();
    const key = await es256();
    const input = `${json({ alg: "ES256", jwk: pub(key.publicJwk) })}.${b64url(encoder.encode("no es json"))}`;
    const result = await checkJws(`${input}.${b64url(await key.sign(encoder.encode(input)))}`, subtle);
    expect(result?.payload).toBeNull();
    expect(result?.signature).toMatchObject({ state: "unchecked", reason: "format" });
  });

  it("makes no request, whatever it is given", async () => {
    const calls: unknown[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => {
      calls.push(args);
      return Promise.reject(new Error("no request"));
    }) as typeof fetch;
    try {
      const key = await es256();
      await checkJws(await signed(key, { alg: "ES256", kid: "https://emisor.example.com/keys/1" }), subtle);
      await checkJws(await signed(key, { alg: "ES256", jku: "https://emisor.example.com/jwks.json" }), subtle);
      await checkJws(await signed(key, { alg: "ES256", jwk: pub(key.publicJwk) }), subtle);
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toEqual([]);
  });
});
