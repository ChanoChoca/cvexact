/**
 * A small CSV reader, enough for LinkedIn's data export.
 *
 * Quoted fields with commas and line breaks inside (a job description is a
 * paragraph), doubled quotes, a byte-order mark, either line ending, `;` as the
 * delimiter when a spreadsheet re-saved the file. And the one thing that makes
 * LinkedIn's files awkward: some start with a few lines of prose before the real
 * header, so the header is *found*, not assumed to be first.
 */

export type CsvTable = { headers: string[]; rows: Array<Record<string, string>> };

function detectDelimiter(text: string): "," | ";" | "\t" {
  const firstLines = text.split(/\r?\n/).slice(0, 5).join("\n");
  const count = (char: string) => firstLines.split(char).length - 1;
  const commas = count(",");
  const semicolons = count(";");
  const tabs = count("\t");
  if (tabs > commas && tabs > semicolons) return "\t";
  return semicolons > commas ? ";" : ",";
}

/** Rows of cells, honouring quotes. */
export function parseCsvRows(input: string, delimiter?: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const delim = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === delim) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

/** How a header is compared: no case, no spaces, no punctuation. */
export const headerKey = (header: string): string => header.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * A table from CSV text. The header is the first row that has at least two
 * cells and, when `expect` is given, at least one column this reader knows —
 * which is what steps over a line of notes before it.
 */
export function parseCsv(input: string, expect: readonly string[] = []): CsvTable {
  const rows = parseCsvRows(input);
  const wanted = new Set(expect.map(headerKey));
  const filled = (row: string[]) => row.filter((cell) => cell.trim() !== "").length;
  const knows = (row: string[]) => row.some((cell) => wanted.has(headerKey(cell)));

  // A header names a column this reader knows — which is what steps over notes
  // before it, and what lets a file with one column (Skills.csv) have a header at
  // all. Without a known name, the first row with two or more cells will do.
  let headerAt = wanted.size > 0 ? rows.findIndex((row) => knows(row) && filled(row) >= 1) : -1;
  if (headerAt === -1) headerAt = rows.findIndex((row) => filled(row) >= 2);
  if (headerAt === -1) return { headers: [], rows: [] };

  const headers = rows[headerAt]!.map((cell) => cell.trim());
  const body = rows.slice(headerAt + 1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      if (header) record[headerKey(header)] = (cells[i] ?? "").trim();
    });
    return record;
  });
  return { headers, rows: body };
}

/** The first of these columns that has a value in the row. */
export function pick(row: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const value = row[headerKey(name)];
    if (value) return value;
  }
  return "";
}
