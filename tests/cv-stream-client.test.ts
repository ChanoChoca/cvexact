import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { streamGenerator } from "@/lib/api/stream-client";

/**
 * The reader's half of the CV route's contract.
 *
 * `app/api/generate/cv/route.ts` answers NDJSON so the wait can be narrated:
 * a frame per stage, a frame when a provider falls over and another one picks
 * the work up, and one terminal frame. The reader has to act on the three
 * frames it owns and hand every other kind to the caller untouched — that is
 * what lets a route add a frame without this file learning about it.
 */

function ndjson(...frames: unknown[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) {
        controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

function respondWith(response: Response) {
  vi.stubGlobal("fetch", vi.fn(async () => response));
}

afterEach(() => vi.unstubAllGlobals());

describe("lectura del stream del CV", () => {
  it("entrega las etapas al caller y devuelve el documento final", async () => {
    respondWith(
      ndjson(
        { type: "stage", stage: "analyzing" },
        { type: "stage", stage: "writing" },
        { type: "stage", stage: "checking" },
        { type: "done", value: { cv: { title: "listo" } } },
      ),
    );

    const seen: string[] = [];
    const result = await streamGenerator<{ cv: { title: string } }>(
      "/api/generate/cv",
      {},
      { onFrame: (frame) => seen.push(String(frame.stage ?? frame.type)) },
    );

    expect(seen).toEqual(["analyzing", "writing", "checking"]);
    expect(result.cv.title).toBe("listo");
  });

  /**
   * The frame that turns an unexplained sixty seconds into an explained one.
   * It is not a failure — the request goes on to succeed — so it must reach
   * the caller without disturbing the result.
   */
  it("entrega el aviso de cambio de proveedor sin romper la generación", async () => {
    respondWith(
      ndjson(
        { type: "stage", stage: "writing" },
        { type: "switch", to: "Google · gemini", reason: "sin crédito" },
        { type: "done", value: { cv: {} } },
      ),
    );

    const switches: string[] = [];
    await streamGenerator("/api/generate/cv", {}, {
      onFrame: (frame) => {
        if (frame.type === "switch") switches.push(String(frame.to));
      },
    });

    expect(switches).toEqual(["Google · gemini"]);
  });

  /**
   * A posting the applicant cannot pass is a complete answer, not a failure,
   * so it travels as `done` carrying exactly what the JSON body used to. Given
   * a frame type of its own it would leave this reader waiting for a `done`
   * that never comes, and the request would end as "la respuesta se cortó".
   */
  it("trata una oferta bloqueada como una respuesta terminal", async () => {
    respondWith(ndjson({ type: "done", value: { blocked: [{ requirement: "título" }] } }));

    const result = await streamGenerator<{ blocked: unknown[] }>("/api/generate/cv", {});
    expect(result.blocked).toHaveLength(1);
  });

  it("levanta un error in-band como si hubiera sido HTTP", async () => {
    respondWith(
      ndjson({ type: "stage", stage: "writing" }, { type: "error", message: "sin crédito" }),
    );

    await expect(streamGenerator("/api/generate/cv", {})).rejects.toBeInstanceOf(ApiError);
  });

  /**
   * `attempts`/`untried` are what let a caller continue on its own instead of
   * making the user click again — see `hasUntriedKeys` in `@/lib/api/client`.
   * They have to survive the trip through the in-band frame the same way the
   * message does.
   */
  it("el error in-band lleva los intentos y las keys sin probar", async () => {
    respondWith(
      ndjson({
        type: "error",
        message: "sin crédito",
        attempts: [
          { name: "Groq · llama", message: "sin crédito", provider: "groq", modelId: "llama", status: 402 },
        ],
        untried: 2,
      }),
    );

    await expect(streamGenerator("/api/generate/cv", {})).rejects.toMatchObject({
      untried: 2,
      attempts: [expect.objectContaining({ provider: "groq", status: 402 })],
    });
  });

  /**
   * A refusal before the stream opens — no key, a spent quota — says why in its JSON body, and the screen decides what
   * to offer from that reason (`denialOf`). Dropping it left `/postular` showing the bare message.
   */
  it("una negativa antes de abrir el stream lleva su motivo", async () => {
    respondWith(
      new Response(JSON.stringify({ error: "Configurá tu key.", reason: "byok_required" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(streamGenerator("/api/generate/cv", {})).rejects.toMatchObject({ status: 403, reason: "byok_required", message: "Configurá tu key." });
  });

  it("y sin motivo en el cuerpo, el error queda como siempre", async () => {
    respondWith(new Response(JSON.stringify({ error: "Se rompió." }), { status: 500, headers: { "content-type": "application/json" } }));

    const error = await streamGenerator("/api/generate/cv", {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).reason).toBeUndefined();
  });

  /** A stream cut off mid-flight has delivered no answer, and must not look like one. */
  it("falla cuando el stream termina sin frame final", async () => {
    respondWith(ndjson({ type: "stage", stage: "writing" }));

    await expect(streamGenerator("/api/generate/cv", {})).rejects.toMatchObject({
      message: expect.stringContaining("se cortó"),
    });
  });

  it("sigue siendo un error HTTP lo que falla antes de abrir el stream", async () => {
    respondWith(
      new Response(JSON.stringify({ error: "Falta la API key." }), { status: 400 }),
    );

    await expect(streamGenerator("/api/generate/cv", {})).rejects.toMatchObject({
      status: 400,
      message: "Falta la API key.",
    });
  });
});
