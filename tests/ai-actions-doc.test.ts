import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GOOGLE_EUROPE,
  GOOGLE_FREE_FACTS,
  GOOGLE_PAID_FACTS,
  GOOGLE_TERMS_IN_FORCE,
  GOOGLE_TERMS_READ_ON,
  GOOGLE_TERMS_URL,
  GOOGLE_UNPAID_DEFINITION,
} from "@/lib/ai/google-terms";

/**
 * `docs/ia-con-y-sin-ia.md` says, for every action that sends something to a model, what is sent and what is done when there is no model:
 * nothing of the profile depends on the AI. It is kept honest the one way that can be: a route that is added under
 * `app/api/generate/` and is not in the table fails here, so whoever adds an action with AI has to say what is done without it.
 */

const doc = readFileSync("docs/ia-con-y-sin-ia.md", "utf8");

const routes = readdirSync("app/api/generate")
  .filter((name) => statSync(`app/api/generate/${name}`).isDirectory())
  .sort();

/** The rows of the table of actions: those that name a route. */
const rows = doc
  .split("\n")
  .filter((line) => line.startsWith("|") && /`\/api\/generate\/[a-z]+/.test(line))
  .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));

describe("the actions with AI, and what is done without it", () => {
  it("has a row for every route that talks to a model, and the routes are the ones there are", () => {
    expect(routes).toEqual(["answers", "condense", "cv", "email", "followup", "import", "improve", "interview", "result", "split", "transcribe", "video"]);
    for (const route of routes) expect(rows.some((row) => row[2]!.includes(`/api/generate/${route}`)), `/api/generate/${route}`).toBe(true);
  });

  it("says, in each row, what is sent and what is done without a model — and never leaves a cell empty", () => {
    expect(rows.length).toBeGreaterThanOrEqual(routes.length);
    for (const row of rows) {
      expect(row, row[0]).toHaveLength(5);
      for (const cell of row) expect(cell.length, `${row[0]}: a cell is empty`).toBeGreaterThan(3);
    }
  });

  it("says, of what reads the person's own words, that who they are is not sent, and of the photo that it goes whole", () => {
    const reading = rows.filter((row) => /import|improve|split|followup/.test(row[2]!));
    expect(reading.length).toBeGreaterThanOrEqual(4);
    for (const row of reading) expect(row[3], row[0]).toMatch(/sin tu nombre|con el mismo tapado/);
    const photo = rows.find((row) => row[2]!.includes("/api/generate/transcribe"))!;
    expect(photo[3]).toMatch(/foto entera/);
    expect(photo[3]).toMatch(/no se puede tapar/);
    expect(photo[4]).toMatch(/Pegar el texto/);
  });

  it("says that the CV adapted to an offer is the one thing that has no way without a model, and what is there instead", () => {
    const cv = rows.find((row) => row[2]!.includes("/api/generate/cv"))!;
    expect(cv[4]).toMatch(/CV base/);
    expect(cv[4]).toMatch(/No hay adaptación a un aviso sin IA/);
  });
});

describe("what it says of Google", () => {
  it("quotes the terms in Google's words, all of them, and says when they were read", () => {
    for (const fact of [...GOOGLE_FREE_FACTS, ...GOOGLE_PAID_FACTS]) {
      expect(doc, fact.id).toContain(fact.from);
      expect(doc, fact.id).toContain(fact.says);
    }
    expect(doc).toContain(GOOGLE_EUROPE.from);
    expect(doc).toContain(GOOGLE_EUROPE.says);
    expect(doc).toContain(GOOGLE_UNPAID_DEFINITION.replace(/\\"/g, '"').slice(0, 60));
    expect(doc).toContain(GOOGLE_TERMS_URL);
    expect(doc).toContain(GOOGLE_TERMS_IN_FORCE.replace(" de 2026", ""));
    // «7 de octubre de 2026»: the day it was read, as the document says it.
    expect(GOOGLE_TERMS_READ_ON).toBe("2026-10-07");
    expect(doc).toContain("7 de octubre de 2026");
  });

  it("does not leave the open question closed: whether it is for a person who uses their own key is for the advisers", () => {
    expect(doc).toMatch(/pregunta legal sin contestar/);
    expect(doc).toMatch(/asesoría/);
  });
});
