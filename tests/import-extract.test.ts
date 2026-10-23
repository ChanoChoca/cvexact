import { describe, expect, it } from "vitest";
import { Packer } from "docx";
import { UnreadableFileError, extractText } from "@/lib/import/extract";
import { buildCVDocument } from "@/lib/docx/cv-docx";
import { templateCV } from "@/lib/fixtures/template-cv";

/**
 * Reading a CV file, against a real one.
 *
 * The .docx is built with this app's own renderer, so the fixture is a genuine
 * Word file rather than a hand-written approximation of one — the failure this
 * guards against is a parser that returns something plausible and empty, and
 * only a real file can catch it.
 *
 * The PDF branch is not covered here: pdf.js wants a DOM and a worker, and
 * standing both up under node would be testing the harness rather than the
 * code. It is checked by hand, in a browser, against a real CV.
 */

async function docxFile(name = "cv.docx"): Promise<File> {
  const buffer = await Packer.toBuffer(buildCVDocument(templateCV));
  return new File([new Uint8Array(buffer)], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

describe("extraer el texto de un CV", () => {
  it("saca de un .docx real todo lo que el prompt necesita leer", async () => {
    const text = await extractText(await docxFile());

    expect(text).toContain("Lucía Ferrer Molina");
    expect(text).toContain("lucia.ferrer.molina@example.com");
    expect(text).toContain("Nube Ámbar");
    expect(text).toContain("Lead FrontEnd Architect");
    expect(text).toContain("Marzo 2018 – Octubre 2023");
    expect(text).toContain("EXPERIENCIA PROFESIONAL");
    expect(text).toContain("EDUCACIÓN");
    // A bullet, whole: if the paragraph handling were wrong this is what breaks.
    expect(text).toMatch(/Coordiné el frontend de tres productos|Implementé un flujo de integración/);
  });

  it("no deja tabulaciones ni corridas de espacios del layout", async () => {
    const text = await extractText(await docxFile());
    // The right-hand column is a tab stop in the .docx; left raw it reaches the
    // model as whitespace it has to interpret as structure.
    expect(text).not.toMatch(/\t/);
    expect(text).not.toMatch(/ {2}/);
    expect(text).not.toMatch(/\n{3}/);
  });

  it("acepta el archivo por extensión cuando el navegador no lo nombra", async () => {
    const buffer = await Packer.toBuffer(buildCVDocument(templateCV));
    const octet = new File([new Uint8Array(buffer)], "mi-cv.docx", {
      type: "application/octet-stream",
    });
    await expect(extractText(octet)).resolves.toContain("Nube Ámbar");
  });

  it("rechaza un formato que no sabemos leer, diciendo qué es y qué hacer", async () => {
    const file = new File(["hola"], "cv.pages", { type: "application/x-iwork-pages-sffpages" });
    await expect(extractText(file)).rejects.toBeInstanceOf(UnreadableFileError);
    // Qué es, cómo sacarlo de ahí, y que el texto se puede pegar: el detalle de cada formato está en `import-formats.test.ts`.
    await expect(extractText(file)).rejects.toThrow(/Pages.*Exportar a → PDF.*pegá el texto/);
  });

  it("trata un archivo casi vacío como ilegible en vez de mandarlo al modelo", async () => {
    const empty = new File([new Uint8Array(await Packer.toBuffer(buildCVDocument({
      ...templateCV,
      header: { ...templateCV.header, fullName: "Ana" },
      summary: "",
      sections: [],
    })))], "vacio.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await expect(extractText(empty)).rejects.toBeInstanceOf(UnreadableFileError);
  });
});
