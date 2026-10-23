import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CVDocument } from "@/components/cv/CVDocument";
import { AnswersIllustration, AtsIllustration, TimeIllustration, WeekIllustration } from "@/components/onboarding/Illustrations";
import { buildAnswersPrompt } from "@/lib/ai/prompts/answer-questions";
import { buildCVPrompt } from "@/lib/ai/prompts/build-cv";
import { templateCV } from "@/lib/fixtures/template-cv";
import { cvDocumentSchema } from "@/lib/schemas/cv";
import { jobAnalysisSchema } from "@/lib/schemas/job";
import { answerSchema } from "@/lib/schemas/outputs";
import { GHOSTING_DAYS } from "@/lib/tracker/constants";
import { APPLICATION_STATUS_LABEL, CLOSED_BOARD_STATUSES, OPEN_BOARD_STATUSES } from "@/lib/tracker/status";
import { RULES } from "@/lib/voice";
import { backendProfile } from "./fixtures";

/**
 * Stage 4 of the profile's new first load: four cards between the parts of «de cero» that say what the profile is for. What is checked is what
 * they claim: that each one is still true of the code it speaks of (the headings the CV prints, that it is one column, that the posting's
 * words are used only where the profile has them, how the answers are counted, the states of the board), and that none of them is a number, a
 * promise or something to press.
 */

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/<!-- -->/g, "");
const words = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** What a person reads: the numerals inside a drawing only match the list beside it. */
const read = (markup: string) => words(markup.replace(/<svg[\s\S]*?<\/svg>/g, " "));
const source = (path: string) => readFileSync(path, "utf8");

/** A posting that asks for something the profile has (Go, AWS) and something it does not (CQRS, event sourcing). */
const analysis = jobAnalysisSchema.parse({
  title: "Software Engineer Backend",
  company: "Ualá",
  language: "es",
  domain: "software engineering (backend, fintech)",
  relevance: "direct",
  relevanceReason: "Backend engineer applying to a backend role.",
  requirements: [
    { text: "Experiencia sólida en desarrollo backend utilizando Go.", kind: "hard" },
    { text: "Conocimientos avanzados de event sourcing y CQRS.", kind: "hard" },
  ],
  responsibilities: ["Diseñar soluciones backend cloud-native sobre AWS."],
  keywords: ["Go", "AWS", "CQRS", "event sourcing"],
});

const CARDS = { tiempo: TimeIllustration, ats: AtsIllustration, respuestas: AnswersIllustration, semana: WeekIllustration } as const;
const card = (id: keyof typeof CARDS) => html(createElement(CARDS[id]));
const ids = Object.keys(CARDS) as Array<keyof typeof CARDS>;

describe("the cards between the parts", () => {
  it.each(ids)("«%s» is a figure with its drawing, its title and what it shows in words", (id) => {
    const markup = card(id);
    expect(markup).toMatch(new RegExp(`^<figure data-illustration="${id}"`));
    expect(markup).toContain("<figcaption>");
    // The drawing is shapes: whoever reads the page by ear gets the words and not a drawing that says nothing.
    expect(markup.match(/<svg/g)).toHaveLength(1);
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(read(markup).length).toBeGreaterThan(100);
  });

  it.each(ids)("«%s» has nothing to press: it is not a step, and does not stand between the person and «Siguiente»", (id) => {
    expect(card(id)).not.toMatch(/<(?:button|a|input|select|textarea|summary|details)[\s>]/);
  });

  it.each(ids)("«%s» speaks in the product's voice", (id) => {
    for (const rule of RULES) expect(rule.not.test(read(card(id))), `${rule.use}: «${read(card(id))}»`).toBe(false);
  });

  // «3x más entrevistas» is a claim about somebody else's hiring, which the product has no way to know; and a count is a claim too.
  it.each(ids)("«%s» says no number and promises nothing", (id) => {
    const text = read(card(id));
    expect(text).not.toMatch(/\d|%|×|\bx\b/);
    expect(text).not.toMatch(/garantiz|aseguramos|prometemos|más (?:entrevistas|chances|oportunidades)|conseguí|te contratan/i);
  });
});

describe("«ATS»: what the CV is, said against CVDocument and build-cv", () => {
  it("names the headings the template prints, which it imposes after the model answers", () => {
    const parsed = cvDocumentSchema.parse({ ...templateCV, sections: templateCV.sections.map((section) => ({ ...section, title: "Un título cualquiera" })) });
    const titles = parsed.sections.map((section) => section.title);
    expect(titles).toEqual(["EXPERIENCIA PROFESIONAL", "EDUCACIÓN", "SKILLS ADICIONALES"]);
    for (const title of titles.slice(0, 2)) expect(read(card("ats")), title).toContain(title);
  });

  it("is one column: the document is one flow of its parts, in the order they are read, and the template has no columns", () => {
    const markup = html(createElement(CVDocument, { data: templateCV }));
    const inner = markup.slice(markup.indexOf(">") + 1, markup.lastIndexOf("</article>"));
    const top: string[] = [];
    let depth = 0;
    for (const [, close, name] of inner.matchAll(/<(\/?)([a-z0-9]+)[^>]*>/g)) {
      if (close) depth--;
      else {
        if (depth === 0) top.push(name!);
        depth++;
      }
    }
    // The name, the contact, the summary, and the sections one after another: no side column, no table.
    expect(top).toEqual(["h1", "div", "p", ...templateCV.sections.map(() => "section")]);
    // A header with the place and the dates at its right is a row, and reads in order; a column of the page is `column-count`, `columns` or a grid.
    expect(source("components/cv/cv-document.css").replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/column-count|columns\s*:|display\s*:\s*(?:inline-)?grid|float\s*:/);
  });

  it("uses the posting's words only where the profile has them, and says what is left over", () => {
    const prompt = buildCVPrompt({ profile: backendProfile, analysis, inferredSkills: [], outputLanguage: "es" });
    const allowed = prompt.slice(prompt.indexOf("IN THE PROFILE —"), prompt.indexOf("NOT IN THE PROFILE"));
    const forbidden = prompt.slice(prompt.indexOf("NOT IN THE PROFILE"), prompt.indexOf("=== END VOCABULARY"));
    expect(allowed).toContain("Go");
    expect(forbidden).toContain("CQRS");
    expect(forbidden.replace(/\s+/g, " ")).toContain("Record each as uncovered in the coverage report");
    // …and the place where it is said is the one the card names.
    expect(source("components/wizard/panels.tsx")).toContain('title="Qué pide el puesto"');
  });
});

describe("«Respuestas» and «Tu semana»: said against what the product does", () => {
  it("hands the model the years as computed from the profile's dates, and has a field for what the profile cannot settle", () => {
    const prompt = buildAnswersPrompt({ questions: ["¿Cuántos años de experiencia tenés con Go?"], profile: backendProfile, analysis, outputLanguage: "es" });
    expect(prompt).toContain("=== EXPERIENCE ARITHMETIC (computed — authoritative) ===");
    expect(answerSchema.parse({ question: "¿Qué pretensión salarial tenés?", answer: "A conversar." }).needsUserInput).toBe(false);
    expect(source("components/wizard/ExtrasPanel.tsx")).toContain("tu perfil no tiene el dato");
  });

  it("names columns the board has, in the order it has them, and a closed state for what gets no answer", () => {
    const text = read(card("semana"));
    const named = (text.match(/Cada una en su columna: (.+?) Un recordatorio/)?.[1] ?? "").split(", ");
    const labels = Object.fromEntries(Object.entries(APPLICATION_STATUS_LABEL).map(([status, label]) => [label, status]));
    const at = named.map((label) => OPEN_BOARD_STATUSES.indexOf(labels[label] as (typeof OPEN_BOARD_STATUSES)[number]));
    expect(named.length).toBeGreaterThan(2);
    expect(at.every((index) => index >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(CLOSED_BOARD_STATUSES.map((status) => APPLICATION_STATUS_LABEL[status])).toContain("Sin respuesta");
    expect(text).toContain("«Sin respuesta»");
    // «Semanas» without a number: it has to stay true if the cutoff changes.
    expect(GHOSTING_DAYS).toBeGreaterThanOrEqual(14);
  });

  it("says what the board asks for: an account, a reminder that is offered and not made, and the weekly series", () => {
    expect(read(card("semana"))).toContain("piden una cuenta");
    expect(source("app/(app)/postulaciones/Tracker.tsx")).toContain("El tablero completo pide una cuenta");
    expect(source("app/(app)/postulaciones/KanbanBoard.tsx")).toContain("¿Te recordamos hacer seguimiento");
    expect(source("app/(app)/postulaciones/Metrics.tsx")).toContain("Postulaciones por semana");
  });
});
