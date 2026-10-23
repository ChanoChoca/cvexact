import type { TextRun } from "@/lib/parse/lines";

/**
 * A stand-in for LinkedIn's PDF export: the same template — sidebar on the left,
 * main column on the right, the same font sizes for name, headings, company,
 * role and body — laid out by a few lines of code instead of by LinkedIn.
 *
 * It is built to the template as reported by people who parse the real export;
 * it is not a real export, and a parser that only ever met this would be
 * measured against the test's idea of the template. Real files go beside it when
 * there are some (`tests/fixtures/linkedin/`).
 */

export type Spec = {
  col: "side" | "main";
  text: string;
  size: number;
  /** Extra space above, in font sizes, on top of the normal line height. */
  gap?: number;
};

export const SIZE = { name: 26, heading: 15.8, company: 12, role: 11.5, body: 10.5, footer: 8 } as const;

const SIDEBAR_X = 30;
const MAIN_X = 190;
const TOP = 780;
const BOTTOM = 70;

/** Stacks each column's lines down the page, starting a new page when one runs out. */
export function layout(specs: readonly Spec[]): TextRun[] {
  const runs: TextRun[] = [];
  const cursor = { side: { page: 1, y: TOP }, main: { page: 1, y: TOP } };
  for (const spec of specs) {
    const c = cursor[spec.col];
    c.y -= spec.size * 1.25 + (spec.gap ?? 0) * spec.size;
    if (c.y < BOTTOM) {
      c.page += 1;
      c.y = TOP - spec.size * 1.25;
    }
    runs.push({
      str: spec.text,
      page: c.page,
      x: spec.col === "side" ? SIDEBAR_X : MAIN_X,
      y: c.y,
      width: spec.text.length * spec.size * 0.5,
      size: spec.size,
    });
  }
  const pages = Math.max(...runs.map((r) => r.page));
  for (let page = 1; page <= pages; page++) {
    runs.push({ str: `Page ${page} of ${pages}`, page, x: 280, y: 40, width: 60, size: SIZE.footer });
  }
  return runs;
}

const side = (text: string, size: number = SIZE.body, gap?: number): Spec => ({ col: "side", text, size, gap });
const main = (text: string, size: number = SIZE.body, gap?: number): Spec => ({ col: "main", text, size, gap });

/**
 * Items in a sidebar list are set apart from one another; the lines of one item
 * that wrapped are not. `ITEM` is the extra space above an item.
 */
const ITEM = 0.5;

/** Lucía's profile, in Spanish. */
export const LINKEDIN_ES: Spec[] = [
  side("Contacto", SIZE.heading),
  side("lucia.fernandez@example.com", SIZE.body, 0.6),
  side("www.linkedin.com/in/perfil-ejemplo-a1b2c3d4", SIZE.body, ITEM),
  side("(LinkedIn)"),
  side("Aptitudes principales", SIZE.heading, 1.2),
  side("Google Analytics", SIZE.body, 0.6),
  side("SEO", SIZE.body, ITEM),
  side("Email marketing", SIZE.body, ITEM),
  side("Idiomas", SIZE.heading, 1.2),
  side("Español (Native or Bilingual)", SIZE.body, 0.6),
  side("Inglés (Professional Working)", SIZE.body, ITEM),
  side("Certificaciones", SIZE.heading, 1.2),
  side("Google Ads Certification", SIZE.body, 0.6),

  main("Lucía Fernández", SIZE.name),
  main("Analista de Marketing Digital en Nubia Retail", SIZE.role, 0.3),
  main("Valencia, Comunidad Valenciana, España", SIZE.body, 0.1),
  main("Extracto", SIZE.heading, 1.4),
  main("Analista con seis años de experiencia en campañas de pago", SIZE.body, 0.4),
  main("y SEO, con foco en resultados medibles."),
  main("Experiencia", SIZE.heading, 1.4),
  main("Nubia Retail", SIZE.company, 0.5),
  main("Analista de Marketing Digital", SIZE.role),
  main("marzo de 2021 - Present (3 años 6 meses)"),
  main("Valencia, Comunidad Valenciana, España"),
  main("Llevo las campañas de Google Ads y Meta para tres marcas.", SIZE.body, 0.4),
  main("Preparo los informes mensuales para dirección.", SIZE.body, 0.9),
  main("Grupo Lumen", SIZE.company, 1.1),
  main("Asistente de Marketing", SIZE.role),
  main("septiembre de 2018 - febrero de 2021 (2 años 6 meses)"),
  main("Valencia, España"),
  main("Educación", SIZE.heading, 1.4),
  main("Universidad de Valencia", SIZE.company, 0.5),
  main("Grado en Administración y Dirección de Empresas · (2013 - 2017)"),
];

/**
 * Lucía as the first-run flow meets her: a profile that is titles and dates, with
 * nothing written under any of them, and one internship long enough ago to be a
 * skeleton and no more.
 */
export const LINKEDIN_ES_BARE: Spec[] = [
  side("Contacto", SIZE.heading),
  side("lucia.fernandez@example.com", SIZE.body, 0.6),
  side("www.linkedin.com/in/perfil-ejemplo-a1b2c3d4", SIZE.body, ITEM),
  side("(LinkedIn)"),
  side("Aptitudes principales", SIZE.heading, 1.2),
  side("Google Analytics", SIZE.body, 0.6),
  side("SEO", SIZE.body, ITEM),
  side("HubSpot", SIZE.body, ITEM),
  side("Email marketing", SIZE.body, ITEM),
  side("Copywriting", SIZE.body, ITEM),
  side("Idiomas", SIZE.heading, 1.2),
  side("Español (Native or Bilingual)", SIZE.body, 0.6),
  side("Inglés", SIZE.body, ITEM),

  main("Lucía Fernández", SIZE.name),
  main("Analista de Marketing Digital en Nubia Retail", SIZE.role, 0.3),
  main("Valencia, Comunidad Valenciana, España", SIZE.body, 0.1),
  main("Experiencia", SIZE.heading, 1.4),
  main("Nubia Retail", SIZE.company, 0.5),
  main("Analista de Marketing Digital", SIZE.role),
  main("marzo de 2021 - Present (5 años 6 meses)"),
  main("Valencia, Comunidad Valenciana, España"),
  main("Grupo Lumen", SIZE.company, 1.1),
  main("Asistente de Marketing", SIZE.role),
  main("septiembre de 2018 - febrero de 2021 (2 años 6 meses)"),
  main("Valencia, España"),
  main("Agencia Faro", SIZE.company, 1.1),
  main("Prácticas de Marketing", SIZE.role),
  main("febrero de 2018 - julio de 2018 (6 meses)"),
  main("Valencia, España"),
  main("Educación", SIZE.heading, 1.4),
  main("Universidad de Valencia", SIZE.company, 0.5),
  main("Grado en Administración y Dirección de Empresas · (2013 - 2017)"),
];

/** An engineer with two roles at one company, and English headings. */
export const LINKEDIN_EN: Spec[] = [
  side("Contact", SIZE.heading),
  side("+1 512 555 0142 (Mobile)", SIZE.body, 0.6),
  side("john.carter@example.com", SIZE.body, ITEM),
  side("www.linkedin.com/in/perfil-ejemplo-87654321", SIZE.body, ITEM),
  side("(LinkedIn)"),
  side("perfil-ejemplo.dev (Personal)", SIZE.body, ITEM),
  side("Top Skills", SIZE.heading, 1.2),
  side("Go", SIZE.body, 0.6),
  side("Apache Kafka", SIZE.body, ITEM),
  side("PostgreSQL", SIZE.body, ITEM),
  side("Languages", SIZE.heading, 1.2),
  side("English (Native or Bilingual)", SIZE.body, 0.6),
  side("Spanish (Full Professional)", SIZE.body, ITEM),
  side("Certifications", SIZE.heading, 1.2),
  side("AWS Certified Solutions", SIZE.body, 0.6),
  side("Architect"),

  main("John Carter", SIZE.name),
  main("Senior Software Engineer at Acme Corp", SIZE.role, 0.3),
  main("Austin, Texas, United States", SIZE.body, 0.1),
  main("Summary", SIZE.heading, 1.4),
  main("Backend engineer focused on payments and data pipelines.", SIZE.body, 0.4),
  main("Experience", SIZE.heading, 1.4),
  main("Acme Corp", SIZE.company, 0.5),
  main("6 years 3 months"),
  main("Senior Software Engineer", SIZE.role, 0.3),
  main("January 2020 - Present (4 years 9 months)"),
  main("San Francisco, California, United States"),
  main("Lead the payments platform team of six engineers.", SIZE.body, 0.4),
  main("Software Engineer", SIZE.role, 0.8),
  main("September 2018 - December 2019 (1 year 4 months)"),
  main("Built the ingestion service in Go and Kafka.", SIZE.body, 0.4),
  main("Globex", SIZE.company, 1.1),
  main("Intern", SIZE.role),
  main("June 2016 - August 2016 (3 months)"),
  main("Education", SIZE.heading, 1.4),
  main("University of Texas at Austin", SIZE.company, 0.5),
  main("Bachelor's degree, Computer Science · (2012 - 2016)"),
];
