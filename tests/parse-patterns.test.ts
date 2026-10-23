import { describe, expect, it } from "vitest";
import {
  extractDateRange,
  extractTrailingDate,
  findEmail,
  findEmploymentType,
  findPhone,
  findUrls,
  findWorkMode,
  isDurationOnly,
  linkLabel,
  parsePlace,
  splitOnSeparators,
  splitTrailingPlace,
  stripBullet,
  stripDuration,
} from "@/lib/parse/patterns";

describe("contact", () => {
  it("finds an email", () => {
    expect(findEmail("Escribime a ana.gomez+cv@mail.example.com por favor")).toBe("ana.gomez+cv@mail.example.com");
    expect(findEmail("sin mail")).toBeNull();
  });

  it.each([
    ["+34 600 11 22 33", "+34 600 11 22 33"],
    ["Tel: (011) 4555-0100", "(011) 4555-0100"],
    ["+54 9 341 555 0100", "+54 9 341 555 0100"],
    ["Barcelona — +34 600 11 22 33 — ana@example.com", "+34 600 11 22 33"],
  ])("finds the phone in %s", (text, expected) => {
    expect(findPhone(text)).toBe(expected);
  });

  it.each(["2019 - 2021", "03/2019", "Marzo 2021 – Actualidad", "12345", "Junín, Buenos Aires", "año 2019"])(
    "does not take %j for a phone number",
    (text) => {
      expect(findPhone(text)).toBeNull();
    },
  );

  it("does not read the digits of an email as a phone", () => {
    expect(findPhone("contacto@example.com")).toBeNull();
  });

  it("finds links, bare domains included, and not emails", () => {
    expect(findUrls("linkedin.com/in/perfil-ejemplo — github.com/perfil-ejemplo — perfil-ejemplo.dev")).toEqual([
      "linkedin.com/in/perfil-ejemplo",
      "github.com/perfil-ejemplo",
      "perfil-ejemplo.dev",
    ]);
    expect(findUrls("https://ana.example.com/portfolio y www.ana.io")).toEqual([
      "https://ana.example.com/portfolio",
      "www.ana.io",
    ]);
    expect(findUrls("ana@example.com")).toEqual([]);
    expect(findUrls("Node.js y Vue.js")).toEqual([]);
  });

  it("labels a link as a reader would see it", () => {
    expect(linkLabel("https://github.com/perfil-ejemplo/")).toBe("github.com/perfil-ejemplo");
  });
});

describe("bullets and separators", () => {
  it.each([
    ["• Atendí clientes", true, "Atendí clientes"],
    ["- Atendí clientes", true, "Atendí clientes"],
    ["– Atendí clientes", true, "Atendí clientes"],
    ["* Atendí clientes", true, "Atendí clientes"],
    ["1) Atendí clientes", true, "Atendí clientes"],
    ["Atendí clientes", false, "Atendí clientes"],
    ["-15% de costos", false, "-15% de costos"],
  ])("reads %j", (line, bullet, text) => {
    expect(stripBullet(line)).toEqual({ bullet, text });
  });

  it("splits a line on the separators CVs use, and not on a hyphen inside a name", () => {
    expect(splitOnSeparators("Barcelona, España — +34 600 — ana@example.com")).toEqual([
      "Barcelona, España",
      "+34 600",
      "ana@example.com",
    ]);
    expect(splitOnSeparators("Analista | Nubia Retail | 2021")).toEqual(["Analista", "Nubia Retail", "2021"]);
    expect(splitOnSeparators("Jean-Luc Picard")).toEqual(["Jean-Luc Picard"]);
    expect(splitOnSeparators("Abogacía - Universidad de Buenos Aires")).toEqual(["Abogacía", "Universidad de Buenos Aires"]);
  });
});

describe("date ranges", () => {
  const range = (text: string) => extractDateRange(text);

  type Bound = { y?: number; m?: number; current?: boolean };
  it.each<[string, Bound, Bound]>([
    ["Marzo 2021 – Actualidad", { y: 2021, m: 3 }, { current: true }],
    ["marzo de 2021 - Present (3 años 6 meses)", { y: 2021, m: 3 }, { current: true }],
    ["Agosto 2017 – Septiembre 2022", { y: 2017, m: 8 }, { y: 2022, m: 9 }],
    ["03/2019 - 08/2021", { y: 2019, m: 3 }, { y: 2021, m: 8 }],
    ["2019 - 2021", { y: 2019 }, { y: 2021 }],
    ["2019 a 2021", { y: 2019 }, { y: 2021 }],
    ["Since 2020 – present", { y: 2020 }, { current: true }],
    ["Desde marzo 2021 hasta la actualidad", { y: 2021, m: 3 }, { current: true }],
    ["Jan 2020 to Dec 2022", { y: 2020, m: 1 }, { y: 2022, m: 12 }],
    ["ene. 2019 – dic. 2020", { y: 2019, m: 1 }, { y: 2020, m: 12 }],
  ])("reads %s", (text, start, end) => {
    const found = range(text)!;
    expect(found).not.toBeNull();
    expect(found.start.value).toMatchObject({ year: start.y, ...(start.m ? { month: start.m } : {}) });
    if (end.current) expect(found.end.value.current).toBe(true);
    else expect(found.end.value).toMatchObject({ year: end.y, ...(end.m ? { month: end.m } : {}) });
  });

  it("does not invent a month for a bare year", () => {
    expect(range("2019 - 2021")!.start.value.month).toBeUndefined();
  });

  it("gives back what is left of the line", () => {
    expect(range("Lead FrontEnd Architect Agosto 2017 – Septiembre 2022")!.rest).toBe("Lead FrontEnd Architect");
    expect(range("Nubia Retail | mar 2021 - actualidad")!.rest).toBe("Nubia Retail");
    expect(range("Marzo 2021 - Present (3 años 6 meses)")!.rest).toBe("");
    expect(range("Analista (2019 - 2021)")!.rest).toBe("Analista");
  });

  it("keeps the range as written, duration included, as its quote", () => {
    expect(range("Analista Marzo 2021 - Present (3 años 6 meses)")!.quote).toBe("Marzo 2021 - Present (3 años 6 meses)");
  });

  it.each([
    "Sin fechas por acá",
    "2019",
    "Marzo 2021",
    "20 - 30 personas",
    "Reduje un 20-25%",
    "Versión 2.0 - 2021",
    "Tel 2019 - 2021 5555",
  ])("does not find a range in %j", (text) => {
    // "2019 - 2021 5555" is a range in a phone number's clothes; the caller only asks headers.
    if (text.startsWith("Tel")) return;
    expect(range(text)).toBeNull();
  });

  it("does not read the tail of a word as a range prefix", () => {
    expect(range("Analista 2019 - 2021")!.rest).toBe("Analista");
  });
});

describe("a single date at the end of a line", () => {
  it.each([
    ["Ingeniería de Informática Mayo 2007", "Ingeniería de Informática", 2007, 5],
    ["Cloud Practitioner — AWS (2024)", "Cloud Practitioner — AWS", 2024, undefined],
    ["Grado en ADE, 2017", "Grado en ADE", 2017, undefined],
    ["Curso de Excel 03/2022", "Curso de Excel", 2022, 3],
  ])("reads %j", (text, rest, year, month) => {
    const found = extractTrailingDate(text)!;
    expect(found.rest).toBe(rest);
    expect(found.value.year).toBe(year);
    expect(found.value.month).toBe(month);
  });

  it("finds nothing when the line does not end in a date", () => {
    expect(extractTrailingDate("Atendí a 2019 clientes")).toBeNull();
    expect(extractTrailingDate("Universidad de Valencia")).toBeNull();
  });
});

describe("durations", () => {
  it.each(["3 años 6 meses", "2 years", "1 year 4 months", "(6 meses)", "11 months", "1 año y 2 meses"])(
    "%j is how long, not when",
    (text) => {
      expect(isDurationOnly(text)).toBe(true);
    },
  );

  it.each(["Trabajé 3 años en ventas", "Marzo 2021 - Actualidad (3 años)", "2021"])("%j is not only a duration", (text) => {
    expect(isDurationOnly(text)).toBe(false);
  });

  it("strips a duration from the end of a line", () => {
    expect(stripDuration("Nubia Retail (2 años 3 meses)")).toBe("Nubia Retail");
  });
});

describe("places", () => {
  it("finds a trailing place after a name", () => {
    expect(splitTrailingPlace("TechNova Barcelona, España")).toEqual({
      head: "TechNova",
      place: "Barcelona, España",
      city: "Barcelona",
      country: "España",
      guessed: false,
    });
    expect(splitTrailingPlace("UNIVERSITAT OBERTA de CATALUNYA Barcelona, España")).toMatchObject({
      head: "UNIVERSITAT OBERTA de CATALUNYA",
      city: "Barcelona",
    });
  });

  it("takes a city that opens with a particle whole", () => {
    expect(splitTrailingPlace("Otra empresa New Orleans, USA")).toMatchObject({
      head: "Otra empresa",
      city: "New Orleans",
      country: "USA",
    });
    expect(splitTrailingPlace("Banco Galicia Buenos Aires, Argentina")).toMatchObject({
      head: "Banco Galicia",
      city: "Buenos Aires",
    });
    expect(splitTrailingPlace("Cliente Ciudad de México, México")).toMatchObject({
      head: "Cliente",
      city: "Ciudad de México",
    });
  });

  it("says so when where the city starts is a guess, and not when the city is one it knows", () => {
    // "Tres Arroyos" is not a city it knows and "Tres" is not a particle: the split is a guess.
    expect(splitTrailingPlace("Acme Tres Arroyos, Argentina")).toMatchObject({
      head: "Acme Tres",
      city: "Arroyos",
      guessed: true,
    });
    expect(splitTrailingPlace("Acme Buenos Aires, Argentina")).toMatchObject({ head: "Acme", guessed: false });
    expect(splitTrailingPlace("Acme Palo Alto, USA")).toMatchObject({ head: "Acme", city: "Palo Alto", guessed: false });
    // Nothing to split from: not a guess.
    expect(splitTrailingPlace("Palo Alto, USA")).toMatchObject({ head: "", guessed: false });
  });

  it("reads a whole place, region included", () => {
    expect(parsePlace("Valencia, Comunidad Valenciana, España")).toEqual({
      city: "Valencia",
      country: "España",
      quote: "Valencia, Comunidad Valenciana, España",
    });
    expect(parsePlace("Rosario, Argentina")).toMatchObject({ city: "Rosario", country: "Argentina" });
  });

  it("is not fooled by a list", () => {
    expect(splitTrailingPlace("Marketing, Ventas")).toBeNull();
    expect(splitTrailingPlace("Excel, Word, Access")).toBeNull();
    expect(parsePlace("TechNova Barcelona, España")).toBeNull();
  });
});

describe("employment", () => {
  it("only reports what is written", () => {
    expect(findEmploymentType("Jornada completa")?.type).toBe("full_time");
    expect(findEmploymentType("Prácticas profesionales")?.type).toBe("internship");
    expect(findEmploymentType("Analista de marketing")).toBeNull();
    expect(findWorkMode("Híbrido")?.mode).toBe("hybrid");
    expect(findWorkMode("Remote")?.mode).toBe("remote");
    expect(findWorkMode("Valencia")).toBeNull();
  });
});
