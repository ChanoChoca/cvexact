"use client";

/**
 * Turning a CV file into text, in the browser.
 *
 * In the browser rather than on the server so the document itself never leaves
 * the machine — the same bargain the BYOK keys get, and the one this app makes
 * everywhere else it can. Only the extracted text is sent, and only to the
 * model that has to read it.
 *
 * Both parsers are behind dynamic `import()`. Together they are around two
 * megabytes of JavaScript, and the profile page must not pay for that to render
 * a chat nobody may ever import into.
 */

import type { CsvFiles } from "@/lib/parse/linkedin-csv";
import type { PdfInfo } from "@/lib/parse";
import type { TextRun } from "@/lib/parse/lines";
import { actualTextStreams, restoreActualText } from "./actual-text";
import { kindOfFile, refusalFor, type FileKind } from "./formats";
import { infoFrom, runsFromItems } from "./pdf-runs";

/** How much text a file has to yield before it is worth sending to a model. */
const MIN_USEFUL_CHARS = 200;

/**
 * The file cannot be read here. Always actionable: every path that throws this
 * has a way forward, and it is always the same one — paste the text instead.
 */
export class UnreadableFileError extends Error {
  /**
   * Why, for the screen that has to offer a way forward: a scan needs the
   * document shown beside the forms, a wrong format needs a different file.
   */
  readonly reason: "scanned" | "unsupported" | "photo" | "too_large" | "empty" | "zip" | "other";

  constructor(message: string, reason: UnreadableFileError["reason"] = "other") {
    super(message);
    this.reason = reason;
  }
}

export type ExtractedKind = FileKind;

/**
 * A document, read. The text is what a model would be sent and what a pasted CV
 * looks like; `runs` and `info` are what only a PDF has — where each piece of
 * text sat on the page, and what the file says about itself — and are what let
 * a parser tell a company from a role by its size. A LinkedIn data export has
 * no text at all, only its CSV files.
 */
export type ReadDocument =
  | { kind: "pdf"; name: string; fileHash: string; text: string; runs: TextRun[]; info: PdfInfo }
  | { kind: "docx"; name: string; fileHash: string; text: string }
  | { kind: "txt"; name: string; fileHash: string; text: string }
  | { kind: "zip"; name: string; fileHash: string; csvFiles: CsvFiles };

/** SHA-256 of a file, hex. The same file is never read twice, and this is how it is recognised. */
export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Reads a file: text and, for a PDF, the positioned runs it was made from; for
 * a LinkedIn data export, its CSV files.
 *
 * Throws `UnreadableFileError` for a format we cannot parse (saying which, and how to
 * get out of it: `lib/import/formats.ts`), for a file too big to read here, for a PDF
 * with no text layer (a scan, or a CV exported as an image), and for anything that
 * yields too little text to be a CV. The caller offers the paste box for all of
 * them, because from the user's side they are one problem.
 */
export async function readDocument(file: File): Promise<ReadDocument> {
  const refusal = refusalFor(file);
  if (refusal) throw new UnreadableFileError(refusal.message, refusal.reason);
  const kind = kindOfFile(file)!;

  const buffer = await file.arrayBuffer();
  const fileHash = await sha256Hex(buffer);

  if (kind === "zip") {
    const { readLinkedInZip } = await import("./zip");
    return { kind, name: file.name, fileHash, csvFiles: await readLinkedInZip(buffer) };
  }

  if (kind === "pdf") {
    const { text: raw, runs, info } = await readPdf(buffer);
    const text = tidy(raw);
    assertUseful(text, kind);
    return { kind, name: file.name, fileHash, text, runs, info };
  }

  if (kind === "txt") {
    const text = tidy(decodeText(buffer));
    assertUseful(text, kind);
    return { kind, name: file.name, fileHash, text };
  }

  const text = tidy(await readDocx(buffer));
  assertUseful(text, kind);
  return { kind, name: file.name, fileHash, text };
}

function assertUseful(text: string, kind: "pdf" | "docx" | "txt"): void {
  if (text.length >= MIN_USEFUL_CHARS) return;
  throw new UnreadableFileError(
    kind === "pdf"
      ? "Este PDF no tiene texto: parece escaneado o exportado como imagen. Pegá el contenido a mano."
      : kind === "txt"
        ? "Ese archivo de texto tiene muy poco: no alcanza para ser un CV. Pegá el contenido a mano, o agregá lo que falta."
        : "No pudimos sacar texto de ese archivo. Pegá el contenido a mano.",
    kind === "pdf" ? "scanned" : "empty",
  );
}

/**
 * A text file's bytes as text. UTF-8 when it is, and Windows-1252 — what Notepad wrote before it wrote UTF-8, and what
 * a CV saved as «texto» from an old Word still is — when it is not: read as UTF-8 those come out full of «�» where the
 * accents were, which the review would then have to ask about letter by letter.
 */
function decodeText(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

/**
 * The text of a CV, for callers that only want text.
 *
 * A LinkedIn data export has none, so it is refused here with the same way out
 * as any other unreadable file.
 */
export async function extractText(file: File): Promise<string> {
  const doc = await readDocument(file);
  if (doc.kind === "zip") {
    throw new UnreadableFileError("Ese archivo es un ZIP de datos: no tiene un texto para leer.");
  }
  return doc.text;
}

/** A text item, before `str` is fixed up — same shape pdf.js hands back, the parts this needs. */
type TextItem = { str: string; hasEOL?: boolean };

async function readPdf(data: ArrayBuffer): Promise<{ text: string; runs: TextRun[]; info: PdfInfo }> {
  const pdfjs = await import("pdfjs-dist");

  // Served from public/, copied there by scripts/copy-pdf-worker.mjs. See that
  // file for why it is a copy and not a bundled asset.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  // A copy, taken before pdf.js sees `data`: a real worker (the only kind this
  // sets up) can take the buffer as a transfer, which leaves the original
  // detached — and `actualTextStreams` below needs the same bytes pdf.js just read.
  const raw = data.slice(0);

  // The loading task is kept rather than discarded: `destroy` lives on it, not
  // on the document it resolves to.
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  try {
    const pageItems: TextItem[][] = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      for (const item of content.items) {
        if ("str" in item) items.push(item);
      }
      pageItems.push(items);
    }

    // A ligature glyph with no ToUnicode entry comes back as `str: "\u0000"`;
    // this is what turns it back into the letters it actually draws, before
    // anything below reads `str`. See `lib/import/actual-text.ts`.
    const found = await actualTextStreams(new Uint8Array(raw));
    restoreActualText(pageItems.flat(), found);

    const pages: string[] = [];
    const runs: TextRun[] = [];
    pageItems.forEach((items, index) => {
      const number = index + 1;
      // pdf.js hands back positioned runs, not lines. `hasEOL` is where it says
      // a run ended a line; without honouring it every page collapses into one
      // paragraph and a two-column CV interleaves into nonsense.
      let text = "";
      for (const item of items) {
        text += item.str;
        if (item.hasEOL) text += "\n";
      }
      pages.push(text);
      runs.push(...runsFromItems(items, number));
    });
    const metadata = await doc.getMetadata().catch(() => null);
    return { text: pages.join("\n\n"), runs, info: infoFrom(metadata?.info) };
  } finally {
    // Frees the worker. Without it a user importing three files in a row leaves
    // three workers running.
    await task.destroy();
  }
}

async function readDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  // The browser build explicitly: the package's main entry reaches for node's
  // zip and fs paths, and its `browser` field only remaps part of that.
  const mammoth = await import("mammoth/mammoth.browser.js");
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return value;
}

/**
 * Collapses what the extractors leave behind: runs of spaces from a PDF's
 * positioned text, and blank-line drifts from both. Paragraph breaks survive
 * because the prompt reads them as the boundaries between entries.
 */
function tidy(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
