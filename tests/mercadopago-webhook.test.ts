import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InvalidWebhookSignatureError, WebhookSignatureValidator } from "mercadopago";

/**
 * The webhook that hands out credits.
 *
 * This is the one endpoint in the app whose failure mode is free money: anything
 * that reaches the crediting call without proof of payment is a way to mint
 * credits. So the signature check is pinned here directly — the route delegates
 * to the SDK's validator, and these fix that the delegation actually rejects
 * what it should.
 *
 * Signing is done by hand rather than through the SDK so the test does not
 * verify the library against itself: if the SDK changed how it builds the
 * manifest, a test that signed with the SDK would keep passing while real
 * notifications from Mercado Pago started failing.
 */

const SECRET = "un-secreto-de-prueba";

function sign(input: { dataId: string; requestId: string; ts: string; secret?: string }): string {
  // The manifest Mercado Pago documents: id, request id and timestamp, each
  // terminated by a semicolon.
  const manifest = `id:${input.dataId};request-id:${input.requestId};ts:${input.ts};`;
  const hash = createHmac("sha256", input.secret ?? SECRET).update(manifest).digest("hex");
  return `ts=${input.ts},v1=${hash}`;
}

const now = () => Math.floor(Date.now() / 1000).toString();

const validate = (over: Partial<Parameters<typeof WebhookSignatureValidator.validate>[0]>) =>
  WebhookSignatureValidator.validate({
    xSignature: sign({ dataId: "12345", requestId: "req-1", ts: now() }),
    xRequestId: "req-1",
    dataId: "12345",
    secret: SECRET,
    toleranceSeconds: 600,
    ...over,
  });

describe("la firma del webhook de Mercado Pago", () => {
  it("acepta una notificación legítima", () => {
    expect(() => validate({})).not.toThrow();
  });

  it("rechaza una firma alterada en un solo byte", () => {
    const ts = now();
    const good = sign({ dataId: "12345", requestId: "req-1", ts });
    // Flip the last hex digit of the hash.
    const last = good.slice(-1);
    const tampered = good.slice(0, -1) + (last === "0" ? "1" : "0");

    expect(() => validate({ xSignature: tampered })).toThrow(InvalidWebhookSignatureError);
  });

  it("rechaza una firma hecha con otro secreto", () => {
    const forged = sign({
      dataId: "12345",
      requestId: "req-1",
      ts: now(),
      secret: "test-secreto-del-atacante",
    });
    expect(() => validate({ xSignature: forged })).toThrow(InvalidWebhookSignatureError);
  });

  it("rechaza cuando no viene firma", () => {
    expect(() => validate({ xSignature: null })).toThrow(InvalidWebhookSignatureError);
  });

  it("rechaza una firma válida para otro pago", () => {
    // Replaying someone else's notification with your own id in the query is
    // the obvious attack, and the id being inside the manifest is what stops it.
    const other = sign({ dataId: "99999", requestId: "req-1", ts: now() });
    expect(() => validate({ xSignature: other, dataId: "12345" })).toThrow(
      InvalidWebhookSignatureError,
    );
  });

  it("rechaza una notificación vieja, aunque esté bien firmada", () => {
    const old = (Math.floor(Date.now() / 1000) - 3600).toString();
    const signed = sign({ dataId: "12345", requestId: "req-1", ts: old });
    expect(() => validate({ xSignature: signed })).toThrow(InvalidWebhookSignatureError);
  });

  it("informa por qué falló, para poder correlacionar con el panel", () => {
    try {
      validate({ xSignature: null });
      expect.unreachable("debería haber tirado");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidWebhookSignatureError);
      expect((error as InvalidWebhookSignatureError).reason).toBeTruthy();
    }
  });
});
