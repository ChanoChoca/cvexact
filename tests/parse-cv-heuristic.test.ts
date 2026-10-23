import { describe, expect, it } from "vitest";
import { Packer } from "docx";
import { buildCVDocument } from "@/lib/docx/cv-docx";
import { templateCV } from "@/lib/fixtures/template-cv";
import { extractText } from "@/lib/import/extract";
import { linesFromText } from "@/lib/parse/lines";
import { parseCv } from "@/lib/parse/cv-heuristic";
import {
  AMBIGUOUS,
  DATES_FIRST,
  ENGLISH_STACKED,
  SPANISH_BULLETS,
  UNDATED_EDUCATION,
  WITH_PERSONAL_DATA,
} from "./fixtures/cv-samples";

const parse = (text: string) => parseCv(linesFromText(text));

describe("a Spanish CV with bullets", () => {
  const doc = parse(SPANISH_BULLETS);

  it("reads who and how to reach them", () => {
    expect(doc.contact.fullName?.value).toBe("LUCÍA FERNÁNDEZ");
    expect(doc.contact.headline?.value).toBe("Analista de Marketing Digital");
    expect(doc.contact.email?.value).toBe("lucia.fernandez@example.com");
    expect(doc.contact.phone?.value).toBe("+34 611 22 33 44");
    expect(doc.contact.city?.value).toBe("Valencia");
    expect(doc.contact.country?.value).toBe("España");
    expect(doc.contact.links.map((l) => l.value.url)).toEqual(["linkedin.com/in/perfil-ejemplo"]);
  });

  it("finds each job, with its company, role and dates", () => {
    expect(doc.experience).toHaveLength(2);
    const [first, second] = doc.experience;
    expect(first).toMatchObject({
      company: { value: "Nubia Retail" },
      role: { value: "Analista de Marketing Digital" },
      start: { value: { year: 2021, month: 3 } },
      end: { value: { current: true } },
      confidence: "high",
    });
    expect(second).toMatchObject({
      company: { value: "Grupo Lumen" },
      role: { value: "Asistente de Marketing" },
      start: { value: { year: 2018, month: 9 } },
      end: { value: { year: 2021, month: 2 } },
      confidence: "high",
    });
  });

  it("keeps each bullet as a statement in the author's words", () => {
    expect(doc.experience[0]!.facts.map((f) => f.value)).toEqual([
      "Llevo las campañas de Google Ads y Meta para tres marcas.",
      "Preparo los informes mensuales para dirección.",
      "Coordino a la agencia que nos hace el contenido.",
    ]);
    expect(doc.experience[1]!.facts).toHaveLength(2);
  });

  it("quotes the source for every value", () => {
    const [first] = doc.experience;
    expect(first!.company!.quote).toBe("Nubia Retail");
    expect(first!.start!.quote).toBe("marzo 2021");
    expect(first!.end!.quote.toLowerCase()).toBe("actualidad");
  });

  it("reads the education entry by its words, the years as a range", () => {
    expect(doc.education).toHaveLength(1);
    expect(doc.education[0]).toMatchObject({
      institution: { value: "Universidad de Valencia" },
      degree: { value: "Grado en Administración y Dirección de Empresas" },
      start: { value: { year: 2013 } },
      end: { value: { year: 2017 } },
      confidence: "high",
    });
  });

  it("reads languages with the level as written", () => {
    expect(doc.languages.map((l) => [l.name.value, l.level?.value])).toEqual([
      ["Español", "Nativo"],
      ["Inglés", "B2"],
    ]);
  });

  it("reads skills, and certifications with their date", () => {
    expect(doc.skills.map((s) => s.value)).toEqual([
      "Google Analytics",
      "SEO",
      "HubSpot",
      "Email marketing",
      "Copywriting",
    ]);
    expect(doc.certifications).toHaveLength(2);
    expect(doc.certifications[0]).toMatchObject({
      name: { value: "Google Ads Certification" },
      issuer: { value: "Google" },
      date: { value: { year: 2022 } },
    });
    expect(doc.certifications[1]).toMatchObject({ name: { value: "Curso de HubSpot Inbound" }, date: { value: { year: 2020 } } });
  });

  it("puts the summary in the tray instead of the profile", () => {
    expect(doc.unassigned).toContainEqual(
      expect.objectContaining({ kind: "summary", heading: "PERFIL", text: expect.stringContaining("seis años") }),
    );
  });

  it("is confident about a document it read cleanly", () => {
    expect(doc.confidence).toBe("high");
    expect(doc.omittedPersonalData).toBe(0);
  });
});

describe("an English CV with the dates on their own line", () => {
  const doc = parse(ENGLISH_STACKED);

  it("reads the stacked header: role, company, then dates", () => {
    expect(doc.experience).toHaveLength(2);
    expect(doc.experience[0]).toMatchObject({
      role: { value: "Senior Software Engineer" },
      company: { value: "Globex Corporation" },
      start: { value: { year: 2020, month: 1 } },
      end: { value: { current: true } },
      confidence: "high",
    });
    expect(doc.experience[1]).toMatchObject({
      role: { value: "Software Engineer" },
      company: { value: "Initech Labs" },
    });
  });

  it("reads bullets marked with a hyphen", () => {
    expect(doc.experience[0]!.facts.map((f) => f.value)).toEqual([
      "Lead the payments platform team of six engineers.",
      "Cut settlement time from two days to four hours.",
    ]);
  });

  it("reads English education, contact and languages", () => {
    expect(doc.education[0]).toMatchObject({
      degree: { value: "B.Sc. in Computer Science" },
      institution: { value: "University of Texas at Austin" },
    });
    expect(doc.contact.email?.value).toBe("john.carter@example.com");
    expect(doc.contact.city?.value).toBe("Austin");
    expect(doc.languages.map((l) => [l.name.value, l.level?.value])).toEqual([
      ["English", "Native"],
      ["Spanish", "Fluent"],
    ]);
  });
});

describe("dates first, names under them", () => {
  const doc = parse(DATES_FIRST);

  it("reads the entry from the lines under the dates", () => {
    expect(doc.experience).toHaveLength(2);
    expect(doc.experience[0]).toMatchObject({
      role: { value: "Cajero" },
      company: { value: "Supermercados Delta" },
      start: { value: { year: 2019 } },
      end: { value: { year: 2023 } },
    });
    expect(doc.experience[0]!.facts.map((f) => f.value)).toEqual([
      "Atención al público y cierre de caja diario.",
      "Reposición de góndolas.",
    ]);
  });

  it("reads a phone written with spaces around the separators", () => {
    expect(doc.contact.phone?.value).toBe("+54 9 341 555 0199");
    expect(doc.contact.city?.value).toBe("Rosario");
  });
});

describe("when the lines do not settle it", () => {
  it("keeps both candidates and marks the entry low instead of guessing quietly", () => {
    const doc = parse(AMBIGUOUS);
    expect(doc.experience).toHaveLength(1);
    const [entry] = doc.experience;
    expect(entry!.confidence).toBe("low");
    expect(entry!.doubts).toContain("company_or_role");
    expect(entry!.candidates).toEqual(["Estrella Norte", "Mercado Sur"]);
    expect(entry!.start?.value.year).toBe(2020);
    expect(doc.confidence).toBe("low");
  });
});

describe("personal data", () => {
  const doc = parse(WITH_PERSONAL_DATA);

  it("is never read into the profile, and the count says how much was left out", () => {
    const everything = JSON.stringify(doc);
    expect(everything).not.toContain("12/05/1990");
    expect(everything).not.toContain("30.123.456");
    expect(everything).not.toContain("Soltero");
    expect(everything).not.toContain("Corrientes 1234");
    // birth date, document, marital status, address, and the references block
    expect(doc.omittedPersonalData).toBe(5);
  });

  it("does not keep them in the copy of the document shown beside the review either", () => {
    expect(doc.lines).toHaveLength(linesFromText(WITH_PERSONAL_DATA).length);
    expect(doc.lines).not.toContain(expect.stringContaining("12/05/1990"));
    expect(doc.lines!.filter((line) => line.includes("dato personal omitido")).length).toBeGreaterThanOrEqual(5);
    // Line numbers do not move, so a block still points at the right place.
    expect(doc.lines![0]).toBe("Carlos Méndez");
  });

  it("does not read third parties' details either", () => {
    expect(JSON.stringify(doc)).not.toContain("María Pérez");
  });

  it("still reads the rest", () => {
    expect(doc.contact.fullName?.value).toBe("Carlos Méndez");
    expect(doc.contact.email?.value).toBe("carlos@example.com");
    expect(doc.experience[0]).toMatchObject({
      company: { value: "Banco Galicia" },
      role: { value: "Ejecutivo de cuentas" },
    });
  });
});

describe("studies with no dates", () => {
  const doc = parse(UNDATED_EDUCATION);

  it("finds them by their words and never rates them better than medium", () => {
    expect(doc.education.length).toBeGreaterThanOrEqual(2);
    for (const entry of doc.education) {
      expect(entry.confidence).not.toBe("high");
      expect(entry.doubts).toContain("no_dates");
    }
  });

  it("pairs a degree line with the institution line next to it", () => {
    const first = doc.education[0]!;
    expect(first.degree?.value).toContain("Abogacía");
    expect(first.institution?.value).toContain("Universidad de Buenos Aires");
    const second = doc.education[1]!;
    expect(second.degree?.value).toBe("Diplomatura en Derecho Laboral");
    expect(second.institution?.value).toBe("Universidad Austral");
  });
});

describe("the CV this app itself exports", () => {
  async function exportedText() {
    const buffer = await Packer.toBuffer(buildCVDocument(templateCV));
    const file = new File([new Uint8Array(buffer)], "cv.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    return extractText(file);
  }

  it("reads back the jobs it was made from, with company, role and dates", async () => {
    const doc = parse(await exportedText());
    expect(doc.experience.map((e) => [e.company?.value, e.role?.value])).toEqual([
      ["Nube Ámbar", "Lead FrontEnd Architect"],
      ["Estudio Bruma", "Desarrollador FullStack"],
      ["Taller Pardo", "Desarrollador FrontEnd"],
    ]);
    expect(doc.experience[0]).toMatchObject({
      start: { value: { year: 2018, month: 3 } },
      end: { value: { year: 2023, month: 10 } },
      city: { value: "Valencia" },
      country: { value: "España" },
      confidence: "high",
    });
  });

  it("reads the header, the education and the languages", async () => {
    const doc = parse(await exportedText());
    expect(doc.contact).toMatchObject({
      fullName: { value: "Lucía Ferrer Molina" },
      email: { value: "lucia.ferrer.molina@example.com" },
      phone: { value: "+34 600 00 00 00" },
      city: { value: "Valencia" },
    });
    expect(doc.contact.links.map((l) => l.value.url)).toEqual([
      "linkedin.com/in/perfil-ejemplo",
      "github.com/perfil-ejemplo",
      "perfil-ejemplo.dev",
    ]);
    expect(doc.education[0]).toMatchObject({
      institution: { value: "Escuela Superior de Ingeniería Delta" },
      degree: { value: "Ingeniería de Software" },
      honors: { value: "Beca de excelencia académica en el trabajo de fin de carrera" },
    });
    expect(doc.languages.map((l) => [l.name.value, l.level?.value])).toEqual([
      ["Español", "Nativo"],
      ["Catalán", "Nativo"],
      ["Inglés", "Fluido"],
    ]);
  });

  it("keeps the paragraphs under each job as its facts", async () => {
    const doc = parse(await exportedText());
    expect(doc.experience[0]!.facts.length).toBe(5);
    expect(doc.experience[0]!.facts[0]!.value).toMatch(/^Coordiné el frontend de tres productos/);
  });

  it("puts the summary in the tray", async () => {
    const doc = parse(await exportedText());
    expect(doc.unassigned.some((u) => u.kind === "summary" && u.text.includes("más de una década de experiencia"))).toBe(true);
  });
});

describe("a heading combining two kinds", () => {
  it("reads a certification, a language and a practical fact from one heading, none left in the tray", () => {
    const doc = parse(
      "Ana Gómez\n\n" +
        "EXPERIENCIA\n" +
        "Nubia Retail\n" +
        "Analista\n" +
        "2021 - 2023\n" +
        "Coordiné campañas\n\n" +
        "CERTIFICACIONES E IDIOMAS\n" +
        "AWS Cloud Practitioner: AWS\n" +
        "Inglés: Avanzado\n" +
        "Disponibilidad: Full time, Part time\n",
    );
    expect(doc.certifications).toEqual([{ name: { value: "AWS Cloud Practitioner", quote: "AWS Cloud Practitioner: AWS" }, issuer: { value: "AWS", quote: "AWS Cloud Practitioner: AWS" } }]);
    expect(doc.languages).toMatchObject([{ name: { value: "Inglés" }, level: { value: "Avanzado" } }]);
    expect(doc.practical?.availability).toMatchObject({ value: "Full time, Part time" });
    expect(doc.unassigned.some((u) => u.heading === "CERTIFICACIONES E IDIOMAS")).toBe(false);
  });

  it("reads a heading naming only a practical fact", () => {
    const doc = parse("Ana Gómez\n\nDisponibilidad\nFines de semana\n");
    expect(doc.practical?.availability).toMatchObject({ value: "Fines de semana" });
  });

  it("does not turn an ordinary two-word skills heading into a fake compound", () => {
    const doc = parse("Ana Gómez\n\nHabilidades y competencias\nSQL, Python\n");
    expect(doc.skills.map((s) => s.value)).toEqual(["SQL", "Python"]);
  });
});

describe("a skills section with sentences instead of a list", () => {
  it("pulls out the named tools and leaves only the rest in the tray", () => {
    const doc = parse(
      "Ana Gómez\n\n" +
        "SKILLS ADICIONALES\n" +
        "Desarrollo backend con Spring Boot y Node.js.\n" +
        "Implementación de seguridad en aplicaciones y APIs.\n",
    );
    expect(doc.skills.map((s) => s.value)).toEqual(["Spring Boot", "Node.js"]);
    expect(doc.unassigned).toContainEqual(
      expect.objectContaining({ kind: "other", text: "Implementación de seguridad en aplicaciones y APIs.", heading: "SKILLS ADICIONALES" }),
    );
  });

  it("still reads a language mentioned inside an ordinary skills list", () => {
    const doc = parse("Ana Gómez\n\nHabilidades\nInglés: Avanzado\nExcel, SAP\n");
    expect(doc.languages).toMatchObject([{ name: { value: "Inglés" }, level: { value: "Avanzado" } }]);
    expect(doc.skills.map((s) => s.value)).toEqual(["Excel", "SAP"]);
  });
});

describe("a URL under a job, on its own line", () => {
  it("is kept as a link, not read as an achievement", () => {
    const doc = parse(
      "Ana Gómez\n\nEXPERIENCIA\nFlash Page\nSoftware Engineer\n2024 - Actualidad\n• Gestioné el equipo.\n• https://flashpage.com.ar\n",
    );
    expect(doc.experience[0]!.facts.map((f) => f.value)).toEqual(["Gestioné el equipo."]);
    expect(doc.unassigned).toContainEqual(expect.objectContaining({ kind: "link", text: "https://flashpage.com.ar", heading: "Flash Page" }));
  });
});

describe("every value is a piece of the document", () => {
  it.each([
    ["spanish", SPANISH_BULLETS],
    ["english", ENGLISH_STACKED],
    ["dates first", DATES_FIRST],
  ])("%s: each quote can be found in the text", (_name, text) => {
    const flat = text.replace(/\s+/g, " ");
    const doc = parse(text);
    const quotes: string[] = [];
    for (const job of doc.experience) {
      for (const q of [job.company, job.role, job.start, job.end, job.city]) if (q) quotes.push(q.quote);
      for (const fact of job.facts) quotes.push(fact.quote);
    }
    for (const entry of doc.education) for (const q of [entry.institution, entry.degree]) if (q) quotes.push(q.quote);
    for (const q of [doc.contact.fullName, doc.contact.email, doc.contact.phone]) if (q) quotes.push(q.quote);
    expect(quotes.length).toBeGreaterThan(10);
    for (const quote of quotes) expect(flat, quote).toContain(quote.replace(/\s+/g, " "));
  });
});
