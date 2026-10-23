import { describe, expect, it } from "vitest";
import { z } from "zod";
import { relaxJsonSchema } from "@/lib/ai/cohere-schema";
import { inferredSkillsSchema } from "@/lib/schemas/job";
import { cvDocumentSchema, cvLabelsSchema, cvSectionSchema } from "@/lib/schemas/cv";

/**
 * Cohere's structured-outputs endpoint rejects `minItems`/`maxItems`,
 * `minLength`/`maxLength` and `oneOf` — see the "invalid 'json_schema'
 * provided ... constraint: 'maxItems'" 400 this guards against, first hit on
 * `inferredSkillsSchema.skills` (`.max(60)`).
 */
describe("relaxJsonSchema", () => {
  it("strips minItems/maxItems and maxLength recursively, without touching required or additionalProperties", () => {
    const raw = z.toJSONSchema(inferredSkillsSchema, { io: "input" }) as Record<string, unknown>;
    expect(JSON.stringify(raw)).toContain("maxItems");
    expect(JSON.stringify(raw)).toContain("maxLength");

    const relaxed = JSON.stringify(relaxJsonSchema(raw));

    expect(relaxed).not.toContain("minItems");
    expect(relaxed).not.toContain("maxItems");
    expect(relaxed).not.toContain("minLength");
    expect(relaxed).not.toContain("maxLength");
    expect(relaxed).toContain("required");
    expect(relaxed).toContain("additionalProperties");
  });

  it("converts oneOf to anyOf at every level of a discriminated union", () => {
    const raw = z.toJSONSchema(cvSectionSchema, { io: "input" }) as Record<string, unknown>;
    expect(raw.oneOf).toBeDefined();

    const relaxed = relaxJsonSchema(raw) as Record<string, unknown>;

    expect(relaxed.oneOf).toBeUndefined();
    expect(Array.isArray(relaxed.anyOf)).toBe(true);
    expect((relaxed.anyOf as unknown[]).length).toBe((raw.oneOf as unknown[]).length);
  });

  it("leaves enum, const and description untouched", () => {
    const schema = z.object({
      kind: z.enum(["a", "b"]),
      flag: z.literal("x").describe("a fixed value"),
    });
    const raw = z.toJSONSchema(schema, { io: "input" });

    const relaxed = relaxJsonSchema(raw) as { properties: Record<string, unknown> };

    expect(relaxed.properties.kind).toEqual((raw as { properties: Record<string, unknown> }).properties.kind);
    expect(relaxed.properties.flag).toEqual(
      (raw as { properties: Record<string, unknown> }).properties.flag,
    );
  });

  it("passes through primitives and null untouched", () => {
    expect(relaxJsonSchema(null)).toBeNull();
    expect(relaxJsonSchema("x")).toBe("x");
    expect(relaxJsonSchema(5)).toBe(5);
  });

  /**
   * Cohere also rejects an object type with zero required fields ("`object`
   * type must have at least one required field") — the 400 this guards
   * against, first hit on `cvDocumentSchema.properties.labels`, whose every
   * field carries a `.default()` so `z.toJSONSchema(..., { io: "input" })`
   * omits all of them from `required`.
   */
  it("fills required with every property key on an object whose fields are all defaulted", () => {
    const raw = z.toJSONSchema(cvLabelsSchema, { io: "input" }) as Record<string, unknown>;
    expect(raw.required).toBeUndefined();

    const relaxed = relaxJsonSchema(raw) as { required: string[]; properties: Record<string, unknown> };

    expect(relaxed.required.sort()).toEqual(Object.keys(relaxed.properties).sort());
  });

  it("leaves an object's existing non-empty required array untouched", () => {
    const raw = z.toJSONSchema(cvDocumentSchema, { io: "input" }) as unknown as {
      properties: { header: { required: string[]; properties: Record<string, unknown> } };
    };
    const originalHeaderRequired = [...raw.properties.header.required];
    expect(originalHeaderRequired.length).toBeGreaterThan(0);
    expect(originalHeaderRequired.length).toBeLessThan(
      Object.keys(raw.properties.header.properties).length,
    );

    const relaxed = relaxJsonSchema(raw) as {
      properties: { header: { required: string[] } };
    };

    expect(relaxed.properties.header.required.sort()).toEqual(originalHeaderRequired.sort());
  });

  it("fills required for labels nested inside the full CV document schema", () => {
    const raw = z.toJSONSchema(cvDocumentSchema, { io: "input" });
    const relaxed = relaxJsonSchema(raw) as {
      properties: { labels: { required: string[]; properties: Record<string, unknown> } };
    };

    expect(relaxed.properties.labels.required.sort()).toEqual(
      Object.keys(relaxed.properties.labels.properties).sort(),
    );
  });
});
