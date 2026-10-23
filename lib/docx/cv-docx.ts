import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  LevelFormat,
  LineRuleType,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
  type IParagraphOptions,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import {
  CV_LABEL_DEFAULTS,
  projectLinkLabel,
  type CVDocument,
  type CVEducationItem,
  type CVExperienceItem,
  type CVLink,
  type CVPairItem,
  type CVProjectItem,
  type CVSection,
} from "@/lib/schemas/cv";

/**
 * Second deterministic renderer for the CV, sibling of components/cv/CVDocument.tsx.
 *
 * Both read the same CVDocument JSON; that one produces the screen and the
 * printed PDF, this one produces the .docx a job portal or an ATS can ingest.
 * When the layout changes, both have to change.
 *
 * Every measurement below is transcribed from components/cv/cv-document.css.
 * Do not "clean up" the odd values (32.2pt, 17.9pt, 10.5pt) — they are the
 * template, and matching them is the whole point of that file and of this one.
 *
 * Units: OOXML wants twips (1pt = 20 twips) for spacing and indents, half
 * points for font sizes, and eighths of a point for border widths. The `pt`,
 * `halfPt` and `eighthPt` helpers do the conversion so the constants below can
 * be read straight against the stylesheet.
 *
 * `coverage` is deliberately absent: it is shown beside the preview and never
 * printed (see lib/schemas/cv.ts).
 */

/** pt → twips, the unit for spacing, indents and page geometry. */
const pt = (value: number) => Math.round(value * 20);
/** pt → half points, the unit for font sizes. */
const halfPt = (value: number) => Math.round(value * 2);
/** pt → eighths of a point, the unit for border widths. */
const eighthPt = (value: number) => Math.round(value * 8);

/* --- Page geometry — .cv-document custom properties ------------------------ */

const PAGE_WIDTH = pt(595.28); // A4, as in --cv-page-width
const PAGE_HEIGHT = pt(841.89);
const PAD_X = pt(28.4); // --cv-pad-x
const PAD_TOP = pt(28.4); // --cv-pad-top
const PAD_BOTTOM = pt(14.2); // --cv-pad-bottom

/**
 * Where the right-hand column lands. Word has no flexbox, so the two-column
 * entry header of .cv-entry-header is a right tab stop at the content width —
 * one paragraph, which also keeps ATS parsers reading the line in order.
 */
const CONTENT_WIDTH = PAGE_WIDTH - PAD_X * 2;

/* --- Vertical rhythm — the --cv-gap-* properties --------------------------- */

const GAP_AFTER_CONTACT = pt(7.1);
const GAP_AFTER_HEADING = pt(9);
const GAP_BETWEEN_ENTRIES = pt(12);
const GAP_BEFORE_HEADING = pt(12);
const CONTACT_PADDING_TOP = pt(9); // .cv-contact padding-top
const CONTACT_PADDING_BOTTOM = 9; // .cv-contact padding-bottom, in pt for the border
const HEADING_PADDING_BOTTOM = 2; // .cv-section-heading padding-bottom, idem
const BULLETS_MARGIN_TOP = pt(4); // .cv-bullets margin-top
const BULLET_PADDING_BOTTOM = pt(3); // .cv-bullets li padding-bottom
const CONTACT_LINE_GAP = pt(2); // .cv-contact-line + .cv-contact-line
const PAIR_PADDING_BOTTOM = pt(3); // .cv-pair padding-bottom

/* --- Type ------------------------------------------------------------------ */

const BODY_SIZE = halfPt(11); // .cv-document font-size
const NAME_SIZE = halfPt(24); // .cv-name
const HEADING_SIZE = halfPt(12); // .cv-section-heading
const SUMMARY_SIZE = halfPt(10.5); // .cv-summary

const SUMMARY_COLOR = "0E0E0E"; // .cv-summary color
const LINK_COLOR = "1155CC"; // .cv-contact a color

/**
 * The CV renders in a self-hosted STIX Two Text (public/fonts/). A .docx cannot
 * carry the font with it, so Word substitutes when the reader does not have it
 * installed — Georgia and the Times fallback mirror the CSS font stack, which
 * is the accepted degradation for an editable document.
 */
const FONT = "STIX Two Text";
const FALLBACK_FONT = "Georgia";

/**
 * --cv-rule: 1pt solid #000000.
 *
 * `space` is the gap between the text and the line, in points. It stands in for
 * the CSS padding-bottom, which sits *inside* the border — spacing.after would
 * put the gap on the wrong side of the line.
 */
const rule = (space: number) =>
  ({ style: BorderStyle.SINGLE, size: eighthPt(1), color: "000000", space }) as const;

/**
 * The stylesheet sets line-height: 1 nearly everywhere. AT_LEAST rather than
 * EXACT: an exact leading equal to the font size clips accents and the tildes
 * of "ñ" in Word, and Spanish CVs are full of both.
 */
const tightLine = (sizePt: number) => ({
  line: pt(sizePt),
  lineRule: LineRuleType.AT_LEAST,
});

const BULLET_REFERENCE = "cv-bullets";

function isBlank(value: string | undefined): boolean {
  return !value || value.trim() === "";
}

/** A run carrying the document font, so nothing falls back to Word's default. */
function run(text: string, options: IRunOptions = {}) {
  return new TextRun({ font: FONT, size: BODY_SIZE, ...options, text });
}

function link({ label, url }: CVLink) {
  return new ExternalHyperlink({
    link: url,
    children: [run(label, { color: LINK_COLOR, underline: {} })],
  });
}

/* --- Header ---------------------------------------------------------------- */

function nameParagraph(fullName: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: tightLine(24),
    children: [run(fullName, { size: NAME_SIZE, bold: true })],
  });
}

/**
 * The contact block is one or two centred lines closed by the 1pt rule of
 * .cv-contact's border-bottom. The rule and the bottom padding belong to the
 * block, so they go on whichever line ends up last.
 */
function contactParagraphs(header: CVDocument["header"]): Paragraph[] {
  const identity: ParagraphChild[] = [];
  const parts = [header.location, header.phone, header.email].filter((part) => !isBlank(part));

  for (const part of parts) {
    if (identity.length > 0) identity.push(run(" • "));
    identity.push(
      part === header.email
        ? link({ label: part, url: `mailto:${part}` })
        : run(part),
    );
  }

  const linkChildren: ParagraphChild[] = [];
  for (const item of header.links) {
    if (linkChildren.length > 0) linkChildren.push(run(" • "));
    linkChildren.push(link(item));
  }

  const lines = [identity, linkChildren].filter((children) => children.length > 0);
  if (lines.length === 0) return [];

  return lines.map((children, index) => {
    const isFirst = index === 0;
    const isLast = index === lines.length - 1;
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: {
        ...tightLine(11),
        before: isFirst ? CONTACT_PADDING_TOP : CONTACT_LINE_GAP,
      },
      border: isLast ? { bottom: rule(CONTACT_PADDING_BOTTOM) } : undefined,
      children,
    });
  });
}

function summaryParagraph(summary: string): Paragraph {
  return new Paragraph({
    spacing: {
      before: GAP_AFTER_CONTACT,
      line: pt(10.5 * 1.15), // .cv-summary line-height: 1.15
      lineRule: LineRuleType.AT_LEAST,
    },
    children: [run(summary, { size: SUMMARY_SIZE, italics: true, color: SUMMARY_COLOR })],
  });
}

/* --- Sections -------------------------------------------------------------- */

/**
 * .cv-section applies margin-top to every section including the first — that
 * margin is what separates the first heading from the summary — so there is no
 * first/rest distinction here either.
 */
function headingParagraph(title: string): Paragraph {
  return new Paragraph({
    spacing: {
      ...tightLine(12),
      before: GAP_BEFORE_HEADING,
      after: GAP_AFTER_HEADING,
    },
    border: { bottom: rule(HEADING_PADDING_BOTTOM) },
    // Word would otherwise be free to break a page between the heading and its
    // first entry; this is the @media print `break-after: avoid` of the CSS.
    keepNext: true,
    keepLines: true,
    children: [run(title, { size: HEADING_SIZE, bold: true })],
  });
}

/**
 * One line of an entry header: left text, a tab, right text. Either side may be
 * empty — the stylesheet drops the element, and here an empty run collapses to
 * nothing while the tab stop keeps the survivor on its correct side.
 */
function twoColumnLine(
  left: ParagraphChild[],
  right: ParagraphChild[],
  options: IParagraphOptions = {},
): Paragraph | null {
  if (left.length === 0 && right.length === 0) return null;

  const children = [...left];
  if (right.length > 0) {
    children.push(new TextRun({ children: [new Tab()], font: FONT, size: BODY_SIZE }), ...right);
  }

  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }],
    spacing: tightLine(11),
    keepLines: true,
    ...options,
    children,
  });
}

function bulletParagraphs(
  bullets: string[],
  lineHeight: number,
  firstSpacingBefore = BULLETS_MARGIN_TOP,
): Paragraph[] {
  return bullets
    .filter((bullet) => !isBlank(bullet))
    .map(
      (bullet, index) =>
        new Paragraph({
          numbering: { reference: BULLET_REFERENCE, level: 0 },
          spacing: {
            line: pt(11 * lineHeight),
            lineRule: LineRuleType.AT_LEAST,
            before: index === 0 ? firstSpacingBefore : 0,
            after: BULLET_PADDING_BOTTOM,
          },
          children: [run(bullet)],
        }),
    );
}

function experienceParagraphs(item: CVExperienceItem, isFirst: boolean): Paragraph[] {
  const spacingBefore = isFirst ? 0 : GAP_BETWEEN_ENTRIES;

  const lines = [
    twoColumnLine(
      isBlank(item.company) ? [] : [run(item.company, { bold: true })],
      isBlank(item.location) ? [] : [run(item.location, { bold: true })],
      { spacing: { ...tightLine(11), before: spacingBefore }, keepNext: true },
    ),
    twoColumnLine(
      isBlank(item.role) ? [] : [run(item.role)],
      isBlank(item.dateRange) ? [] : [run(item.dateRange, { italics: true })],
      // .cv-dates has line-height: 1.5
      { spacing: { line: pt(11 * 1.5), lineRule: LineRuleType.AT_LEAST }, keepNext: true },
    ),
  ].filter((paragraph): paragraph is Paragraph => paragraph !== null);

  if (item.note && !isBlank(item.note)) {
    lines.push(new Paragraph({ spacing: { ...tightLine(11), before: lines.length === 0 ? spacingBefore : 0 }, keepNext: true, keepLines: true, children: [run(item.note, { italics: true })] }));
  }

  // An entry with no header line at all would lose its gap along with it, so
  // when that happens the first bullet carries the separation instead.
  const bullets = bulletParagraphs(
    item.bullets,
    1,
    lines.length === 0 ? spacingBefore : BULLETS_MARGIN_TOP,
  );

  return [...lines, ...bullets];
}

function educationParagraphs(
  item: CVEducationItem,
  isFirst: boolean,
  honorsLabel: string,
): Paragraph[] {
  const spacingBefore = isFirst ? 0 : GAP_BETWEEN_ENTRIES;

  const lines = [
    twoColumnLine(
      isBlank(item.institution) ? [] : [run(item.institution, { bold: true })],
      isBlank(item.location) ? [] : [run(item.location, { bold: true })],
      { spacing: { ...tightLine(11), before: spacingBefore }, keepNext: true },
    ),
    twoColumnLine(
      isBlank(item.degree) ? [] : [run(item.degree)],
      isBlank(item.date) ? [] : [run(item.date, { italics: true })],
      { spacing: { line: pt(11 * 1.5), lineRule: LineRuleType.AT_LEAST }, keepNext: true },
    ),
  ].filter((paragraph): paragraph is Paragraph => paragraph !== null);

  if (!isBlank(item.honors)) {
    lines.push(
      new Paragraph({
        spacing: {
          ...tightLine(11),
          before: lines.length === 0 ? spacingBefore : 0,
        },
        keepLines: true,
        children: [run(`${honorsLabel}: `), run(item.honors)],
      }),
    );
  }

  return lines;
}

/** .cv-pair: bold label, then ": value" in the body weight. */
function pairParagraph(item: CVPairItem): Paragraph {
  const children = [run(item.label, { bold: true })];
  if (!isBlank(item.value)) children.push(run(`: ${item.value}`));

  return new Paragraph({
    spacing: { ...tightLine(11), after: PAIR_PADDING_BOTTOM },
    keepLines: true,
    children,
  });
}

/** .cv-project: a pair whose tail is the link, so a reader and an ATS both find the address. */
function projectParagraph(item: CVProjectItem): Paragraph {
  const children: ParagraphChild[] = [run(item.name, { bold: true })];
  if (!isBlank(item.description)) children.push(run(`: ${item.description}`));
  if (!isBlank(item.url)) {
    children.push(run(isBlank(item.description) ? ": " : " • "));
    children.push(link({ label: projectLinkLabel(item.url), url: item.url }));
  }

  return new Paragraph({
    spacing: { ...tightLine(11), after: PAIR_PADDING_BOTTOM },
    keepLines: true,
    children,
  });
}

function sectionParagraphs(section: CVSection, honorsLabel: string): Paragraph[] {
  const body: Paragraph[] = [];

  if (section.kind === "experience") {
    section.items.forEach((item, index) => {
      body.push(...experienceParagraphs(item, index === 0));
    });
  } else if (section.kind === "education") {
    section.items.forEach((item, index) => {
      body.push(...educationParagraphs(item, index === 0, honorsLabel));
    });
  } else if (section.kind === "pairs") {
    body.push(...section.items.map(pairParagraph));
  } else if (section.kind === "projects") {
    body.push(...section.items.map(projectParagraph));
  } else if (section.kind === "activities") {
    body.push(...bulletParagraphs(section.items.map((item) => item.text), 1.0791666666666666));
  } else {
    // .cv-section-bullets uses line-height 1.0791666…
    body.push(...bulletParagraphs(section.bullets, 1.0791666666666666));
  }

  return [headingParagraph(section.title), ...body];
}

/* --- Document -------------------------------------------------------------- */

export function buildCVDocument(data: CVDocument): Document {
  // Mirrors CVDocument.tsx: a CV stored before `labels` existed has none, and
  // it reaches here straight from localStorage without revalidation.
  const honorsLabel = data.labels?.honors || CV_LABEL_DEFAULTS.honors;
  const children: Paragraph[] = [nameParagraph(data.header.fullName)];

  children.push(...contactParagraphs(data.header));

  if (!isBlank(data.summary)) children.push(summaryParagraph(data.summary));

  for (const section of data.sections) {
    children.push(...sectionParagraphs(section, honorsLabel));
  }

  return new Document({
    title: data.header.fullName ? `CV — ${data.header.fullName}` : "CV",
    creator: "cvexact",
    description: "CV generado con cvexact",
    styles: {
      default: {
        document: {
          run: { font: FONT, size: BODY_SIZE, color: "000000" },
          paragraph: { spacing: { before: 0, after: 0, ...tightLine(11) } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: BULLET_REFERENCE,
          levels: [
            {
              level: 0,
              // A real Word list, not a "●" typed into the text: ATS parsers
              // recognise the former as bullets and the latter as a character.
              format: LevelFormat.BULLET,
              text: "●", // .cv-bullets li::before content
              alignment: AlignmentType.LEFT,
              style: {
                run: { font: FALLBACK_FONT, size: BODY_SIZE },
                // .cv-bullets li: margin-left 32.2pt, with the marker hanging
                // 17.9pt back into the indent.
                paragraph: { indent: { left: pt(32.2), hanging: pt(17.9) } },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: PAD_TOP, right: PAD_X, bottom: PAD_BOTTOM, left: PAD_X },
          },
        },
        children,
      },
    ],
  });
}

/** Browser-side entry point. Node callers should use `Packer.toBuffer` instead. */
export async function cvToBlob(data: CVDocument): Promise<Blob> {
  return Packer.toBlob(buildCVDocument(data));
}

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
