import { describe, expect, it } from "vitest";
import { parseDocument } from "@/lib/parse";
import { layout, LINKEDIN_ES, SIZE, type Spec } from "./fixtures/linkedin-layout";
import { ENGLISH_STACKED, SPANISH_BULLETS } from "./fixtures/cv-samples";

/**
 * Which reader a document gets. The readers are tested on their own; what is
 * pinned here is that the right one is chosen, and that a wrong choice falls
 * back rather than failing.
 */

describe("parseDocument", () => {
  it("reads a PDF that says it is LinkedIn's with the LinkedIn reader", () => {
    const doc = parseDocument({ text: "", runs: layout(LINKEDIN_ES), info: { author: "LinkedIn" } });
    expect(doc.kind).toBe("linkedin_pdf");
    expect(doc.experience.map((e) => e.company?.value)).toEqual(["Nubia Retail", "Grupo Lumen"]);
    expect(doc.experience[0]!.confidence).toBe("high");
  });

  it("recognises one with no metadata by its shape", () => {
    const doc = parseDocument({ text: "", runs: layout(LINKEDIN_ES) });
    expect(doc.kind).toBe("linkedin_pdf");
  });

  it("falls back to the general reader, still calling it LinkedIn's, when the template is not there", () => {
    // Says it is LinkedIn's, but every line is the same size: no name, no headings.
    // The file's origin does not change because the reader that knows the template
    // could not use it; "De LinkedIn" is still true, and what it read is low.
    const flat: Spec[] = Array.from({ length: 14 }, (_, i) => ({ col: "main", text: `Línea ${i}`, size: SIZE.body }));
    const doc = parseDocument({ text: "", runs: layout(flat), info: { author: "LinkedIn" } });
    expect(doc.kind).toBe("linkedin_pdf");
    expect(doc.confidence).toBe("low");
  });

  it("keeps the main column whole, ahead of the sidebar, when the template's own reader still cannot use it", () => {
    // Everything the same, unremarkable size: no "name" class for
    // `parseLinkedInPdf`'s own reader to find in `main`, so it gives up —
    // but the file still says it is LinkedIn's, so this should read the main
    // column's job as one block rather than trust `readingOrder`'s own
    // column guess, which was never measured against this template's sidebar.
    const runs = [
      { str: "Ana Gómez", page: 1, x: 200, y: 800, width: 90, size: 11 },
      { str: "Experiencia", page: 1, x: 200, y: 780, width: 90, size: 11 },
      { str: "Nubia Retail", page: 1, x: 200, y: 760, width: 90, size: 11 },
      { str: "Analista de datos", page: 1, x: 200, y: 740, width: 120, size: 11 },
      { str: "2021 - 2023", page: 1, x: 200, y: 720, width: 90, size: 11 },
      { str: "Armé los tableros de ventas.", page: 1, x: 200, y: 700, width: 200, size: 11 },
      { str: "Contacto", page: 1, x: 30, y: 800, width: 90, size: 11 },
      { str: "ana@example.com", page: 1, x: 30, y: 780, width: 90, size: 11 },
      { str: "Aptitudes principales", page: 1, x: 30, y: 760, width: 130, size: 11 },
      { str: "SQL", page: 1, x: 30, y: 740, width: 40, size: 11 },
    ];
    const doc = parseDocument({ text: "", runs, info: { author: "LinkedIn" } });
    expect(doc.kind).toBe("linkedin_pdf");
    expect(doc.experience[0]).toMatchObject({ company: { value: "Nubia Retail" }, role: { value: "Analista de datos" } });
    expect(doc.contact.email?.value).toBe("ana@example.com");
  });

  it("reads plain text with the general reader", () => {
    const doc = parseDocument({ text: SPANISH_BULLETS });
    expect(doc.kind).toBe("cv");
    expect(doc.experience).toHaveLength(2);
    expect(parseDocument({ text: ENGLISH_STACKED }).experience).toHaveLength(2);
  });

  it("puts a two-column PDF back in reading order before reading it", () => {
    const runs = [
      { str: "ANA GÓMEZ ANALISTA DE DATOS", page: 1, x: 30, y: 800, width: 400, size: 20 },
      ...["Contacto", "ana@example.com", "Rosario, Argentina", "Habilidades", "SQL, Python, Excel", "Idiomas", "Inglés: B2", "Español: Nativo"].map((str, i) => ({
        str,
        page: 1,
        x: 30,
        y: 760 - i * 20,
        width: 110,
        size: 10,
      })),
      ...["EXPERIENCIA", "Nubia Retail", "Analista de datos", "2021 - 2023", "Armé los tableros de ventas.", "EDUCACIÓN", "UBA", "Licenciatura en Estadística", "2015 - 2019"].map((str, i) => ({
        str,
        page: 1,
        x: 200,
        y: 760 - i * 20,
        width: 150,
        size: 10,
      })),
    ];
    const doc = parseDocument({ text: "", runs });
    expect(doc.experience).toHaveLength(1);
    expect(doc.experience[0]).toMatchObject({
      company: { value: "Nubia Retail" },
      role: { value: "Analista de datos" },
    });
    expect(doc.contact.email?.value).toBe("ana@example.com");
    expect(doc.languages.map((l) => l.name.value)).toEqual(["Inglés", "Español"]);
  });

  it("is deterministic", () => {
    expect(parseDocument({ text: SPANISH_BULLETS })).toEqual(parseDocument({ text: SPANISH_BULLETS }));
  });
});
