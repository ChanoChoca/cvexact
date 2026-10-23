import { describe, expect, it } from "vitest";
import { BADGE_FAILURE, MAX_BADGE_CHARS, describeSignature, readBadge } from "@/lib/evidence/badge";
import { b64url, encoder, es256, json, pub, signed, subtle } from "./helpers/jws";

/**
 * Reading an Open Badges 3.0 credential (e5, O20): what it is called, who says they gave it and from when until when — from the JSON or from the
 * signed text — and what its signature came to. It makes no request, and it says what it could not do.
 */

const credential = (extra: Record<string, unknown> = {}) => ({
  "@context": ["https://www.w3.org/ns/credentials/v2", "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json"],
  id: "https://academia.example.com/credenciales/3732",
  type: ["VerifiableCredential", "OpenBadgeCredential"],
  name: "Insignia de Excel",
  issuer: { id: "https://academia.example.com/emisor", type: ["Profile"], name: "Academia Ejemplo" },
  validFrom: "2024-03-05T00:00:00Z",
  validUntil: "2027-03-05T00:00:00Z",
  credentialSubject: {
    type: ["AchievementSubject"],
    achievement: { id: "https://academia.example.com/logros/excel", type: ["Achievement"], name: "Excel avanzado", description: "Tablas dinámicas y fórmulas.", criteria: { narrative: "Aprobar el examen." } },
  },
  ...extra,
});

const read = (value: unknown) => readBadge(typeof value === "string" ? value : JSON.stringify(value), subtle);

describe("a badge as JSON", () => {
  it("is read: the achievement's name, the issuer's, the dates and the credential's own page", async () => {
    const result = await read(credential());
    expect(result).toEqual({
      ok: true,
      badge: {
        format: "json",
        name: "Excel avanzado",
        issuer: "Academia Ejemplo",
        issuedOn: { year: 2024, month: 3 },
        validUntil: { year: 2027, month: 3 },
        pageUrl: "https://academia.example.com/credenciales/3732",
        signature: { state: "none" },
      },
    });
  });

  it("takes the credential's name when the achievement has none, and says it has none when neither does", async () => {
    const noAchievement = credential({ credentialSubject: { type: ["AchievementSubject"] } });
    expect(await read(noAchievement)).toMatchObject({ ok: true, badge: { name: "Insignia de Excel" } });
    expect(await read({ ...noAchievement, name: "" })).toEqual({ ok: false, reason: "no_name" });
  });

  it("reads what a credential allows in place of a string: a value object, a language map, a list", async () => {
    const result = await read(
      credential({
        name: { "@value": "Insignia", "@language": "es" },
        credentialSubject: { achievement: [{ name: { "es-AR": "Soldadura básica", en: "Basic welding" } }] },
        issuer: { name: [{ "@value": "Escuela de Oficios" }] },
      }),
    );
    expect(result).toMatchObject({ ok: true, badge: { name: "Soldadura básica", issuer: "Escuela de Oficios" } });
  });

  it("names an issuer given only as an address or a did:web by where it lives, and says nothing when it is neither", async () => {
    expect(await read(credential({ issuer: "https://www.academia.example.com/emisor" }))).toMatchObject({ badge: { issuer: "academia.example.com" } });
    expect(await read(credential({ issuer: "did:web:escuela.example.org" }))).toMatchObject({ badge: { issuer: "escuela.example.org" } });
    expect(await read(credential({ issuer: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" }))).toMatchObject({ badge: { issuer: "" } });
    expect(await read(credential({ issuer: undefined }))).toMatchObject({ badge: { issuer: "" } });
  });

  it("reads the dates of the first version of the standard too, and leaves out what is not a date", async () => {
    const old = credential({ validFrom: undefined, validUntil: undefined, issuanceDate: "2022-11-30T10:00:00Z", expirationDate: "2025" });
    expect(await read(old)).toMatchObject({ badge: { issuedOn: { year: 2022, month: 11 }, validUntil: { year: 2025 } } });
    expect(await read(credential({ validFrom: "pronto", validUntil: 7 }))).toMatchObject({ badge: { issuedOn: {}, validUntil: {} } });
    expect(await read(credential({ validFrom: undefined, validUntil: undefined }))).toMatchObject({ badge: { issuedOn: {}, validUntil: {} } });
  });

  it("keeps the credential's page only when it is one anyone can open: not a urn, a did or a page on this computer", async () => {
    for (const id of ["urn:uuid:123e4567-e89b-12d3-a456-426614174000", "did:example:abc", "http://localhost:3000/c/1", "javascript:alert(1)", 42]) {
      expect(await read(credential({ id })), String(id)).toMatchObject({ ok: true, badge: { pageUrl: "" } });
    }
  });

  it("says a proof that needs the credential's contexts is not checked here, and that no proof is no signature", async () => {
    const proof = { type: "DataIntegrityProof", cryptosuite: "eddsa-rdfc-2022", verificationMethod: "did:key:z6Mk#z6Mk", proofValue: "zabc" };
    expect(await read(credential({ proof }))).toMatchObject({ badge: { signature: { state: "unchecked", reason: "alg", alg: "eddsa-rdfc-2022" } } });
    expect(await read(credential())).toMatchObject({ badge: { signature: { state: "none" } } });
  });
});

describe("a badge as a signed text", () => {
  it("is read, and its signature checked, when the key comes with it", async () => {
    const key = await es256();
    const token = await signed(key, { alg: "ES256", typ: "vc+jwt", jwk: pub(key.publicJwk) }, credential());
    const result = await read(token);
    expect(result).toMatchObject({
      ok: true,
      badge: { format: "jwt", name: "Excel avanzado", issuer: "Academia Ejemplo", signature: { state: "valid", alg: "ES256", keyFrom: "jwk" } },
    });
  });

  it("reads the credential out of the `vc` claim of the older form, and takes its dates and its issuer from the token when it has none", async () => {
    const key = await es256();
    const vc = credential({ validFrom: undefined, validUntil: undefined, issuer: undefined, issuanceDate: undefined, expirationDate: undefined });
    const payload = { vc, iss: "did:web:emisor.example.com", nbf: Date.UTC(2023, 5, 15) / 1000, exp: Date.UTC(2026, 0, 31) / 1000 };
    const result = await read(await signed(key, { alg: "ES256", jwk: pub(key.publicJwk) }, payload));
    expect(result).toMatchObject({ ok: true, badge: { issuer: "emisor.example.com", issuedOn: { year: 2023, month: 6 }, validUntil: { year: 2026, month: 1 }, signature: { state: "valid" } } });
  });

  it("says when the key is somewhere else, and still reads what the credential says", async () => {
    const key = await es256();
    const result = await read(await signed(key, { alg: "ES256", kid: "https://academia.example.com/claves/1" }, credential()));
    expect(result).toMatchObject({ ok: true, badge: { name: "Excel avanzado", signature: { state: "unchecked", reason: "needs_network" } } });
  });

  it("says when the content was changed after it was signed", async () => {
    const key = await es256();
    const [header, , signature] = (await signed(key, { alg: "ES256", jwk: pub(key.publicJwk) }, credential())).split(".");
    const forged = `${header}.${json(credential({ name: "Máster", credentialSubject: { achievement: { name: "Máster en Nada" } } }))}.${signature}`;
    expect(await read(forged)).toMatchObject({ ok: true, badge: { name: "Máster en Nada", signature: { state: "invalid" } } });
  });
});

describe("what is not a badge", () => {
  it("says so for each way it is not", async () => {
    expect(await readBadge("", subtle)).toEqual({ ok: false, reason: "empty" });
    expect(await readBadge("   \n ", subtle)).toEqual({ ok: false, reason: "empty" });
    expect(await readBadge("hola, esto no es una insignia", subtle)).toEqual({ ok: false, reason: "unreadable" });
    expect(await readBadge("[1, 2]", subtle)).toEqual({ ok: false, reason: "unreadable" });
    expect(await readBadge("a.b", subtle)).toEqual({ ok: false, reason: "unreadable" });
    expect(await readBadge(`${b64url(encoder.encode("no es json"))}.e30.AAAA`, subtle)).toEqual({ ok: false, reason: "unreadable" });
    expect(await readBadge("a.b.c.d.e", subtle)).toEqual({ ok: false, reason: "encrypted" });
    expect(await read({ type: ["VerifiableCredential"], name: "Una factura" })).toEqual({ ok: false, reason: "not_a_badge" });
    expect(await read({ type: "OpenBadgeCredential" })).toEqual({ ok: false, reason: "no_name" });
    expect(await readBadge("x".repeat(MAX_BADGE_CHARS + 1), subtle)).toEqual({ ok: false, reason: "big" });
  });

  it("has a sentence for each", () => {
    for (const text of Object.values(BADGE_FAILURE)) expect(text.length).toBeGreaterThan(20);
  });

  it("is a badge by either of the two names an Open Badges 3.0 credential goes by", async () => {
    expect(await read(credential({ type: ["VerifiableCredential", "AchievementCredential"] }))).toMatchObject({ ok: true });
    expect(await read(credential({ type: "OpenBadgeCredential" }))).toMatchObject({ ok: true });
  });
});

describe("what the signature is said to be", () => {
  it("is said in words for each way it ends, and never as more than the file says", () => {
    expect(describeSignature({ state: "valid", alg: "ES256", keyFrom: "jwk" })).toEqual({ tone: "good", text: "La firma está bien con la clave que trae el archivo (ES256)." });
    expect(describeSignature({ state: "invalid", alg: "ES256", keyFrom: "jwk" }).tone).toBe("warn");
    expect(describeSignature({ state: "none" }).text).toBe("No trae firma.");
    for (const reason of ["no_key", "needs_network", "alg", "format", "key", "no_crypto"] as const) {
      const says = describeSignature({ state: "unchecked", reason });
      expect(says.tone, reason).toBe("neutral");
      expect(says.text.length, reason).toBeGreaterThan(20);
    }
    // Nothing says «verificada», «oficial» or «emitida por»: the file brings its own key, and whose it is is not something it can prove.
    for (const signature of [{ state: "valid", alg: "EdDSA", keyFrom: "did:key" }, { state: "none" }] as const) {
      expect(describeSignature(signature).text).not.toMatch(/verificad|oficial|emitid|garantiz|aut[ée]ntic/i);
    }
  });

  it("makes no request while it reads, whatever is in the badge", async () => {
    const calls: unknown[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => {
      calls.push(args);
      return Promise.reject(new Error("no request"));
    }) as typeof fetch;
    try {
      const key = await es256();
      await read(credential({ proof: { type: "DataIntegrityProof", cryptosuite: "eddsa-rdfc-2022" } }));
      await read(await signed(key, { alg: "ES256", kid: "https://academia.example.com/claves/1" }, credential()));
      await read(credential({ "@context": ["https://www.w3.org/ns/credentials/v2", "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json"] }));
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toEqual([]);
  });
});
