import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { streamGenerator } from "@/lib/api/stream-client";

/**
 * The reader's half of the interview route's contract.
 *
 * `app/api/generate/interview/route.ts` answered a single JSON body, and it was
 * the one generation long enough to be killed by the proxy's server timeout
 * (HAProxy, ~50s — measured from production: the browser saw the 504 at 50.05s)
 * before the chain of candidates had even finished the first attempt. It now
 * streams NDJSON like the CV route, and this file pins the frames its reader
 * has to understand: `keepalive` and `stage` are wire noise, `switch` is the
 * status line's text, `done` carries `{ interview }` exactly as the JSON body
 * used to, and `error` is raised as the same `ApiError` an HTTP failure was.
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

const prep = {
  jobTitle: "Atención al cliente",
  sections: [{ category: "Motivación", questions: [] }],
};

describe("lectura del stream de la entrevista", () => {
  it("entrega la preparación final e ignora stage y keepalive", async () => {
    respondWith(
      ndjson(
        { type: "stage", stage: "writing" },
        { type: "keepalive" },
        { type: "keepalive" },
        { type: "done", value: { interview: prep } },
      ),
    );

    const seen: string[] = [];
    const result = await streamGenerator<{ interview: typeof prep }>(
      "/api/generate/interview",
      {},
      { onFrame: (frame) => seen.push(String(frame.type)) },
    );

    expect(seen).toEqual(["stage", "keepalive", "keepalive"]);
    expect(result.interview).toEqual(prep);
  });

  /**
   * The frame that turns an unexplained minute into an explained one: the
   * interview chain is allowed three candidates, and when the first one is cut
   * or refuses, the status line should say who is picking the work up.
   */
  it("entrega el aviso de cambio de proveedor para la línea de estado", async () => {
    respondWith(
      ndjson(
        { type: "stage", stage: "writing" },
        { type: "switch", to: "Groq · openai/gpt-oss-120b", reason: "no respondió" },
        { type: "done", value: { interview: prep } },
      ),
    );

    const switches: Array<{ to: string; reason: string }> = [];
    await streamGenerator<{ interview: typeof prep }>("/api/generate/interview", {}, {
      onFrame: (frame) => {
        if (frame.type === "switch") {
          switches.push({ to: String(frame.to), reason: String(frame.reason) });
        }
      },
    });

    expect(switches).toEqual([{ to: "Groq · openai/gpt-oss-120b", reason: "no respondió" }]);
  });

  /**
   * A route that has already sent its headers reports failure in-band, BYOK
   * attempts included — the retry button is wired off the same `ApiError` shape
   * the non-streaming tabs get, so it must carry `attempts`/`untried` too.
   */
  it("levanta un error in-band, con los intentos BYOK, como si hubiera sido HTTP", async () => {
    respondWith(
      ndjson({
        type: "error",
        message: "El modelo devolvió una respuesta que no respeta el formato esperado.",
        attempts: [
          {
            name: "Cloudflare · @cf/meta/llama-3.3-70b-instruct-fp8-fast",
            message: "formato",
            provider: "cloudflare",
            modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
            status: 502,
          },
        ],
        untried: 1,
      }),
    );

    const error = await streamGenerator<{ interview: unknown }>("/api/generate/interview", {}).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.message).toContain("no respeta el formato");
    expect(apiError.status).toBe(502);
    expect(apiError.attempts).toHaveLength(1);
    expect(apiError.untried).toBe(1);
    // `hasUntriedKeys` is what offers the continuation — it must see the frame.
    expect(apiError.untried).toBeGreaterThan(0);
  });
});