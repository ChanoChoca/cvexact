import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkillReview } from "@/components/wizard/SkillReview";

const git = { skill: "Git", derivedFrom: "GitHub Actions", confidence: "high" as const, rationale: "—" };
const jest = { skill: "Jest", derivedFrom: "Vitest", confidence: "medium" as const, rationale: "—" };

const text = (markup: string) => markup.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("la tarjeta de skills deducidas", () => {
  const markup = renderToStaticMarkup(createElement(SkillReview, { skills: [git, jest], onDone: () => undefined }));

  it("pregunta si es suyo, con cada skill y de dónde se dedujo, y nada marcado de antemano", () => {
    const said = text(markup);
    expect(said).toContain("El aviso pide esto, que dedujimos de tu perfil. ¿Es tuyo?");
    expect(said).toContain("Git de «GitHub Actions»");
    expect(said).toContain("Jest de «Vitest»");
    expect(markup.match(/aria-pressed="false"/g)).toHaveLength(4);
    expect(markup).not.toContain('aria-pressed="true"');
  });

  it("da un Sí y un No por skill y el botón que escribe el CV, y dice qué pasa con lo que no se contesta", () => {
    const said = text(markup);
    expect(said.match(/ Sí /g)).toHaveLength(2);
    expect(said.match(/ No /g)).toHaveLength(2);
    expect(said).toContain("Escribir el CV");
    expect(said).toContain("Lo que no contestes no se escribe en el CV.");
  });
});
