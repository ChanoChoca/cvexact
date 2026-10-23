import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LABEL_OBLIGATIONS,
  LABEL_TYPES,
  bankAdSchema,
  coverage,
  describeReport,
  evaluateBank,
  precision,
  sameStretch,
  type BankAd,
  type Floors,
} from "@/lib/jobs/bank";
import { cleanPosting, isAskable, readRequirements, type RequirementType } from "@/lib/jobs/requirements";

/**
 * The bank of postings the reader is measured against (`tests/fixtures/avisos/`, `docs/banco-de-avisos.md`): that it is a bank — postings
 * with their labels, well formed, with nobody's data in them — and that the reader keeps reading it at least as well as the floors say, the
 * way the postings are written and the way the feed gives them: a page of HTML with its tags taken out, in one line, with no bullets.
 *
 * Run `BANCO_REPORTE=1 pnpm vitest run tests/jobs-bank.test.ts` to see the whole report: what the reader reads, and what it misses.
 */

const DIRECTORY = fileURLToPath(new URL("./fixtures/avisos", import.meta.url));

const files = readdirSync(DIRECTORY)
  .filter((name) => name.endsWith(".json"))
  .sort();
const ads: BankAd[] = files.map((name) => bankAdSchema.parse(JSON.parse(readFileSync(`${DIRECTORY}/${name}`, "utf8"))));

/** What `stripHtml` leaves of a page: every run of white space is one space; a list has no bullets, or — in some sources — keeps them. */
const flatten = (ad: BankAd, bullets: boolean): BankAd => ({
  ...ad,
  texto: ad.texto
    .split("\n")
    .map((line) => (bullets ? line : line.replace(/^\s*(?:[-–—•·▪*]|\d{1,2}[.)])\s+/, "")))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim(),
});

/**
 * Set a little under what was measured when they were set (`docs/banco-de-avisos.md` has the table): a change that makes the reader worse
 * fails here, and one that makes it better does not need to touch this. A floor goes up when the reader improves, and is not lowered without
 * saying, in the commit, which posting made it fall and why that is worth it.
 */
const STRUCTURED: Floors = {
  precision: { tool: 0.95, task: 0.95, condition: 0.95, credential: 0.95, trait: 0.9, other: 0.9 },
  coverage: { tool: 0.93, task: 0.9, condition: 0.95, credential: 0.95, trait: 0.75, other: 0.9 },
  obligation: 0.95,
};
const FLAT: Floors = {
  precision: { tool: 0.95, task: 0.95, condition: 0.95, credential: 0.95, trait: 0.85, other: 0.9 },
  coverage: { tool: 0.9, task: 0.85, condition: 0.93, credential: 0.93, trait: 0.7, other: 0.9 },
  obligation: 0.93,
};

const TYPES: readonly RequirementType[] = ["tool", "task", "condition", "credential", "trait", "other"];

function holds(name: string, report: ReturnType<typeof evaluateBank>, floors: Floors) {
  for (const type of TYPES) {
    const wanted = floors.precision[type];
    const got = precision(report.byType[type]);
    if (wanted !== undefined) expect(got ?? 1, `precision of ${type}, as read in «${name}»`).toBeGreaterThanOrEqual(wanted);
    const reach = floors.coverage[type];
    const covered = coverage(report.byType[type]);
    if (reach !== undefined) expect(covered ?? 1, `coverage of ${type}, as read in «${name}»`).toBeGreaterThanOrEqual(reach);
  }
  const { compared, right } = report.obligation;
  expect(right / compared, `obligation, as read in «${name}»`).toBeGreaterThanOrEqual(floors.obligation);
}

describe("the bank of postings", () => {
  it("has the postings it says it has, in the segments it is for", () => {
    expect(ads.length).toBeGreaterThanOrEqual(40);
    expect(new Set(ads.map((ad) => ad.segmento))).toEqual(new Set(["oficios", "primer-empleo", "tecnico", "administrativo"]));
    // Every kind of thing a posting asks for is in it, with every way of saying how much.
    const labels = ads.flatMap((ad) => ad.requisitos);
    expect(new Set(labels.map((label) => label.tipo))).toEqual(new Set(Object.keys(LABEL_TYPES)));
    expect(new Set(labels.map((label) => label.obligatoriedad))).toEqual(new Set(Object.keys(LABEL_OBLIGATIONS)));
    expect(labels.length).toBeGreaterThanOrEqual(200);
  });

  it("is made of files named for what they hold, each once", () => {
    for (const [index, ad] of ads.entries()) expect(files[index], ad.id).toBe(`${ad.id}.json`);
    expect(new Set(ads.map((ad) => ad.id)).size).toBe(ads.length);
  });

  it("holds the words of the posting, copied — and nobody's data", () => {
    for (const ad of ads) {
      for (const label of ad.requisitos) expect(ad.texto, `${ad.id}: «${label.fragmento}»`).toContain(label.fragmento);
      // No person's contact: an address is the example one, and no run of digits is a phone, a document or a tax number.
      for (const email of ad.texto.match(/[\w.+-]+@[\w.-]+/g) ?? []) expect(email, ad.id).toMatch(/@example\.com$/);
      expect(ad.texto, ad.id).not.toMatch(/\d[\d\s-]{7,}\d/);
      expect(ad.texto, ad.id).not.toMatch(/https?:\/\//);
    }
  });

  it("says where each posting comes from, and the seed is the examples it says it is", () => {
    for (const ad of ads) expect(["ejemplo", "real"], ad.id).toContain(ad.origen);
    expect(ads.filter((ad) => ad.origen === "ejemplo").length).toBeGreaterThanOrEqual(40);
  });
});

describe("the reader against the bank", () => {
  const structured = evaluateBank(ads);

  it("reads a posting as it is written", () => {
    holds("as written", structured, STRUCTURED);
  });

  it("reads it as the feed gives it: a page with its tags taken out", () => {
    holds("one line, no bullets", evaluateBank(ads.map((ad) => flatten(ad, false))), FLAT);
    holds("one line, bullets kept", evaluateBank(ads.map((ad) => flatten(ad, true))), FLAT);
  });

  it("has floors with teeth: a reader that reads nothing, or reads every line as a tool, does not clear them", () => {
    expect(() => holds("nothing", evaluateBank(ads, () => []), STRUCTURED)).toThrow();
    const everything = (text: string) =>
      text
        .split("\n")
        .filter((line) => line.trim().length > 3)
        .map((line) => ({ fragment: line.trim(), type: "tool" as const, obligation: "unstated" as const, subjects: [line.trim()], conditions: [] }));
    expect(() => holds("everything", evaluateBank(ads, everything), STRUCTURED)).toThrow();
  });

  it("reads the same bank to the same report", () => {
    expect(evaluateBank(ads)).toEqual(structured);
  });

  it("quotes only the posting: every fragment is a piece of it", () => {
    for (const ad of ads) {
      for (const variant of [ad, flatten(ad, false)]) {
        const text = cleanPosting(variant.texto);
        for (const requirement of readRequirements(variant.texto)) {
          // The quote has had its white space made one space, as `cleanFragment` does.
          expect(text.replace(/\s+/g, " "), `${ad.id}: «${requirement.fragment}»`).toContain(requirement.fragment);
        }
      }
    }
  });

  it("never offers to ask about a trait, or about what is not asked: only a tool, a task, a condition or a credential, and a thing it names", () => {
    for (const ad of ads) {
      for (const requirement of readRequirements(ad.texto)) {
        if (!isAskable(requirement)) continue;
        expect(["tool", "task", "condition", "credential"], ad.id).toContain(requirement.type);
        expect(requirement.subjects.length, `${ad.id}: «${requirement.fragment}» names nothing`).toBeGreaterThan(0);
        expect(requirement.obligation).not.toBe("preferred");
      }
    }
  });

  it("does not ask about anything the posting says it does not ask", () => {
    for (const ad of ads) {
      for (const requirement of readRequirements(ad.texto)) {
        expect(requirement.fragment, ad.id).not.toMatch(/no (?:es necesari|se requiere|hace falta)|sin experiencia/i);
      }
    }
  });

  it("is not taken in by a posting that is not one", () => {
    for (const text of ["Estamos muy contentos con nuestro equipo. Trabajamos todos los días con pasión.", "Hola, ¿tenés un rato para hablar?"]) {
      expect(readRequirements(text)).toEqual([]);
    }
  });

  it("matches a reading to a label by the stretch of the posting, not by the word for it", () => {
    expect(sameStretch("Debe manejar secador y plancha", "manejar secador y plancha")).toBe(true);
    expect(sameStretch("Excel", "Excel avanzado (excluyente)")).toBe(true);
    expect(sameStretch("Disponibilidad full time", "Disponibilidad para turnos rotativos")).toBe(false);
    expect(sameStretch("", "algo")).toBe(false);
  });

  it("says what it reads and what it misses, when asked", () => {
    const report = describeReport(structured);
    expect(report).toContain(`Avisos: ${ads.length}`);
    for (const type of TYPES) expect(report).toContain(type);
    if (process.env.BANCO_REPORTE) {
      console.log(report);
      console.log("\nNo leídos:\n" + structured.misses.map((miss) => `  ${miss.ad} · ${miss.type} · ${miss.fragment}`).join("\n"));
      console.log("\nLeídos de más:\n" + structured.extras.map((extra) => `  ${extra.ad} · ${extra.type} · ${extra.fragment}`).join("\n"));
    }
  });
});
