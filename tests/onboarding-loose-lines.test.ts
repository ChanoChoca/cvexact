import { describe, expect, it } from "vitest";
import type { Extraction } from "@/lib/ai/prompts/extract";
import { looseLineRanges } from "@/lib/parse/coverage";
import { REDACTED } from "@/lib/parse/cv-heuristic";
import { parseDocument } from "@/lib/parse";
import { applyParsedDocument, type SourceInfo } from "@/lib/parse/to-profile";
import { verifyExtraction } from "@/lib/parse/verify-extraction";
import type { ParsedDocument } from "@/lib/parse/types";
import { dismissAllLoose, dismissLoose, looseLineCount, looseSummary, looseText, looseToNote, readReceipt } from "@/lib/onboarding/review";
import { MAX_LOOSE_RANGES, emptyStoredProfile, importedSourceSchema, type StoredProfile } from "@/lib/schemas/profile-v2";
import { AMBIGUOUS, DATES_FIRST, ENGLISH_STACKED, SPANISH_BULLETS, UNDATED_EDUCATION, WITH_PERSONAL_DATA } from "./fixtures/cv-samples";
import { LINKEDIN_EN, LINKEDIN_ES, LINKEDIN_ES_BARE, layout } from "./fixtures/linkedin-layout";

/**
 * A reading shows what it found and says nothing of what it left: a person who sees four jobs on the screen does not
 * learn that a fifth was in the file and went nowhere. These are the cases where the file's own lines are set beside
 * what was kept from them — and the ones where saying so would be noise.
 */

const q = (value: string, quote = value) => ({ value, quote });

function extraction(overrides: Partial<Extraction> = {}): Extraction {
  return {
    contact: { fullName: null, headline: null, email: null, phone: null, city: null, country: null, links: [] },
    experience: [],
    education: [],
    certifications: [],
    languages: [],
    skills: [],
    projects: [],
    unassigned: [],
    ...overrides,
  };
}

const VOLUNTEERING = [
  "Participé como voluntaria en un comedor comunitario del barrio durante tres años,",
  "organizando las donaciones y coordinando al resto de los voluntarios.",
];

const CV = [
  "Marta Ruiz",
  "Contadora",
  "marta@example.com",
  "",
  "EXPERIENCIA",
  "Estudio Lara — Contadora — 2019 a 2023",
  "Liquidé los impuestos de cuarenta clientes",
  "Armé los balances trimestrales de la cartera",
  "",
  "VOLUNTARIADO",
  ...VOLUNTEERING,
  "",
  "IDIOMAS",
  "Inglés intermedio",
].join("\n");

/** What a model made of `CV`: the job and the language, and not the volunteering. */
const READ_BY_MODEL = extraction({
  contact: { fullName: q("Marta Ruiz"), headline: q("Contadora"), email: q("marta@example.com"), phone: null, city: null, country: null, links: [] },
  experience: [
    {
      kind: "job",
      company: q("Estudio Lara"),
      role: q("Contadora"),
      city: null,
      country: null,
      start: null,
      end: null,
      facts: [q("Liquidé los impuestos de cuarenta clientes"), q("Armé los balances trimestrales de la cartera")],
    },
  ],
  languages: [{ name: q("Inglés"), level: q("intermedio") }],
});

const reading = (text = CV, overrides: Partial<Extraction> = READ_BY_MODEL) => verifyExtraction(text, extraction(overrides), "cv");
const at = (doc: ParsedDocument, text: string) => doc.lines!.indexOf(text);

describe("the stretches of a document that nothing was kept from", () => {
  it("are the paragraph a model did not carry over", () => {
    const doc = reading();
    const from = at(doc, VOLUNTEERING[0]!);
    expect(looseLineRanges(doc)).toEqual([[from, from + 1]]);
  });

  it("are none when what was kept is everything the document said", () => {
    const doc = reading(CV, {
      ...READ_BY_MODEL,
      unassigned: [{ text: VOLUNTEERING.join(" "), kind: "other", heading: "Voluntariado" }],
    });
    // The tray is on its way to the person's eyes: not a place the lines went to and were lost.
    expect(looseLineRanges(doc)).toEqual([]);
  });

  it("are none for a line whose words are mostly in a value that was kept", () => {
    const doc = reading(CV, { ...READ_BY_MODEL, projects: [{ name: q("Participé como voluntaria en un comedor comunitario"), description: null, url: null }] });
    const from = at(doc, VOLUNTEERING[0]!);
    // The first line is covered, the second is not: the stretch is the one that is.
    expect(looseLineRanges(doc)).toEqual([[from + 1, from + 1]]);
  });

  it("are not found in a document the patterns read: they keep a line with the value, even a whole line for one word", () => {
    for (const text of [SPANISH_BULLETS, ENGLISH_STACKED, DATES_FIRST, AMBIGUOUS, WITH_PERSONAL_DATA, UNDATED_EDUCATION]) {
      expect(looseLineRanges(parseDocument({ text }))).toEqual([]);
    }
  });

  it("are not found in a LinkedIn PDF either, where the lines of one summary sit apart with a sidebar between them", () => {
    for (const specs of [LINKEDIN_ES, LINKEDIN_ES_BARE, LINKEDIN_EN]) {
      const doc = parseDocument({ text: "", runs: layout(specs), info: { author: "LinkedIn" } });
      expect(doc.kind).toBe("linkedin_pdf");
      expect(looseLineRanges(doc)).toEqual([]);
    }
  });

  it("are not made of a length of time — LinkedIn sets one under a company, and its dates are read", () => {
    const text = ["6 years 3 months", "2 años 6 meses", "1 año", "8 meses y 3 años", "Colecciono monedas antiguas y organizo encuentros mensuales"].join("\n");
    const doc = reading(text, extraction());
    expect(looseLineRanges(doc)).toEqual([[4, 4]]);
  });

  it("count the lines a card offers to choose between: a company that could be either of two is not lost", () => {
    const doc = parseDocument({ text: DATES_FIRST });
    // «Repositor — Almacén Central» became a role, and a candidate for the company the card asks about.
    expect(doc.experience[1]!.candidates).toContain("Almacén Central");
    expect(looseLineRanges(doc)).toEqual([]);
  });

  it("never include a heading, which names a section and says nothing in it", () => {
    const doc = reading(CV, extraction());
    const ranges = looseLineRanges(doc);
    for (const [from, to] of ranges) {
      for (let line = from; line <= to; line++) expect(doc.lines![line]).not.toMatch(/^(EXPERIENCIA|VOLUNTARIADO|IDIOMAS)$/);
    }
  });

  it("do not run over a heading: what is above it and below it are two", () => {
    const text = [
      "Participé como voluntario en comedores comunitarios del barrio durante tres años",
      "HOBBIES",
      "Colecciono monedas antiguas y organizo encuentros mensuales con otros coleccionistas",
    ].join("\n");
    const doc = reading(text, extraction());
    expect(looseLineRanges(doc)).toEqual([[0, 0], [2, 2]]);
  });

  it("do not run over a line struck out as personal data", () => {
    const doc = reading(CV, extraction());
    const from = at(doc, VOLUNTEERING[0]!);
    doc.lines![from + 1] = REDACTED;
    expect(looseLineRanges(doc)).toContainEqual([from, from]);
    expect(looseLineRanges(doc).every(([start, end]) => !(start <= from + 1 && from + 1 <= end))).toBe(true);
  });

  it("are not made of lines too short to say something", () => {
    const text = ["Ver más", "2019", "Sí, claro", "Página 2 de 3"].join("\n");
    expect(looseLineRanges(reading(text, extraction()))).toEqual([]);
  });

  it("keep a short line between two that did say something, and drop it at either end", () => {
    const text = [
      "Colaboré con la cooperadora de la escuela del barrio durante varios ciclos",
      "Ver más",
      "organizando las rendiciones anuales y los eventos solidarios del año",
      "Ver más",
    ].join("\n");
    expect(looseLineRanges(reading(text, extraction()))).toEqual([[0, 2]]);
  });

  it("end at a blank line: a paragraph is a thing of its own", () => {
    const text = [
      "Colaboré con la cooperadora de la escuela del barrio durante varios ciclos",
      "",
      "Organicé las rendiciones anuales y los eventos solidarios del año",
    ].join("\n");
    expect(looseLineRanges(reading(text, extraction()))).toEqual([[0, 0], [2, 2]]);
  });

  it("find a value whose quote runs over two lines — a task written on two", () => {
    const text = ["Coordiné el equipo de ventas de la sucursal norte", "durante el período de mayor demanda del año"].join("\n");
    expect(looseLineRanges(reading(text, extraction()))).toEqual([[0, 1]]);
    const kept = reading(text, extraction({ unassigned: [{ text: text.replace("\n", " "), kind: "other", heading: null }] }));
    expect(looseLineRanges(kept)).toEqual([]);
  });

  it("are none for a document with no lines to point at — a data export", () => {
    const doc = reading();
    delete doc.lines;
    expect(looseLineRanges(doc)).toEqual([]);
  });

  it(`stop at ${MAX_LOOSE_RANGES}: a document the reading made nothing of is not a list of a hundred`, () => {
    const paragraph = (n: number) => `Participé en la actividad número ${n} organizando voluntarios y recursos del barrio`;
    const text = Array.from({ length: 100 }, (_, n) => paragraph(n)).join("\n\n");
    expect(looseLineRanges(reading(text, extraction()))).toHaveLength(MAX_LOOSE_RANGES);
  });
});

describe("applying a document", () => {
  const info: SourceInfo = { name: "cv.pdf", fileHash: "hash-1", pasted: false, chars: 400 };
  const apply = (doc: ParsedDocument) => applyParsedDocument(emptyStoredProfile(), doc, info, { sourceId: "src-1", now: "2026-10-03T12:00:00.000Z", newId: () => crypto.randomUUID() });

  it("keeps where the lines that went nowhere are, and not what they say", () => {
    const doc = reading();
    const source = apply(doc).profile.sources[0]!;
    const from = at(doc, VOLUNTEERING[0]!);
    expect(source.loose).toEqual([[from, from + 1]]);
    expect(JSON.stringify(source)).not.toContain("comedor");
  });

  it("keeps nothing when nothing was left over", () => {
    const source = apply(parseDocument({ text: SPANISH_BULLETS })).profile.sources[0]!;
    expect(source.loose).toBeUndefined();
    expect("loose" in source).toBe(false);
  });

  it("leaves a story to its own tray: its loose sentences are cards already", () => {
    const text = "Trabajé cinco años en Acme como analista, armaba los informes de ventas. Me encanta trabajar en equipo y aprender cosas nuevas.";
    const dump = verifyExtraction(text, extraction({ experience: [{ kind: "job", company: q("Acme"), role: q("analista"), city: null, country: null, start: null, end: null, facts: [q("armaba los informes de ventas")] }] }), "dump");
    expect(apply(dump).profile.sources[0]!.loose).toBeUndefined();
  });
});

describe("the stretches in a profile", () => {
  const withLoose = (): StoredProfile => {
    const profile = emptyStoredProfile();
    profile.sources.push(importedSourceSchema.parse({ id: "src-1", kind: "cv", name: "cv.pdf", loose: [[3, 4], [9, 9], [12, 14]] }));
    return profile;
  };
  const LINES = ["a", "b", "c", "Participé como voluntaria en un comedor", "  organizando las donaciones  ", "", "f", "g", "h", "Colecciono monedas"];

  it("are counted by their lines", () => {
    expect(looseLineCount([[3, 4], [9, 9], [12, 14]])).toBe(6);
    expect(looseLineCount(undefined)).toBe(0);
  });

  it("are said back in the receipt, when there are some", () => {
    const profile = withLoose();
    profile.sources[0]!.read = { experience: 1, education: 0, facts: 2, skills: 0, languages: 0, certifications: 0, projects: 0, unassigned: 0, conflicts: 0 };
    expect(readReceipt(profile.sources[0]!)).toMatchObject({ sourceId: "src-1", loose: 6 });
    delete profile.sources[0]!.loose;
    expect(readReceipt(profile.sources[0]!)).not.toHaveProperty("loose");
  });

  it("are said in the terms of the document they were left over from, and in the number", () => {
    expect(looseSummary(1, "cv")).toBe("1 línea de tu CV no quedó en ningún lado");
    expect(looseSummary(7, "cv")).toBe("7 líneas de tu CV no quedaron en ningún lado");
    expect(looseSummary(2, "linkedin_pdf")).toBe("2 líneas de tu perfil de LinkedIn no quedaron en ningún lado");
  });

  it("read from the original as the lines they point at, without the empty ones", () => {
    expect(looseText(LINES, [3, 5])).toBe("Participé como voluntaria en un comedor\norganizando las donaciones");
    expect(looseText(LINES, [9, 9])).toBe("Colecciono monedas");
    expect(looseText(LINES, [20, 22])).toBe("");
  });

  it("become a note, which keeps where it came from and comes off the list", () => {
    const profile = withLoose();
    expect(looseToNote(profile, "src-1", [3, 4], looseText(LINES, [3, 4]), { now: "2026-10-03T12:00:00.000Z", newId: () => "note-1" })).toBe(true);
    expect(profile.notes).toEqual([{ id: "note-1", text: "Participé como voluntaria en un comedor\norganizando las donaciones", sourceId: "src-1", at: "2026-10-03T12:00:00.000Z" }]);
    expect(profile.sources[0]!.loose).toEqual([[9, 9], [12, 14]]);
  });

  it("are not asked for twice: a stretch that was dealt with is not there to deal with again", () => {
    const profile = withLoose();
    expect(looseToNote(profile, "src-1", [9, 9], "Colecciono monedas")).toBe(true);
    expect(looseToNote(profile, "src-1", [9, 9], "Colecciono monedas")).toBe(false);
    expect(profile.notes).toHaveLength(1);
  });

  it("come off the list even when the same words are already a note", () => {
    const profile = withLoose();
    profile.notes.push({ id: "n", text: "colecciono   MONEDAS", at: "" });
    expect(looseToNote(profile, "src-1", [9, 9], "Colecciono monedas")).toBe(true);
    expect(profile.notes).toHaveLength(1);
    expect(profile.sources[0]!.loose).toEqual([[3, 4], [12, 14]]);
  });

  it("can be let go, one by one, and the key goes with the last", () => {
    const profile = withLoose();
    expect(dismissLoose(profile, "src-1", [9, 9])).toBe(true);
    expect(dismissLoose(profile, "src-1", [9, 9])).toBe(false);
    expect(profile.notes).toEqual([]);
    expect(dismissLoose(profile, "src-1", [3, 4])).toBe(true);
    expect(dismissLoose(profile, "src-1", [12, 14])).toBe(true);
    expect("loose" in profile.sources[0]!).toBe(false);
  });

  it("can all be let go at once", () => {
    const profile = withLoose();
    expect(dismissAllLoose(profile, "src-1")).toBe(true);
    expect("loose" in profile.sources[0]!).toBe(false);
    expect(dismissAllLoose(profile, "src-1")).toBe(false);
    expect(dismissAllLoose(profile, "nobody")).toBe(false);
  });

  it("do nothing to a document that is not there", () => {
    const profile = withLoose();
    expect(looseToNote(profile, "nobody", [3, 4], "x")).toBe(false);
    expect(dismissLoose(profile, "nobody", [3, 4])).toBe(false);
    expect(profile.notes).toEqual([]);
  });

  it("travel with the profile, and are let go of when they are not stretches", () => {
    expect(importedSourceSchema.parse({ id: "s", loose: [[1, 2]] }).loose).toEqual([[1, 2]]);
    expect(importedSourceSchema.parse({ id: "s", loose: "x" }).loose).toBeUndefined();
    expect(importedSourceSchema.parse({ id: "s", loose: [[1]] }).loose).toBeUndefined();
    expect(importedSourceSchema.parse({ id: "s", loose: [[-1, 2]] }).loose).toBeUndefined();
    expect(importedSourceSchema.parse({ id: "s", loose: Array.from({ length: MAX_LOOSE_RANGES + 1 }, (_, n) => [n, n]) }).loose).toBeUndefined();
    expect(importedSourceSchema.parse({ id: "s" }).loose).toBeUndefined();
  });
});
