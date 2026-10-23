import { describe, expect, it } from "vitest";
import { linesFromRuns } from "@/lib/parse/lines";
import { isLinkedInPdf, parseLinkedInPdf } from "@/lib/parse/linkedin-pdf";
import { LINKEDIN_EN, LINKEDIN_ES, SIZE, layout } from "./fixtures/linkedin-layout";

/**
 * Lines as the import builds them for a file that says it is LinkedIn's: cut at
 * the sidebar's edge, so a long sidebar entry never runs into the main column.
 */
const linesOf = (specs: Parameters<typeof layout>[0]) => linesFromRuns(layout(specs), { splitAt: 150 });

describe("recognising the file", () => {
  it("trusts the metadata", () => {
    expect(isLinkedInPdf({ author: "LinkedIn" }, [])).toBe(true);
    expect(isLinkedInPdf({ subject: "Generated from Profile" }, [])).toBe(true);
    expect(isLinkedInPdf({ author: "Someone Else" }, [])).toBe(false);
  });

  it("falls back on the shape of the text when the metadata is missing", () => {
    expect(isLinkedInPdf(undefined, linesOf(LINKEDIN_ES))).toBe(true);
    expect(isLinkedInPdf(undefined, linesOf(LINKEDIN_EN))).toBe(true);
  });

  it("does not take a CV for one just because it links to LinkedIn and has the usual headings", () => {
    const cv = linesOf([
      { col: "main", text: "Ana Gómez", size: 20 },
      { col: "main", text: "Contacto", size: 14 },
      { col: "main", text: "linkedin.com/in/perfil-ejemplo", size: 10 },
      { col: "main", text: "Idiomas", size: 14 },
      { col: "main", text: "Inglés B2", size: 10 },
      { col: "main", text: "Experiencia", size: 14 },
      { col: "main", text: "Nubia Retail", size: 12 },
      { col: "main", text: "Educación", size: 14 },
    ]);
    expect(isLinkedInPdf(undefined, cv)).toBe(false);
  });

  it("does not take an ordinary CV for one", () => {
    const cv = linesOf([
      { col: "main", text: "Ana Gómez", size: 20 },
      { col: "main", text: "Contacto", size: 14 },
      { col: "main", text: "ana@example.com", size: 10 },
    ]);
    expect(isLinkedInPdf(undefined, cv)).toBe(false);
  });
});

describe("the Spanish export", () => {
  const doc = parseLinkedInPdf(linesOf(LINKEDIN_ES))!;

  it("is read", () => {
    expect(doc).not.toBeNull();
    expect(doc.kind).toBe("linkedin_pdf");
  });

  it("reads the name, headline and place from the main column", () => {
    expect(doc.contact.fullName?.value).toBe("Lucía Fernández");
    expect(doc.contact.headline?.value).toBe("Analista de Marketing Digital en Nubia Retail");
    expect(doc.contact.city?.value).toBe("Valencia");
    expect(doc.contact.country?.value).toBe("España");
  });

  it("reads contact details from the sidebar", () => {
    expect(doc.contact.email?.value).toBe("lucia.fernandez@example.com");
    expect(doc.contact.links.map((l) => l.value.url)).toEqual(["www.linkedin.com/in/perfil-ejemplo-a1b2c3d4"]);
  });

  it("tells a company from a role by size, not by guessing at words", () => {
    expect(doc.experience).toHaveLength(2);
    expect(doc.experience[0]).toMatchObject({
      company: { value: "Nubia Retail" },
      role: { value: "Analista de Marketing Digital" },
      start: { value: { year: 2021, month: 3 } },
      end: { value: { current: true } },
      city: { value: "Valencia" },
      country: { value: "España" },
      confidence: "high",
    });
    expect(doc.experience[1]).toMatchObject({
      company: { value: "Grupo Lumen" },
      role: { value: "Asistente de Marketing" },
      start: { value: { year: 2018, month: 9 } },
      end: { value: { year: 2021, month: 2 } },
      confidence: "high",
    });
  });

  it("keeps the description, paragraph by paragraph, and an empty one stays empty", () => {
    expect(doc.experience[0]!.facts.map((f) => f.value)).toEqual([
      "Llevo las campañas de Google Ads y Meta para tres marcas.",
      "Preparo los informes mensuales para dirección.",
    ]);
    expect(doc.experience[1]!.facts).toEqual([]);
  });

  it("does not take the duration for part of the dates", () => {
    expect(doc.experience[0]!.end?.quote).toBe("Present");
    expect(doc.experience[0]!.start?.quote).toBe("marzo de 2021");
  });

  it("reads education, the years closing the degree", () => {
    expect(doc.education).toHaveLength(1);
    expect(doc.education[0]).toMatchObject({
      institution: { value: "Universidad de Valencia" },
      degree: { value: "Grado en Administración y Dirección de Empresas" },
      start: { value: { year: 2013 } },
      end: { value: { year: 2017 } },
      confidence: "high",
    });
  });

  it("reads skills, languages with their level as written, and certifications", () => {
    expect(doc.skills.map((s) => s.value)).toEqual(["Google Analytics", "SEO", "Email marketing"]);
    expect(doc.languages.map((l) => [l.name.value, l.level?.value])).toEqual([
      ["Español", "Native or Bilingual"],
      ["Inglés", "Professional Working"],
    ]);
    expect(doc.certifications.map((c) => c.name.value)).toEqual(["Google Ads Certification"]);
  });

  it("puts the summary in the tray, as one paragraph", () => {
    const summary = doc.unassigned.find((u) => u.kind === "summary")!;
    expect(summary.heading).toBe("Extracto");
    expect(summary.text).toBe("Analista con seis años de experiencia en campañas de pago y SEO, con foco en resultados medibles.");
  });

  it("is confident, and leaves the footer out", () => {
    expect(doc.confidence).toBe("high");
    expect(JSON.stringify(doc)).not.toMatch(/Page \d of/);
  });
});

describe("the English export, with two roles at one company", () => {
  const doc = parseLinkedInPdf(linesOf(LINKEDIN_EN))!;

  it("gives each role the company that was named once above them", () => {
    expect(doc.experience.map((e) => [e.company?.value, e.role?.value])).toEqual([
      ["Acme Corp", "Senior Software Engineer"],
      ["Acme Corp", "Software Engineer"],
      ["Globex", "Intern"],
    ]);
  });

  it("skips the total duration under the company", () => {
    expect(doc.experience[0]!.start?.value).toMatchObject({ year: 2020, month: 1 });
    expect(JSON.stringify(doc.experience[0])).not.toContain("6 years 3 months");
  });

  it("reads each role's own dates, place and description", () => {
    expect(doc.experience[0]).toMatchObject({
      end: { value: { current: true } },
      city: { value: "San Francisco" },
      country: { value: "United States" },
    });
    expect(doc.experience[0]!.facts.map((f) => f.value)).toEqual(["Lead the payments platform team of six engineers."]);
    expect(doc.experience[1]).toMatchObject({
      start: { value: { year: 2018, month: 9 } },
      end: { value: { year: 2019, month: 12 } },
    });
    expect(doc.experience[2]!.end?.value).toMatchObject({ year: 2016, month: 8 });
  });

  it("reads the sidebar: phone, links, wrapped certification, languages", () => {
    expect(doc.contact.phone?.value).toBe("+1 512 555 0142");
    expect(doc.contact.links.map((l) => l.value.url)).toEqual(["www.linkedin.com/in/perfil-ejemplo-87654321", "perfil-ejemplo.dev"]);
    expect(doc.certifications.map((c) => c.name.value)).toEqual(["AWS Certified Solutions Architect"]);
    expect(doc.languages.map((l) => l.name.value)).toEqual(["English", "Spanish"]);
    expect(doc.skills.map((s) => s.value)).toEqual(["Go", "Apache Kafka", "PostgreSQL"]);
  });

  it("reads a degree with its field and years", () => {
    expect(doc.education[0]).toMatchObject({
      institution: { value: "University of Texas at Austin" },
      degree: { value: "Bachelor's degree, Computer Science" },
      end: { value: { year: 2016 } },
    });
  });
});

describe("quirks a real export throws at the body-size guess", () => {
  it("is not fooled by a long summary paragraph set a touch larger than the body", () => {
    const doc = parseLinkedInPdf(
      linesOf([
        { col: "main", text: "Lucía Fernández", size: SIZE.name },
        { col: "main", text: "Analista de Marketing Digital en Nubia Retail", size: SIZE.role, gap: 0.3 },
        { col: "main", text: "Valencia, España", size: SIZE.body, gap: 0.1 },
        { col: "main", text: "Extracto", size: SIZE.heading, gap: 1.4 },
        // A long summary, set at 12pt while the rest of the body is 10.5pt —
        // enough characters to have won the old "most characters" vote.
        { col: "main", text: "Analista con experiencia en campañas de pago y en estrategias", size: 12, gap: 0.4 },
        { col: "main", text: "de contenido para marcas de retail en varios países de la región,", size: 12 },
        { col: "main", text: "con foco constante en resultados medibles y en el crecimiento.", size: 12 },
        { col: "main", text: "Experiencia", size: SIZE.heading, gap: 1.4 },
        { col: "main", text: "Nubia Retail", size: SIZE.company, gap: 0.5 },
        { col: "main", text: "Analista de Marketing Digital", size: SIZE.role },
        { col: "main", text: "marzo de 2021 - Present (3 años)", size: SIZE.body },
        { col: "main", text: "Coordino las campañas de la marca.", size: SIZE.body, gap: 0.4 },
        { col: "side", text: "Contacto", size: SIZE.heading },
        { col: "side", text: "lucia@example.com", size: SIZE.body, gap: 0.6 },
        { col: "side", text: "www.linkedin.com/in/perfil-ejemplo", size: SIZE.body, gap: 0.5 },
        { col: "side", text: "Aptitudes principales", size: SIZE.heading, gap: 1.2 },
        { col: "side", text: "SEO", size: SIZE.body, gap: 0.6 },
      ]),
    );
    expect(doc).not.toBeNull();
    expect(doc!.experience[0]).toMatchObject({
      company: { value: "Nubia Retail" },
      role: { value: "Analista de Marketing Digital" },
      confidence: "high",
    });
  });
});

describe("a sidebar headed \"Contactar\" rather than \"Contacto\"", () => {
  it("is still recognised as the template, and its fields still read", () => {
    const specs = LINKEDIN_ES.map((spec) => (spec.text === "Contacto" ? { ...spec, text: "Contactar" } : spec));
    const lines = linesOf(specs);
    expect(isLinkedInPdf(undefined, lines)).toBe(true);
    const doc = parseLinkedInPdf(lines)!;
    expect(doc).not.toBeNull();
    expect(doc.contact.email?.value).toBe("lucia.fernandez@example.com");
    expect(doc.contact.links.map((l) => l.value.url)).toEqual(["www.linkedin.com/in/perfil-ejemplo-a1b2c3d4"]);
  });
});

describe("a job description of separate one-line bullets, not a wrapped paragraph", () => {
  it("keeps each as its own fact instead of merging them into one", () => {
    const doc = parseLinkedInPdf(
      linesOf([
        { col: "main", text: "Lucía Fernández", size: SIZE.name },
        { col: "main", text: "Analista", size: SIZE.role, gap: 0.3 },
        { col: "main", text: "Valencia, España", size: SIZE.body, gap: 0.1 },
        // A properly wrapped paragraph elsewhere on the page, reaching the
        // column's real right edge — what "ends early" is measured against.
        // Without one, nothing on this small a page looks short by comparison.
        { col: "main", text: "Extracto", size: SIZE.heading, gap: 1.4 },
        { col: "main", text: "Analista con experiencia en campañas de pago y en estrategias de", size: SIZE.body, gap: 0.4 },
        { col: "main", text: "contenido para marcas de retail en varios países de la región.", size: SIZE.body },
        { col: "main", text: "Experiencia", size: SIZE.heading, gap: 1.4 },
        { col: "main", text: "Nubia Retail", size: SIZE.company, gap: 0.5 },
        { col: "main", text: "Analista de Marketing Digital", size: SIZE.role },
        { col: "main", text: "marzo de 2021 - Present (3 años)", size: SIZE.body },
        // Three short, separate lines, each far from the column's own widest
        // line — the same leading a genuinely wrapped paragraph would use.
        { col: "main", text: "Desarrollo en backend: Spring Boot, Node.js", size: SIZE.body, gap: 0.4 },
        { col: "main", text: "Desarrollo en frontend: Angular, React", size: SIZE.body },
        { col: "main", text: "https://flashpage.com.ar", size: SIZE.body },
        { col: "side", text: "Contacto", size: SIZE.heading },
        { col: "side", text: "lucia@example.com", size: SIZE.body, gap: 0.6 },
        { col: "side", text: "www.linkedin.com/in/perfil-ejemplo", size: SIZE.body, gap: 0.5 },
        { col: "side", text: "Aptitudes principales", size: SIZE.heading, gap: 1.2 },
        { col: "side", text: "SEO", size: SIZE.body, gap: 0.6 },
      ]),
    );
    expect(doc).not.toBeNull();
    expect(doc!.experience[0]!.facts.map((f) => f.value)).toEqual([
      "Desarrollo en backend: Spring Boot, Node.js",
      "Desarrollo en frontend: Angular, React",
    ]);
    expect(doc!.unassigned).toContainEqual(expect.objectContaining({ kind: "link", text: "https://flashpage.com.ar" }));
  });
});

describe("a degree whose field of study wraps onto a second line", () => {
  it("joins across the wider gap that line uses, and drops LinkedIn's own shouting-case field", () => {
    const doc = parseLinkedInPdf(
      linesOf([
        { col: "main", text: "Lucía Fernández", size: SIZE.name },
        { col: "main", text: "Analista", size: SIZE.role, gap: 0.3 },
        { col: "main", text: "Valencia, España", size: SIZE.body, gap: 0.1 },
        { col: "main", text: "Educación", size: SIZE.heading, gap: 1.4 },
        { col: "main", text: "UNNOBA", size: SIZE.company, gap: 0.5 },
        // Wrapped with more leading than an ordinary paragraph line, the way
        // this exact LinkedIn field does — under WRAP_LIMIT's own reach but
        // inside the wider one this reads a degree's continuation with.
        { col: "main", text: "Analista de Sistemas, COMPUTER AND INFORMATION SCIENCES AND", size: SIZE.body, gap: 0.5 },
        { col: "main", text: "SUPPORT SERVICES · (marzo de 2020 - noviembre de 2024)", size: SIZE.body, gap: 0.5 },
        { col: "side", text: "Contacto", size: SIZE.heading },
        { col: "side", text: "lucia@example.com", size: SIZE.body, gap: 0.6 },
        { col: "side", text: "www.linkedin.com/in/perfil-ejemplo", size: SIZE.body, gap: 0.5 },
        { col: "side", text: "Aptitudes principales", size: SIZE.heading, gap: 1.2 },
        { col: "side", text: "SEO", size: SIZE.body, gap: 0.6 },
      ]),
    );
    expect(doc).not.toBeNull();
    expect(doc!.education[0]).toMatchObject({
      institution: { value: "UNNOBA" },
      degree: { value: "Analista de Sistemas" },
      start: { value: { year: 2020, month: 3 } },
      end: { value: { year: 2024, month: 11 } },
    });
  });
});

describe("when it is not the template", () => {
  it("gives up rather than guessing, so the general reader can take over", () => {
    expect(parseLinkedInPdf([])).toBeNull();
    // A page of same-sized text: no name, no headings.
    const flat = linesOf(Array.from({ length: 12 }, (_, i) => ({ col: "main" as const, text: `Línea número ${i}`, size: SIZE.body })));
    expect(parseLinkedInPdf(flat)).toBeNull();
  });

  it("does not need the text to be positioned to be refused", () => {
    expect(parseLinkedInPdf([{ text: "Hola", index: 0, gapBefore: false }])).toBeNull();
  });
});
