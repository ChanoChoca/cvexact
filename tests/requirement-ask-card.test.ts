import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RequirementAskCard } from "@/components/wizard/RequirementAsk";
import { askTypeOf, askedAgainQuestion, questionFor, type AskKind, type RequirementAsk } from "@/lib/jobs/requirement-ask";
import { NOW } from "./helpers/profiles";

/**
 * The card of the question a posting puts: the offer's line above the question, and three answers of the same weight. Rendered as the page is
 * first drawn; what happens when a button is pressed is walked through in the browser (`e2e-pt4`).
 */

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/<!-- -->/g, "");
const noop = () => {};
const jobs = [{ id: "j1", label: "Repartidor · Rappi" }];

const askOf = (kind: AskKind, extra: Partial<RequirementAsk> = {}): RequirementAsk => ({
  kind,
  type: askTypeOf(kind),
  fragment: "Manejo de SAP (excluyente)",
  thing: "SAP",
  question: questionFor(kind, "SAP"),
  obligation: "required",
  ...extra,
});

const card = (ask: RequirementAsk) =>
  html(createElement(RequirementAskCard, { ask, jobs, now: NOW, onClaim: noop, onCredential: noop, onConditions: noop, onDecline: noop, onKeep: noop, onLater: noop }));

describe("the card of the posting's question", () => {
  it("shows the offer's own line above the question, and says it is the offer's", () => {
    const markup = card(askOf("tool"));
    expect(markup).toContain("Lo que pide el aviso");
    expect(markup).toContain("data-requirement-quote");
    expect(markup).toContain("Manejo de SAP (excluyente)");
    expect(markup).toContain("¿Usaste SAP en algún trabajo, curso o proyecto?");
    expect(markup.indexOf("Manejo de SAP (excluyente)")).toBeLessThan(markup.indexOf("¿Usaste SAP"));
  });

  it("offers three answers of the same weight: yes, no and not now", () => {
    const markup = card(askOf("tool"));
    const buttons = [...markup.matchAll(/<button[^>]*class="([^"]*)"[^>]*>(Sí, usé SAP|No|Ahora no)<\/button>/g)];
    expect(buttons.map((button) => button[2])).toEqual(["Sí, usé SAP", "No", "Ahora no"]);
    expect(new Set(buttons.map((button) => button[1])).size).toBe(1);
  });

  it("calls «Sí» what it is said yes to, for each kind", () => {
    expect(card(askOf("task"))).toContain("Sí, lo hice");
    expect(card(askOf("credential"))).toContain("Sí, la tengo");
    for (const kind of ["license", "vehicle", "availability", "documents"] as const) expect(card(askOf(kind))).toMatch(/>Sí<\/button>/);
  });

  it("says nothing of how much the offer wants it: no «excluyente» badge, no push", () => {
    const markup = card(askOf("tool"));
    expect(markup).not.toMatch(/badge/i);
    expect(markup).not.toMatch(/chances|las empresas|atrás/i);
    // The word is in the quote, because it is the offer's; it is not in anything the card says.
    expect(markup.replace(/Manejo de SAP \(excluyente\)/, "")).not.toMatch(/excluyente/i);
  });

  it("asks a second time, a year after a «no», with the day it was said and the second answer's own words", () => {
    const markup = card(askOf("tool", { again: "2025-09-02T12:00:00.000Z" }));
    expect(markup).toContain("data-declined-again");
    expect(markup).toContain("Anotaste el 2 de septiembre de 2025 que no lo tenías. ¿Sigue siendo así?");
    expect(markup).toContain("Sigue siendo no");
    expect(markup).toContain("Ahora no");
    expect(markup).not.toMatch(/>No<\/button>/);
  });

  it("is one question, and not the question of the first time under a line that asks another (U16)", () => {
    const again = card(askOf("tool", { again: "2025-09-02T12:00:00.000Z", question: "¿Usaste SAP en algún trabajo, curso o proyecto?" }));
    // The title is the one asked now, with its day; what was asked the first time is not asked as well.
    expect(again.match(/<h2/g)).toHaveLength(1);
    expect(again.match(/¿/g)).toHaveLength(1);
    expect(again).not.toContain("¿Usaste SAP en algún trabajo, curso o proyecto?");
    // And the first time it is the question, in the title, as always.
    const first = card(askOf("tool", { question: "¿Usaste SAP en algún trabajo, curso o proyecto?" }));
    expect(first).toContain("¿Usaste SAP en algún trabajo, curso o proyecto?");
  });

  it("words the second asking the same wherever it is asked: the day, the year when it is not this one, and whether it still is so", () => {
    expect(askedAgainQuestion("2025-09-02T12:00:00.000Z", NOW)).toBe("Anotaste el 2 de septiembre de 2025 que no lo tenías. ¿Sigue siendo así?");
    expect(askedAgainQuestion("2026-03-14T12:00:00.000Z", NOW)).toBe("Anotaste el 14 de marzo que no lo tenías. ¿Sigue siendo así?");
  });

  it("does not say it was asked a second time when it was not", () => {
    expect(card(askOf("tool"))).not.toContain("data-declined-again");
  });

  it("says that a quote cut at the length of a line was cut", () => {
    const long = "Experiencia en ventas ".repeat(12).trim();
    expect(card(askOf("task", { fragment: long.slice(0, 238), thing: "ventas" }))).toContain("…</blockquote>");
    expect(card(askOf("task", { fragment: "Experiencia en ventas", thing: "ventas" }))).not.toContain("…</blockquote>");
  });

  it("marks the kind it asks, for the walkthrough and for nothing else", () => {
    for (const kind of ["tool", "task", "credential", "license", "vehicle", "availability", "documents"] as const) expect(card(askOf(kind))).toContain(`data-requirement-ask="${kind}"`);
  });

  it("has the question as its heading, which the section is named for", () => {
    const markup = card(askOf("license", { fragment: "Licencia de conducir B1", thing: "Licencia de conducir" }));
    expect(markup).toMatch(/<section aria-labelledby="([^"]+)"/);
    const id = /aria-labelledby="([^"]+)"/.exec(markup)![1]!;
    expect(markup).toContain(`<h2 id="${id}"`);
    expect(markup).toContain("¿Tenés licencia de conducir?");
  });
});
