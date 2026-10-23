import { describe, expect, it } from "vitest";
import { metricFromAnswer } from "@/lib/onboarding/answer";
import { describeFigure, describeReading, figureText, quantitiesIn, readFigure, statesQuantity, type FigureReading } from "@/lib/onboarding/figure";

/** What a line reads as, when it reads as a figure. */
const read = (text: string) => {
  const reading = readFigure(text);
  if (reading.kind !== "read") throw new Error(`"${text}" did not read as a figure: ${JSON.stringify(reading)}`);
  return reading.answer;
};

const unclear = (text: string): FigureReading => {
  const reading = readFigure(text);
  expect(reading.kind, text).toBe("unclear");
  return reading;
};

describe("a figure, written in one line", () => {
  it("is empty until something is typed", () => {
    expect(readFigure("")).toEqual({ kind: "empty" });
    expect(readFigure("   ")).toEqual({ kind: "empty" });
  });

  it("reads a number with its unit, however the two are spaced", () => {
    expect(read("20 %")).toEqual({ kind: "exact", value: "20", unit: "%" });
    expect(read("20%")).toEqual({ kind: "exact", value: "20", unit: "%" });
    expect(read("150 clientes")).toEqual({ kind: "exact", value: "150", unit: "clientes" });
    expect(read("150clientes")).toEqual({ kind: "exact", value: "150", unit: "clientes" });
    expect(read("12 horas por semana")).toEqual({ kind: "exact", value: "12", unit: "horas por semana" });
  });

  it("reads a number with no unit as a number with none, and does not give it one", () => {
    expect(read("40")).toEqual({ kind: "exact", value: "40", unit: "" });
    expect(describeReading(read("40"))).toBe("Se guarda: 40 (sin unidad).");
  });

  it("reads a range, written any of the ways people write one", () => {
    for (const text of ["20-25 %", "20 - 25 %", "20–25 %", "20 a 25 %", "20 hasta 25 %", "20% a 25%", "entre 20 y 25 %", "de 20 a 25 %"]) {
      expect(read(text), text).toEqual({ kind: "range", from: "20", to: "25", unit: "%" });
    }
    expect(read("2 a 3 personas")).toEqual({ kind: "range", from: "2", to: "3", unit: "personas" });
    expect(read("20-25")).toEqual({ kind: "range", from: "20", to: "25", unit: "" });
  });

  it("takes a 'y' for a range only after an 'entre': two numbers joined by 'y' alone could be two things", () => {
    expect(read("entre 10 y 15 clientes")).toMatchObject({ kind: "range", from: "10", to: "15" });
    unclear("10 y 15 clientes");
  });

  it("keeps the digits exactly as they were typed, with whichever separators", () => {
    expect(read("1.500.000 $")).toEqual({ kind: "exact", value: "1.500.000", unit: "$" });
    expect(read("1,5 millones")).toEqual({ kind: "exact", value: "1,5", unit: "millones" });
    expect(read("1.500-2.000 clientes")).toEqual({ kind: "range", from: "1.500", to: "2.000", unit: "clientes" });
    expect(read("0,75 %")).toEqual({ kind: "exact", value: "0,75", unit: "%" });
  });

  it("says it is approximate when the person did", () => {
    for (const text of ["aprox. 150 clientes", "aprox 150 clientes", "~150 clientes", "≈ 150 clientes", "unos 150 clientes", "casi 150 clientes", "más o menos 150 clientes", "cerca de 150 clientes", "aproximadamente 150 clientes"]) {
      expect(read(text), text).toEqual({ kind: "exact", value: "150", unit: "clientes", approx: true });
    }
    expect(describeReading(read("~150 clientes"))).toBe("Se guarda como aproximado: 150 clientes.");
  });

  it("does not take a word that only starts like 'about' for one", () => {
    // "casa" is not "casi": nothing here is a number, and it says so.
    unclear("casa 150");
  });

  it("reads a currency before the number as the unit", () => {
    expect(read("$ 1.500")).toEqual({ kind: "exact", value: "1.500", unit: "$" });
    expect(read("USD 20000")).toEqual({ kind: "exact", value: "20000", unit: "USD" });
    expect(read("usd 20.000")).toEqual({ kind: "exact", value: "20.000", unit: "USD" });
    expect(read("u$s 500")).toEqual({ kind: "exact", value: "500", unit: "US$" });
    expect(read("$10-12")).toEqual({ kind: "range", from: "10", to: "12", unit: "$" });
  });

  it("reads 'por ciento' as a percent, and a unit that is a thing a number counts as that", () => {
    expect(read("30 por ciento")).toEqual({ kind: "exact", value: "30", unit: "%" });
    expect(read("150 de clientes")).toEqual({ kind: "exact", value: "150", unit: "clientes" });
    expect(read("150 clientes.")).toEqual({ kind: "exact", value: "150", unit: "clientes" });
  });

  it("says what is wrong with what it could not read, and does not guess", () => {
    expect(unclear("muchos")).toMatchObject({ why: expect.stringMatching(/No encontramos el número/) });
    expect(unclear("más de 100 clientes")).toMatchObject({ why: expect.stringMatching(/No encontramos el número/) });
    // Two figures in one line: which is the figure?
    expect(unclear("150 clientes en 2023")).toMatchObject({ why: expect.stringMatching(/más de un número/) });
    expect(unclear("20 de 100")).toMatchObject({ why: expect.stringMatching(/más de un número/) });
    expect(unclear("1-2-3")).toMatchObject({ why: expect.stringMatching(/más de un número/) });
    // A unit is a word or two; a sentence is not one, and `Metric.unit` would cut it at 24 characters.
    expect(unclear("12 casos resueltos por semana en todo el país")).toMatchObject({ why: expect.stringMatching(/unidad es larga/) });
  });

  it("waits for the second number of a range that is still being typed, instead of reading 'a' as a unit", () => {
    for (const half of ["20 a", "20 -", "20-", "20 hasta", "entre 20 y"]) {
      expect(unclear(half), half).toMatchObject({ why: expect.stringMatching(/segundo número/) });
    }
  });
});

describe("what a figure is saved as, said before and after", () => {
  it("shows the interpretation of an exact figure, a range and an unknown one the same way every time", () => {
    expect(describeReading(read("20 %"))).toBe("Se guarda: 20 %.");
    expect(describeReading(read("20-25 %"))).toBe("Se guarda como aproximado: 20–25 %.");
    expect(figureText(read("150 clientes"))).toBe("150 clientes");
    expect(figureText(read("20 a 25 personas"))).toBe("20–25 personas");
  });

  it("is the receipt of what was saved", () => {
    expect(describeFigure(read("20 %"))).toBe("Guardado: 20 %.");
    expect(describeFigure(read("20-25 %"))).toBe("Guardado como aproximado: 20–25 %.");
    expect(describeFigure(read("aprox. 150 clientes"))).toBe("Guardado como aproximado: 150 clientes.");
    expect(describeFigure({ kind: "unknown" })).toBe("Lo guardamos sin cifra. Si la encontrás, podés agregarla desde tu perfil.");
  });

  it("is kept as the same metric whichever way it was typed: the single line and the two boxes agree", () => {
    expect(metricFromAnswer(read("20-25 %"))).toEqual({ value: "20-25", unit: "%", approx: true });
    expect(metricFromAnswer({ kind: "range", from: "20", to: "25", unit: "%" })).toEqual({ value: "20-25", unit: "%", approx: true });
    expect(metricFromAnswer(read("20 %"))).toEqual({ value: "20", unit: "%", approx: false });
    expect(metricFromAnswer(read("aprox. 150 clientes"))).toEqual({ value: "150", unit: "clientes", approx: true });
  });

  it("still refuses what is not a number, wherever it comes from", () => {
    expect(metricFromAnswer({ kind: "exact", value: "veinte", unit: "%" })).toBeNull();
    expect(metricFromAnswer({ kind: "exact", value: "20", unit: "%", approx: true })).toEqual({ value: "20", unit: "%", approx: true });
  });
});

describe("a line that states a number that counts something, and not only a year", () => {
  it("is one with a percentage, an amount or a count, as any number was before", () => {
    for (const line of ["Subí la conversión un 20%", "Atendí 150 clientes por mes", "Reduje los tiempos 3 semanas", "Logré 2.000 ventas", "Armé 12 informes", "Pasé de 40 a 90 pedidos"]) {
      expect(statesQuantity(line), line).toBe(true);
    }
  });

  it("is not one that only says when: a year is not a figure", () => {
    for (const line of [
      "Aumenté las ventas en 2022",
      "En 2022 lancé el nuevo sistema de pedidos",
      "Gané el premio al mejor vendedor 2021",
      "Entre 2019 y 2021 armé el equipo comercial",
      "Lo mantuve desde 1999 hasta 2024",
      "Lancé el programa en marzo de 2023",
      "Trabajé en el proyecto (2018-2020)",
      "Cerré el año 2022–2023 con el mejor resultado",
    ]) {
      expect(statesQuantity(line), line).toBe(false);
      expect(quantitiesIn(line), line).toEqual([]);
    }
  });

  it("is one that has a year and a quantity: the quantity counts", () => {
    expect(quantitiesIn("En 2022 subí las ventas un 20%")).toEqual(["20"]);
    expect(quantitiesIn("En 2022 atendí 150 clientes")).toEqual(["150"]);
  });

  it("takes a number from 1900 to 2100 for a quantity when something beside it says so", () => {
    for (const line of ["Atendí 2000 clientes", "Capacité a 2000 personas", "Facturé $2000", "Facturé US$ 2000", "Facturé 2000 USD", "Facturé 2000 pesos", "Vendí 2020 unidades", "Superé 2000 ventas", "Crecí 2022%", "Más de 2000", "Cerca de 2000", "Sumé 2000k"]) {
      expect(statesQuantity(line), line).toBe(true);
    }
  });

  it("only takes for a year what is one: four plain digits, from 1900 to 2100", () => {
    expect(statesQuantity("Vendí 1899")).toBe(true);
    expect(statesQuantity("Vendí 2101")).toBe(true);
    expect(statesQuantity("Desde 1900")).toBe(false);
    expect(statesQuantity("Hasta 2100")).toBe(false);
    // Grouped by thousands is a quantity, whatever the digits.
    expect(statesQuantity("Logré 2.000")).toBe(true);
    expect(statesQuantity("Logré 2,022")).toBe(true);
  });

  it("does not take a digit that is part of a name for a figure, as before", () => {
    expect(statesQuantity("Migré el sistema a OAuth2")).toBe(false);
    expect(statesQuantity("Usé S3 y EC2")).toBe(false);
  });

  it("is quiet about a line with no number at all", () => {
    expect(statesQuantity("Llevo las campañas de Google Ads")).toBe(false);
    expect(statesQuantity("")).toBe(false);
  });
});
