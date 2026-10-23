import { describe, expect, it } from "vitest";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { chooseFollowUp } from "@/lib/ai/followup";
import { FOLLOW_UP_SYSTEM } from "@/lib/ai/prompts/followup";
import type { ModelChain, ModelChoice } from "@/lib/ai/provider";

/**
 * Choosing a question through the real generator and the SDK's own model, with a fetch that answers: the schema built from the
 * ids reaches the provider, what it says is read back as one of them or none, and an id that is not on the list is an error and
 * never a question.
 */

type Seen = { messages: Array<{ role: string; content: unknown }> };

function chain(replies: string[], seen: Seen[]): ModelChain {
  let call = 0;
  const fetchWith: typeof fetch = async (_input, init) => {
    seen.push(JSON.parse(String(init?.body ?? "{}")) as Seen);
    const content = replies[Math.min(call++, replies.length - 1)]!;
    return new Response(
      JSON.stringify({ id: "r", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const model = createOpenAICompatible({ name: "prueba", baseURL: "https://proveedor.example/v1", apiKey: "k", fetch: fetchWith })("m");
  const choice: ModelChoice = { model, describe: "prueba", cooldownKey: `k-${Math.random()}`, provider: "groq", modelId: "m", reasoningCapable: false, looseJsonSchema: false };
  return { candidates: [choice], deadlineAt: Date.now() + 60_000, used: choice, failed: new Set(), switches: [] };
}

const options = [
  { id: "vague_scale:e1:f1", about: "Ask how many." },
  { id: "no_achievements:e1", about: "Ask whether anything improved." },
];

describe("the choice of the next question, through the generator", () => {
  it("gives back the id the model chose, after sending it the answer, the instructions and the list", async () => {
    const seen: Seen[] = [];
    const choice = await chooseFollowUp(chain(['{"choice":"no_achievements:e1"}'], seen), "Armé un tablero de ventas", options);
    expect(choice).toBe("no_achievements:e1");
    const sent = JSON.stringify(seen[0]);
    expect(sent).toContain(FOLLOW_UP_SYSTEM.slice(0, 60));
    expect(sent).toContain("Armé un tablero de ventas");
    expect(sent).toContain("- vague_scale:e1:f1: Ask how many.");
    // The ids are the whole of what it may say, with «none»: the schema sent says so.
    expect(sent).toContain("vague_scale:e1:f1");
    expect(sent).toContain("none");
  });

  it("gives back none when the model says none", async () => {
    expect(await chooseFollowUp(chain(['{"choice":"none"}'], []), "Armé un tablero de ventas", options)).toBe("none");
  });

  it("does not make a question of an id that was not on the list: it is an error, after one more try and no more", async () => {
    const seen: Seen[] = [];
    await expect(chooseFollowUp(chain(['{"choice":"invented"}'], seen), "Armé un tablero de ventas", options)).rejects.toThrow();
    expect(seen.length).toBeLessThanOrEqual(2);
  });
});
