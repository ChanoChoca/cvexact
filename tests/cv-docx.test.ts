import JSZip from "jszip";
import { Packer } from "docx";
import { describe, expect, it } from "vitest";
import { buildCVDocument } from "@/lib/docx/cv-docx";
import { templateCV } from "@/lib/fixtures/template-cv";
import { cvDocumentSchema, type CVDocument } from "@/lib/schemas/cv";

/**
 * The .docx export is the deliverable for portals and ATS that reject PDFs, so
 * what matters here is that every word of the CV reaches the file, that the
 * screen-only coverage panel does not, and that a CV full of empty optional
 * fields still produces a document Word can open.
 *
 * These assertions read the generated OOXML directly rather than trusting the
 * builder: a Paragraph the library silently drops would still typecheck.
 */

/** Reads word/document.xml out of the generated package. */
async function documentXml(data: CVDocument): Promise<string> {
  const buffer = await Packer.toBuffer(buildCVDocument(data));
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("the package has no word/document.xml");
  return xml;
}

/**
 * OOXML splits and escapes text, so comparing raw strings is unreliable. This
 * concatenates every <w:t> run into one plain-text blob, which is roughly what
 * a parser sees.
 */
function plainText(xml: string): string {
  return [...xml.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => match[1])
    .join("")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

describe("buildCVDocument", () => {
  it("produces a readable OOXML package", async () => {
    const buffer = await Packer.toBuffer(buildCVDocument(templateCV));
    const zip = await JSZip.loadAsync(buffer);

    // The three parts Word refuses to open a file without.
    expect(zip.file("[Content_Types].xml")).not.toBeNull();
    expect(zip.file("word/document.xml")).not.toBeNull();
    expect(zip.file("word/numbering.xml")).not.toBeNull();
  });

  it("carries every line of the CV into the document", async () => {
    const text = plainText(await documentXml(templateCV));

    expect(text).toContain(templateCV.header.fullName);
    expect(text).toContain(templateCV.header.location);
    expect(text).toContain(templateCV.header.phone);
    expect(text).toContain(templateCV.summary);

    for (const section of templateCV.sections) {
      expect(text).toContain(section.title);

      if (section.kind === "experience") {
        for (const item of section.items) {
          expect(text).toContain(item.company);
          expect(text).toContain(item.role);
          expect(text).toContain(item.dateRange);
          for (const bullet of item.bullets) expect(text).toContain(bullet);
        }
      } else if (section.kind === "education") {
        for (const item of section.items) {
          expect(text).toContain(item.institution);
          expect(text).toContain(item.degree);
          expect(text).toContain(item.honors);
        }
      } else if (section.kind === "bullets") {
        for (const bullet of section.bullets) expect(text).toContain(bullet);
      } else if (section.kind === "projects") {
        for (const item of section.items) expect(text).toContain(item.name);
      } else if (section.kind === "activities") {
        for (const item of section.items) expect(text).toContain(item.text);
      } else {
        for (const item of section.items) {
          expect(text).toContain(item.label);
          expect(text).toContain(item.value);
        }
      }
    }
  });

  it("carries a pairs section, in parity with the HTML renderer", async () => {
    const withPairs: CVDocument = {
      ...templateCV,
      sections: [
        ...templateCV.sections,
        {
          kind: "pairs",
          title: "CERTIFICACIONES E IDIOMAS",
          items: [
            { label: "AWS Cloud Practitioner", value: "AWS, 2024" },
            { label: "Inglés", value: "Avanzado" },
          ],
        },
      ],
    };

    const text = plainText(await documentXml(withPairs));
    expect(text).toContain("CERTIFICACIONES E IDIOMAS");
    expect(text).toContain("AWS Cloud Practitioner");
    expect(text).toContain("AWS, 2024");
    expect(text).toContain("Inglés");
  });

  it("carries an activities section as a list under its own heading, in parity with the HTML renderer", async () => {
    const withActivities: CVDocument = {
      ...templateCV,
      sections: [
        ...templateCV.sections,
        { kind: "activities", title: "ACTIVIDADES", items: [{ ref: "O1", text: "Presido el Club de Robótica." }, { ref: "O2", text: "Doy clases de apoyo." }] },
      ],
    };

    const xml = await documentXml(withActivities);
    const text = plainText(xml);
    expect(text).toContain("ACTIVIDADES");
    expect(text).toContain("Presido el Club de Robótica.");
    expect(text).toContain("Doy clases de apoyo.");
    // The reference is how the generator points at the profile; it is never printed.
    expect(text).not.toContain("O1");
  });

  it("omits a pair's separator when it has no value", async () => {
    const withPairs: CVDocument = {
      ...templateCV,
      sections: [
        { kind: "pairs", title: "DISPONIBILIDAD", items: [{ label: "Full time", value: "" }] },
      ],
    };

    const text = plainText(await documentXml(withPairs));
    expect(text).toContain("Full time");
    expect(text).not.toContain("Full time:");
  });

  describe("projects", () => {
    // No contact links, so any hyperlink in the file is a project's.
    const bare = (items: Extract<CVDocument["sections"][number], { kind: "projects" }>["items"]): CVDocument => ({
      ...templateCV,
      header: { ...templateCV.header, email: "", links: [] },
      sections: [{ kind: "projects", title: "PROYECTOS", items }],
    });

    async function relationships(data: CVDocument): Promise<string> {
      const zip = await JSZip.loadAsync(await Packer.toBuffer(buildCVDocument(data)));
      return (await zip.file("word/_rels/document.xml.rels")?.async("string")) ?? "";
    }

    it("prints the name, the description and the link, which points at the whole address", async () => {
      const data = bare([{ ref: "P1", name: "Sistema de turnos", description: "Agenda para una clínica.", url: "https://github.com/perfil-ejemplo/turnos" }]);
      const xml = await documentXml(data);

      expect(plainText(xml)).toContain("PROYECTOS");
      expect(plainText(xml)).toContain("Sistema de turnos: Agenda para una clínica. • github.com/perfil-ejemplo/turnos");
      expect(xml).toContain("<w:hyperlink");
      expect(await relationships(data)).toContain('Target="https://github.com/perfil-ejemplo/turnos"');
      // The reference is how the generator points at the profile; it is never printed.
      expect(plainText(xml)).not.toContain("P1");
    });

    it("prints a project with no link as plain text", async () => {
      const xml = await documentXml(bare([{ ref: "", name: "Sistema de turnos", description: "Agenda para una clínica.", url: "" }]));
      expect(plainText(xml)).toContain("Sistema de turnos: Agenda para una clínica.");
      expect(xml).not.toContain("<w:hyperlink");
    });

    it("prints a project with a link and no description as its name and link, with no description between them", async () => {
      const data = bare([{ ref: "", name: "Sitio de la cooperativa", description: "", url: "https://coop.example.com" }]);
      const xml = await documentXml(data);
      expect(plainText(xml)).toContain("PROYECTOSSitio de la cooperativa: coop.example.com");
      expect(await relationships(data)).toContain('Target="https://coop.example.com"');
    });
  });

  it("keeps the coverage panel out of the file", async () => {
    const withCoverage: CVDocument = {
      ...templateCV,
      coverage: {
        requirements: [
          {
            requirement: "PISTA-REQUISITO-QUE-NO-DEBE-IMPRIMIRSE",
            covered: true,
            evidence: "PISTA-EVIDENCIA-QUE-NO-DEBE-IMPRIMIRSE",
            inferred: false,
          },
        ],
        omitted: [
          { item: "PISTA-OMITIDO", reason: "PISTA-RAZON-QUE-NO-DEBE-IMPRIMIRSE" },
        ],
      },
    };

    const xml = await documentXml(withCoverage);
    expect(xml).not.toContain("PISTA-");
  });

  it("uses the A4 geometry and margins of cv-document.css", async () => {
    const xml = await documentXml(templateCV);

    // 595.28pt × 841.89pt and the 28.4pt / 14.2pt padding, in twips.
    expect(xml).toContain('w:w="11906"');
    expect(xml).toContain('w:h="16838"');
    expect(xml).toMatch(/w:left="568"/);
    expect(xml).toMatch(/w:right="568"/);
    expect(xml).toMatch(/w:top="568"/);
    expect(xml).toMatch(/w:bottom="284"/);
  });

  it("puts the right-hand column on a right tab stop at the content width", async () => {
    const xml = await documentXml(templateCV);

    // 538.48pt of content width; Word has no flexbox, so this is what keeps
    // location and dates flush right.
    expect(xml).toContain('w:val="right" w:pos="10770"');
    expect(xml).toContain("<w:tab/>");
  });

  /**
   * A .docx of this CV, opened in Google Docs and exported back to HTML, came
   * out with the location and date separated from the company by runs of
   * non-breaking spaces instead of sitting flush right — which reads exactly
   * like a lost tab stop.
   *
   * It is not one: Google Docs' own exporter renders a tab as `&nbsp;` runs, and
   * the round trip is what produced them. These pin the two things that would be
   * true if the fault were ours, so the next time the symptom appears it can be
   * attributed in one run rather than argued about.
   */
  describe("the two-column entry header", () => {
    it("carries the tab stop on the same paragraph as the tab", async () => {
      const xml = await documentXml(templateCV);

      const paragraphs = [...xml.matchAll(/<w:p>[\s\S]*?<\/w:p>/g)].map((m) => m[0]);
      const withTab = paragraphs.filter((p) => p.includes("<w:tab/>"));
      expect(withTab.length).toBeGreaterThan(0);

      for (const paragraph of withTab) {
        // A tab with no stop defined on its own paragraph falls back to Word's
        // default half-inch grid, which is what "not flush right" looks like.
        expect(paragraph).toContain('w:val="right" w:pos="10770"');
        // Exactly one: two tabs on one line would push the right column past
        // the stop and wrap it.
        expect(paragraph.match(/<w:tab\/>/g)).toHaveLength(1);
      }
    });

    it("never aligns anything with hard spaces", async () => {
      const xml = await documentXml(templateCV);

      // The symptom itself. If this ever fires, the fault is ours after all.
      expect(xml).not.toContain(" ");
      expect(xml).not.toContain("&#160;");
      expect(xml).not.toMatch(/<w:t(?: [^>]*)?>[^<]*\s{3,}[^<]*<\/w:t>/);
    });
  });

  it("renders bullets as a real Word list", async () => {
    const buffer = await Packer.toBuffer(buildCVDocument(templateCV));
    const zip = await JSZip.loadAsync(buffer);
    const numbering = await zip.file("word/numbering.xml")?.async("string");

    expect(numbering).toContain('w:val="bullet"');
    expect(numbering).toContain("●");
    // .cv-bullets li: margin-left 32.2pt with a 17.9pt hanging marker.
    expect(numbering).toContain('w:left="644"');
    expect(numbering).toContain('w:hanging="358"');
  });

  it("omits the elements an empty field stands for", async () => {
    const bare = cvDocumentSchema.parse({
      language: "es",
      header: { fullName: "Ana Ñuñez Pérez", location: "Córdoba, Argentina" },
      summary: "",
      sections: [
        {
          kind: "experience",
          title: "EXPERIENCIA",
          items: [
            { company: "Acme", role: "", location: "", dateRange: "", bullets: [] },
          ],
        },
        {
          kind: "education",
          title: "EDUCACIÓN",
          items: [
            { institution: "UNC", degree: "", location: "", date: "", honors: "" },
          ],
        },
      ],
      coverage: { requirements: [], omitted: [] },
    });

    const xml = await documentXml(bare);
    const text = plainText(xml);

    expect(text).toContain("Ana Ñuñez Pérez");
    expect(text).toContain("Acme");
    expect(text).toContain("UNC");
    // No honors line, and no summary paragraph, when the data says to omit them.
    expect(text).not.toContain("Honores:");
    // A blank phone/email must not leave the " • " separator behind.
    expect(text).not.toContain("• ");
  });

  /**
   * The honors label is the one word this renderer writes that the model did
   * not. A CV in English that says "Honores:" is the bug; these two pin both
   * halves of the fix — that the model's label is used, and that a CV saved
   * before the field existed still gets the Spanish one.
   */
  it("prints the honors label the CV carries, not a hardcoded Spanish one", async () => {
    const english = cvDocumentSchema.parse({
      ...templateCV,
      language: "en",
      labels: { honors: "Honors" },
      sections: [
        {
          kind: "education",
          title: "EDUCATION",
          items: [
            {
              institution: "UOC",
              degree: "Computer Engineering",
              location: "Barcelona, Spain",
              date: "May 2007",
              honors: "Distinction in Programming",
            },
          ],
        },
      ],
    });

    const text = plainText(await documentXml(english));

    expect(text).toContain("Honors: ");
    expect(text).not.toContain("Honores");
  });

  it("falls back to Spanish for a CV stored before labels existed", async () => {
    // Not parsed through the schema on purpose: this is what comes back from
    // localStorage, where the schema's default never ran.
    const legacy = { ...templateCV, labels: undefined } as unknown as CVDocument;

    expect(plainText(await documentXml(legacy))).toContain("Honores: ");
  });
});
