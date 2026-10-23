import { describe, expect, it } from "vitest";
import { z } from "zod";
import { relaxJsonSchema } from "@/lib/ai/cohere-schema";
import { intakeOperationSchema, intakeTurnSchema } from "@/lib/schemas/intake";

/**
 * The turn schema is the widest thing this app asks a provider to fill in: a
 * discriminated union of eighteen shapes, nested in an array, nested in an
 * object. `cvSectionSchema` has four variants and already needed
 * `lib/ai/cohere-schema.ts` to survive Cohere and Gemini — so the same
 * guarantees are pinned here before the chat is pointed at either.
 */

describe("intakeTurnSchema", () => {
  it("puts reply first, so the streamed text arrives before the operations", () => {
    // The route streams partial objects and models emit keys in schema order.
    // If `reply` stops being first the chat goes silent until the whole turn
    // has been generated, which is the entire reason for streaming it.
    const schema = z.toJSONSchema(intakeTurnSchema, { io: "input" }) as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties)[0]).toBe("reply");
  });

  it("parses a turn shaped the way a model returns one", () => {
    const parsed = intakeTurnSchema.parse({
      reply: "¿En qué empresa fue?",
      operations: [
        { op: "setBasic", field: "fullName", value: "Ana Gómez" },
        { op: "addExperience", ref: "new-1", company: "Flash Page", role: "Dev" },
        { op: "addBullet", ref: "new-1", text: "Escribí servicios en Go." },
      ],
      topicDone: false,
      missing: ["desde cuándo"],
    });
    expect(parsed.operations).toHaveLength(3);
  });

  it("defaults everything except the reply, so a bare answer still parses", () => {
    // A turn that only asks a question emits no operations. Making any of these
    // required would fail the whole turn over a field with an obvious value.
    const parsed = intakeTurnSchema.parse({ reply: "¿Cómo te llamás?" });
    expect(parsed).toEqual({
      reply: "¿Cómo te llamás?",
      operations: [],
      topicDone: false,
      missing: [],
      notesHandled: [],
    });
  });

  it("takes the notes a turn dealt with as indices", () => {
    const parsed = intakeTurnSchema.parse({ reply: "Listo.", notesHandled: [0, 2] });
    expect(parsed.notesHandled).toEqual([0, 2]);
  });

  it("rejects an operation whose discriminator is not one of ours", () => {
    expect(() =>
      intakeTurnSchema.parse({ reply: "ok", operations: [{ op: "dropProfile" }] }),
    ).toThrow();
  });

  it("truncates rather than overflowing the profile's own caps", () => {
    const parsed = intakeTurnSchema.parse({
      reply: "ok",
      operations: [{ op: "addBullet", ref: "e1", text: "x".repeat(900) }],
    });
    const op = parsed.operations[0]!;
    expect(op.op === "addBullet" && op.text).toHaveLength(600);
  });
});

describe("relaxJsonSchema over the turn", () => {
  it("leaves no keyword Cohere rejects", () => {
    const raw = z.toJSONSchema(intakeTurnSchema, { io: "input" });
    const relaxed = JSON.stringify(relaxJsonSchema(raw));

    for (const keyword of ["minItems", "maxItems", "minLength", "maxLength", "oneOf"]) {
      expect(relaxed).not.toContain(keyword);
    }
  });

  it("keeps every variant of the union distinguishable after relaxing", () => {
    // The rename to `anyOf` is what stops Gemini flattening a union into bare
    // strings (see the module docstring in lib/ai/cohere-schema.ts). If a
    // variant's `op` const is lost, the model has no way to say which shape it
    // is sending.
    const relaxed = JSON.stringify(
      relaxJsonSchema(z.toJSONSchema(intakeOperationSchema, { io: "input" })),
    );

    for (const op of [
      "setBasic",
      "setPractical",
      "setPracticalFlag",
      "addLink",
      "addExperience",
      "updateExperience",
      "addBullet",
      "updateBullet",
      "addTags",
      "addEducation",
      "updateEducation",
      "addProject",
      "addCertification",
      "addLanguage",
      "addSkills",
      "addExtra",
      "remove",
      "note",
    ]) {
      expect(relaxed).toContain(`"${op}"`);
    }
  });

  it("never leaves an object with an empty required list", () => {
    // Cohere rejects "object type must have at least one required field".
    // Every variant carries a required `op`, but the guard is what makes that
    // a property of the output rather than a coincidence of the input.
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node === null || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (record.type === "object" && record.properties) {
        expect(Array.isArray(record.required) && record.required.length > 0).toBe(true);
      }
      Object.values(record).forEach(walk);
    };

    walk(relaxJsonSchema(z.toJSONSchema(intakeTurnSchema, { io: "input" })));
  });
});
