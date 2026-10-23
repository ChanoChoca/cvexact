import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvRows, pick } from "@/lib/parse/csv";
import { parseLinkedInExport, type CsvFiles } from "@/lib/parse/linkedin-csv";

describe("parseCsvRows", () => {
  it("reads quoted cells with commas, doubled quotes and line breaks inside", () => {
    const rows = parseCsvRows('a,b\n"uno, dos","dijo ""hola"""\n"línea 1\nlínea 2",x\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["uno, dos", 'dijo "hola"'],
      ["línea 1\nlínea 2", "x"],
    ]);
  });

  it("handles a byte-order mark and Windows line ends", () => {
    expect(parseCsvRows("﻿a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("detects a semicolon delimiter", () => {
    expect(parseCsvRows("a;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("skips blank lines and keeps a last row with no trailing newline", () => {
    expect(parseCsvRows("a,b\n\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseCsv", () => {
  it("keys columns without regard to case, spaces or punctuation", () => {
    const table = parseCsv("Company Name,Started On\nNubia,Mar 2021");
    expect(table.rows[0]).toEqual({ companyname: "Nubia", startedon: "Mar 2021" });
    expect(pick(table.rows[0]!, "company name")).toBe("Nubia");
    expect(pick(table.rows[0]!, "missing", "Started ON")).toBe("Mar 2021");
  });

  it("finds the header after a few lines of notes", () => {
    const text = 'Notes:\n"When exporting your connection data, you may notice that some of the email addresses are missing."\n\nFirst Name,Last Name,Company\nAna,Gómez,Nubia\n';
    const table = parseCsv(text, ["First Name", "Company"]);
    expect(table.headers).toEqual(["First Name", "Last Name", "Company"]);
    expect(table.rows).toEqual([{ firstname: "Ana", lastname: "Gómez", company: "Nubia" }]);
  });

  it("gives back nothing for nothing", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });

  it("pads a short row instead of throwing", () => {
    expect(parseCsv("a,b,c\n1,2").rows[0]).toEqual({ a: "1", b: "2", c: "" });
  });
});

const FILES: CsvFiles = {
  profile:
    'First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location,Twitter Handles,Websites,Instant Messengers\n' +
    'Lucía,Fernández,,"Calle Mayor 1, Valencia",1990-05-12,Analista de Marketing Digital,"Analista con seis años de experiencia\nen campañas de pago y SEO.",Marketing,46001,"Valencia, Valencian Community, Spain",,[PERSONAL:https://luciafernandez.example.com],\n',
  positions:
    "Company Name,Title,Description,Location,Started On,Finished On\n" +
    'Nubia Retail,Analista de Marketing Digital,"• Llevo las campañas de Google Ads y Meta.\n• Preparo los informes mensuales.","Valencia, Spain",Mar 2021,\n' +
    'Grupo Lumen,Asistente de Marketing,,"Valencia, Spain",Sep 2018,Feb 2021\n',
  education: "School Name,Start Date,End Date,Notes,Degree Name,Activities\nUniversidad de Valencia,2013,2017,Matrícula de honor,Grado en ADE,\n",
  skills: "Name\nGoogle Analytics\nSEO\n",
  languages: "Name,Proficiency\nEspañol,Native or bilingual proficiency\nInglés,Professional working proficiency\n",
  certifications: "Name,Url,Authority,Started On,Finished On,License Number\nGoogle Ads Certification,,Google,Jun 2022,,\n",
  "email addresses": "Email Address,Confirmed,Primary,Updated On\notro@example.com,Yes,No,2024-01-01\nlucia@example.com,Yes,Yes,2024-01-01\n",
};

describe("the LinkedIn data export", () => {
  const doc = parseLinkedInExport(FILES)!;

  it("is read, and says where it came from", () => {
    expect(doc.kind).toBe("linkedin_csv");
  });

  it("reads the profile: name, headline, place, site, primary email", () => {
    expect(doc.contact).toMatchObject({
      fullName: { value: "Lucía Fernández" },
      headline: { value: "Analista de Marketing Digital" },
      city: { value: "Valencia" },
      country: { value: "Spain" },
      email: { value: "lucia@example.com" },
    });
    expect(doc.contact.links.map((l) => l.value.url)).toEqual(["https://luciafernandez.example.com"]);
  });

  it("never reads the address or the birth date, and counts them", () => {
    expect(JSON.stringify(doc)).not.toContain("Calle Mayor");
    expect(JSON.stringify(doc)).not.toContain("1990-05-12");
    expect(doc.omittedPersonalData).toBe(2);
  });

  it("reads each position from its columns, with no guessing about which is which", () => {
    expect(doc.experience).toHaveLength(2);
    expect(doc.experience[0]).toMatchObject({
      company: { value: "Nubia Retail" },
      role: { value: "Analista de Marketing Digital" },
      start: { value: { year: 2021, month: 3 } },
      end: { value: { current: true } },
      city: { value: "Valencia" },
      country: { value: "Spain" },
      confidence: "high",
    });
    expect(doc.experience[1]).toMatchObject({
      start: { value: { year: 2018, month: 9 } },
      end: { value: { year: 2021, month: 2 } },
    });
  });

  it("reads a description as statements, dropping the bullet marks", () => {
    expect(doc.experience[0]!.facts.map((f) => f.value)).toEqual([
      "Llevo las campañas de Google Ads y Meta.",
      "Preparo los informes mensuales.",
    ]);
    expect(doc.experience[1]!.facts).toEqual([]);
  });

  it("reads education, skills, languages with their level as written, and certifications", () => {
    expect(doc.education[0]).toMatchObject({
      institution: { value: "Universidad de Valencia" },
      degree: { value: "Grado en ADE" },
      start: { value: { year: 2013 } },
      end: { value: { year: 2017 } },
    });
    expect(doc.skills.map((s) => s.value)).toEqual(["Google Analytics", "SEO"]);
    expect(doc.languages.map((l) => [l.name.value, l.level?.value])).toEqual([
      ["Español", "Native or bilingual proficiency"],
      ["Inglés", "Professional working proficiency"],
    ]);
    expect(doc.certifications[0]).toMatchObject({
      name: { value: "Google Ads Certification" },
      issuer: { value: "Google" },
      date: { value: { year: 2022, month: 6 } },
    });
  });

  it("puts the summary and the education notes in the tray", () => {
    expect(doc.unassigned.some((u) => u.kind === "summary" && u.text.includes("seis años"))).toBe(true);
    expect(doc.unassigned.some((u) => u.text === "Matrícula de honor")).toBe(true);
  });

  it("copes with files missing, with nothing recognisable, and with a position that has no title", () => {
    expect(parseLinkedInExport({})).toBeNull();
    expect(parseLinkedInExport({ connections: "First Name,Last Name\nAna,Gómez" })).toBeNull();
    const partial = parseLinkedInExport({ positions: "Company Name,Title,Started On,Finished On\nNubia,,Mar 2021,\n" })!;
    expect(partial.experience[0]).toMatchObject({ confidence: "medium", doubts: ["no_role"] });
  });

  it("does not depend on a file name's case or on extra columns", () => {
    const doc2 = parseLinkedInExport({ positions: "COMPANY NAME,TITLE,Extra,STARTED ON,FINISHED ON\nNubia,Analista,x,Mar 2021,Jun 2022\n" })!;
    expect(doc2.experience[0]).toMatchObject({ company: { value: "Nubia" }, end: { value: { year: 2022, month: 6 } } });
  });
});
