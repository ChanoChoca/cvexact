/**
 * The typography the CV is set in, in one place.
 *
 * `cv-document.css` declares it and four files have to agree about it: the
 * stylesheet (which loads it), `components/cv/measure.ts` (which waits for it
 * before measuring), `lib/export/pdf.ts` (which asks the printer whether it got
 * it) and `inspectPdfFonts` (which reads the finished PDF back). A second copy
 * of these strings in any of them is a check that stops meaning anything the
 * first time the family is renamed.
 *
 * Pure: no DOM, no React, safe on both sides of the boundary.
 */

/** The family name `cv-document.css` gives the self-hosted STIX Two Text. */
export const CV_FONT_FAMILY = "STIX Two Text CV";

/**
 * The three faces the stylesheet asks for, in the shorthand `document.fonts`
 * `load`/`check` accept: the regular text, the bold weight the entry headers
 * use, and the italic the summary is set in.
 */
export const CV_FONT_FACES = [
  `11pt "${CV_FONT_FAMILY}"`,
  `bold 12pt "${CV_FONT_FAMILY}"`,
  `italic 10.5pt "${CV_FONT_FAMILY}"`,
] as const;

/**
 * What Chromium names those faces inside the PDF (`/FontName` of each
 * `FontDescriptor`, before any `ABCDEF+` subset prefix): the PostScript names of
 * the static instances in `public/fonts/`. Compared case-insensitively and
 * accepting a subset prefix — see `inspectPdfFonts` in `lib/export/pdf-check.ts`,
 * whose `"ok"` verdict means nothing else appeared. The variable font's own
 * names (`STIXTwoText`, `STIXTwoText_700wght`) are deliberately not here: that
 * file prints as Type 3, which loses the spaces of the text layer.
 */
export const CV_PDF_FONT_NAMES = [
  "STIXTwoText-Regular",
  "STIXTwoText-Bold",
  "STIXTwoText-Italic",
  "STIXTwoText-BoldItalic",
] as const;

/**
 * Symbols the STIX woff2 files do not carry, with the plain text that says the
 * same. Left alone, each one is drawn by a system font and `inspectPdfFonts`
 * refuses the whole PDF — a deterministic failure, not one a retry fixes. Models
 * and pasted or imported CVs produce these all the time (arrows, ticks, `ﬁ`, a
 * non-breaking hyphen, a square bullet), so the document is set with the
 * equivalent instead.
 *
 * Read off the fonts' own `cmap` tables, not guessed. Note the converse: U+0300,
 * U+0301, U+0303, U+0309 and U+0323 ARE in the files but outside the stylesheet's
 * `unicode-range`, so decomposed accents (`e` + U+0301, which is what a PDF or a
 * macOS text field hands over) fall to a system font too — `normalize("NFC")`
 * below composes them back into the letters the files have.
 *
 * shortcut: only the symbols seen in real CVs; anything else (↑ ↓, other
 * alphabets) still comes back `substituted`, and the printer names it
 * (`CvPdfCheck.missing`). Add it here when a new one turns up.
 */
const GLYPH_FALLBACKS: Record<string, string> = {
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2015": "—",
  "→": "->",
  "←": "<-",
  "↔": "<->",
  "✓": "-",
  "✔": "-",
  "★": "*",
  "☆": "*",
  "●": "•",
  "○": "•",
  "◆": "•",
  "◇": "•",
  "■": "•",
  "▪": "•",
  "◦": "•",
  "‣": "•",
  "►": "•",
  "▸": "•",
  "➢": "•",
  "∙": "•",
  "≥": ">=",
  "≤": "<=",
  "≈": "~",
  "≠": "!=",
  "№": "Nº",
  "ﬀ": "ff",
  "ﬁ": "fi",
  "ﬂ": "fl",
  "ﬃ": "ffi",
  "ﬄ": "ffl",
};

const GLYPH_FALLBACK_PATTERN = new RegExp(`[${Object.keys(GLYPH_FALLBACKS).join("")}]`, "g");
/** Word's and PDF's symbol-font bullets (U+F0B7 and kin) arrive in the private-use area. */
const PRIVATE_USE = /[\uE000-\uF8FF]/g;
/** Emoji and dingbats, with the joiners that glue them: no face here draws them and no equivalent says the same. */
const PICTOGRAPHS = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200D]/gu;

/** The same document with every string set in glyphs the typography has. */
export function withCoveredGlyphs<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (_key, field: unknown) =>
    typeof field === "string"
      ? field
          .normalize("NFC")
          .replace(GLYPH_FALLBACK_PATTERN, (glyph) => GLYPH_FALLBACKS[glyph]!)
          .replace(PRIVATE_USE, "•")
          .replace(PICTOGRAPHS, "")
      : field,
  ) as T;
}
