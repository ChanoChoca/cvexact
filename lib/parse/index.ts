import { finish, linesFromRuns, linesFromText, readingOrder, type TextRun } from "./lines";
import { parseCv } from "./cv-heuristic";
import { isLinkedInPdf, parseLinkedInPdf, type PdfInfo } from "./linkedin-pdf";
import type { ParsedDocument } from "./types";

export type { PdfInfo } from "./linkedin-pdf";

/** The left edge of the main column in LinkedIn's template, in points. */
const LINKEDIN_SIDEBAR_EDGE = 150;

/**
 * What an extractor hands over: the text, and — for a PDF — the positioned runs
 * it was made from and the file's metadata.
 */
export type SourceDocument = {
  text: string;
  runs?: readonly TextRun[];
  info?: PdfInfo;
};

/**
 * Reads a document with whichever reader fits it.
 *
 * A PDF that says it came from LinkedIn (or is shaped like one) goes to the
 * reader that knows that template; if that reader does not recognise the
 * structure it gives up, and the general reader takes over on the same lines and
 * marks what it cannot be sure of. Anything else goes to the general reader,
 * with columns put back in reading order when the page has them. Text with no
 * positions — pasted, or from a Word file — is read as lines of text.
 *
 * Pure: the same document always reads the same way, and nothing is sent anywhere.
 */
export function parseDocument(source: SourceDocument): ParsedDocument {
  if (source.runs && source.runs.length > 0) {
    const generic = linesFromRuns(source.runs);
    const looksLikeLinkedIn = isLinkedInPdf(source.info, generic);
    if (looksLikeLinkedIn) {
      const split = linesFromRuns(source.runs, { splitAt: LINKEDIN_SIDEBAR_EDGE });
      const doc = parseLinkedInPdf(split);
      if (doc) return doc;
      // The template's own structure was not there to rely on, but the sidebar
      // edge still is — read the main column whole and then the sidebar,
      // rather than trust `readingOrder`'s generic column guess on a layout it
      // was never measured against (a narrower sidebar, say, than the two
      // clusters it looks for).
      const main = split.filter((line) => (line.x ?? 0) >= LINKEDIN_SIDEBAR_EDGE);
      const side = split.filter((line) => (line.x ?? 0) < LINKEDIN_SIDEBAR_EDGE);
      return parseCv(finish([...main, ...side]), "linkedin_pdf");
    }
    return parseCv(readingOrder(generic), "cv");
  }

  const lines = linesFromText(source.text);
  return parseCv(lines, isLinkedInPdf(source.info, lines) ? "linkedin_pdf" : "cv");
}
