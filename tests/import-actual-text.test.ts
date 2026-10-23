import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { actualTextStreams, extractActualTextFromContent, restoreActualText } from "@/lib/import/actual-text";

/** One PDF indirect object holding a Flate-compressed stream, built the way a real file lays it out. */
function streamObject(num: number, dict: string, content: string): Buffer {
  const compressed = deflateSync(Buffer.from(content, "latin1"));
  return Buffer.concat([
    Buffer.from(`${num} 0 obj\n<< ${dict} /Length ${compressed.length} >>\nstream\n`, "latin1"),
    compressed,
    Buffer.from("\nendstream\nendobj\n", "latin1"),
  ]);
}

/** A minimal "PDF" — just the object bodies this reads, none of the surrounding structure it ignores. */
function fakePdf(objects: readonly Buffer[]): Uint8Array<ArrayBuffer> {
  const buffer = Buffer.concat([Buffer.from("%PDF-1.4\n"), ...objects]);
  // A plain copy: `Buffer.concat` returns a `Uint8Array<ArrayBufferLike>`, and
  // `actualTextStreams` wants the narrower, always-real-`ArrayBuffer` type
  // pdf.js's own bytes carry.
  const out = new Uint8Array(buffer.length);
  out.set(buffer);
  return out;
}

const CONTENT_WITH_LIGATURES =
  "BT /F1 12 Tf (Uses a) Tj /Span<</ActualText (f) >> BDC <7c> Tj EMC /Span<</ActualText (l) >> BDC <83> Tj EMC (ash) Tj ET";

describe("extractActualTextFromContent", () => {
  it("reads a literal string value", () => {
    expect(extractActualTextFromContent("/Span<</ActualText (f) >> BDC")).toEqual(["f"]);
  });

  it("reads several, in order", () => {
    expect(extractActualTextFromContent(CONTENT_WITH_LIGATURES)).toEqual(["f", "l"]);
  });

  it("reads a hex string value", () => {
    expect(extractActualTextFromContent("/Span<</ActualText <66> >> BDC")).toEqual(["f"]);
  });

  it("decodes a UTF-16BE hex string by its BOM", () => {
    expect(extractActualTextFromContent("/Span<</ActualText <FEFF0066> >> BDC")).toEqual(["f"]);
  });

  it("keeps a balanced inner parenthesis instead of ending the string early", () => {
    expect(extractActualTextFromContent("/ActualText (fi(ne))")).toEqual(["fi(ne)"]);
  });

  it("resolves octal and named escapes", () => {
    expect(extractActualTextFromContent("/ActualText (\\101\\n\\)\\()")).toEqual(["A\n)("]);
  });

  it("finds nothing in text with no ActualText span", () => {
    expect(extractActualTextFromContent("BT /F1 12 Tf (hola) Tj ET")).toEqual([]);
  });

  it("does not loop forever on a marker with no string after it", () => {
    expect(extractActualTextFromContent("/ActualText /Other true")).toEqual([]);
  });
});

describe("actualTextStreams", () => {
  it("finds ActualText inside a Flate content stream", async () => {
    const pdf = fakePdf([streamObject(4, "/Filter /FlateDecode", CONTENT_WITH_LIGATURES)]);
    expect(await actualTextStreams(pdf)).toEqual(["f", "l"]);
  });

  it("does not try to inflate a font program (/Length1)", async () => {
    const pdf = fakePdf([streamObject(5, "/Filter /FlateDecode /Length1 900", "/ActualText (f) garbage that is not really a font")]);
    expect(await actualTextStreams(pdf)).toEqual([]);
  });

  it("skips an object stream and a cross-reference stream", async () => {
    const pdf = fakePdf([
      streamObject(6, "/Type /ObjStm /Filter /FlateDecode /N 1 /First 4", "/ActualText (f)"),
      streamObject(7, "/Type /XRef /Filter /FlateDecode", "/ActualText (f)"),
    ]);
    expect(await actualTextStreams(pdf)).toEqual([]);
  });

  it("skips a stream with no /FlateDecode filter", async () => {
    // Not actually DCT-encoded — the point is only that the filter name rules it out.
    const pdf = fakePdf([streamObject(8, "/Filter /DCTDecode", "/ActualText (f)")]);
    expect(await actualTextStreams(pdf)).toEqual([]);
  });

  it("reads across several objects in file order", async () => {
    const pdf = fakePdf([
      streamObject(1, "/Filter /FlateDecode", "/ActualText (a)"),
      streamObject(2, "/Filter /FlateDecode", "/ActualText (b)"),
    ]);
    expect(await actualTextStreams(pdf)).toEqual(["a", "b"]);
  });
});

describe("restoreActualText", () => {
  it("replaces each blank item with its recovered text, in order", () => {
    const items = [{ str: "Uses a" }, { str: "\u0000" }, { str: "\u0000" }, { str: "ash" }];
    restoreActualText(items, ["f", "l"]);
    expect(items.map((item) => item.str)).toEqual(["Uses a", "f", "l", "ash"]);
  });

  it("does nothing when there is nothing blank", () => {
    const items = [{ str: "hola" }];
    restoreActualText(items, ["whatever"]);
    expect(items[0]!.str).toBe("hola");
  });

  it("falls back to a visible placeholder when the counts disagree, rather than guessing", () => {
    const items = [{ str: "\u0000" }, { str: "\u0000" }];
    restoreActualText(items, ["only-one"]);
    expect(items.map((item) => item.str)).toEqual(["�", "�"]);
  });

  it("treats a multi-character run of NUL as one blank item", () => {
    const items = [{ str: "\u0000\u0000" }];
    restoreActualText(items, ["fl"]);
    expect(items[0]!.str).toBe("fl");
  });
});
