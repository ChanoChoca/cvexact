import { describe, expect, it } from "vitest";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { TRANSCRIBE_SYSTEM, transcribeImage } from "@/lib/ai/vision";
import type { ModelChain, ModelChoice } from "@/lib/ai/provider";

/**
 * The reading of a photo, with the SDK's own models and a fetch that answers: what leaves for each family of provider is an image
 * part they both understand, with the instructions beside it — which is what no test with `generateText` replaced can say.
 */

type Seen = { url: string; body: Record<string, unknown> };

function answering(text: string, seen: Seen[]): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    seen.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    const body = url.includes("generativelanguage")
      ? { candidates: [{ content: { parts: [{ text }], role: "model" }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 } }
      : { id: "r", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
}

const chainOf = (model: ModelChoice["model"], provider: ModelChoice["provider"]): ModelChain => {
  const choice: ModelChoice = { model, describe: "prueba", cooldownKey: `k-${provider}`, provider, modelId: "m", reasoningCapable: false, looseJsonSchema: false };
  return { candidates: [choice], deadlineAt: Date.now() + 60_000, used: choice, failed: new Set(), switches: [] };
};

const image = { base64: "QUJD".repeat(40), mediaType: "image/jpeg" };

describe("the photo, as each kind of provider receives it", () => {
  it("goes to an OpenAI-compatible provider as an image in the message, with the instructions as the system prompt", async () => {
    const seen: Seen[] = [];
    const model = createOpenAICompatible({ name: "prueba", baseURL: "https://proveedor.example/v1", apiKey: "k", fetch: answering("Ana Ruiz\nBarista", seen) })("m");
    const telemetry: { inputTokens?: number; outputTokens?: number } = {};
    const text = await transcribeImage(chainOf(model, "groq"), image, telemetry);
    expect(text).toBe("Ana Ruiz\nBarista");
    expect(telemetry).toMatchObject({ inputTokens: 12, outputTokens: 4 });
    const messages = seen[0]!.body.messages as Array<{ role: string; content: unknown }>;
    expect(messages[0]).toEqual({ role: "system", content: TRANSCRIBE_SYSTEM });
    const user = messages[1]!.content as Array<{ type: string; image_url?: { url: string }; text?: string }>;
    expect(user[0]).toEqual({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${image.base64}` } });
    expect(user[1]).toEqual({ type: "text", text: "Transcribe this image." });
  });

  it("goes to Gemini as inline data of the same image", async () => {
    const seen: Seen[] = [];
    const model = createGoogleGenerativeAI({ apiKey: "k", fetch: answering("Ana Ruiz", seen) })("gemini-2.5-flash");
    expect(await transcribeImage(chainOf(model, "google"), image)).toBe("Ana Ruiz");
    const contents = seen[0]!.body.contents as Array<{ parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> }>;
    expect(contents[0]!.parts[0]).toEqual({ inlineData: { mimeType: "image/jpeg", data: image.base64 } });
    expect((seen[0]!.body.systemInstruction as { parts: Array<{ text: string }> }).parts[0]!.text).toBe(TRANSCRIBE_SYSTEM);
  });
});
