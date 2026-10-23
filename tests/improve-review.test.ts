import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImproveReview, type Proposal } from "@/components/profile/hub/ImproveSection";

/**
 * The window that shows what «Mejorar con IA» proposed for a section, next to what is written: every proposal ticked to begin with, the count of what will
 * be used on the button, and the two ways out. What happens when a box is unticked is the browser's own tests'.
 */

const html = (proposals: Proposal[]) =>
  renderToStaticMarkup(createElement(ImproveReview, { proposals, titleId: "t", onUse: () => {}, onClose: () => {} })).replace(/<!-- -->/g, "");

const ONE: Proposal = { id: "a", label: "Analista · Nubia Retail", before: "Armo los pedidos", after: "Armo los pedidos del depósito" };
const TWO: Proposal = { id: "b", label: "Idioma", before: "ingles", after: "Inglés" };

describe("the window of proposals", () => {
  it("says how many there are, and names the heading for the dialog", () => {
    expect(html([ONE])).toContain('<h2 id="t" class="text-[17px] text-ink">Tu IA propone un cambio</h2>');
    expect(html([ONE, TWO])).toContain("Tu IA propone 2 cambios");
  });

  it("shows each one next to what is written: which text it is, the words before and the words after", () => {
    const markup = html([ONE, TWO]);
    for (const text of ["Usar: Analista · Nubia Retail", "Armo los pedidos", "Armo los pedidos del depósito", "Usar: Idioma", "ingles", "Inglés"]) expect(markup).toContain(text);
    expect(markup.indexOf("Antes")).toBeLessThan(markup.indexOf("Después"));
    expect(markup).toContain("data-improve-review");
  });

  it("starts with all of them ticked, and the button says how many it will use", () => {
    const markup = html([ONE, TWO]);
    expect(markup.match(/checked=""/g)).toHaveLength(2);
    expect(markup).toContain("Usar 2");
    // The attribute, not the `disabled:` of a class.
    expect(markup).not.toMatch(/ disabled(=|>)/);
  });

  it("keeps the line breaks of a list of points, which are the lines", () => {
    expect(html([{ id: "p", label: "Destacados", before: "Tesis\nPromedio 8", after: "Tesis sobre logística\nPromedio 8" }])).toContain("whitespace-pre-line");
  });

  it("offers to leave it all as it was", () => {
    expect(html([ONE])).toContain("Dejar como estaba");
  });
});
