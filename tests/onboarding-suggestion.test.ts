import { describe, expect, it } from "vitest";
import { infoFrom, pdfDate } from "@/lib/import/pdf-runs";
import { parseCv } from "@/lib/parse/cv-heuristic";
import { linesFromText } from "@/lib/parse/lines";
import { applyParsedDocument } from "@/lib/parse/to-profile";
import { sourceDate, suggestedSide } from "@/lib/onboarding/review";
import { emptyStoredProfile, importedSourceSchema, type Conflict, type StoredProfile } from "@/lib/schemas/profile-v2";
import { SPANISH_BULLETS } from "./fixtures/cv-samples";

/**
 * Where two documents say a thing differently, the newer one is suggested — when both have a date and one is clearly newer. A
 * file's date is not the date of what it says, so it is a suggestion and never a choice, and it says nothing when it cannot know.
 */

describe("a date a PDF gives of itself", () => {
  it("reads the PDF's own format, with whatever follows the year", () => {
    expect(pdfDate("D:20240115103000+01'00'")).toBe("2024-01-15T10:30:00.000Z");
    expect(pdfDate("D:20240115")).toBe("2024-01-15T00:00:00.000Z");
    expect(pdfDate("D:2024")).toBe("2024-01-01T00:00:00.000Z");
    expect(pdfDate("  D:20231231235959Z ")).toBe("2023-12-31T23:59:59.000Z");
  });

  it("is nothing for what is not a date, or a year nobody made a CV in", () => {
    for (const value of [undefined, 20240115, "", "2024-01-15", "D:abcd", "D:00000101000000", "D:18500101", "D:30000101"]) {
      expect(pdfDate(value), String(value)).toBeUndefined();
    }
  });

  it("goes into the metadata the importer keeps, whatever the file called its fields", () => {
    expect(infoFrom({ Author: "LinkedIn", CreationDate: "D:20240102030405Z", ModDate: "D:20250304" })).toEqual({
      author: "LinkedIn",
      created: "2024-01-02T03:04:05.000Z",
      modified: "2025-03-04T00:00:00.000Z",
    });
    expect(infoFrom({ Author: "x" })).toEqual({ author: "x" });
  });
});

describe("what a source remembers of when it is from", () => {
  const apply = (info: Record<string, string>) =>
    applyParsedDocument(emptyStoredProfile(), parseCv(linesFromText(SPANISH_BULLETS), "cv"), { name: "cv.pdf", fileHash: "h", pasted: false, chars: 10, ...info }, { sourceId: "s1", now: "2026-10-04T10:00:00.000Z", newId: () => crypto.randomUUID() }).profile.sources[0]!;

  it("keeps both dates a file gave, and nothing when it gave none", () => {
    expect(apply({ modifiedAt: "2025-01-01T00:00:00.000Z", madeAt: "2024-12-01T00:00:00.000Z" })).toMatchObject({ modifiedAt: "2025-01-01T00:00:00.000Z", madeAt: "2024-12-01T00:00:00.000Z" });
    const bare = apply({});
    expect("modifiedAt" in bare || "madeAt" in bare).toBe(false);
  });

  it("is what the document says before what the device says, and none when there is none", () => {
    const source = (extra: Record<string, string>) => importedSourceSchema.parse({ id: "x", ...extra });
    expect(sourceDate(source({ madeAt: "2024-01-01T00:00:00.000Z", modifiedAt: "2025-01-01T00:00:00.000Z" }))).toBe(Date.parse("2024-01-01T00:00:00.000Z"));
    expect(sourceDate(source({ modifiedAt: "2025-01-01T00:00:00.000Z" }))).toBe(Date.parse("2025-01-01T00:00:00.000Z"));
    expect(sourceDate(source({ madeAt: "nonsense", modifiedAt: "2025-01-01T00:00:00.000Z" }))).toBe(Date.parse("2025-01-01T00:00:00.000Z"));
    expect(sourceDate(source({}))).toBeNull();
    expect(sourceDate(undefined)).toBeNull();
  });
});

describe("which version to suggest", () => {
  const side = (docId?: string) => ({ value: "x", status: "proposed" as const, ...(docId ? { source: { kind: "cv" as const, docId, at: "" } } : {}) });
  const conflict = (current?: string, incoming?: string): Pick<Conflict, "current" | "incoming"> => ({ current: side(current), incoming: side(incoming) });
  const profile = (dates: Record<string, Record<string, string>>): Pick<StoredProfile, "sources"> => ({
    sources: Object.entries(dates).map(([id, extra]) => importedSourceSchema.parse({ id, ...extra })),
  });
  const day = (n: number) => `2025-03-${String(n).padStart(2, "0")}T12:00:00.000Z`;

  it("is the version from the newer document, when both have a date", () => {
    const sources = profile({ a: { madeAt: day(1) }, b: { madeAt: day(20) } });
    expect(suggestedSide(sources, conflict("a", "b"))).toMatchObject({ side: "incoming", newer: Date.parse(day(20)), older: Date.parse(day(1)) });
    expect(suggestedSide(sources, conflict("b", "a"))).toMatchObject({ side: "current" });
  });

  it("compares what a PDF says of itself with what another file's device says", () => {
    const sources = profile({ a: { madeAt: day(1) }, b: { modifiedAt: day(20) } });
    expect(suggestedSide(sources, conflict("a", "b"))?.side).toBe("incoming");
  });

  it("says nothing when it cannot know: no date, the same document, a version the person wrote, or the same afternoon", () => {
    expect(suggestedSide(profile({ a: { madeAt: day(1) }, b: {} }), conflict("a", "b"))).toBeNull();
    expect(suggestedSide(profile({ a: { madeAt: day(1) } }), conflict("a", "a"))).toBeNull();
    expect(suggestedSide(profile({ a: { madeAt: day(1) }, b: { madeAt: day(20) } }), conflict("a"))).toBeNull();
    expect(suggestedSide(profile({ a: { madeAt: day(1) }, b: { madeAt: day(20) } }), conflict("a", "gone"))).toBeNull();
    expect(suggestedSide(profile({ a: { madeAt: "2025-03-01T08:00:00.000Z" }, b: { madeAt: "2025-03-01T20:00:00.000Z" } }), conflict("a", "b"))).toBeNull();
  });
});
