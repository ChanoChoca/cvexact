import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewGate } from "@/components/cv/ReviewGate";
import type { Finding } from "@/lib/ai/verify";

/** P15: confirming and downloading stays one tap, but each error is read out where it is confirmed, not only counted. */

const error = (field: string, detail: string): Finding => ({ severity: "error", field, detail });
const warning: Finding = { severity: "warning", field: "summary", detail: "El resumen es largo." };
const render = (findings: Finding[], reviewed = false) => renderToStaticMarkup(createElement(ReviewGate, { findings, reviewed }));

describe("the confirmation before a download", () => {
  it("lists each error with its own words", () => {
    const html = render([error("sections[0].items[0]", "El CV menciona «SQL», que no figura en tu perfil."), error("summary", "El resumen dice 15 años; tus fechas suman 12."), warning]);
    expect(html).toContain("incluidos los 2 puntos marcados");
    expect(html).toContain("<li>El CV menciona «SQL», que no figura en tu perfil.</li>");
    expect(html).toContain("<li>El resumen dice 15 años; tus fechas suman 12.</li>");
    expect(html).not.toContain("El resumen es largo.");
  });

  it("says «el punto marcado» for one", () => {
    expect(render([error("summary", "Algo.")])).toContain("incluido el punto marcado");
  });

  it("lists nothing when there are no errors, or when this version was already confirmed", () => {
    expect(render([warning])).not.toContain("<li>");
    expect(render([error("summary", "Algo.")], true)).not.toContain("<li>");
    expect(render([error("summary", "Algo.")], true)).toContain("Ya confirmaste esta versión del CV.");
  });
});
