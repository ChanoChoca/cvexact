import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectPdfFonts, substitutedFontNames } from "@/lib/export/pdf-check";

/**
 * Reading the typography back out of the file. The fixtures are the shape
 * Chromium writes — one `FontDescriptor` per face, with its file travelling
 * inside — rather than a real PDF: what is under test is the reading.
 */

const HEADER = "%PDF-1.4\n";

function pdf(body: string): Buffer {
  return Buffer.from(`${HEADER}${body}\n%%EOF\n`, "latin1");
}

describe("inspectPdfFonts", () => {
  /**
   * The shape Chromium writes: one object per dictionary, keys in alphabetical
   * order — so `/FontName` comes *before* the `/Type` that names the dictionary.
   * A reader that opens its window at `/Type /FontDescriptor` finds no name at
   * all, which is the bug this fixture exists to catch.
   */
  const descriptor = (object: number, name: string, file?: string) =>
    `${object} 0 obj\n<< /FontFamily (STIX Two Text)\n  /FontName /${name}\n  ${file ? `/${file} 90 0 R\n  ` : ""}/StemV 172\n  /Type /FontDescriptor\n>>\nendobj`;

  const type3 = (object: number, descriptorObject: number) =>
    `${object} 0 obj\n<< /Subtype /Type3\n  /FontDescriptor ${descriptorObject} 0 R\n  /Type /Font\n>>\nendobj`;

  it("says ok when every descriptor is an embedded STIX face", () => {
    const one = pdf(
      ["Regular", "Bold", "Italic", "BoldItalic"]
        .map((style, index) => descriptor(36 + index, `STIXTwoText-${style}`, "FontFile2"))
        .join("\n"),
    );
    expect(inspectPdfFonts(one)).toBe("ok");

    // Chromium may write the subset prefix; the name behind it is what counts.
    expect(inspectPdfFonts(pdf(descriptor(36, "AAAAAA+STIXTwoText-Regular", "FontFile2")))).toBe("ok");
  });

  it("says substituted for the variable font: its names mean it is being served again, and it prints as Type 3", () => {
    // What Chromium wrote for the variable woff2 these static instances replaced.
    const variable = pdf(
      `${descriptor(36, "AAAAAA+STIXTwoText")}\n${type3(30, 36)}\n${descriptor(37, "BAAAAA+STIXTwoText_700wght", "FontFile2")}`,
    );
    expect(inspectPdfFonts(variable)).toBe("substituted");
    expect(substitutedFontNames(variable)).toEqual(["STIXTwoText", "STIXTwoText_700wght"]);
  });

  it("accepts a Type 3 face: its glyphs are content streams in the file", () => {
    // What `pdffonts` reports as `emb: yes` for a Type 3 face: no `/FontFile`
    // to find, because there is none to need.
    const page = pdf(
      `${descriptor(36, "AAAAAA+STIXTwoText-Regular")}\n${type3(30, 36)}\n${descriptor(37, "BAAAAA+STIXTwoText-Italic")}\n${type3(31, 37)}`,
    );
    expect(inspectPdfFonts(page)).toBe("ok");
  });

  it("says substituted for a face that is not STIX, or that is not embedded", () => {
    expect(inspectPdfFonts(pdf(descriptor(36, "LiberationSerif", "FontFile2")))).toBe("substituted");
    // A CID font with no file to travel in: the reader would need it locally.
    expect(inspectPdfFonts(pdf(descriptor(36, "STIXTwoText-Regular", undefined)))).toBe("substituted");
    // One alien face among the right ones is enough — the page would print it
    // in a different typeface for the glyphs it covers.
    expect(
      inspectPdfFonts(pdf(`${descriptor(36, "STIXTwoText-Regular", "FontFile2")}\n${descriptor(37, "DejaVuSans", "FontFile2")}`)),
    ).toBe("substituted");
    // And a Type 3 face whose name is not STIX is a substitution, not a pass.
    expect(
      inspectPdfFonts(pdf(`${descriptor(36, "CCCCCC+WenQuanYiZenHei")}\n${type3(30, 36)}`)),
    ).toBe("substituted");
  });

  it("names the fonts that are not STIX, and the ones that are not embedded", () => {
    const page = pdf(
      `${descriptor(36, "AAAAAA+STIXTwoText-Regular", "FontFile2")}\n${descriptor(37, "DejaVuSans", "FontFile2")}\n${descriptor(38, "STIXTwoText-Italic")}`,
    );
    expect(substitutedFontNames(page)).toEqual(["DejaVuSans", "STIXTwoText-Italic (no incrustada)"]);
    expect(substitutedFontNames(pdf(descriptor(36, "STIXTwoText-Regular", "FontFile2")))).toEqual([]);
  });

  it("says unverifiable when there is nothing to read", () => {
    // Not our producer: no descriptors to judge, and accepting it is a decision
    // the caller makes (with `fontsLoaded` and the staging check behind it).
    expect(inspectPdfFonts(pdf("1 0 obj\n<< /Type /Page >>\nendobj"))).toBe("unverifiable");
    expect(inspectPdfFonts(Buffer.from("no soy un pdf", "latin1"))).toBe("unverifiable");
  });
});

describe("the stylesheet's font files", () => {
  it("are all in public/fonts, one per weight, style and subset", () => {
    const css = readFileSync("components/cv/cv-document.css", "utf8");
    const files = [...css.matchAll(/url\("(\/fonts\/[^"]+\.woff2)"\)/g)].map((match) => match[1]!);
    expect(files).toHaveLength(8);
    expect(new Set(files).size).toBe(8);
    for (const file of files) expect(existsSync(`public${file}`), file).toBe(true);
  });
});
