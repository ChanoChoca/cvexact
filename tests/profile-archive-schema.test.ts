import { describe, expect, it } from "vitest";
import { emptyStoredProfile, storedProfileSchema } from "@/lib/schemas/profile-v2";

describe("the archive, as it is read back", () => {
  const entry = (kind: string, id: string) => ({ id, at: "2026-10-01T10:00:00.000Z", kind, parentPath: ["notes"], entity: { id: "n", text: "hola", at: "" }, label: "hola" });

  it("keeps what it knows", () => {
    const parsed = storedProfileSchema.parse({ ...emptyStoredProfile(), archive: [entry("note", "a"), entry("fact", "b")] });
    expect(parsed.archive.map((item) => [item.id, item.kind])).toEqual([["a", "note"], ["b", "fact"]]);
  });

  it("leaves out an entry of a kind this version does not know, instead of failing the whole profile", () => {
    const parsed = storedProfileSchema.parse({ ...emptyStoredProfile(), archive: [entry("note", "a"), entry("algo-de-una-version-futura", "b"), entry("skill", "c")] });
    expect(parsed.archive.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("leaves out an entry that is not one at all", () => {
    const parsed = storedProfileSchema.parse({ ...emptyStoredProfile(), archive: [null, "x", 3, { kind: "note" }, entry("note", "a")] });
    expect(parsed.archive.map((item) => item.id)).toEqual(["a"]);
  });

  it("is an empty archive when there is none, and survives being read twice", () => {
    expect(storedProfileSchema.parse({}).archive).toEqual([]);
    const once = storedProfileSchema.parse({ archive: [entry("note", "a")] });
    expect(storedProfileSchema.parse(once)).toEqual(once);
  });
});
