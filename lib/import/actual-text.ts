/**
 * Recovering `/ActualText` from a PDF's raw bytes.
 *
 * A font can draw a ligature — "fl", "fi" — as one glyph with no entry in its
 * ToUnicode map, which is legal: the spec's own way to still say what that
 * glyph means is `/ActualText`, a span around the drawing operator naming the
 * real text. pdf.js reads ToUnicode for `str` and ignores `/ActualText`
 * entirely, so a document built that way (this app's own CV export, among
 * others) comes back with a literal `\u0000` wherever a glyph like that was
 * drawn — see `cv-document.css`'s `font-variant-ligatures: none` for the other
 * half of this, which stops the app's own exports from doing it going forward.
 * Anything already out in the world, or from anyone else's generator, still
 * needs recovering on the way in.
 *
 * Pure and platform-agnostic: raw bytes in, strings out, using
 * `DecompressionStream` (in both the browser and Node 18+) rather than
 * anything pdf.js-internal, so it runs under a plain test the same way it runs
 * during import.
 *
 * This is not a PDF parser. It looks for the shapes real generators produce —
 * `N 0 obj << …/FlateDecode… >> stream … endstream` and, inside the inflated
 * bytes, `/ActualText (…)` or `/ActualText <…>` — and it is content to miss a
 * document built some other way: `restoreActualText` only trusts what this
 * finds when the counts line up, and falls back to a visible placeholder
 * otherwise. It must never throw; recovery only helps.
 */

/** Above this, a candidate stream is not worth inflating just to look for a marker. */
const MAX_CANDIDATE_BYTES = 3_000_000;

function looksLikeContentStream(dict: string): boolean {
  if (!/\/FlateDecode\b/.test(dict)) return false;
  // A font program, not page content — the one Flate stream this would
  // otherwise happily inflate for nothing, and the biggest one at that.
  if (/\/Length1\b/.test(dict)) return false;
  if (/\/Type\s*\/(?:ObjStm|XRef|Metadata)\b/.test(dict)) return false;
  if (/\/Subtype\s*\/Image\b/.test(dict)) return false;
  return true;
}

async function inflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  // PDF's `/FlateDecode` is zlib-wrapped (a 2-byte header, an Adler-32
  // trailer) — the Web/Node "deflate" format, not "deflate-raw".
  const stream = new DecompressionStream("deflate");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];

  const readAll = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  })();
  const writeAll = writer.write(data).then(() => writer.close());

  // Awaited together, not one after the other: malformed input can make
  // *both* sides of the stream reject, and `Promise.all` is what keeps the
  // one this does not end up throwing from still counting as handled instead
  // of surfacing as a separate unhandled rejection.
  await Promise.all([readAll, writeAll]);

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Up to three octal digits after a backslash in a literal string: `\101` is "A". */
function readOctal(text: string, at: number): { value: number; next: number } {
  let digits = "";
  let i = at;
  while (digits.length < 3 && i < text.length && /[0-7]/.test(text[i]!)) {
    digits += text[i];
    i += 1;
  }
  return { value: parseInt(digits, 8) & 0xff, next: i };
}

const SIMPLE_ESCAPES: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 0x28, ")": 0x29, "\\": 0x5c };

/**
 * A PDF literal string, from just after its opening `(`. Escapes are resolved
 * to bytes (octal, the usual single-letter ones, a backslash-newline that
 * inserts nothing), and balanced inner parentheses are kept as bytes rather
 * than ending the string early.
 */
function readLiteralString(text: string, start: number): { bytes: number[]; next: number } {
  const bytes: number[] = [];
  let depth = 1;
  let i = start;
  while (i < text.length && depth > 0) {
    const ch = text[i]!;
    if (ch === "\\") {
      const after = text[i + 1];
      if (after === "\r" || after === "\n") {
        i += after === "\r" && text[i + 2] === "\n" ? 3 : 2;
        continue;
      }
      if (after !== undefined && after in SIMPLE_ESCAPES) {
        bytes.push(SIMPLE_ESCAPES[after]!);
        i += 2;
        continue;
      }
      if (after !== undefined && /[0-7]/.test(after)) {
        const octal = readOctal(text, i + 1);
        bytes.push(octal.value);
        i = octal.next;
        continue;
      }
      if (after !== undefined) {
        bytes.push(after.charCodeAt(0));
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
    bytes.push(ch.charCodeAt(0));
    i += 1;
  }
  return { bytes, next: i };
}

/** A PDF hex string, from just after its opening `<`. An odd trailing nibble is padded with 0, per spec. */
function readHexString(text: string, start: number): { bytes: number[]; next: number } {
  let hex = "";
  let i = start;
  while (i < text.length && text[i] !== ">") {
    if (/[0-9a-fA-F]/.test(text[i]!)) hex += text[i];
    i += 1;
  }
  if (i < text.length) i += 1;
  if (hex.length % 2 === 1) hex += "0";
  const bytes: number[] = [];
  for (let k = 0; k < hex.length; k += 2) bytes.push(parseInt(hex.slice(k, k + 2), 16));
  return { bytes, next: i };
}

/** UTF-16BE when the bytes open with its BOM; otherwise one byte per character, which is all a single letter needs. */
function decodeBytes(bytes: readonly number[]): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
    return out;
  }
  return bytes.map((byte) => String.fromCharCode(byte)).join("");
}

/**
 * Every `/ActualText` value in one inflated content stream, in the order the
 * page draws them.
 */
export function extractActualTextFromContent(content: string): string[] {
  const marker = "/ActualText";
  const found: string[] = [];
  let i = 0;
  for (;;) {
    const at = content.indexOf(marker, i);
    if (at === -1) break;
    let j = at + marker.length;
    while (j < content.length && /\s/.test(content[j]!)) j += 1;
    if (content[j] === "(") {
      const literal = readLiteralString(content, j + 1);
      found.push(decodeBytes(literal.bytes));
      i = literal.next;
    } else if (content[j] === "<") {
      const hex = readHexString(content, j + 1);
      found.push(decodeBytes(hex.bytes));
      i = hex.next;
    } else {
      // Not the operator this expects — keep scanning past the marker
      // rather than looping on it forever.
      i = j;
    }
  }
  return found;
}

const STREAM_HEADER = /\d+\s+\d+\s+obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g;

/**
 * Every `/ActualText` value in the file's content streams, in the order the
 * streams appear — which is the order pdf.js draws them in, for a document a
 * single tool generated in one pass.
 *
 * Never throws: a stream this cannot inflate (a false-positive from the dict
 * filter, a corrupt or unsupported document) is skipped rather than failing
 * the whole recovery, since a partial answer here only ever replaces a
 * `\u0000` that would otherwise stay one.
 */
export async function actualTextStreams(bytes: Uint8Array<ArrayBuffer>): Promise<string[]> {
  const latin1 = new TextDecoder("latin1").decode(bytes);
  const found: string[] = [];
  for (const match of latin1.matchAll(STREAM_HEADER)) {
    const dict = match[1]!;
    if (!looksLikeContentStream(dict)) continue;
    const dataStart = match.index + match[0].length;
    const endIndex = latin1.indexOf("endstream", dataStart);
    if (endIndex === -1) continue;
    let dataEnd = endIndex;
    if (latin1[dataEnd - 1] === "\n") dataEnd -= 1;
    if (latin1[dataEnd - 1] === "\r") dataEnd -= 1;
    if (dataEnd <= dataStart || dataEnd - dataStart > MAX_CANDIDATE_BYTES) continue;
    try {
      const inflated = await inflate(bytes.subarray(dataStart, dataEnd));
      const text = new TextDecoder("latin1").decode(inflated);
      found.push(...extractActualTextFromContent(text));
    } catch {
      // See the doc comment: recovery only helps.
    }
  }
  return found;
}

const isActualTextPlaceholder = (str: string): boolean => str.length > 0 && [...str].every((ch) => ch === "\u0000");

/**
 * Fixes pdf.js text items that are only `\u0000` using the `/ActualText`
 * values `actualTextStreams` found, matched up in the order both lists put
 * them.
 *
 * Exact only when the counts agree: that is the one thing this can check
 * without being a real PDF parser, and a mismatch means the document is built
 * some other way this was not written for. When they do not agree, every
 * blank item becomes `�` instead of a guess — visible on screen and
 * greppable in the profile, never a silently wrong letter. Mutates `items` in
 * place, the same objects pdf.js handed back, so the caller's own later
 * reads of `str` see the fix.
 */
export function restoreActualText(items: ReadonlyArray<{ str: string }>, found: readonly string[]): void {
  const blanks = items.filter((item) => isActualTextPlaceholder(item.str));
  if (blanks.length === 0) return;
  if (blanks.length !== found.length) {
    for (const item of blanks) item.str = "�";
    return;
  }
  blanks.forEach((item, i) => {
    item.str = found[i]!;
  });
}
