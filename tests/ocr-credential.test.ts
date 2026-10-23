import { describe, expect, it } from "vitest";
import { classesText, expiryLabel, likelyExpiry, readCredential } from "@/lib/ocr/credential";

/**
 * What is taken from the text an OCR made of the photo of a driving licence (e5, O18; O7): the class and the day it lapses, and nothing of what else is on the
 * card. Each case is what an OCR makes of a card, with what it gets wrong — a letter for a digit, a space where there is none, the word and its date on lines of their own.
 */

const CARD = `REPUBLICA ARGENTINA
LICENCIA NACIONAL DE CONDUCIR
APELLIDO: PEREZ
NOMBRE: LUCIA
DNI 30.123.456
NACIMIENTO: 03/11/1990
DOMICILIO: AV. CORRIENTES 1234, CABA
CLASE: B1
OTORGAMIENTO: 12/05/2024
VENCIMIENTO: 12/05/2029
GRUPO SANGUINEO O+ DONANTE SI`;

describe("a licence", () => {
  it("gives the class and the day it lapses, and not the day of birth nor the day it was given", () => {
    const found = readCredential(CARD);
    expect(found.classes).toEqual(["B1"]);
    expect(found.expiries).toEqual([{ year: 2029, month: 5, day: 12, after: "vence" }]);
  });

  it("returns nothing of the rest of the card: no name, no document, no address, no blood group, no donation", () => {
    const said = JSON.stringify(readCredential(CARD));
    for (const secret of ["PEREZ", "LUCIA", "30.123.456", "CORRIENTES", "SANGUINEO", "DONANTE", "O+", "1990", "03/11", "2024"]) expect(said, secret).not.toContain(secret);
  });

  it("is the same for every way a card is written: dots, dashes, spaces, a month and a year alone, other words for it", () => {
    for (const line of ["VENCIMIENTO: 12/05/2029", "VENCIMIENTO 12-05-2029", "VENC. 12.05.2029", "VTO: 12 / 05 / 2029", "Vence 12/05/2029", "VALIDA HASTA 12/05/2029", "VIGENCIA: 12/05/2029"]) {
      expect(readCredential(line).expiries, line).toEqual([{ year: 2029, month: 5, day: 12, after: "vence" }]);
    }
    expect(readCredential("VENCE: 05/2029").expiries).toEqual([{ year: 2029, month: 5, after: "vence" }]);
    expect(expiryLabel({ year: 2029, month: 5 })).toBe("05/2029");
  });

  it("puts right what an OCR reads wrong in a date: a letter O for a zero, an l or a bar for a one", () => {
    expect(readCredential("VENCIMIENTO 1O/O5/2O29").expiries[0]).toMatchObject({ year: 2029, month: 5, day: 10 });
    expect(readCredential("VENCIMIENTO l2/l0/2O3l").expiries[0]).toMatchObject({ year: 2031, month: 10, day: 12 });
    expect(readCredential("VENCIMIENTO |2/05/2029").expiries[0]).toMatchObject({ year: 2029, month: 5, day: 12 });
  });

  it("finds the word and its value when the OCR put them on lines of their own", () => {
    const found = readCredential("CLASE\nB.1\nVENCIMIENTO\n12/05/2029\nNACIMIENTO\n03/11/1990");
    expect(found.classes).toEqual(["B.1"]);
    expect(found.expiries.map(expiryLabel)).toEqual(["05/2029"]);
  });

  it("gives every class on the line, as it is printed — dots, letters read for numbers, spaces in between — and not the words after them", () => {
    expect(readCredential("CLASE: A.2.1 B.1 VENCE 12/05/2029").classes).toEqual(["A.2.1", "B.1"]);
    expect(readCredential("CLASES D1, D2").classes).toEqual(["D1", "D2"]);
    expect(readCredential("CLASE: B l").classes).toEqual(["B1"]);
    expect(readCredential("CLASE B | C 2").classes).toEqual(["B1", "C2"]);
    expect(readCredential("Clase b1").classes).toEqual(["B1"]);
    expect(readCredential("CATEGORIA: C3").classes).toEqual(["C3"]);
  });

  it("does not take a word for a class: the A of «B1 A LA» is not one, and a class is only after the word that says so", () => {
    expect(readCredential("CLASE: B1 A LA ORDEN DEL JUEZ").classes).toEqual(["B1"]);
    expect(readCredential("CLASE: ROMA").classes).toEqual([]);
    expect(readCredential("TIPO B1 VENCE 12/05/2029").classes).toEqual([]);
    expect(readCredential("CLASE: H3").classes).toEqual([]);
    expect(readCredential("Una clase de cocina, a las 18").classes).toEqual([]);
  });

  it("is a licence with nothing to read when the photo gave nothing: no class, no date", () => {
    expect(readCredential("")).toEqual({ classes: [], expiries: [] });
    expect(readCredential("asdf qwer 12 34 zzz")).toEqual({ classes: [], expiries: [] });
  });
});

describe("the dates", () => {
  it("put first the ones that say they lapse, in the order of the photo, and then the rest", () => {
    const found = readCredential("OTROS 07/07/2031 TEXTO\nVENCE 12/05/2029\nVENC 03/2034\nFECHA 09/09/2027");
    expect(found.expiries.map((entry) => [expiryLabel(entry), entry.after])).toEqual([
      ["05/2029", "vence"],
      ["03/2034", "vence"],
      ["07/2031", "otra"],
      ["09/2027", "otra"],
    ]);
  });

  it("leave out a date of birth and the day it was given, in any of the ways they are written", () => {
    for (const line of ["NACIMIENTO 03/11/1990", "F. NAC: 03/11/1990", "FECHA DE NAC. 03-11-1990", "OTORGAMIENTO 12/05/2024", "EMISION: 12/05/2024", "EMITIDA 12/05/2024", "EXPEDIDA 12/05/2024", "ALTA 12/05/2024", "1ERA 12/05/2024", "PRIMER OTORGAMIENTO 12/05/2024"]) {
      expect(readCredential(line).expiries, line).toEqual([]);
    }
    // But the one that says it lapses stays, next to them.
    expect(readCredential("NAC. 03/11/1990 OTORG. 12/05/2024 VENC. 12/05/2029").expiries).toEqual([{ year: 2029, month: 5, day: 12, after: "vence" }]);
  });

  it("leave out the day a validity starts, and keep the one it ends", () => {
    expect(readCredential("VIGENCIA: desde 12/05/2024 hasta 12/05/2029").expiries.map(expiryLabel)).toEqual(["05/2029"]);
  });

  it("do not borrow the word of the date before: what says «vence» is for the date it is next to", () => {
    const found = readCredential("VENC 03/2034\nFECHA 09/09/2027");
    expect(found.expiries.map((entry) => [expiryLabel(entry), entry.after])).toEqual([
      ["03/2034", "vence"],
      ["09/2027", "otra"],
    ]);
  });

  it("keep, of a month that is twice in the photo, the one that says it lapses", () => {
    expect(readCredential("FECHA 20/05/2029 VENCE 12/05/2029").expiries).toEqual([{ year: 2029, month: 5, day: 12, after: "vence" }]);
  });

  it("are dates and not numbers: a year out of reach, a day or a month that does not exist, a phone, a document", () => {
    for (const line of ["VENCE 12/05/1850", "VENCE 12/05/2400", "VENCE 32/05/2029", "VENCE 12/13/2029", "TEL 011 4555 1234", "DNI 30.123.456", "1234/2029/55"]) {
      expect(readCredential(line).expiries, line).toEqual([]);
    }
  });

  it("are no more than four, each month once", () => {
    const text = Array.from({ length: 8 }, (_, index) => `VENC ${String(index + 1).padStart(2, "0")}/0${(index % 8) + 1}/203${index % 8}`).join("\n");
    expect(readCredential(`${text}\nVENC 01/01/2030`).expiries.length).toBeLessThanOrEqual(4);
    expect(readCredential("VENC 12/05/2029\nVENC 20/05/2029").expiries).toHaveLength(1);
  });
});

describe("an expiry from another kind of credential", () => {
  it("is the same: a carnet or a matrícula says when it lapses, and has no class", () => {
    const found = readCredential("CARNET DE MANIPULACION DE ALIMENTOS\nNOMBRE: LUCIA PEREZ\nVALIDO HASTA 15/08/2027");
    expect(found.classes).toEqual([]);
    expect(found.expiries).toEqual([{ year: 2027, month: 8, day: 15, after: "vence" }]);
  });
});

describe("what is offered before the person looks", () => {
  it("is the one date that says it lapses, or the only date there is", () => {
    expect(likelyExpiry(readCredential("NAC 03/11/1990\nVENCE 12/05/2029\nFECHA 09/09/2027"))).toMatchObject({ year: 2029, month: 5 });
    expect(likelyExpiry(readCredential("FECHA 09/09/2027"))).toMatchObject({ year: 2027, month: 9 });
  });

  it("is none when there is more than one to choose from: a guess there is a wrong date in a profile", () => {
    expect(likelyExpiry(readCredential("VENCE 12/05/2029\nVTO 03/2034"))).toBeNull();
    expect(likelyExpiry(readCredential("FECHA 09/09/2027\nOTRA 01/01/2030"))).toBeNull();
    expect(likelyExpiry(readCredential("sin fechas"))).toBeNull();
  });

  it("gives the classes the way the box takes them", () => {
    expect(classesText(readCredential("CLASE: A.2.1 B.1"))).toBe("A.2.1, B.1");
    expect(classesText(readCredential("nada"))).toBe("");
  });
});
