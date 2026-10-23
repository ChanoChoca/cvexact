import type { TextRun } from "@/lib/parse/lines";
import type { PdfInfo } from "@/lib/parse";

/**
 * What pdf.js gives back for a page, as the `TextRun`s the parsers read.
 *
 * Kept out of `extract.ts` so it can be tested without a browser: that file
 * needs a DOM and a worker to do anything, and this is the part of it that has
 * decisions in it.
 */

/** The shape of a text item in pdf.js, the parts this reads. */
export type PdfTextItem = {
  str: string;
  /** [scaleX, skewY, skewX, scaleY, x, y] in page units. */
  transform: number[];
  width: number;
  height?: number;
  hasEOL?: boolean;
};

export function runsFromItems(items: readonly unknown[], page: number): TextRun[] {
  const runs: TextRun[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item) || !("transform" in item)) continue;
    const text = item as PdfTextItem;
    if (!text.str || text.str.trim() === "") continue;
    const [a = 0, , , d = 0, x = 0, y = 0] = text.transform;
    // The font size is the vertical scale of the text matrix — or the horizontal
    // one when the text is drawn sideways.
    const size = Math.abs(d) || Math.abs(a) || text.height || 0;
    if (size === 0) continue;
    runs.push({ str: text.str, page, x, y, width: text.width, size });
  }
  return runs;
}

/**
 * A PDF date — `D:20240115103000+01'00'`, with everything after the year optional — as an ISO instant, or `undefined` for what
 * is not one. The zone is left out: this is only ever compared with another document's date, to see which is newer.
 */
export function pdfDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const found = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(value.trim());
  if (!found) return undefined;
  const [, year, month = "01", day = "01", hour = "00", minute = "00", second = "00"] = found;
  const at = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  const year4 = Number(year);
  // A year nobody made a CV in is a field left as zeros, not a date.
  if (Number.isNaN(at.getTime()) || year4 < 1990 || year4 > new Date().getFullYear() + 1) return undefined;
  return at.toISOString();
}

/** The metadata fields the LinkedIn check reads, whatever case the file wrote them in. */
export function infoFrom(info: unknown): PdfInfo {
  const source = (info && typeof info === "object" ? info : {}) as Record<string, unknown>;
  const text = (key: string): string | undefined => {
    const value = source[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const out: PdfInfo = {};
  const author = text("Author");
  const subject = text("Subject");
  const title = text("Title");
  const producer = text("Producer");
  if (author) out.author = author;
  if (subject) out.subject = subject;
  if (title) out.title = title;
  if (producer) out.producer = producer;
  const created = pdfDate(source.CreationDate);
  const modified = pdfDate(source.ModDate);
  if (created) out.created = created;
  if (modified) out.modified = modified;
  return out;
}
