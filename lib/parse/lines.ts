import { FOOTER_PATTERNS } from "./dictionaries";
import type { Line, LineBox } from "./types";

/**
 * Turning what an extractor returns into `Line`s.
 *
 * Two sources, one shape: text (pasted, or read from a Word file) has line
 * breaks and blank lines and nothing else; a PDF's text runs also know where on
 * the page they sit and how large they are. What the parsers get is the same
 * either way, with the position fields present or absent.
 */

const NBSP = /[\u00a0\u2007\u202f\u200b]/g;

export function isFooter(text: string): boolean {
  const trimmed = text.trim();
  return FOOTER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Plain text to lines: blank lines become `gapBefore`, page footers are dropped. */
export function linesFromText(text: string): Line[] {
  const lines: Line[] = [];
  let gap = true;
  for (const raw of text.replace(/\r\n?/g, "\n").replace(/\f/g, "\n").split("\n")) {
    const clean = raw.replace(NBSP, " ").replace(/\t/g, "   ").trim();
    if (!clean) {
      gap = true;
      continue;
    }
    if (isFooter(clean)) continue;
    lines.push({ text: clean.replace(/[ ]{4,}/g, "   "), index: lines.length, gapBefore: gap });
    gap = false;
  }
  return lines;
}

/** One piece of text with a position, as pdf.js hands them over. */
export type TextRun = {
  str: string;
  page: number;
  x: number;
  y: number;
  width: number;
  size: number;
};

/**
 * A gap wider than this many font sizes between two runs on one baseline is a
 * break — a column, a tab stop — and not the space between words. Measured
 * against the smaller of the two runs: a name set large beside a narrow sidebar
 * must not make the gap between them look small.
 */
const COLUMN_BREAK = 1.2;
const COLUMN_BREAK_MIN = 10;
/**
 * Two runs share a baseline when their `y` differ by less than this. Small and
 * absolute-ish on purpose: a fraction of the *larger* size lets a big heading
 * swallow whatever text of another column happens to sit near it.
 */
const baselineTolerance = (a: number, b: number) => Math.min(2, Math.max(0.6, 0.15 * Math.min(a, b)));
/** A vertical gap beyond this many font sizes starts something new; within it, a line wrapped. */
export const WRAP_LIMIT = 1.4;

/**
 * Text runs to lines, row by row.
 *
 * Runs on one baseline are one line unless a wide gap separates them, in which
 * case they are separate lines side by side — a table's cells, a sidebar and its
 * neighbour. Lines come back top to bottom, left to right, page by page;
 * `readingOrder` reorders those for a layout with columns, and LinkedIn's
 * parser partitions them by `x` itself.
 */
export function linesFromRuns(runs: readonly TextRun[], options: { splitAt?: number } = {}): Line[] {
  const pages = [...new Set(runs.map((run) => run.page))].sort((a, b) => a - b);
  const out: Line[] = [];

  for (const page of pages) {
    const onPage = runs
      .filter((run) => run.page === page && run.str.trim() !== "")
      .sort((a, b) => b.y - a.y || a.x - b.x);

    type Row = { y: number; size: number; minSize: number; side: boolean; runs: TextRun[] };
    const rows: Row[] = [];
    for (const run of onPage) {
      // With a known column boundary, runs on either side of it never share a line.
      const side = options.splitAt !== undefined && run.x < options.splitAt;
      const row = rows.find(
        (candidate) =>
          candidate.side === side && Math.abs(candidate.y - run.y) <= baselineTolerance(candidate.minSize, run.size),
      );
      if (row) {
        row.runs.push(run);
        row.size = Math.max(row.size, run.size);
        row.minSize = Math.min(row.minSize, run.size);
      } else {
        rows.push({ y: run.y, size: run.size, minSize: run.size, side, runs: [run] });
      }
    }

    for (const row of rows.sort((a, b) => b.y - a.y)) {
      row.runs.sort((a, b) => a.x - b.x);
      let segment: TextRun[] = [];
      const flush = () => {
        if (segment.length === 0) return;
        const first = segment[0]!;
        const last = segment[segment.length - 1]!;
        let text = "";
        segment.forEach((run, i) => {
          if (i > 0) {
            const prev = segment[i - 1]!;
            const gap = run.x - (prev.x + prev.width);
            const needsSpace = gap > 0.15 * Math.max(prev.size, run.size) && !/\s$/.test(text) && !/^\s/.test(run.str);
            if (needsSpace) text += " ";
          }
          text += run.str;
        });
        out.push({
          text: text.replace(NBSP, " ").replace(/\s+/g, " ").trim(),
          index: 0,
          gapBefore: false,
          page,
          x: first.x,
          y: row.y,
          size: Math.max(...segment.map((run) => run.size)),
          width: last.x + last.width - first.x,
        });
        segment = [];
      };
      for (const run of row.runs) {
        const prev = segment[segment.length - 1];
        if (
          prev &&
          run.x - (prev.x + prev.width) > Math.max(COLUMN_BREAK_MIN, COLUMN_BREAK * Math.min(prev.size, run.size))
        ) {
          flush();
        }
        segment.push(run);
      }
      flush();
    }
  }

  return finish(out.filter((line) => line.text !== "" && !isFooter(line.text)));
}

/** Numbers the lines and marks where the gap above one is wider than a wrapped line. */
export function finish(lines: Line[]): Line[] {
  return lines.map((line, index) => {
    const prev = lines[index - 1];
    const size = line.size ?? 10;
    const gapBefore =
      !prev ||
      prev.page !== line.page ||
      prev.y === undefined ||
      line.y === undefined ||
      prev.y - line.y > WRAP_LIMIT * size ||
      // Going back up the page is a jump to another column.
      line.y > prev.y + 0.5 * size;
    return { ...line, index, gapBefore };
  });
}

/**
 * Reorders positioned lines for a layout in columns.
 *
 * Row-major order interleaves a sidebar with the main column, which is
 * unreadable. A column layout shows itself as a wide empty band in the `x` where
 * lines start, with no line running across it; lines that do run across it (a
 * name at the top of the page) split the page into bands, and inside each band
 * one column is read whole before the other. A page without that band comes back
 * unchanged.
 */
export function readingOrder(lines: Line[]): Line[] {
  if (lines.some((line) => line.x === undefined || line.y === undefined || line.width === undefined)) return lines;

  const split = findColumnSplit(lines);
  if (split === null) return lines;

  const out: Line[] = [];
  const pages = [...new Set(lines.map((line) => line.page ?? 0))].sort((a, b) => a - b);
  for (const page of pages) {
    const onPage = lines.filter((line) => (line.page ?? 0) === page);
    let left: Line[] = [];
    let right: Line[] = [];
    const flush = () => {
      out.push(...left, ...right);
      left = [];
      right = [];
    };
    for (const line of onPage) {
      const x = line.x!;
      const end = x + line.width!;
      if (x < split && end > split + 4) {
        flush();
        out.push(line);
      } else if (x < split) {
        left.push(line);
      } else {
        right.push(line);
      }
    }
    flush();
  }
  return finish(out);
}

/**
 * The `x` where a right-hand column begins, or null when there is not one.
 *
 * Found in where lines *start*: two columns show as two clusters of start
 * positions with a wide empty stretch between them. The boundary goes just left
 * of the second cluster, not in the middle of the stretch — a sidebar's text can
 * run well past the middle without touching the next column.
 */
function findColumnSplit(lines: readonly Line[]): number | null {
  const substantial = lines.filter((line) => line.text.length >= 5);
  if (substantial.length < 10) return null;
  const starts = substantial.map((line) => line.x!).sort((a, b) => a - b);
  const pageWidth = Math.max(...lines.map((line) => line.x! + line.width!));
  if (pageWidth <= 0) return null;

  let bestGap = 0;
  let rightStart = 0;
  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i]! - starts[i - 1]!;
    if (gap > bestGap) {
      bestGap = gap;
      rightStart = starts[i]!;
    }
  }
  if (bestGap < 0.12 * pageWidth) return null;

  const split = rightStart - 0.5;
  const left = substantial.filter((line) => line.x! < split);
  const right = substantial.filter((line) => line.x! >= split);
  if (left.length < 0.15 * substantial.length || right.length < 0.15 * substantial.length) return null;

  // A column layout has lines that stay on their side. If most lines run across
  // the boundary, it was an indented block, not a second column.
  const crossing = left.filter((line) => line.x! + line.width! > split + 4);
  if (crossing.length > 0.35 * substantial.length) return null;

  // A real column's lines start together, at that column's own left edge, and
  // run however far their own text needs. A date or a place set flush with the
  // page's right edge — this app's own CV template, among others, with enough
  // entries — does the opposite: it *ends* at the same point every time and
  // starts wherever fits a shorter or longer line, which is what makes it the
  // widest gap on the page precisely when there are enough of them. Told apart
  // by which edge actually clusters: tight endings with spread-out starts is a
  // right-aligned field, never a second column of its own.
  const rightEnds = right.map((line) => line.x! + line.width!);
  const endSpread = Math.max(...rightEnds) - Math.min(...rightEnds);
  const startSpread = Math.max(...right.map((line) => line.x!)) - Math.min(...right.map((line) => line.x!));
  if (endSpread < 6 && startSpread > 3 * endSpread + 10) return null;

  return split;
}

/**
 * Each line's own box, for "Ver el original" to draw the page it came from
 * instead of a plain list of text — `undefined` when none of `lines` have one
 * to begin with (pasted text, a Word file, an AI reading), the same condition
 * under which a `ParsedDocument` leaves `layout` out entirely.
 */
export function layoutOf(lines: readonly Line[]): Array<LineBox | null> | undefined {
  if (!lines.some(isPositionedLine)) return undefined;
  return lines.map((line) =>
    isPositionedLine(line) ? { page: line.page, x: line.x, y: line.y, width: line.width ?? line.size * line.text.length * 0.5, size: line.size } : null,
  );
}

function isPositionedLine(line: Line): line is Line & { page: number; x: number; y: number; size: number } {
  return line.page !== undefined && line.x !== undefined && line.y !== undefined && line.size !== undefined;
}
