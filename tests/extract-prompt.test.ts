import { describe, expect, it } from "vitest";
import { EXTRACT_SYSTEM, buildExtractPrompt, extractionSchema } from "@/lib/ai/prompts/extract";

/**
 * The extractor's failure mode is the same one every reader of a CV has: a
 * model told to "read this" will happily improve on it. What stops that, and
 * what makes every claim it does make checkable afterwards, is in the prompt.
 */

const says = (phrase: string) => new RegExp(phrase.trim().replace(/\s+/g, "\\s+"), "i");

describe("el sistema del extractor", () => {
  it("le prohíbe inventar y le pide transcribir, no completar", () => {
    expect(EXTRACT_SYSTEM).toMatch(/FACTUAL INTEGRITY/);
    expect(EXTRACT_SYSTEM).toMatch(says("Never invent an employer"));
    expect(EXTRACT_SYSTEM).toMatch(says("not writing, completing, or\\s+improving anything"));
  });

  it("le prohíbe deducir un mes, un nivel o una habilidad a partir del cargo", () => {
    expect(EXTRACT_SYSTEM).toMatch(says("Never infer a month, an end date, a language level"));
  });

  it("exige una cita literal por campo, y dice que se va a verificar", () => {
    expect(EXTRACT_SYSTEM).toMatch(says('Every non-null field has a "quote"'));
    expect(EXTRACT_SYSTEM).toMatch(says("checked against the document's own text"));
    expect(EXTRACT_SYSTEM).toMatch(says("discarded before it ever reaches the profile"));
  });

  it("prohíbe convertir una fecha o inventar un mes a partir de un año suelto", () => {
    expect(EXTRACT_SYSTEM).toMatch(says('do not convert "marzo de 2021" to "2021-03"'));
  });

  it("manda lo que no tiene campo propio a «unassigned» en vez de perderlo o forzarlo", () => {
    expect(EXTRACT_SYSTEM).toMatch(/unassigned/);
    expect(EXTRACT_SYSTEM).toMatch(says("rather than being dropped or forced into a field"));
  });

  it("excluye explícitamente los datos personales que el esquema no pide", () => {
    expect(EXTRACT_SYSTEM).toMatch(says("birth date, national ID, marital status"));
    expect(EXTRACT_SYSTEM).toMatch(says("do not even put it in \\\"unassigned\\\""));
  });
});

describe("el esquema del extractor", () => {
  it("no exige ningún campo: un documento vacío es una respuesta válida", () => {
    const parsed = extractionSchema.safeParse({});
    expect(parsed.success).toBe(true);
  });

  it("cada campo es null o {value, quote}, nunca un valor suelto", () => {
    const parsed = extractionSchema.parse({
      contact: { fullName: { value: "Lucía", quote: "Lucía" }, headline: null, email: null, phone: null, city: null, country: null },
      experience: [
        {
          kind: "job",
          company: { value: "Nubia Retail", quote: "Nubia Retail" },
          role: null,
          city: null,
          country: null,
          start: null,
          end: null,
          facts: [],
        },
      ],
    });
    expect(parsed.contact.fullName).toEqual({ value: "Lucía", quote: "Lucía" });
    expect(parsed.experience[0]!.role).toBeNull();
  });

  it("degrada un tipo de empleo desconocido en vez de rechazar todo el documento", () => {
    const parsed = extractionSchema.parse({
      experience: [{ kind: "manager", company: null, role: null, city: null, country: null, start: null, end: null, facts: [] }],
    });
    expect(parsed.experience[0]!.kind).toBe("job");
  });

  it("no exige el bloque de contacto: un documento sin datos de contacto también parsea", () => {
    const parsed = extractionSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.contact.fullName).toBeNull();
  });
});

describe("el prompt del extractor", () => {
  it("lleva el texto del documento entero, verbatim", () => {
    const text = "Nubia Retail | Analista de Marketing | marzo 2021 – actualidad";
    expect(buildExtractPrompt(text, "cv")).toContain(text);
  });

  it("dice si el texto es un CV o un párrafo libre, porque cambia qué tan estructurado esperar", () => {
    expect(buildExtractPrompt("x", "cv")).toMatch(/CV file/);
    expect(buildExtractPrompt("x", "dump")).toMatch(says("wrote freely about their own career"));
  });
});
