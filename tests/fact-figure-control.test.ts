import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FactRow } from "@/components/profile/hub/FactRow";
import type { Metric } from "@/lib/schemas/profile-v2";
import { profileWith } from "./helpers/profiles";

/**
 * The button that gives a line a figure is not on every line of a job: the questions ask for it, and a number written in the sentence counts. It is where
 * there is a figure to change or take off, and where one was left as «no lo sé» — the line that «Si la encontrás» leads to.
 */

const row = (metric?: Metric) => {
  const profile = profileWith({ company: "Nubia Retail", role: "Analista", facts: [{ text: "Armo los pedidos", ...(metric ? { metric } : {}) }] });
  const job = profile.experience[0]!;
  return renderToStaticMarkup(createElement(FactRow, { experienceId: job.id, fact: job.facts[0]!, onRemoved: () => {} })).replace(/<!-- -->/g, "");
};

describe("the figure of a line of a job", () => {
  it("has no button on a line that has none and was not left for later", () => {
    const markup = row();
    expect(markup).not.toContain("Agregar cifra");
    expect(markup).not.toContain("Cambiar cifra");
    expect(markup).not.toContain("Quitar cifra");
    // The rest of the line is as it was.
    expect(markup).toContain("Qué tipo de cosa es");
    expect(markup).toContain(">Quitar<");
  });

  it("can be changed or taken off where there is one", () => {
    const markup = row({ value: "150", unit: "clientes", approx: false });
    expect(markup).toContain("Cambiar cifra");
    expect(markup).toContain("Quitar cifra");
    expect(markup).not.toContain("Agregar cifra");
    expect(markup).toContain("150 clientes");
  });

  it("can be added where it was answered «no lo sé», which is where «Si la encontrás» leads", () => {
    const markup = row({ unknown: true });
    expect(markup).toContain("Agregar cifra");
    expect(markup).not.toContain("Cambiar cifra");
    expect(markup).not.toContain("Quitar cifra");
  });
});
