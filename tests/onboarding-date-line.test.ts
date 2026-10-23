import { describe, expect, it } from "vitest";
import { describeDateLine, lineOf, readDateLine, type DateLine } from "@/lib/onboarding/date-line";

/**
 * Dates, written in one line, and what was read shown back in words before anything is kept. The one thing it must not do
 * is guess: a line it cannot read says so, and a date nobody wrote — a month, an end — is not made up.
 */

const NOW = new Date("2026-09-21T12:00:00.000Z");
const read = (text: string) => readDateLine(text, NOW);
const line = (text: string): DateLine => {
  const reading = read(text);
  if (reading.kind !== "read") throw new Error(`no se leyó «${text}»: ${JSON.stringify(reading)}`);
  return reading.line;
};
const says = (text: string) => {
  const reading = read(text);
  return reading.kind === "read" ? reading.says : `(${reading.kind})`;
};

describe("a stretch written in one line", () => {
  it("reads a month and a year to a «still going» word, in any of the ways it is said", () => {
    for (const text of ["mar 2020 – actualidad", "mar 2020 - actualidad", "Marzo 2020 hasta hoy", "03/2020 - presente", "marzo de 2020 a la fecha", "desde marzo de 2020 hasta la actualidad", "Mar. 2020 – Actualmente"]) {
      expect(line(text), text).toEqual({ from: { year: 2020, month: 3 }, to: {}, current: true });
    }
  });

  it("reads two dates, with or without their months", () => {
    expect(line("mar 2020 – may 2021")).toEqual({ from: { year: 2020, month: 3 }, to: { year: 2021, month: 5 }, current: false });
    expect(line("2018-2021")).toEqual({ from: { year: 2018 }, to: { year: 2021 }, current: false });
    expect(line("2018 a 2021")).toEqual({ from: { year: 2018 }, to: { year: 2021 }, current: false });
    expect(line("03/2018 – 12/2019")).toEqual({ from: { year: 2018, month: 3 }, to: { year: 2019, month: 12 }, current: false });
    expect(line("Enero 2019 a Diciembre 2019")).toEqual({ from: { year: 2019, month: 1 }, to: { year: 2019, month: 12 }, current: false });
  });

  it("reads English, because a CV has it", () => {
    expect(line("Jan 2020 - present")).toEqual({ from: { year: 2020, month: 1 }, to: {}, current: true });
    expect(line("March 2018 to June 2019")).toEqual({ from: { year: 2018, month: 3 }, to: { year: 2019, month: 6 }, current: false });
  });

  it("does not make up a month: a year stays a year", () => {
    const read = line("2018 – 2021");
    expect(read.from.month).toBeUndefined();
    expect(read.to.month).toBeUndefined();
  });

  it("keeps the dates as values, with no text of their own: nothing was left to be read twice", () => {
    expect(line("mar 2020 – actualidad").from).not.toHaveProperty("raw");
  });

  it("reads a start alone only when it says so", () => {
    expect(line("desde mar 2020")).toEqual({ from: { year: 2020, month: 3 }, to: {}, current: false });
    expect(line("since 2019")).toEqual({ from: { year: 2019 }, to: {}, current: false });
  });
});

describe("what it says it read", () => {
  it("is the stretch in words: month and year, and «a hoy» for the one that goes on", () => {
    expect(says("mar 2020 – actualidad")).toBe("Marzo 2020 a hoy");
    expect(says("mar 2020 – may 2021")).toBe("Marzo 2020 a mayo 2021");
    expect(says("2018-2021")).toBe("2018 a 2021");
    expect(says("desde mar 2020")).toBe("Desde marzo 2020, sin fecha de fin");
  });

  it("describes a stretch the same way whoever asks", () => {
    expect(describeDateLine({ from: { year: 2020, month: 3 }, to: {}, current: true })).toBe("Marzo 2020 a hoy");
  });
});

describe("a line it will not guess at", () => {
  it("says nothing for nothing", () => {
    expect(read("")).toEqual({ kind: "empty" });
    expect(read("   ")).toEqual({ kind: "empty" });
  });

  it("says what it could not read, and what it would read, when it is not a date", () => {
    for (const text of ["ayer", "hace tres años", "verano 2019", "3/4/20", "20/21"]) {
      const reading = read(text);
      expect(reading.kind, text).toBe("unclear");
      expect(reading.kind === "unclear" ? reading.why : "", text).toMatch(/^No pudimos leer las fechas\. Escribilas con el mes y el año/);
    }
  });

  it("does not take a lone date for a stretch: which end it is is not for this to choose", () => {
    for (const text of ["2020", "mar 2020", "03/2020"]) {
      const reading = read(text);
      expect(reading.kind, text).toBe("unclear");
      expect(reading.kind === "unclear" ? reading.why : "").toMatch(/^Falta la otra fecha\./);
    }
  });

  it("asks for only the dates when the line has other words in it", () => {
    const reading = read("Cajero 2019 – 2021");
    expect(reading).toEqual({ kind: "unclear", why: "Escribí solo las fechas, sin otras palabras. Lo demás va en los otros campos." });
  });

  it("will not take an end before a start", () => {
    expect(read("2021 – 2019")).toEqual({ kind: "unclear", why: "La fecha de fin es anterior a la de inicio." });
    expect(read("may 2021 – mar 2021")).toMatchObject({ kind: "unclear", why: "La fecha de fin es anterior a la de inicio." });
  });

  it("takes a year alone to its own end: 2020 to 2020 is a year, not a mistake", () => {
    expect(read("2020 – 2020").kind).toBe("read");
    expect(read("mar 2020 – mar 2020").kind).toBe("read");
  });

  it("keeps years to the ones a person can mean: not before 1950, not more than ten years ahead", () => {
    expect(read("1930 – 1935")).toMatchObject({ kind: "unclear", why: expect.stringContaining("1930") });
    expect(read("2020 – 2040")).toMatchObject({ kind: "unclear", why: expect.stringContaining("2040") });
    expect(read("2022 – 2027").kind).toBe("read");
  });
});

describe("a stretch as a line, and back", () => {
  it("writes a stretch in a form that reads back as the same stretch", () => {
    const stretches: DateLine[] = [
      { from: { year: 2020, month: 3 }, to: {}, current: true },
      { from: { year: 2018 }, to: { year: 2021 }, current: false },
      { from: { year: 2019, month: 1 }, to: { year: 2019, month: 12 }, current: false },
    ];
    for (const stretch of stretches) expect(line(lineOf(stretch))).toEqual(stretch);
  });

  it("writes nothing for a stretch with nothing in it", () => {
    expect(lineOf({ from: {}, to: {}, current: false })).toBe("");
  });

  it("writes a start alone as the one date it is, which is not a stretch to read back", () => {
    expect(lineOf({ from: { year: 2020 }, to: {}, current: false })).toBe("2020");
  });
});
