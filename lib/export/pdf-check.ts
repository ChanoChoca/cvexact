/**
 * What was verified about a printed CV — and the two ways of reading the file
 * that answer it.
 *
 * Pure, and deliberately outside `lib/export/pdf.ts`: that module is
 * `server-only` (it drives Playwright), while the client needs these types and
 * `acceptedCvPdf` to decide whether the file it is holding may be handed over
 * (`components/cv/DownloadPdfButton.tsx`, the Wizard's `onUnverified`).
 */

import { CV_PDF_FONT_NAMES } from "@/lib/cv/fonts";
import type { Sheets } from "@/lib/cv/sheets";

/**
 * What was verified about a printed CV.
 *
 * Two different questions that must not be confused: `fontsLoaded` says the page
 * had the expected faces when it was printed (the same check the preview waits
 * on), and `pdfFonts` says the file actually contains them. A PDF can pass the
 * first and fail the second — a glyph outside the woff2 subsets falls back to a
 * system face without `document.fonts.check` ever noticing.
 */
export type CvPdfCheck = {
  /** Sheets in the file, or `null` when the PDF could not be read. */
  pages: number | null;
  /** Natural height of `.cv-document`, in CSS px, measured the same way the client measures it. */
  heightPx: number | null;
  /** The sheet's content running past its own width — text no column could break. */
  overflowX: boolean;
  /** The three expected faces answered for this CV's text, at print time. */
  fontsLoaded: boolean;
  /** Whether the file carries those faces, and only those. */
  pdfFonts: PdfFontInspection;
  /**
   * When `pdfFonts` is `"substituted"`: the characters of the CV that the faces
   * do not carry, as the printer found them. Absent otherwise, and best effort —
   * it only names the culprit, it does not decide anything.
   */
  missing?: string[];
  /**
   * When `pdfFonts` is `"substituted"`: the names of the fonts in the file that
   * are not the expected ones (or are not embedded). Says *what* is in the PDF
   * when `missing` — what the CV's own text needs — comes back empty.
   */
  substitutedBy?: string[];
};

/** What reading the PDF's own font dictionaries said. */
export type PdfFontInspection =
  /** At least one descriptor, all embedded, all STIX. */
  | "ok"
  /** Some glyph came from a substituted face — or from a face that is not embedded. */
  | "substituted"
  /** No descriptors found, or the structure could not be read (another PDF producer). */
  | "unverifiable";

/**
 * A CV is accepted only when all four hold: no more sheets than the person allowed — one, unless they asked for two (`Sheets`) —,
 * nothing running off the side, the expected typography in use **and** in the file. A one-page PDF with a substituted font or clipped
 * content is not accepted — it is the promise (`Deja tu CV en una hoja, exactamente`) that would be broken, not the page count.
 */
export function acceptedCvPdf(check: CvPdfCheck, sheets: Sheets = 1): boolean {
  return check.pages !== null && check.pages >= 1 && check.pages <= sheets && !check.overflowX && check.fontsLoaded && check.pdfFonts !== "substituted";
}

/**
 * Sheets in a PDF, by counting its page objects.
 *
 * `/Type /Page`, never `/Pages`: the tree node is one object for the whole
 * document and counting it would call every PDF a two-page one. The lookahead
 * keeps `/Pages` from matching the page pattern. Skia — what Chromium prints
 * with here — writes these dictionaries uncompressed, so reading the bytes is
 * enough; a producer that put them in object streams would come back as a
 * smaller number, which is why `null` (unreadable) and a count are different
 * answers.
 */
export function countPdfPages(pdf: Buffer): number | null {
  const text = pdf.toString("latin1");
  if (!text.includes("%PDF-")) return null;
  return text.match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0;
}

/** A PDF name (`/STIXTwoText`, `/ABCDEF+Foo#20Bar`) as the text it stands for. */
function decodePdfName(raw: string): string {
  return raw.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/**
 * The file's objects, by object number — best effort, and only for the small
 * dictionaries this reads.
 *
 * Read as whole objects rather than by scanning forward from `/Type
 * /FontDescriptor` because Chromium writes the keys in alphabetical order:
 * `/FontName` comes *before* the `/Type` that ends the dictionary, so a window
 * opened at `/Type` has no name in it at all. (Measured, Etapa 0: every face
 * came back nameless and every PDF looked like a substitution.)
 */
function pdfObjects(text: string): Map<string, string> {
  const objects = new Map<string, string>();
  const pattern = /(?:^|[\s>])(\d+)\s+\d+\s+obj\b([\s\S]{0,4000}?)endobj/g;
  for (const match of text.matchAll(pattern)) objects.set(match[1]!, match[2]!);
  return objects;
}

/**
 * Whether the PDF carries the expected typography.
 *
 * Reads every `/Type /FontDescriptor` — where a PDF records what a font is
 * called and whether its glyphs travel inside — and answers three ways rather
 * than two. A face is embedded when its file is there (`/FontFile`, `/FontFile2`
 * or `/FontFile3`) **or** when it is a Type 3 font: those carry their glyph
 * procedures as content streams in the document, and `pdffonts` reports them as
 * `emb: yes`. The static STIX instances print as CID TrueType (`/FontFile2`);
 * Type 3 is how Chromium printed the variable font they replaced, and still
 * counts as embedded — only a name outside `CV_PDF_FONT_NAMES` is refused.
 *
 * `"unverifiable"` is not a failure and not a pass: it means this PDF was not
 * written the way Chromium writes one, so nothing could be read. The caller
 * accepts it, warns, and leans on `fontsLoaded` plus the staging check (to-do
 * §6.7, Etapa 0).
 */
export function inspectPdfFonts(pdf: Buffer): PdfFontInspection {
  const { descriptors, alien } = readPdfFonts(pdf);
  if (alien.length > 0) return "substituted";
  return descriptors === 0 ? "unverifiable" : "ok";
}

/** The fonts in the file that are not the expected, embedded STIX faces — by name, empty when there are none. */
export function substitutedFontNames(pdf: Buffer): string[] {
  return [...new Set(readPdfFonts(pdf).alien)];
}

/** Every `FontDescriptor` in the file, and the names of those that are not the expected embedded faces. */
function readPdfFonts(pdf: Buffer): { descriptors: number; alien: string[] } {
  const objects = pdfObjects(pdf.toString("latin1"));

  // Faces whose glyphs are in the file by construction, keyed by the descriptor
  // they declare.
  const inline = new Set<string>();
  for (const body of objects.values()) {
    if (!/\/Subtype\s*\/Type3\b/.test(body)) continue;
    const reference = /\/FontDescriptor\s+(\d+)\s+\d+\s+R/.exec(body)?.[1];
    if (reference) inline.add(reference);
  }

  let descriptors = 0;
  const alien: string[] = [];
  for (const [object, body] of objects) {
    if (!/\/Type\s*\/FontDescriptor\b/.test(body)) continue;
    descriptors += 1;

    const name = decodePdfName(/\/FontName\s*\/([#\w.+-]+)/.exec(body)?.[1] ?? "");
    const bare = name.replace(/^[A-Z]{6}\+/, "");
    const embedded = /\/(?:FontFile2?|FontFile3)\b/.test(body) || inline.has(object);
    const expected = CV_PDF_FONT_NAMES.some((known) => bare.toLowerCase() === known.toLowerCase());
    if (!embedded || !expected) alien.push(`${bare || "sin nombre"}${embedded ? "" : " (no incrustada)"}`);
  }

  return { descriptors, alien };
}
