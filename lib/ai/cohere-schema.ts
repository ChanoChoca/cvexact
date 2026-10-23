import "server-only";

import { jsonSchema, type JSONSchema7, type Schema } from "ai";
import { z } from "zod";

/**
 * Two unrelated providers need the JSON Schema this app sends relaxed before
 * it reaches them, for two different reasons — this module fixes both with
 * the same transform.
 *
 * Cohere's structured-outputs endpoint validates the JSON Schema it is given
 * and rejects several keywords Zod v4's `z.toJSONSchema()` emits for nearly
 * every field in this app's schemas — `minItems`/`maxItems` on arrays,
 * `minLength`/`maxLength` on strings, and `oneOf` (what
 * `z.discriminatedUnion()` compiles to). See
 * https://docs.cohere.com/docs/structured-outputs. `anyOf`, `enum`, `const`,
 * `required` and `additionalProperties` are all fine.
 *
 * `pattern`/`format` are also unsupported there, but nothing in
 * `lib/schemas/*.ts` emits them (no `.regex()`/`.email()`/`.url()`/`.uuid()`/
 * `.datetime()`), so there is nothing to strip for those yet.
 *
 * `@ai-sdk/google` has a narrower but sharper problem: its converter to
 * Gemini's OpenAPI-style `responseSchema`
 * (`convertJSONSchemaToOpenAPISchema`) gives `anyOf` special handling
 * (including collapsing a nullable union to `nullable: true`) but forwards
 * `oneOf` — what `cvSectionSchema` compiles to, the only
 * `z.discriminatedUnion()` in this app — completely unhandled. Nested inside
 * an array's `items` (`cvDocumentSchema.sections`), that made Gemini lose
 * the per-`kind` shape entirely: it returned `sections[].items` as an array
 * of bare strings instead of objects, for every kind that isn't `"bullets"`.
 * Renaming `oneOf` to `anyOf` before it reaches Gemini fixes exactly this,
 * with no change to what is actually enforced (`generateObject` still
 * validates the response against the full, unrelaxed `cvSectionSchema`).
 */
const UNSUPPORTED_KEYS = ["minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum"];

/**
 * Recursively strips the JSON Schema keywords Cohere rejects and renames
 * `oneOf` to `anyOf` — the rename is also what fixes Gemini's mishandling of
 * `cvSectionSchema` (see the module docstring above). Only the wire-level
 * schema is relaxed — the model's response is still validated against the
 * full, unrelaxed Zod schema, so this only affects what the provider is
 * *told*, not what is *enforced*.
 *
 * Also sets `additionalProperties: false` on every object node, same as the
 * AI SDK's own `zod4Schema` does via `addAdditionalPropertiesToJsonSchema`
 * for every other provider — `z.toJSONSchema()` alone doesn't set it, and
 * skipping it here would make Cohere the one provider not told to reject
 * extra fields. `convertJSONSchemaToOpenAPISchema` (Gemini's converter) never
 * reads this key at all, so it is a no-op for Google either way.
 *
 * And fills in `required` on any object node that has none: Cohere also
 * rejects an object type with zero required fields ("`object` type must have
 * at least one required field"), which `cvLabelsSchema` and
 * `interviewLabelsSchema` both trigger — every one of their fields carries a
 * `.default()`, so `z.toJSONSchema(..., { io: "input" })` omits all of them
 * from `required`. An object whose `required` is already non-empty is left
 * untouched. Same as above, Gemini's converter never reads this key either.
 */
export function relaxJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(relaxJsonSchema);
  if (node === null || typeof node !== "object") return node;

  const entries = Object.entries(node as Record<string, unknown>)
    .filter(([key]) => !UNSUPPORTED_KEYS.includes(key))
    .map(([key, value]) => [key === "oneOf" ? "anyOf" : key, relaxJsonSchema(value)] as const);

  const relaxed = Object.fromEntries(entries) as Record<string, unknown>;
  if (relaxed.type === "object") {
    relaxed.additionalProperties = false;
    const properties = relaxed.properties as Record<string, unknown> | undefined;
    const required = relaxed.required;
    if (properties && (!Array.isArray(required) || required.length === 0)) {
      relaxed.required = Object.keys(properties);
    }
  }
  return relaxed;
}

/**
 * Wraps a Zod schema so `generateObject` sends Cohere or Google a JSON
 * Schema they will actually handle correctly, while still validating the
 * model's response against `schema` itself. Mirrors the AI SDK's own
 * `zod4Schema` (in `@ai-sdk/provider-utils`), which builds exactly this
 * `{ jsonSchema, validate }` shape from a Zod schema — the only difference
 * here is that the JSON Schema half is relaxed before being handed to
 * `jsonSchema()`.
 */
export function relaxedSchema<T>(schema: z.ZodType<T>): Schema<T> {
  return jsonSchema<T>(
    () => relaxJsonSchema(z.toJSONSchema(schema, { io: "input" })) as JSONSchema7,
    {
      validate: async (value) => {
        const result = await schema.safeParseAsync(value);
        return result.success
          ? { success: true, value: result.data }
          : { success: false, error: result.error };
      },
    },
  );
}
