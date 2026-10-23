import type { LineBox } from "@/lib/parse/types";
import { readCollection, writeCollection } from "./stores";

/**
 * The originals, kept here so the review can show the document beside what was
 * read from it.
 *
 * Local to this browser and capped: a CV is a few thousand characters, but the
 * store is shared with everything else the app keeps, and the oldest original is
 * the first thing worth losing. Losing one costs nothing that matters — every
 * value read from it carries its own quote — it only removes the "ver el
 * original" panel, or — losing only `layout`, a smaller record within the same
 * one — turns it from the page it was into a plain list of what it said.
 */

type SourceRecord = { name: string; lines: string[]; layout?: Array<LineBox | null>; at: string };
type SourceStore = Record<string, SourceRecord>;

/** Total characters kept across every original — `layout`'s own JSON size counts too, so a PDF's does not quietly outgrow what this was measured for. */
export const MAX_SOURCE_CHARS = 400_000;
const MAX_LINES = 4000;

/**
 * The collection, from wherever it lives in this browser: IndexedDB where there
 * is one (read into memory on load), localStorage otherwise — see
 * `./stores`. The cap and the order below do not care which.
 */
function read(): SourceStore {
  return readCollection<SourceRecord>("sources");
}

/** A point value, rounded: the original's own layout is an approximation already, and a tenth of a point buys nothing worth the extra digits. */
const rounded = (value: number): number => Math.round(value * 10) / 10;

function roundedLayout(layout: readonly (LineBox | null)[] | undefined): Array<LineBox | null> | undefined {
  if (!layout) return undefined;
  return layout.map((box) => (box ? { page: box.page, x: rounded(box.x), y: rounded(box.y), width: rounded(box.width), size: rounded(box.size) } : null));
}

const sizeOf = (record: SourceRecord) =>
  record.lines.reduce((total, line) => total + line.length, 0) + (record.layout ? JSON.stringify(record.layout).length : 0);

export function saveSource(
  id: string,
  name: string,
  lines: readonly string[],
  options: { layout?: readonly (LineBox | null)[]; now?: string } = {},
): void {
  const { layout, now = new Date().toISOString() } = options;
  const store = read();
  store[id] = { name: name.slice(0, 200), lines: lines.slice(0, MAX_LINES), ...(layout ? { layout: roundedLayout(layout.slice(0, MAX_LINES)) } : {}), at: now };

  // Oldest first, until it fits. The one just saved is never the one dropped.
  const ids = Object.keys(store).sort((a, b) => store[a]!.at.localeCompare(store[b]!.at));
  let total = ids.reduce((sum, key) => sum + sizeOf(store[key]!), 0);
  for (const key of ids) {
    if (total <= MAX_SOURCE_CHARS || key === id) continue;
    total -= sizeOf(store[key]!);
    delete store[key];
  }

  try {
    writeCollection("sources", store);
  } catch {
    // The original is a convenience. A full store must not fail an import that
    // already succeeded.
  }
}

export type LoadedSource = { name: string; lines: string[]; layout?: Array<LineBox | null> };

export function loadSource(id: string): LoadedSource | null {
  const record = read()[id];
  return record ? { name: record.name, lines: record.lines, ...(record.layout ? { layout: record.layout } : {}) } : null;
}

export function forgetSource(id: string): void {
  const store = read();
  if (!(id in store)) return;
  delete store[id];
  try {
    writeCollection("sources", store);
  } catch {
    // As above.
  }
}

/** Several originals, read together: the store is parsed once, not once per document. */
export function loadSources(ids: readonly string[]): Array<{ id: string } & LoadedSource> {
  const store = read();
  return ids.flatMap((id) => {
    const record = store[id];
    return record ? [{ id, name: record.name, lines: record.lines, ...(record.layout ? { layout: record.layout } : {}) }] : [];
  });
}
