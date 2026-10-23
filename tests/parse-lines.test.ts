import { describe, expect, it } from "vitest";
import { finish, layoutOf, linesFromRuns, linesFromText, readingOrder, type TextRun } from "@/lib/parse/lines";
import { classifyHeading } from "@/lib/parse/sections";

describe("linesFromText", () => {
  it("numbers the lines and turns blank lines into gaps", () => {
    const lines = linesFromText("Ana Gómez\nDesarrolladora\n\nEXPERIENCIA\n\nNubia\nAnalista");
    expect(lines.map((l) => [l.index, l.text, l.gapBefore])).toEqual([
      [0, "Ana Gómez", true],
      [1, "Desarrolladora", false],
      [2, "EXPERIENCIA", true],
      [3, "Nubia", true],
      [4, "Analista", false],
    ]);
  });

  it("drops page footers, in both languages", () => {
    const lines = linesFromText("Ana\nPage 1 of 2\nPágina 2 de 2\n3/4\nNubia");
    expect(lines.map((l) => l.text)).toEqual(["Ana", "Nubia"]);
  });

  it("normalises Windows line ends, non-breaking spaces and tabs", () => {
    const lines = linesFromText("Analista Senior\r\nNubia\tRetail\r\n");
    expect(lines.map((l) => l.text)).toEqual(["Analista Senior", "Nubia   Retail"]);
  });

  it("gives back nothing for nothing", () => {
    expect(linesFromText("")).toEqual([]);
    expect(linesFromText("\n\n  \n")).toEqual([]);
  });
});

const run = (str: string, x: number, y: number, size = 10, page = 1, width = str.length * size * 0.5): TextRun => ({
  str,
  x,
  y,
  size,
  page,
  width,
});

describe("linesFromRuns", () => {
  it("joins the runs of one baseline into a line, with the spaces between words", () => {
    const [line] = linesFromRuns([run("Analista", 50, 700), run("de", 95, 700), run("Marketing", 110, 700)]);
    expect(line!.text).toBe("Analista de Marketing");
  });

  it("does not add a space inside a word the extractor cut in two", () => {
    const [line] = linesFromRuns([run("Mar", 50, 700, 10, 1, 15), run("keting", 65, 700, 10, 1, 30)]);
    expect(line!.text).toBe("Marketing");
  });

  it("returns lines top to bottom, page by page", () => {
    const lines = linesFromRuns([run("segunda", 50, 500), run("primera", 50, 700), run("otra página", 50, 700, 10, 2)]);
    expect(lines.map((l) => l.text)).toEqual(["primera", "segunda", "otra página"]);
    expect(lines.map((l) => l.page)).toEqual([1, 1, 2]);
  });

  it("splits a line at a wide gap instead of gluing a table's cells together", () => {
    const lines = linesFromRuns([run("Nubia Retail", 50, 700, 10, 1, 60), run("2021 - 2023", 400, 700, 10, 1, 55)]);
    expect(lines.map((l) => l.text)).toEqual(["Nubia Retail", "2021 - 2023"]);
  });

  it("measures that gap against the smaller text, so a big heading beside small text still splits", () => {
    const lines = linesFromRuns([
      run("correo@ejemplo.com", 30, 700, 10.5, 1, 140),
      run("Lucía Fernández", 190, 700, 26, 1, 190),
    ]);
    expect(lines).toHaveLength(2);
  });

  it("does not merge runs whose baselines merely fall near a large heading's", () => {
    const lines = linesFromRuns([run("Título grande", 50, 700, 26, 1, 180), run("texto chico al lado", 300, 693, 9, 1, 90)]);
    expect(lines).toHaveLength(2);
  });

  it("keeps two columns apart when told where the boundary is", () => {
    const runs = [run("barra lateral larga larga", 30, 700, 10, 1, 125), run("columna principal", 150, 700, 10, 1, 85)];
    expect(linesFromRuns(runs)).toHaveLength(1);
    expect(linesFromRuns(runs, { splitAt: 150 }).map((l) => l.text)).toEqual(["barra lateral larga larga", "columna principal"]);
  });

  it("measures each line's position and size", () => {
    const [line] = linesFromRuns([run("Título", 50, 700, 26, 1, 90), run("nota", 150, 700, 8, 1, 20)]);
    expect(line).toMatchObject({ x: 50, y: 700, size: 26, page: 1 });
  });

  it("marks a gap wider than a wrapped line, and not a wrapped line", () => {
    const lines = linesFromRuns([run("línea uno", 50, 700), run("línea dos, pegada", 50, 687), run("otro párrafo", 50, 650)]);
    expect(lines.map((l) => l.gapBefore)).toEqual([true, false, true]);
  });

  it("drops footers and empty runs", () => {
    const lines = linesFromRuns([run("contenido", 50, 700), run("Page 1 of 3", 280, 40, 8), run("   ", 50, 500)]);
    expect(lines.map((l) => l.text)).toEqual(["contenido"]);
  });
});

describe("readingOrder", () => {
  /** A page with a header across the top and a sidebar beside a main column. */
  const twoColumns = (): TextRun[] => {
    const runs: TextRun[] = [run("ANA GÓMEZ ANALISTA DE DATOS", 30, 800, 20, 1, 400)];
    const side = ["Contacto", "ana@example.com", "Rosario", "Habilidades", "SQL, Python", "Idiomas", "Inglés B2", "Español nativo"];
    const main = ["Experiencia", "Nubia Retail", "Analista de datos", "2021 - 2023", "Armé los tableros", "Coordiné con ventas", "Educación", "UBA"];
    side.forEach((text, i) => runs.push(run(text, 30, 760 - i * 20, 10, 1, 110)));
    main.forEach((text, i) => runs.push(run(text, 200, 760 - i * 20, 10, 1, 150)));
    return runs;
  };

  it("reads a sidebar whole and then the main column, under a header that spans both", () => {
    const ordered = readingOrder(linesFromRuns(twoColumns()));
    const texts = ordered.map((l) => l.text);
    expect(texts[0]).toBe("ANA GÓMEZ ANALISTA DE DATOS");
    expect(texts.slice(1, 9)).toEqual(["Contacto", "ana@example.com", "Rosario", "Habilidades", "SQL, Python", "Idiomas", "Inglés B2", "Español nativo"]);
    expect(texts.slice(9)).toEqual(["Experiencia", "Nubia Retail", "Analista de datos", "2021 - 2023", "Armé los tableros", "Coordiné con ventas", "Educación", "UBA"]);
  });

  it("leaves a single column alone", () => {
    const runs = Array.from({ length: 16 }, (_, i) => run(`Línea de texto número ${i}`, 50, 780 - i * 14, 10, 1, 150));
    const lines = linesFromRuns(runs);
    expect(readingOrder(lines).map((l) => l.text)).toEqual(lines.map((l) => l.text));
  });

  it("does not mistake a page of right-aligned dates and places for a second column", () => {
    // Several jobs, laid out the way this app's own CV template does: company
    // and role flush left, place and date flush right — which puts a wide gap
    // between the bullets and whichever place/date is longest, exactly like a
    // real column boundary would.
    const RIGHT_EDGE = 560;
    const runs: TextRun[] = [];
    let y = 800;
    const push = (text: string, x: number, width: number) => runs.push(run(text, x, y, 10, 1, width));
    for (let job = 0; job < 6; job++) {
      const place = job % 2 === 0 ? "Buenos Aires, Argentina" : "Remoto";
      const date = job % 2 === 0 ? "Marzo 2019 - Abril 2021" : "2021 - 2022";
      push(`Empresa ${job}`, 28, 70);
      push(place, RIGHT_EDGE - place.length * 5, place.length * 5);
      y -= 14;
      push(`Puesto ${job}`, 28, 90);
      push(date, RIGHT_EDGE - date.length * 5, date.length * 5);
      y -= 14;
      push("Hice cosas relevantes en el puesto", 43, 260);
      y -= 20;
    }
    const lines = linesFromRuns(runs);
    expect(readingOrder(lines).map((l) => l.text)).toEqual(lines.map((l) => l.text));
  });

  it("leaves lines without positions alone", () => {
    const lines = linesFromText("uno\ndos\ntres");
    expect(readingOrder(lines)).toBe(lines);
  });

  it("renumbers the lines it moves", () => {
    const ordered = readingOrder(linesFromRuns(twoColumns()));
    expect(ordered.map((l) => l.index)).toEqual(ordered.map((_, i) => i));
  });

  it("finish() marks the jump back up the page as a gap", () => {
    const lines = finish([
      { text: "a", index: 0, gapBefore: false, page: 1, x: 0, y: 500, size: 10 },
      { text: "b", index: 1, gapBefore: false, page: 1, x: 0, y: 700, size: 10 },
    ]);
    expect(lines[1]!.gapBefore).toBe(true);
  });
});

describe("classifyHeading", () => {
  it.each([
    ["EXPERIENCIA LABORAL", "experience"],
    ["Experiencia profesional:", "experience"],
    ["Work Experience", "experience"],
    ["Experience", "experience"],
    ["Experiencia", "experience"],
    ["FORMACIÓN ACADÉMICA", "education"],
    ["Educación", "education"],
    ["Education", "education"],
    ["Estudios", "education"],
    ["Habilidades técnicas", "skills"],
    ["Top Skills", "skills"],
    ["Aptitudes principales", "skills"],
    ["Skills adicionales", "skills"],
    ["Idiomas", "languages"],
    ["Languages", "languages"],
    ["Cursos y certificaciones", "certifications"],
    ["Certificaciones", "certifications"],
    ["Perfil", "summary"],
    ["Acerca de mí", "summary"],
    ["Extracto", "summary"],
    ["Summary", "summary"],
    ["Voluntariado", "volunteer"],
    ["Proyectos", "projects"],
    ["Datos personales", "personal"],
    ["Referencias", "references"],
    ["Contacto", "contact"],
    ["Honors-Awards", "awards"],
    ["1. Experiencia", "experience"],
    ["— EXPERIENCIA —", "experience"],
  ])("%s is %s", (text, kind) => {
    expect(classifyHeading(text)).toBe(kind);
  });

  it.each([
    "Experiencia con React, Node y Postgres",
    "• Idiomas",
    "- Educación",
    "Trabajé en la experiencia de usuario de la app",
    "Analista de datos",
    "Cursos de inglés y francés en la Alianza Francesa de Rosario",
    "",
  ])("%j is not a heading", (text) => {
    expect(classifyHeading(text)).toBeNull();
  });
});

describe("layoutOf", () => {
  it("gives each line's own box, aligned index for index with the lines themselves", () => {
    const lines = linesFromRuns([run("Nubia Retail", 50, 700, 12, 1, 60), run("2021 - 2023", 400, 700, 10, 1, 55)]);
    const layout = layoutOf(lines);
    expect(layout).toEqual([
      { page: 1, x: 50, y: 700, width: 60, size: 12 },
      { page: 1, x: 400, y: 700, width: 55, size: 10 },
    ]);
  });

  it("is undefined for text with no positions — pasted, or from a Word file", () => {
    expect(layoutOf(linesFromText("uno\ndos"))).toBeUndefined();
  });

  it("leaves a null where a line in an otherwise positioned document has no box of its own", () => {
    const [positioned] = linesFromRuns([run("Nubia Retail", 50, 700)]);
    const mixed = [positioned!, { text: "sin posición", index: 1, gapBefore: false }];
    expect(layoutOf(mixed)).toEqual([{ page: 1, x: 50, y: 700, width: expect.any(Number), size: 10 }, null]);
  });
});
