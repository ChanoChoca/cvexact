import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Extraction } from "@/lib/ai/prompts/extract";
import { REDACTED, isPersonalData, redactLines, redactPersonalData } from "@/lib/parse/redact";

/**
 * M60: what the product promises not to read does not go to a model and is not kept in the copy of the document.
 */

const CV = `Carlos Méndez
Fecha de nacimiento: 12/05/1990
DNI: 30.123.456
Estado civil: Soltero
carlos@example.com | +54 11 4555 0100

EXPERIENCIA
Banco Galicia
Ejecutivo de cuentas
2018 - 2022
Atención de cartera de 120 clientes.

REFERENCIAS
María Pérez - +54 11 5555 0000

Jorge Sosa - jsosa@example.com

IDIOMAS
Inglés - B2`;

describe("redactPersonalData", () => {
  it("strikes out the details and the references, and nothing else", () => {
    const { text } = redactPersonalData(CV);
    for (const secret of ["12/05/1990", "30.123.456", "Soltero", "María Pérez", "jsosa@example.com", "5555 0000"]) {
      expect(text).not.toContain(secret);
    }
    for (const kept of ["Carlos Méndez", "carlos@example.com", "Banco Galicia", "Ejecutivo de cuentas", "2018 - 2022", "120 clientes", "Inglés - B2"]) {
      expect(text).toContain(kept);
    }
  });

  it("does not move a line: the same count, a blank line still blank, the headings where they were", () => {
    const original = CV.split("\n");
    const lines = redactPersonalData(CV).text.split("\n");
    expect(lines).toHaveLength(original.length);
    original.forEach((line, at) => {
      if (line.trim() === "" || /^(EXPERIENCIA|REFERENCIAS|IDIOMAS)$/.test(line)) expect(lines[at]).toBe(line);
    });
  });

  it("counts each detail once and a whole references section once", () => {
    // birth date, document, marital status — and the references, two entries and a blank line between them, as one.
    expect(redactPersonalData(CV).omitted).toBe(4);
  });

  it("is the identity on a text that has none, and says so", () => {
    const clean = "Ana Ruiz\n\nEXPERIENCIA\nCafé Martínez\nBarista\n2020 - 2023";
    expect(redactPersonalData(clean)).toEqual({ text: clean, omitted: 0 });
  });

  it("takes the value under a label that stands alone, as a table lays them out", () => {
    const table = ["Ana Ruiz", "Fecha de nacimiento", "03/11/1992", "Estado civil:", "Casada", "", "EXPERIENCIA", "Café Martínez"].join("\n");
    const { text, omitted } = redactPersonalData(table);
    expect(text).not.toContain("03/11/1992");
    expect(text).not.toContain("Casada");
    expect(text).toContain("Café Martínez");
    expect(omitted).toBe(4);
  });

  it("does not take a heading, or a line long enough to be a sentence, for a label's value", () => {
    const heading = redactPersonalData("Edad\nEXPERIENCIA\nCafé Martínez").text;
    expect(heading.split("\n")).toEqual([REDACTED, "EXPERIENCIA", "Café Martínez"]);
    const sentence = `Edad\n${"Trabajé en un café de barrio durante varios años y aprendí a atender. ".repeat(2)}`;
    expect(redactPersonalData(sentence).text.split("\n")[1]).toContain("Trabajé en un café");
  });

  it("does not guess at a date or a number that comes with no label", () => {
    const unlabelled = "Nací el 12/05/1990\n30.123.456\nCertificado emitido el 03/04/2021";
    expect(redactPersonalData(unlabelled)).toEqual({ text: unlabelled, omitted: 0 });
  });

  it("leaves a role, an area or a course whose name starts like a label", () => {
    const names = ["Dirección de Obra", "Dirección Comercial", "Género y desarrollo (curso)", "Documentación técnica"];
    expect(redactPersonalData(names.join("\n"))).toEqual({ text: names.join("\n"), omitted: 0 });
    expect(isPersonalData("Dirección: Av. Corrientes 1234, CABA")).toBe(true);
    expect(isPersonalData("Dirección - Av. Corrientes 1234")).toBe(true);
    expect(isPersonalData("Género: femenino")).toBe(true);
    expect(isPersonalData("Domicilio Av. Corrientes 1234")).toBe(true);
    // The template that drops the colon: a street is what follows, and a department is not.
    expect(isPersonalData("Dirección Av. Corrientes 1234, CABA")).toBe(true);
    expect(isPersonalData("Dirección Calle 12 entre 3 y 4")).toBe(true);
    expect(isPersonalData("Dirección Avanzada de Proyectos")).toBe(false);
    expect(isPersonalData("Dirección de obra 2018 – 2020")).toBe(false);
  });

  it("strikes out the health data a driving licence carries, and not what only starts like it (e5, O7)", () => {
    // Ley 24.449: a licence says the blood group and factor and, if asked, whether the holder donates organs.
    for (const line of ["Grupo sanguíneo: 0+", "Grupo y factor: A RH+", "Factor RH: negativo", "Tipo de sangre: B+", "Donante: Sí", "Donante de órganos: sí", "Blood type: AB-"]) {
      expect(isPersonalData(line), line).toBe(true);
    }
    // A licence copied whole into a CV keeps its class and its date, which is what a posting asks for.
    const licence = ["Licencia de conducir: B1", "Vence: 03/2028", "Grupo sanguíneo: 0+", "Donante: Sí"].join("\n");
    const { text, omitted } = redactPersonalData(licence);
    expect(text.split("\n")).toEqual(["Licencia de conducir: B1", "Vence: 03/2028", REDACTED, REDACTED]);
    expect(omitted).toBe(2);
    // Something someone did, or a company, is not a label.
    for (const line of ["Donante voluntario en el Hospital Garrahan", "Grupo Lumen", "Grupo de trabajo de seguridad", "Factor humano en la atención"]) {
      expect(isPersonalData(line), line).toBe(false);
    }
  });

  it("finds the label in any of the parts a separator cuts a line into", () => {
    expect(redactPersonalData("Buenos Aires | Edad: 34 | Disponible").text).toBe(REDACTED);
  });

  it("is the same function over the lines the pattern reader keeps", () => {
    const lines = [
      { text: "Carlos Méndez", index: 0 },
      { text: "DNI: 30.123.456", index: 1 },
      { text: "María Pérez", index: 2 },
    ];
    expect(redactLines(lines, new Set([2]))).toEqual(["Carlos Méndez", REDACTED, REDACTED]);
  });
});

// --- what is sent ------------------------------------------------------------------------------------------------------

const generate = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock("@/lib/api/client", () => ({
  ApiError: class ApiError extends Error {
    reason?: string;
  },
  callGenerator: generate,
}));
vi.mock("@/lib/onboarding/stores", () => ({
  ensureOnboardingStoresHydrated: async () => {},
  readCollection: (name: string) => store.get(name) ?? {},
  writeCollection: (name: string, value: Record<string, unknown>) => void store.set(name, value),
}));

const extraction = (quote: string): Extraction =>
  ({
    contact: { fullName: { value: "Carlos Méndez", quote }, links: [] },
    experience: [],
    education: [],
    certifications: [],
    languages: [],
    skills: [],
    projects: [],
    unassigned: [],
  }) as unknown as Extraction;

describe("extractWithAi", () => {
  beforeEach(() => {
    generate.mockReset();
    store.clear();
    generate.mockResolvedValue(extraction("Carlos Méndez"));
  });

  it("sends the model the text without the details, and keeps that as the copy of the document", async () => {
    const { extractWithAi } = await import("@/lib/onboarding/ai");
    const outcome = await extractWithAi(CV, "cv");
    expect(generate).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify(generate.mock.calls[0]);
    for (const secret of ["12/05/1990", "30.123.456", "Soltero", "María Pérez", "jsosa@example.com"]) expect(sent).not.toContain(secret);
    expect(sent).toContain("Banco Galicia");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.lines).toHaveLength(CV.split("\n").length);
    expect(outcome.result.lines!.join("\n")).not.toContain("30.123.456");
    expect(outcome.result.omittedPersonalData).toBe(4);
  });

  it("asks once for two texts that differ only in what was struck out, and counts the same", async () => {
    const { extractWithAi } = await import("@/lib/onboarding/ai");
    await extractWithAi(CV, "cv");
    const again = await extractWithAi(CV.replace("30.123.456", "27.999.111"), "cv");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(again.ok && again.fromCache).toBe(true);
    expect(again.ok && again.result.omittedPersonalData).toBe(4);
  });

  it("does not make a card of the mark in a story with a detail in it: it is not something nobody read", async () => {
    generate.mockResolvedValue({ ...extraction("Carlos Méndez"), unassigned: [] });
    const { extractWithAi } = await import("@/lib/onboarding/ai");
    const story = "Trabajé varios años en un café del centro atendiendo la barra y organizando los turnos del equipo.\nEstado civil: casado\nDespués pasé a una panadería donde me ocupé de las compras y de los proveedores durante dos años.";
    const outcome = await extractWithAi(story, "dump");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.unassigned.map((item) => item.text).join(" ")).not.toMatch(/dato personal omitido|▒/);
    expect(outcome.result.omittedPersonalData).toBe(1);
  });

  it("does not take the mark that stands where a detail was for something the model read", async () => {
    generate.mockResolvedValue({ ...extraction("Carlos Méndez"), unassigned: [{ text: REDACTED, kind: "other" }, { text: "dato personal omitido", kind: "other" }] });
    const { extractWithAi } = await import("@/lib/onboarding/ai");
    const outcome = await extractWithAi(CV, "cv");
    expect(outcome.ok && outcome.result.unassigned).toEqual([]);
  });

  it("does not check a model's quote against a detail it was never sent", async () => {
    generate.mockResolvedValue({ ...extraction("Carlos Méndez"), skills: [{ value: "30.123.456", quote: "DNI: 30.123.456" }] });
    const { extractWithAi } = await import("@/lib/onboarding/ai");
    const outcome = await extractWithAi(CV, "cv");
    expect(outcome.ok && outcome.result.skills).toEqual([]);
  });
});

describe("splitWithAi", () => {
  const answer = "Llevo las campañas de Google Ads y Meta.\nEdad: 34\nPreparo los informes mensuales.";

  beforeEach(() => {
    generate.mockReset();
    store.clear();
  });

  it("sends the answer without the details, and does not turn the mark into a fact", async () => {
    generate.mockResolvedValue({ pieces: ["Llevo las campañas de Google Ads y Meta.", REDACTED, "Preparo los informes mensuales."] });
    const { splitWithAi } = await import("@/lib/onboarding/ai");
    const outcome = await splitWithAi(answer);
    expect(JSON.stringify(generate.mock.calls[0])).not.toContain("Edad");
    expect(outcome.ok && outcome.result).toEqual(["Llevo las campañas de Google Ads y Meta.", "Preparo los informes mensuales."]);
  });

  it("is checked for what it left out against what was sent, not against what was struck out", async () => {
    const { splitCovers } = await import("@/lib/parse/verify-extraction");
    expect(splitCovers(answer, ["Llevo las campañas de Google Ads y Meta.", "Preparo los informes mensuales."])).toBe(true);
    // And still catches a clause that really went missing.
    expect(splitCovers(answer, ["Llevo las campañas de Google Ads y Meta."])).toBe(false);
  });
});

