import { beforeEach, describe, expect, it, vi } from "vitest";
import { APICallError } from "ai";
import { fitWithin } from "@/lib/import/photo";
import { readByAi } from "@/lib/parse/read-by-ai";
import { applyParsedDocument } from "@/lib/parse/to-profile";
import { readReceipt } from "@/lib/onboarding/review";
import { parseDocument } from "@/lib/parse";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";
import { newId, STAMP } from "./helpers/profiles";

/**
 * M09, second step: a photo or a scan of a CV, written down by the person's own model, looked at by them against the photo, and
 * only then read — as text, by the same patterns as any text, with everything in it marked as read with a model.
 */

const generateText = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), generateText }));
const callGenerator = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({
  ApiError: class ApiError extends Error {
    reason?: string;
  },
  callGenerator,
}));
const preparePhoto = vi.hoisted(() => vi.fn());
vi.mock("@/lib/import/photo", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/import/photo")>()), preparePhoto }));
vi.mock("@/lib/onboarding/stores", () => ({
  ensureOnboardingStoresHydrated: async () => {},
  readCollection: () => ({}),
  writeCollection: () => {},
}));

const CV = `Ana Ruiz
ana@example.com

EXPERIENCIA
Café Martínez
Barista
2020 - 2023
Atención de la barra y cierre de caja.

FORMACIÓN
Universidad de Buenos Aires
Licenciatura en Administración
2015 - 2019`;

describe("making a photo ready", () => {
  it("leaves a small picture at its own size, and brings a big one's longest side down keeping its proportions", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 6000)).toEqual({ width: 1000, height: 2000 });
  });

  it("never draws a side of nothing", () => {
    expect(fitWithin(1, 9000)).toEqual({ width: 1, height: 2000 });
  });
});

describe("the text of a photo, read", () => {
  it("is marked as read with a model, and nothing in it is rated above medium", () => {
    const patterns = parseDocument({ text: CV })!;
    expect(patterns.via).toBeUndefined();
    expect(patterns.experience[0]!.confidence).toBe("high");
    const read = readByAi(patterns);
    expect(read.via).toBe("ai");
    expect(read.confidence).not.toBe("high");
    expect([...read.experience, ...read.education].every((block) => block.confidence !== "high")).toBe(true);
    expect(read.experience.length).toBeGreaterThan(0);
  });

  it("does not raise a block that was already doubtful", () => {
    const patterns = parseDocument({ text: CV })!;
    patterns.experience[0]!.confidence = "low";
    expect(readByAi(patterns).experience[0]!.confidence).toBe("low");
  });

  it("goes into the profile as proposals, and the source says it came from a photo", () => {
    const parsed = readByAi(parseDocument({ text: CV })!);
    const { profile } = applyParsedDocument(
      emptyStoredProfile(),
      parsed,
      { name: "Foto: cv.jpg", fileHash: "h1", pasted: true, chars: CV.length, photo: true },
      { sourceId: "s1", now: STAMP, newId },
    );
    expect(profile.sources[0]).toMatchObject({ via: "ai", photo: true, name: "Foto: cv.jpg" });
    expect(profile.experience[0]!.company.status).toBe("proposed");
    expect(profile.experience[0]!.company.source).toMatchObject({ via: "ai" });
    expect(profile.education[0]!.institution.status).toBe("proposed");
  });

  it("is said in the receipt, and a file read the usual way is not", () => {
    const photo = applyParsedDocument(emptyStoredProfile(), readByAi(parseDocument({ text: CV })!), { name: "Foto", fileHash: "h2", pasted: true, chars: 10, photo: true }, { sourceId: "s2", now: STAMP, newId });
    expect(readReceipt(photo.profile.sources[0]!)).toMatchObject({ via: "ai", photo: true });
    const plain = applyParsedDocument(emptyStoredProfile(), parseDocument({ text: CV })!, { name: "cv.pdf", fileHash: "h3", pasted: false, chars: 10 }, { sourceId: "s3", now: STAMP, newId });
    expect(readReceipt(plain.profile.sources[0]!)).not.toHaveProperty("photo");
  });
});

describe("transcribeWithAi", () => {
  const photo = new File(["x"], "cv.jpg", { type: "image/jpeg" });
  beforeEach(() => {
    callGenerator.mockReset();
    preparePhoto.mockReset();
    preparePhoto.mockResolvedValue({ base64: "QUJD".repeat(80), mediaType: "image/jpeg" });
  });

  it("sends the image made ready, and gives back the text the model wrote", async () => {
    callGenerator.mockResolvedValue({ text: CV });
    const { transcribeWithAi } = await import("@/lib/onboarding/ai");
    const outcome = await transcribeWithAi(photo);
    expect(callGenerator.mock.calls[0]![0]).toBe("/api/generate/transcribe");
    expect(callGenerator.mock.calls[0]![1]).toEqual({ image: "QUJD".repeat(80), mediaType: "image/jpeg" });
    expect(outcome).toEqual({ ok: true, result: CV, fromCache: false });
  });

  it("says so when there was nothing to read, instead of handing back an empty text to look at", async () => {
    callGenerator.mockResolvedValue({ text: "" });
    const { transcribeWithAi } = await import("@/lib/onboarding/ai");
    const outcome = await transcribeWithAi(photo);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.message).toMatch(/No encontramos texto en esa foto/);
  });

  it("says what could not be done with the picture, when it cannot be opened, and asks nothing of the model", async () => {
    const { PhotoError } = await import("@/lib/import/photo");
    preparePhoto.mockRejectedValue(new PhotoError("No pudimos abrir esa imagen en tu navegador."));
    const { transcribeWithAi } = await import("@/lib/onboarding/ai");
    const outcome = await transcribeWithAi(photo);
    expect(outcome).toEqual({ ok: false, message: "No pudimos abrir esa imagen en tu navegador." });
    expect(callGenerator).not.toHaveBeenCalled();
  });
});

describe("transcribeImage", () => {
  const choice = (key: string) => ({ model: { id: key } as never, describe: key, cooldownKey: key, provider: "google" as const, modelId: key, reasoningCapable: false, looseJsonSchema: false });
  const chainOf = (...keys: string[]) => {
    const candidates = keys.map(choice);
    return { candidates, deadlineAt: Date.now() + 60_000, used: candidates[0]!, failed: new Set<string>(), switches: [] };
  };
  const image = { base64: "QUJD".repeat(80), mediaType: "image/jpeg" };

  beforeEach(() => {
    generateText.mockReset();
  });

  it("asks the model to copy what it sees, with the image as an image", async () => {
    generateText.mockResolvedValue({ text: `  ${CV}\n`, finishReason: "stop", usage: { inputTokens: 900, outputTokens: 300 } });
    const { transcribeImage, TRANSCRIBE_SYSTEM } = await import("@/lib/ai/vision");
    const telemetry = {};
    const text = await transcribeImage(chainOf("gemini"), image, telemetry);
    expect(text).toBe(CV);
    const call = generateText.mock.calls[0]![0];
    expect(call.system).toBe(TRANSCRIBE_SYSTEM);
    expect(call.messages[0].content[0]).toEqual({ type: "image", image: image.base64, mediaType: "image/jpeg" });
    expect(telemetry).toMatchObject({ inputTokens: 900, outputTokens: 300 });
    expect(TRANSCRIBE_SYSTEM).toMatch(/copying, not writing/);
    expect(TRANSCRIBE_SYSTEM).toMatch(/\[ilegible\]/);
  });

  it("passes on what the model says when there is nothing to copy", async () => {
    generateText.mockResolvedValue({ text: "NO_TEXT", finishReason: "stop", usage: {} });
    const { transcribeImage, NO_TEXT } = await import("@/lib/ai/vision");
    expect(await transcribeImage(chainOf("gemini"), image)).toBe(NO_TEXT);
  });

  it("goes to the next candidate when one fails, and not to a third", async () => {
    generateText.mockRejectedValueOnce(new Error("boom")).mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ text: CV, finishReason: "stop", usage: {} });
    const { transcribeImage } = await import("@/lib/ai/vision");
    const chain = chainOf("a", "b", "c");
    await expect(transcribeImage(chain, image)).rejects.toThrow();
    expect(generateText).toHaveBeenCalledTimes(2);
    expect([...chain.failed]).toEqual(["a", "b"]);
  });

  it("recovers on the second candidate", async () => {
    generateText.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ text: CV, finishReason: "stop", usage: {} });
    const { transcribeImage } = await import("@/lib/ai/vision");
    const chain = chainOf("a", "b");
    expect(await transcribeImage(chain, image)).toBe(CV);
    expect(chain.used.cooldownKey).toBe("b");
  });

  it("says that a model with no eyes cannot do this, and what kind can", async () => {
    generateText.mockImplementation(async () => {
      throw new APICallError({ message: "unknown variant `image_url`, expected `text`", url: "https://api.example.com", requestBodyValues: {}, statusCode: 400, responseBody: "image input is not supported" });
    });
    const { transcribeImage } = await import("@/lib/ai/vision");
    await expect(transcribeImage(chainOf("deepseek"), image)).rejects.toThrow(/Ese modelo no lee imágenes/);
  });

  it("says what went wrong with the provider in a sentence of its own, with the status it answers with, and a way out", async () => {
    const { transcribeImage, VisionFailure } = await import("@/lib/ai/vision");
    const refused = (statusCode: number, message: string, responseBody = "") => new APICallError({ message, url: "https://api.example.com", requestBodyValues: {}, statusCode, responseBody });
    const cases: Array<[Error, number, RegExp]> = [
      [refused(401, "Incorrect API key provided"), 401, /API key fue rechazada/],
      [refused(402, "Payment required", "insufficient credit"), 402, /no tiene saldo/],
      [refused(413, "Payload too large"), 413, /demasiado grande/],
      [refused(429, "Too many requests"), 429, /limitando los pedidos/],
      [refused(500, "boom"), 502, /No pudimos leer esa foto/],
      [Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }), 504, /tardó demasiado/],
    ];
    for (const [error, status, sentence] of cases) {
      generateText.mockReset();
      generateText.mockRejectedValue(error);
      const failed = await transcribeImage(chainOf("a"), image).catch((thrown: unknown) => thrown);
      expect(failed, String(error.message)).toBeInstanceOf(VisionFailure);
      expect((failed as InstanceType<typeof VisionFailure>).status).toBe(status);
      expect((failed as Error).message).toMatch(sentence);
    }
  });

  it("never lets a key through in what it says", async () => {
    const { transcribeImage } = await import("@/lib/ai/vision");
    generateText.mockRejectedValue(new APICallError({ message: "Incorrect API key provided: sk-test-not-a-real-key", url: "https://api.example.com", requestBodyValues: {}, statusCode: 401, responseBody: "" }));
    const failed = await transcribeImage(chainOf("a"), image).catch((thrown: unknown) => thrown);
    expect((failed as Error).message).not.toMatch(/sk-test-not-a-real-key/);
  });

  it("stops asking when the person has gone", async () => {
    const controller = new AbortController();
    generateText.mockImplementation(async () => {
      controller.abort();
      throw new Error("aborted");
    });
    const { transcribeImage } = await import("@/lib/ai/vision");
    const chain = { ...chainOf("a", "b"), signal: controller.signal };
    await expect(transcribeImage(chain, image)).rejects.toThrow();
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});
