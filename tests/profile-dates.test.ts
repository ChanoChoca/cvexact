import { describe, expect, it } from "vitest";
import {
  dateFromParts,
  dateKey,
  datePrecision,
  formatDateShort,
  formatDateValue,
  monthIndex,
  parseDateText,
  sameDate,
  toDateValue,
} from "@/lib/profile/dates";

/**
 * "Normalizar sí, inferir no": a month named in the source becomes a month, and
 * a bare year stays a bare year. The whole point of not reusing
 * `parseProfileDate` is the second half, so most of what is checked here is
 * things that must NOT be read as dates.
 */

describe("parseDateText", () => {
  it.each([
    ["Marzo 2021", { kind: "date", year: 2021, month: 3 }],
    ["marzo de 2021", { kind: "date", year: 2021, month: 3 }],
    ["mar. 2021", { kind: "date", year: 2021, month: 3 }],
    ["MAR 2021", { kind: "date", year: 2021, month: 3 }],
    ["ene. 2019", { kind: "date", year: 2019, month: 1 }],
    ["sept 2018", { kind: "date", year: 2018, month: 9 }],
    ["Setiembre 2018", { kind: "date", year: 2018, month: 9 }],
    ["Dic 2020", { kind: "date", year: 2020, month: 12 }],
    ["December 2020", { kind: "date", year: 2020, month: 12 }],
    ["Aug 2022", { kind: "date", year: 2022, month: 8 }],
    ["03/2019", { kind: "date", year: 2019, month: 3 }],
    ["05 Sep 2023", { kind: "date", year: 2023, month: 9 }],
    ["1 de marzo de 2021", { kind: "date", year: 2021, month: 3 }],
    ["3-2019", { kind: "date", year: 2019, month: 3 }],
    ["2019-03", { kind: "date", year: 2019, month: 3 }],
    ["2019/3", { kind: "date", year: 2019, month: 3 }],
  ])("reads %s as a month and a year", (text, expected) => {
    expect(parseDateText(text)).toEqual(expected);
  });

  it("keeps a bare year as a year, with no month", () => {
    expect(parseDateText("2019")).toEqual({ kind: "date", year: 2019 });
    expect(parseDateText(" 2019 ")).toEqual({ kind: "date", year: 2019 });
  });

  it.each(["Presente", "actualidad", "Present", "Actualmente", "a la fecha", "hasta hoy"])(
    "reads %s as still going",
    (text) => {
      expect(parseDateText(text)).toEqual({ kind: "current" });
    },
  );

  it.each([
    "",
    "   ",
    "19",
    "2019-2021",
    "2019 - 2021",
    "Verano 2019",
    "hace 3 años",
    "marketing 2019",
    "13/2019",
    "00/2019",
    "1850",
    "2500",
    "primavera",
    "Mar",
    "03/19",
  ])("does not read %j as a date", (text) => {
    expect(parseDateText(text)).toEqual({ kind: "unknown" });
  });

  it("does not take a word that merely starts like a month for one", () => {
    expect(parseDateText("marzoo 2021").kind).toBe("unknown");
    expect(parseDateText("mayor 2021").kind).toBe("unknown");
  });
});

describe("toDateValue", () => {
  it("keeps the text it read the date from", () => {
    expect(toDateValue("ene. 2019")).toEqual({ year: 2019, month: 1, raw: "ene. 2019" });
    expect(toDateValue("2019")).toEqual({ year: 2019, raw: "2019" });
  });

  it("keeps an unreadable date as text and nothing else", () => {
    expect(toDateValue("Verano 2019")).toEqual({ raw: "Verano 2019" });
  });

  it("is empty for empty text", () => {
    expect(toDateValue("")).toEqual({});
    expect(toDateValue("   ")).toEqual({});
  });

  it("marks a 'current' word, keeping it readable", () => {
    expect(toDateValue("Presente")).toEqual({ raw: "Presente", current: true });
  });
});

describe("precision and formatting", () => {
  it("reports the precision that is present", () => {
    expect(datePrecision({ year: 2019, month: 3 })).toBe("month");
    expect(datePrecision({ year: 2019 })).toBe("year");
    expect(datePrecision({ raw: "Verano" })).toBe("none");
    expect(datePrecision(undefined)).toBe("none");
  });

  it("shows the literal text while it is there", () => {
    expect(formatDateValue({ year: 2019, month: 1, raw: "ene. 2019" })).toBe("ene. 2019");
  });

  it("writes a picked date the way the app's own examples are written", () => {
    expect(formatDateValue({ year: 2021, month: 3 })).toBe("Marzo 2021");
    expect(formatDateValue({ year: 2021 })).toBe("2021");
    expect(formatDateValue({})).toBe("");
    expect(formatDateValue(undefined)).toBe("");
  });

  it("has a short form for tight rows", () => {
    expect(formatDateShort({ year: 2021, month: 3 })).toBe("mar 2021");
    expect(formatDateShort({ year: 2021 })).toBe("2021");
    expect(formatDateShort({ raw: "Verano 2019" })).toBe("Verano 2019");
  });

  it("gives a stable key, and no key for no date", () => {
    expect(dateKey({ year: 2021, month: 3 })).toBe("2021-03");
    expect(dateKey({ year: 2021 })).toBe("2021");
    expect(dateKey({})).toBeNull();
  });

  it("orders on the calendar without saying a year is January", () => {
    expect(monthIndex({ year: 2021, month: 3 })! - monthIndex({ year: 2021 })!).toBe(2);
    expect(monthIndex({})).toBeNull();
    // The convention is for ordering only: the date itself is untouched.
    const year = { year: 2021 };
    monthIndex(year);
    expect(year).toEqual({ year: 2021 });
  });

  it("builds a picked date, refusing what is out of range", () => {
    expect(dateFromParts(2021, 3)).toEqual({ year: 2021, month: 3 });
    expect(dateFromParts(2021)).toEqual({ year: 2021 });
    expect(dateFromParts(2021, 13)).toEqual({ year: 2021 });
    expect(dateFromParts(undefined, 3)).toEqual({});
    expect(dateFromParts(1800)).toEqual({});
  });

  it("compares two dates by what they say", () => {
    expect(sameDate({ year: 2019, raw: "2019" }, { year: 2019, raw: "2019" })).toBe(true);
    expect(sameDate({ year: 2019 }, { year: 2019, month: 1 })).toBe(false);
    expect(sameDate(undefined, {})).toBe(true);
  });
});
