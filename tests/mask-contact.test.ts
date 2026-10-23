import { describe, expect, it } from "vitest";
import { hasMark, knownContact, maskContact } from "@/lib/parse/mask-contact";

/**
 * What is taken out of a text before a model reads it — the name, the email, the phone and the links that say who someone is — and put
 * back in what the model says. Not a promise to find everything: a promise to take out what it recognises, and to leave alone what it does not.
 */

const CV = [
  "Lucía Pérez",
  "Analista de Marketing",
  "lucia.perez@example.com | +54 9 351 555-1234 | linkedin.com/in/perfil-ejemplo | Córdoba, Argentina",
  "",
  "Experiencia",
  "Nubia Retail — Analista de Marketing (2022 – 2024)",
  "- Armé el sitio www.nubia.example.com y subí las ventas un 20 %.",
  "- Facturación de 1.500.000 pesos entre 2019 y 2021.",
  "",
  "Contacto",
  "Tel.: 351 555-9999",
  "Web: perfil-ejemplo.example.com",
].join("\n");

const NAMES = ["Lucía Pérez"];

describe("what is taken out of a document", () => {
  const masked = maskContact(CV, { kind: "document", names: NAMES });

  it("takes out the name, the email, the phone and the links, wherever the document keeps them", () => {
    expect(masked.text).not.toMatch(/Lucía Pérez|lucia\.perez@example\.com|351 555|linkedin|perfil-ejemplo/i);
    expect(masked.text.split("\n")[0]).toBe("[NOMBRE_1]");
    expect(masked.text.split("\n")[2]).toBe("[CORREO_1] | [TELEFONO_1] | [ENLACE_1] | Córdoba, Argentina");
    // The section «Contacto» is a place for them too.
    expect(masked.text).toContain("Tel.: [TELEFONO_2]");
    expect(masked.text).toContain("Web: [ENLACE_2]");
  });

  it("leaves what is read: the place, the job, the dates, the figures, and the address of what was built", () => {
    expect(masked.text).toContain("Analista de Marketing");
    expect(masked.text).toContain("Córdoba, Argentina");
    expect(masked.text).toContain("Nubia Retail — Analista de Marketing (2022 – 2024)");
    expect(masked.text).toContain("- Armé el sitio www.nubia.example.com y subí las ventas un 20 %.");
    expect(masked.text).toContain("- Facturación de 1.500.000 pesos entre 2019 y 2021.");
  });

  it("does not move a line: the same lines, the blank ones blank", () => {
    expect(masked.text.split("\n")).toHaveLength(CV.split("\n").length);
    CV.split("\n").forEach((line, at) => {
      if (line === "") expect(masked.text.split("\n")[at]).toBe("");
    });
  });

  it("says what each mark stood for, and puts it back in whatever the model says", () => {
    expect(masked.marks.get("[CORREO_1]")).toBe("lucia.perez@example.com");
    expect(masked.marks.get("[NOMBRE_1]")).toBe("Lucía Pérez");
    expect(masked.restore(masked.text)).toBe(CV);
    const said = { quote: "[CORREO_1] | [TELEFONO_1]", list: ["[NOMBRE_1]", 3, null, { deep: "ver [ENLACE_1]" }], n: 7, ok: true };
    expect(masked.restore(said)).toEqual({
      quote: "lucia.perez@example.com | +54 9 351 555-1234",
      list: ["Lucía Pérez", 3, null, { deep: "ver linkedin.com/in/perfil-ejemplo" }],
      n: 7,
      ok: true,
    });
  });

  it("leaves a mark that was never issued where it is: what a model made up is not something to put back", () => {
    expect(masked.restore("[CORREO_9] y [NOMBRE_1]")).toBe("[CORREO_9] y Lucía Pérez");
  });

  it("is the same text, marked the same way, every time, and does nothing to what it already marked", () => {
    const again = maskContact(CV, { kind: "document", names: NAMES });
    expect(again.text).toBe(masked.text);
    expect([...again.marks]).toEqual([...masked.marks]);
    expect(maskContact(masked.text, { kind: "document", names: NAMES }).text).toBe(masked.text);
  });
});

describe("one mark for one thing", () => {
  it("gives the same address the same mark, and another one its own", () => {
    const { text, marks } = maskContact("Escribime a ana@example.com o a ana@example.com; o a beto@example.com.", { kind: "free" });
    expect(text).toBe("Escribime a [CORREO_1] o a [CORREO_1]; o a [CORREO_2].");
    expect(marks.size).toBe(2);
  });
});

describe("where a phone number is looked for", () => {
  it("only where the contact details are: above the first heading, under «Contacto», or on a line with a label", () => {
    const text = ["Ana Gómez", "351 555-1234", "", "Experiencia", "Me llaman al 351 555-8888 por las tardes", "Cel: 351 555-7777"].join("\n");
    const lines = maskContact(text, { kind: "document" }).text.split("\n");
    expect(lines[1]).toBe("[TELEFONO_1]");
    // In the body a run of digits is a date or a figure, and a sentence is not a place for one.
    expect(lines[4]).toBe("Me llaman al 351 555-8888 por las tardes");
    expect(lines[5]).toBe("Cel: [TELEFONO_2]");
  });

  it("not in what someone says in their own words, unless it has a label", () => {
    const free = maskContact("Mi celular es 351 555-1234.\nCel: 351 555-9999", { kind: "free" }).text.split("\n");
    expect(free[0]).toBe("Mi celular es 351 555-1234.");
    expect(free[1]).toBe("Cel: [TELEFONO_1]");
  });

  it("never takes a range of years or a figure for a phone number", () => {
    const text = ["Ana Gómez", "2019 - 2021 | 03/2019 – 05/2021 | 1.500.000"].join("\n");
    expect(maskContact(text, { kind: "document" }).text).toBe(text);
  });

  it("not in a line too long to be one of contact details", () => {
    const long = `Ana Gómez ${"trabajé en muchas cosas distintas ".repeat(5)} 351 555-1234`;
    expect(maskContact(long, { kind: "document" }).text).toBe(long);
  });
});

describe("where a link is looked for", () => {
  it("in the contact details every link; elsewhere only a profile on a site where people keep one", () => {
    const text = ["Ana Gómez", "perfil-ejemplo.com.ar | github.com/perfil-ejemplo", "", "Proyectos", "Tienda: www.tienda-ejemplo.example.com y mi código en github.com/perfil-ejemplo/tienda"].join("\n");
    const lines = maskContact(text, { kind: "document" }).text.split("\n");
    expect(lines[1]).toBe("[ENLACE_1] | [ENLACE_2]");
    expect(lines[4]).toBe("Tienda: www.tienda-ejemplo.example.com y mi código en [ENLACE_3]");
  });

  it("the long one and the short one of the same link are two things, and neither breaks the other", () => {
    const { text } = maskContact("Ana Gómez\nhttps://linkedin.com/in/perfil-ejemplo linkedin.com/in/perfil-ejemplo", { kind: "document" });
    expect(text.split("\n")[1]).toMatch(/^\[ENLACE_\d\] \[ENLACE_\d\]$/);
  });
});

describe("the name", () => {
  it("wherever it is written, in any case, with or without accents, and in any order", () => {
    const text = "Lucía Pérez\nLUCIA PEREZ\nPérez, Lucía\nme llamo Lucia  Perez y trabajo en Rappi";
    const lines = maskContact(text, { kind: "free", names: NAMES }).text.split("\n");
    expect(lines[0]).toBe("[NOMBRE_1]");
    expect(lines[1]).toBe("[NOMBRE_2]");
    expect(lines[2]).toBe("[NOMBRE_3]");
    expect(lines[3]).toBe("me llamo [NOMBRE_4] y trabajo en Rappi");
  });

  it("reads a name written with decomposed accents", () => {
    const text = "Lucía Pérez".normalize("NFD");
    expect(maskContact(text, { kind: "free", names: NAMES }).text).toBe("[NOMBRE_1]");
  });

  it("does not take a first name alone for a name: it may be a word, a place or a firm", () => {
    const text = "Trabajé en Pilar Express con Lucía.";
    expect(maskContact(text, { kind: "free", names: ["Pilar Rosa Gómez"] }).text).toBe(text);
    expect(maskContact(text, { kind: "free", names: ["Lucía"] }).text).toBe(text);
  });

  it("does not take the particles of a name for a name", () => {
    const text = "Viví de los 20 a los 25 en Mendoza; escribí a María de los Ángeles Gómez.";
    const { text: masked } = maskContact(text, { kind: "free", names: ["María de los Ángeles Gómez"] });
    expect(masked).toBe("Viví de los 20 a los 25 en Mendoza; escribí a [NOMBRE_1].");
  });

  it("takes out the several names it is given, and a name in an address that was already taken out stays taken out", () => {
    const text = "Ana Gómez y Beto Ruiz\nana.gomez@example.com";
    const { text: masked } = maskContact(text, { kind: "free", names: ["Ana Gómez", "Beto Ruiz"] });
    expect(masked).toBe("[NOMBRE_1] y [NOMBRE_2]\n[CORREO_1]");
  });
});

describe("when there is nothing to take out", () => {
  it("is the text itself", () => {
    const text = "Trabajé siete años en Acme. Armé el equipo de ventas y subí la facturación un 20 %.";
    const masked = maskContact(text, { kind: "document", names: NAMES });
    expect(masked.text).toBe(text);
    expect(masked.marks.size).toBe(0);
    expect(hasMark(masked.text)).toBe(false);
  });

  it("is quick on a long one, and does not fail on odd text", () => {
    const started = performance.now();
    const text = "Trabajé en Acme. ".repeat(4000);
    expect(maskContact(text, { kind: "free", names: NAMES }).text).toBe(text);
    expect(performance.now() - started).toBeLessThan(2000);
    for (const odd of ["", "\n\n", "((((", "[CORREO_1]", "🚀🚀", "a@b", "@@@@", "+++ 123"]) expect(() => maskContact(odd, { kind: "document", names: NAMES })).not.toThrow();
  });

  it("knows a mark when it sees one", () => {
    expect(hasMark("escribí a [CORREO_1]")).toBe(true);
    expect(hasMark("[ilegible]")).toBe(false);
    expect(hasMark("[CORREO]")).toBe(false);
  });
});

describe("what is known of who someone is, without a model", () => {
  it("reads the name, the email, the phone and the links from the header", () => {
    const contact = knownContact(CV);
    expect(contact.fullName?.value).toBe("Lucía Pérez");
    expect(contact.email?.value).toBe("lucia.perez@example.com");
    expect(contact.phone?.value).toBe("+54 9 351 555-1234");
    expect(contact.links.map((link) => link.value.url)).toEqual(expect.arrayContaining(["linkedin.com/in/perfil-ejemplo"]));
  });

  it("finds an email anywhere in the text when the header does not give one", () => {
    const contact = knownContact(["Lucía Pérez", "Córdoba", "", "Experiencia", "Nubia Retail — Analista (2022 – 2024)", "- Escribirme a lucia@example.com"].join("\n"));
    expect(contact.email?.value).toBe("lucia@example.com");
  });

  it("says nothing of what is not there", () => {
    expect(knownContact("Trabajé en Acme.")).toEqual({ links: [] });
  });
});
