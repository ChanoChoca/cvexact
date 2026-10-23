import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_BYTES, MAX_TEXT_BYTES, MAX_ZIP_BYTES, isCopyFile, isPhoto, kindOfFile, refusalFor } from "@/lib/import/formats";
import { IMPORT_TEXT_MAX, IMPORT_TEXT_MIN, importTextProblem } from "@/lib/ai/import-limits";
import { UnreadableFileError, readDocument } from "@/lib/import/extract";

/**
 * A file that is refused is a person told no, and "no" is worth a sentence of its own: one message for every format
 * sent someone with a Pages file and someone with a photo of their CV to the same line. Each of these says what the file
 * is and the few clicks it takes to get out of it.
 */

const file = (name: string, type = "", size = 1000) => ({ name, type, size });

describe("which files are read", () => {
  it("knows a PDF, a Word, a text and a LinkedIn archive, by type or by name", () => {
    expect(kindOfFile(file("cv.pdf", "application/pdf"))).toBe("pdf");
    expect(kindOfFile(file("cv.PDF"))).toBe("pdf");
    expect(kindOfFile(file("cv.docx"))).toBe("docx");
    expect(kindOfFile(file("notas.txt", "text/plain"))).toBe("txt");
    expect(kindOfFile(file("notas.txt", "application/octet-stream"))).toBe("txt");
    expect(kindOfFile(file("datos.zip", "application/x-zip-compressed"))).toBe("zip");
  });

  it("does not know the rest", () => {
    for (const name of ["cv.doc", "cv.odt", "cv.rtf", "cv.pages", "cv.jpg", "cv", "cv.pdf.exe"]) expect(kindOfFile(file(name)), name).toBeNull();
  });

  it("sees a photo by its type or its name", () => {
    expect(isPhoto(file("IMG_0042.HEIC"))).toBe(true);
    expect(isPhoto(file("captura", "image/png"))).toBe(true);
    expect(isPhoto(file("cv.pdf", "application/pdf"))).toBe(false);
  });
});

describe("which files are a copy to recover, and not a CV to read (U34)", () => {
  it("sees a copy by its type or its name: a phone often gives a .json no type at all", () => {
    expect(isCopyFile(file("cvexact-perfil-2026-10-10.json"))).toBe(true);
    expect(isCopyFile(file("cvexact-copia-completa-2026-10-10.JSON"))).toBe(true);
    expect(isCopyFile(file("copia", "application/json"))).toBe(true);
    expect(isCopyFile(file("cvexact-perfil-protegido-2026-10-10.json", "application/octet-stream"))).toBe(true);
  });

  it("does not take a CV, a text or an archive for one", () => {
    for (const [name, type] of [["cv.pdf", "application/pdf"], ["cv.docx", ""], ["notas.txt", "text/plain"], ["datos.zip", "application/zip"], ["json", ""], ["cv.json.pdf", ""]] as const) {
      expect(isCopyFile(file(name, type)), name).toBe(false);
    }
  });

  it("is not read as a CV, so the person is not told no for the file that gets their profile back", () => {
    expect(kindOfFile(file("cvexact-perfil-2026-10-10.json", "application/json"))).toBeNull();
  });
});

describe("what is said about a file that cannot be read", () => {
  it("says what each common format is, and how to get out of it", () => {
    const cases: Array<[string, RegExp]> = [
      ["cv.doc", /Word antiguo \(\.doc\).*guardalo como PDF o como \.docx/],
      ["cv.odt", /OpenOffice o LibreOffice \(\.odt\).*guardalo como PDF o como \.docx/],
      ["cv.rtf", /texto enriquecido \(\.rtf\).*guardalo como PDF o como \.docx/],
      ["cv.pages", /Pages.*Exportar a → PDF/],
      ["cv.gdoc", /Google Docs.*Descargar/],
    ];
    for (const [name, pattern] of cases) {
      const refusal = refusalFor(file(name));
      expect(refusal?.reason, name).toBe("unsupported");
      expect(refusal?.message, name).toMatch(pattern);
      // Always a way on that does not need the file: the text can be pasted.
      expect(refusal?.message, name).toMatch(/pegá el texto/i);
    }
  });

  it("says a JSON is not a CV, and where a copy of the profile is brought back (e5, O1)", () => {
    const refusal = refusalFor(file("cvexact-perfil-2026-10-06.json"));
    expect(refusal?.reason).toBe("unsupported");
    expect(refusal?.message).toMatch(/no es un CV/);
    // One name for bringing a copy back at the start and in the profile, and «Introducir perfil» in Ajustes (e5 UX, U32).
    expect(refusal?.message).toMatch(/«Recuperar una copia», al empezar/);
    expect(refusal?.message).toMatch(/en tu perfil o con «Introducir perfil», en Ajustes/);
    expect(refusal?.message).not.toMatch(/Importar|Recuperala/);
  });

  it("says what is not known by name, and what is read", () => {
    const refusal = refusalFor(file("cv.xyz"));
    expect(refusal?.reason).toBe("unsupported");
    expect(refusal?.message).toMatch(/Leemos PDF, Word \(\.docx\), texto \(\.txt\) y el ZIP de datos de LinkedIn/);
  });

  it("answers a photo as a photo: it has no letters to read, and the text can be copied from it", () => {
    for (const name of ["IMG_0042.jpg", "captura.PNG", "foto.heic"]) {
      const refusal = refusalFor(file(name));
      expect(refusal?.reason, name).toBe("photo");
      expect(refusal?.message, name).toMatch(/una foto no tiene letras/);
      expect(refusal?.message, name).toMatch(/copiar el texto de una foto/);
      expect(refusal?.message, name).toMatch(/pegalo acá/i);
    }
  });

  it("reads what it can, whatever its size is, up to a limit", () => {
    expect(refusalFor(file("cv.pdf", "application/pdf", MAX_DOCUMENT_BYTES))).toBeNull();
    expect(refusalFor(file("datos.zip", "application/zip", MAX_ZIP_BYTES))).toBeNull();
    expect(refusalFor(file("notas.txt", "text/plain", MAX_TEXT_BYTES))).toBeNull();
  });

  it("says a file is too big, by how much it weighs and what the limit is", () => {
    const pdf = refusalFor(file("cv.pdf", "application/pdf", 32 * 1024 * 1024));
    expect(pdf?.reason).toBe("too_large");
    expect(pdf?.message).toMatch(/pesa 32 MB y el máximo que leemos en tu navegador es 15 MB/);
    expect(pdf?.message).toMatch(/menos de 1 MB/);
    const zip = refusalFor(file("datos.zip", "application/zip", 400 * 1024 * 1024));
    expect(zip?.message).toMatch(/pesa 400 MB.*100 MB/);
    expect(zip?.message).toMatch(/solo los datos del perfil/);
    const text = refusalFor(file("notas.txt", "text/plain", 3 * 1024 * 1024));
    expect(text?.message).toMatch(/pesa 3,0 MB.*2,0 MB/);
  });
});

describe("reading a file", () => {
  it("throws what the refusal says, with its reason, before reading a byte", async () => {
    const photo = new File([new Uint8Array(10)], "foto.jpg", { type: "image/jpeg" });
    await expect(readDocument(photo)).rejects.toMatchObject({ reason: "photo" });
    await expect(readDocument(photo)).rejects.toBeInstanceOf(UnreadableFileError);
    const huge = new File([new Uint8Array(1)], "cv.pdf", { type: "application/pdf" });
    Object.defineProperty(huge, "size", { value: 50 * 1024 * 1024 });
    await expect(readDocument(huge)).rejects.toMatchObject({ reason: "too_large" });
  });

  it("reads a text file as the text it is", async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `Trabajé en la empresa número ${i + 1} como analista de datos durante un año.`).join("\n");
    const doc = await readDocument(new File([lines], "mi-cv.txt", { type: "text/plain" }));
    expect(doc.kind).toBe("txt");
    expect(doc.kind === "txt" && doc.text).toContain("empresa número 12");
    expect(doc.fileHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads a text file saved the old way: the accents are accents, not «�»", async () => {
    // "Administración, Córdoba, años" in Windows-1252: one byte per letter, which is not valid UTF-8.
    const latin1 = (text: string) => Uint8Array.from([...text].map((char) => char.charCodeAt(0)));
    const body = "Administración y Córdoba, años de experiencia en gestión. ".repeat(6);
    const doc = await readDocument(new File([latin1(body)], "cv.txt", { type: "text/plain" }));
    expect(doc.kind === "txt" && doc.text).toContain("Administración y Córdoba, años de experiencia en gestión.");
    expect(doc.kind === "txt" && doc.text).not.toContain("�");
  });

  it("says a text file with next to nothing in it is not a CV", async () => {
    await expect(readDocument(new File(["Hola"], "nota.txt", { type: "text/plain" }))).rejects.toMatchObject({ reason: "empty", message: expect.stringMatching(/muy poco/) });
  });
});

describe("how much text a reading takes", () => {
  it("says a text is too short or too long in different words, because the way out is the opposite", () => {
    expect(importTextProblem("x".repeat(IMPORT_TEXT_MIN))).toBeNull();
    expect(importTextProblem("x".repeat(IMPORT_TEXT_MAX))).toBeNull();
    expect(importTextProblem("x".repeat(IMPORT_TEXT_MIN - 1))).toMatch(/muy corto/);
    const long = importTextProblem("x".repeat(IMPORT_TEXT_MAX + 1));
    expect(long).toMatch(/más texto del que la IA puede leer de una vez/);
    expect(long).toMatch(/40\.000/);
    expect(long).toMatch(/Pegá solo la parte con tu experiencia y tus estudios/);
  });
});
