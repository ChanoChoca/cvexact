import { describe, expect, it } from "vitest";
import {
  IMPROVE_BATCH,
  IMPROVE_LIMIT,
  IMPROVE_MANY_LIMIT,
  IMPROVE_MANY_SYSTEM,
  IMPROVE_SYSTEM,
  buildImproveManyPrompt,
  buildImprovePrompt,
  improveManySchema,
  improveSchema,
  keepProposed,
  type ImproveItem,
} from "@/lib/ai/prompts/improve";

/**
 * «Mejorar con IA» is "say the same thing better" and "say more" an instruction apart for a model, so the prompt spends its words on the
 * difference — and everything it returns is checked again in the browser (`lib/onboarding/improve-guard.ts`), so a model that ignores
 * this is caught and not trusted.
 */

const says = (phrase: string) => new RegExp(phrase.trim().replace(/\s+/g, "\\s+"), "i");

describe("the instructions", () => {
  it("ask for the same facts and nothing the text does not say", () => {
    expect(IMPROVE_SYSTEM).toMatch(says("You are editing, not inventing"));
    expect(IMPROVE_SYSTEM).toMatch(says("Keep exactly the same facts"));
  });

  it("forbid a new figure, name or tool, and a figure dropped", () => {
    expect(IMPROVE_SYSTEM).toMatch(says("Never add a number, percentage, amount, date or quantity"));
    expect(IMPROVE_SYSTEM).toMatch(says("copy every figure exactly as it is written"));
    expect(IMPROVE_SYSTEM).toMatch(says("Never add the name of a company, a person, a client, a product or a place"));
    expect(IMPROVE_SYSTEM).toMatch(says("never add a tool, technology, method or certification"));
  });

  it("forbid a result the text does not claim, and a task that turns into an achievement", () => {
    expect(IMPROVE_SYSTEM).toMatch(says("Never add a result, an impact or a scale"));
    expect(IMPROVE_SYSTEM).toMatch(says("Do not turn a task into an achievement"));
  });

  it("keep the marks that stand for who the person is, and the language", () => {
    expect(IMPROVE_SYSTEM).toMatch(says("copy it exactly, brackets and number included"));
    expect(IMPROVE_SYSTEM).toMatch(says("Keep the language of the text"));
  });

  it("say that leaving it as it is is a good answer", () => {
    expect(IMPROVE_SYSTEM).toMatch(says("Returning it unchanged is a good answer"));
  });
});

describe("the prompt", () => {
  it("carries the text verbatim and says which kind it is", () => {
    const text = "Armo los pedidos del depósito";
    expect(buildImprovePrompt(text, "task")).toContain(text);
    expect(buildImprovePrompt(text, "task")).toMatch(/^TASK/);
    expect(buildImprovePrompt(text, "project")).toMatch(/^PROJECT/);
  });
});

describe("the answer", () => {
  it("is one text, and not an empty one", () => {
    expect(improveSchema.parse({ text: "Armo pedidos" })).toEqual({ text: "Armo pedidos" });
    expect(improveSchema.safeParse({ text: "" }).success).toBe(false);
    expect(improveSchema.safeParse({}).success).toBe(false);
  });

  it("is rejected when it is longer than the longest field, so that asking again repairs it and it is not kept cut", () => {
    expect(improveSchema.safeParse({ text: "a".repeat(IMPROVE_LIMIT.project) }).success).toBe(true);
    expect(improveSchema.safeParse({ text: "a".repeat(IMPROVE_LIMIT.project + 1) }).success).toBe(false);
  });
});

describe("the instructions for many texts at once", () => {
  it("hold every rule of the instructions for one: the same facts, no new figure, name or tool, the marks and the language", () => {
    for (const phrase of [
      "You are editing, not inventing",
      "Keep exactly the same facts",
      "Never add a number, percentage, amount, date or quantity",
      "copy every figure exactly as it is written",
      "Never add the name of a company, a person, a client, a product or a place",
      "never add a tool, technology, method or certification",
      "Never add a result, an impact or a scale",
      "Do not turn a task into an achievement",
      "copy it exactly, brackets and number included",
      "Keep the language of the text",
      "Returning it unchanged is a good answer",
    ]) {
      expect(IMPROVE_MANY_SYSTEM, phrase).toMatch(says(phrase));
    }
  });

  it("say what each kind of text is, once", () => {
    for (const kind of Object.keys(IMPROVE_MANY_LIMIT)) expect(IMPROVE_MANY_SYSTEM.match(new RegExp(`^- ${kind.toUpperCase()}:`, "gm")), kind).toHaveLength(1);
  });

  it("let a name come back longer, but only written in full, and never with a version, a level or an issuer", () => {
    expect(IMPROVE_MANY_SYSTEM).toMatch(says("This is the only kind that may come back longer, and only by being written in full"));
    expect(IMPROVE_MANY_SYSTEM).toMatch(says("Never add a version, a level, an issuer or any word it does not have"));
    expect(IMPROVE_MANY_SYSTEM).toMatch(says("If a name could mean more than one thing, leave it as it is"));
  });
});

describe("the prompt for many texts", () => {
  const items: ImproveItem[] = [
    { id: "0", kind: "task", text: "Armo los pedidos del depósito" },
    { id: "1", kind: "name", text: "ingles" },
    { id: "2", kind: "points", text: "Tesis sobre logística\nPromedio 8" },
  ];

  it("carries each text verbatim, with its place and its kind", () => {
    const prompt = buildImproveManyPrompt(items);
    expect(prompt).toContain('ITEM 0 · TASK (verbatim):\n"""\nArmo los pedidos del depósito\n"""');
    expect(prompt).toContain('ITEM 1 · NAME (verbatim):\n"""\ningles\n"""');
    expect(prompt).toContain("Tesis sobre logística\nPromedio 8");
  });
});

describe("the answer for many texts", () => {
  it("is a list of texts with their place, none of them empty", () => {
    expect(improveManySchema.parse({ items: [{ id: "0", text: "Armo pedidos" }] })).toEqual({ items: [{ id: "0", text: "Armo pedidos" }] });
    expect(improveManySchema.safeParse({ items: [{ id: "0", text: "" }] }).success).toBe(false);
    expect(improveManySchema.safeParse({ items: [{ text: "Armo pedidos" }] }).success).toBe(false);
    expect(improveManySchema.safeParse({}).success).toBe(false);
  });

  it("is rejected past the longest field and past what one call takes, so that asking again repairs it", () => {
    expect(improveManySchema.safeParse({ items: [{ id: "0", text: "a".repeat(IMPROVE_MANY_LIMIT.about) }] }).success).toBe(true);
    expect(improveManySchema.safeParse({ items: [{ id: "0", text: "a".repeat(IMPROVE_MANY_LIMIT.about + 1) }] }).success).toBe(false);
    const many = (count: number) => ({ items: Array.from({ length: count }, (_, id) => ({ id: String(id), text: "a" })) });
    expect(improveManySchema.safeParse(many(IMPROVE_BATCH.items)).success).toBe(true);
    expect(improveManySchema.safeParse(many(IMPROVE_BATCH.items + 1)).success).toBe(false);
  });

  it("keeps the longest limits of one text as they were, and gives the other kinds theirs", () => {
    expect(IMPROVE_MANY_LIMIT).toMatchObject({ ...IMPROVE_LIMIT, about: 2000, headline: 160, name: 160 });
  });
});

describe("what of the answer is a proposal", () => {
  const items: ImproveItem[] = [
    { id: "0", kind: "task", text: "Armo los pedidos" },
    { id: "1", kind: "name", text: "ingles" },
    { id: "2", kind: "headline", text: "Analista" },
  ];

  it("is what was asked about, once, trimmed", () => {
    expect(keepProposed(items, { items: [{ id: "1", text: " Inglés " }, { id: "0", text: "Armo los pedidos del depósito" }] })).toEqual([
      { id: "1", text: "Inglés" },
      { id: "0", text: "Armo los pedidos del depósito" },
    ]);
  });

  it("is not an id nobody asked about, a second answer for the same text, or a blank one", () => {
    const kept = keepProposed(items, { items: [{ id: "9", text: "Otra cosa" }, { id: "0", text: "Armo pedidos" }, { id: "0", text: "Armo otros pedidos" }, { id: "1", text: "   " }] });
    expect(kept).toEqual([{ id: "0", text: "Armo pedidos" }]);
  });

  it("is not a text longer than the field it came from could hold", () => {
    expect(keepProposed(items, { items: [{ id: "2", text: "a".repeat(IMPROVE_MANY_LIMIT.headline + 1) }, { id: "0", text: "a".repeat(IMPROVE_MANY_LIMIT.task) }] })).toEqual([
      { id: "0", text: "a".repeat(IMPROVE_MANY_LIMIT.task) },
    ]);
  });
});
