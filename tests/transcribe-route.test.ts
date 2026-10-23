import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

/**
 * `POST /api/generate/transcribe`: a photo of a CV goes to the person's own model and to no one else's, and nothing of it is kept.
 */

const openRequest = vi.hoisted(() => vi.fn());
const failure = vi.hoisted(() => vi.fn());
const transcribeImage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/context", () => ({ openRequest, failure }));
vi.mock("@/lib/ai/vision", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/ai/vision")>()), transcribeImage }));

const release = vi.fn();
const opened = (tier: string) => ({ tier, chain: { candidates: [], used: {}, failed: new Set(), switches: [] }, grant: { release } });
const IMAGE = "QUJD".repeat(80);
const post = (body: unknown) => new Request("http://localhost/api/generate/transcribe", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

async function route() {
  return (await import("@/app/api/generate/transcribe/route")).POST;
}

beforeEach(() => {
  openRequest.mockReset();
  failure.mockReset();
  transcribeImage.mockReset();
  release.mockReset();
  failure.mockImplementation(() => NextResponse.json({ error: "falló" }, { status: 502 }));
});

describe("the route that reads a photo", () => {
  it("reads it for someone with a key of their own, and says nothing of the image back", async () => {
    openRequest.mockResolvedValue(opened("byok"));
    transcribeImage.mockResolvedValue("Ana Ruiz\nBarista en Café Martínez");
    const response = await (await route())(post({ image: IMAGE, mediaType: "image/jpeg" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "Ana Ruiz\nBarista en Café Martínez" });
    expect(transcribeImage.mock.calls[0]![1]).toEqual({ base64: IMAGE, mediaType: "image/jpeg" });
    expect(release).toHaveBeenCalledWith("success", expect.anything());
  });

  it("says there was nothing to read as an empty text, not as a text", async () => {
    openRequest.mockResolvedValue(opened("byok"));
    transcribeImage.mockResolvedValue("NO_TEXT");
    const response = await (await route())(post({ image: IMAGE, mediaType: "image/png" }));
    expect(await response.json()).toEqual({ text: "" });
  });

  it("does not read it for a paid plan, which would be sending the photo to our own provider on their behalf", async () => {
    for (const tier of ["pro", "credits"]) {
      openRequest.mockResolvedValue(opened(tier));
      release.mockClear();
      const response = await (await route())(post({ image: IMAGE, mediaType: "image/jpeg" }));
      expect(response.status).toBe(403);
      expect((await response.json()).reason).toBe("byok_required");
      expect(transcribeImage).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledWith("failure");
    }
  });

  it("refuses what is not an image of a size a browser would have made it, without spending a call", async () => {
    openRequest.mockResolvedValue(opened("byok"));
    const POST = await route();
    for (const body of [
      { image: "no es base64!", mediaType: "image/jpeg" },
      { image: IMAGE, mediaType: "application/pdf" },
      { image: "QUJD", mediaType: "image/jpeg" },
      { image: "A".repeat(6_000_001), mediaType: "image/jpeg" },
      { mediaType: "image/jpeg" },
    ]) {
      release.mockClear();
      const response = await POST(post(body));
      expect(response.status).toBe(400);
      expect(release).toHaveBeenCalledWith("failure");
    }
    expect(transcribeImage).not.toHaveBeenCalled();
  });

  it("gives back the grant and lets the failure be told the way every route tells it", async () => {
    openRequest.mockResolvedValue(opened("byok"));
    transcribeImage.mockRejectedValue(new Error("Ese modelo no lee imágenes."));
    const response = await (await route())(post({ image: IMAGE, mediaType: "image/jpeg" }));
    expect(response.status).toBe(502);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith("failure");
  });

  it("tells a failure of the reading with its own sentence and status, and not as an unexpected one", async () => {
    const { VisionFailure } = await import("@/lib/ai/vision");
    openRequest.mockResolvedValue(opened("byok"));
    transcribeImage.mockRejectedValue(new VisionFailure("Ese modelo no lee imágenes.", 400));
    const response = await (await route())(post({ image: IMAGE, mediaType: "image/jpeg" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Ese modelo no lee imágenes." });
    expect(failure).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith("failure");
  });

  it("stops where the request was refused before it began: no key, no quota", async () => {
    const refusal = NextResponse.json({ error: "Configurá tu key." }, { status: 403 });
    openRequest.mockResolvedValue(refusal);
    const response = await (await route())(post({ image: IMAGE, mediaType: "image/jpeg" }));
    expect(response).toBe(refusal);
    expect(transcribeImage).not.toHaveBeenCalled();
  });
});
