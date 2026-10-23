import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetsControl } from "@/components/cv/SheetsControl";
import { FIT_LIMIT_PX, PAGE_HEIGHT_PX, sheetLimitPx, sheetsHeightPx } from "@/components/cv/measure";
import { buildCVPrompt } from "@/lib/ai/prompts/build-cv";
import { canAllowTwoSheets } from "@/lib/cv/sheets";
import { acceptedCvPdf, type CvPdfCheck } from "@/lib/export/pdf-check";
import { jobAnalysisSchema } from "@/lib/schemas/job";
import { profileSchema } from "@/lib/schemas/profile";
import { applicationSchema } from "@/lib/storage/application";
import { newApplication } from "@/lib/storage/local";
import { backendProfile } from "./fixtures";

/**
 * One sheet is the promise; two is something the person asks for, once their dates add up to ten years. These pin what each number
 * means in every place that judges the page, so that the preview, the fit, the PDF check and the prompt cannot disagree.
 */

const NOW = new Date(2026, 9, 21);
const worked = (...jobs: Array<[string, string]>) =>
  profileSchema.parse({ fullName: "Ana", experience: jobs.map(([start, end], at) => ({ id: `j${at}`, company: `Empresa ${at}`, role: "Dev", start, end, current: end === "", bullets: ["Hice algo."], tags: [] })) });

describe("who is offered a second sheet", () => {
  it("is anyone whose dates add up to ten years", () => {
    expect(canAllowTwoSheets(worked(["Enero 2014", "Enero 2024"]), NOW)).toBe(true);
    expect(canAllowTwoSheets(worked(["Febrero 2014", "Enero 2024"]), NOW)).toBe(false);
    expect(canAllowTwoSheets(worked(["Enero 2010", ""]), NOW)).toBe(true);
  });

  it("counts overlap once, and the sum of several jobs", () => {
    expect(canAllowTwoSheets(worked(["Enero 2016", "Enero 2022"], ["Enero 2018", "Enero 2024"]), NOW)).toBe(false);
    expect(canAllowTwoSheets(worked(["Enero 2010", "Enero 2015"], ["Enero 2016", "Enero 2021"]), NOW)).toBe(true);
  });

  it("is not read from a job whose dates cannot be", () => {
    expect(canAllowTwoSheets(worked(["", ""]), NOW)).toBe(false);
    expect(canAllowTwoSheets(profileSchema.parse({}), NOW)).toBe(false);
  });
});

describe("what a page holds", () => {
  it("is the same limit as always for one sheet", () => {
    expect(sheetLimitPx(1)).toBe(FIT_LIMIT_PX);
    expect(sheetsHeightPx(1)).toBe(PAGE_HEIGHT_PX);
  });

  it("is two sheets less the padding they print with once, and less a break's reserve, for two", () => {
    expect(sheetsHeightPx(2)).toBeCloseTo(2 * PAGE_HEIGHT_PX - 56.8, 1);
    expect(sheetLimitPx(2)).toBeLessThan(sheetsHeightPx(2));
    expect(sheetLimitPx(2)).toBeGreaterThan(sheetLimitPx(1) + 900);
  });
});

describe("the PDF the server printed", () => {
  const good: CvPdfCheck = { pages: 1, heightPx: 900, overflowX: false, fontsLoaded: true, pdfFonts: "ok" };

  it("is accepted with as many sheets as were allowed, and no more", () => {
    expect(acceptedCvPdf(good)).toBe(true);
    expect(acceptedCvPdf({ ...good, pages: 2 })).toBe(false);
    expect(acceptedCvPdf({ ...good, pages: 2 }, 2)).toBe(true);
    expect(acceptedCvPdf({ ...good, pages: 3 }, 2)).toBe(false);
    expect(acceptedCvPdf({ ...good, pages: 1 }, 2)).toBe(true);
  });

  it("is never accepted unread, nor with the typography or the width gone", () => {
    expect(acceptedCvPdf({ ...good, pages: null }, 2)).toBe(false);
    expect(acceptedCvPdf({ ...good, pdfFonts: "substituted" }, 2)).toBe(false);
    expect(acceptedCvPdf({ ...good, overflowX: true }, 2)).toBe(false);
  });
});

describe("the application", () => {
  it("keeps the person's choice, and reads one nobody made as one sheet", () => {
    const app = newApplication("texto", "Dev · Acme", "a1");
    expect(applicationSchema.parse({ ...app, sheets: 2 }).sheets).toBe(2);
    expect(applicationSchema.parse(app).sheets).toBeUndefined();
    expect(applicationSchema.parse({ ...app, sheets: 7 }).sheets).toBeUndefined();
  });
});

describe("the control", () => {
  const render = (sheets: 1 | 2, offered: boolean) => renderToStaticMarkup(createElement(SheetsControl, { sheets, offered, onChange: () => undefined }));

  it("offers two sheets to ten years of work, and nothing to anyone else", () => {
    expect(render(1, true)).toContain(">Permitir 2 hojas</button>");
    expect(render(1, false)).toBe("");
  });

  it("always offers the way back to whoever took the second sheet", () => {
    expect(render(2, true)).toContain(">Volver a 1 hoja</button>");
    expect(render(2, false)).toContain(">Volver a 1 hoja</button>");
  });
});

describe("what the model is told", () => {
  const analysis = (relevance: "direct" | "unrelated" = "direct") =>
    jobAnalysisSchema.parse({ title: "Backend", language: "es", domain: "software", relevance, relevanceReason: "x", requirements: [], responsibilities: [], keywords: [] });
  const rich = profileSchema.parse({
    ...backendProfile,
    experience: [0, 1, 2, 3].map((n) => ({ id: `e${n}`, company: `Empresa ${n}`, role: "Dev", start: "2012", end: "2013", bullets: Array.from({ length: 8 }, (_, i) => `Tarea ${n}-${i} del servicio de pagos.`), tags: [] })),
  });
  const prompt = (sheets?: 1 | 2, previousFit?: "over", profile = rich, relevance: "direct" | "unrelated" = "direct") =>
    buildCVPrompt({ profile, analysis: analysis(relevance), inferredSkills: [], outputLanguage: "es", ...(sheets ? { sheets } : {}), ...(previousFit ? { previousFit } : {}) });

  it("is one page by default", () => {
    const text = prompt();
    expect(text).toContain("the CV must fit on ONE A4 page");
    expect(text).toContain("Total bullets across all sections: 10–16. Never more than 16.");
    expect(prompt(1)).toBe(text);
  });

  it("is two pages, with their own totals, when the person allowed a second sheet", () => {
    const text = prompt(2);
    expect(text).toContain("the CV may take TWO A4 pages");
    expect(text).toContain("Total bullets across all sections: 18–28. Never more than 28.");
    expect(text).toContain("Most recent or most relevant role: 4–7 bullets");
    expect(text).not.toContain("ONE A4 page");
    // The profile's own count per role is still the ceiling: a second sheet is room, not a quota.
    expect(text).toContain("Never more than the profile gives that role");
  });

  it("measures an overflow against the sheets it was given", () => {
    expect(prompt(undefined, "over")).toContain("onto a second page");
    expect(prompt(2, "over")).toContain("onto a third page");
  });

  it("stays one page for a posting outside the candidate's field, whatever was allowed", () => {
    expect(prompt(2, undefined, rich, "unrelated")).toBe(prompt(undefined, undefined, rich, "unrelated"));
  });
});
