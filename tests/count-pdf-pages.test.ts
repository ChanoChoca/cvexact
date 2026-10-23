import { describe, expect, it } from "vitest";
import { acceptedCvPdf, countPdfPages } from "@/lib/export/pdf-check";

/**
 * How many sheets the file has — read from the PDF's own bytes, so the fixtures
 * are the shape Chromium writes (page dictionaries written out) rather than a
 * real PDF: what is under test is the reading, not the printer.
 */

const HEADER = "%PDF-1.4\n";

function pdf(body: string): Buffer {
  return Buffer.from(`${HEADER}${body}\n%%EOF\n`, "latin1");
}

describe("countPdfPages", () => {
  it("counts /Type /Page, and never the /Pages node", () => {
    const one = pdf(
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\n2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>",
    );
    expect(countPdfPages(one)).toBe(1);

    const two = pdf("<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type /Page >>");
    expect(countPdfPages(two)).toBe(2);
  });

  it("says zero for a PDF with no pages at all", () => {
    // A document with no page objects is a real failure, and it is not the same
    // answer as «could not read this».
    expect(countPdfPages(pdf("1 0 obj\n<< /Type /Catalog >>"))).toBe(0);
  });

  it("says nothing (null) when the bytes are not a PDF", () => {
    expect(countPdfPages(Buffer.from("no soy un pdf", "latin1"))).toBeNull();
    expect(countPdfPages(Buffer.alloc(0))).toBeNull();
  });

  it("is the first half of the acceptance rule", () => {
    const good = { pages: 1, heightPx: 1_100, overflowX: false, fontsLoaded: true, pdfFonts: "ok" as const };
    expect(acceptedCvPdf(good)).toBe(true);
    // Unverifiable is accepted: the page's own check and staging carry it.
    expect(acceptedCvPdf({ ...good, pdfFonts: "unverifiable" })).toBe(true);

    // Anything else is not: a second sheet, clipped content, a typography the
    // page did not have, or a substituted face.
    expect(acceptedCvPdf({ ...good, pages: 2 })).toBe(false);
    expect(acceptedCvPdf({ ...good, pages: null })).toBe(false);
    expect(acceptedCvPdf({ ...good, overflowX: true })).toBe(false);
    expect(acceptedCvPdf({ ...good, fontsLoaded: false })).toBe(false);
    expect(acceptedCvPdf({ ...good, pdfFonts: "substituted" })).toBe(false);
  });
});
