import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BaseCvDownload } from "@/components/cv/BaseCvDownload";
import { ToastProvider } from "@/components/ui/toast";
import { profileWith } from "./helpers/profiles";

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/<!-- -->/g, "");

/**
 * The file of the CV the profile makes. It had a card of its own —«Tu CV, con tus palabras, sin adaptar», with a paragraph and a long note—; now its two buttons float over the
 * corner of the sheet, and what the file has to say for itself goes under it.
 */
describe("the download of the CV the profile makes", () => {
  const render = (fullName: string, doubtful = false) => {
    const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current", facts: [{ text: "Armo los pedidos" }] });
    profile.contact.fullName = { value: fullName, status: "confirmed" };
    if (doubtful) profile.experience[0]!.company = { value: "Nubia Retail", status: "proposed" };
    return html(createElement(ToastProvider, null, createElement(BaseCvDownload, { profile } as Parameters<typeof BaseCvDownload>[0], createElement("div", null, "LA HOJA"))));
  };

  it("is still where «Bajar mi CV base» goes (/perfil#cv-base), around the sheet", () => {
    const markup = render("Lucía Pérez");
    expect(markup).toContain('id="cv-base"');
    expect(markup).toContain("LA HOJA");
  });

  it("has the two buttons, short on the screen and whole for a screen reader, and before the sheet so that the lines of the CV are not in the way of the keyboard", () => {
    const markup = render("Lucía Pérez");
    expect(markup).toContain('<span class="sr-only">Descargar en </span>Word</button>');
    expect(markup).toContain('<span class="sr-only">Descargar en </span>Pdf</button>');
    expect(markup.indexOf('aria-label="Descargar tu CV"')).toBeGreaterThan(-1);
    expect(markup.indexOf('aria-label="Descargar tu CV"')).toBeLessThan(markup.indexOf("LA HOJA"));
  });

  it("has no card of its own: no title and no paragraph on what the CV is", () => {
    const markup = render("Lucía Pérez");
    expect(markup).not.toContain("sin adaptar");
    expect(markup).not.toContain("Armado con lo que cargaste");
  });

  it("says the name is missing, under the sheet, only when it is", () => {
    expect(render("")).toContain("Falta tu nombre");
    expect(render("Lucía Pérez")).not.toContain("Falta tu nombre");
  });

  it("does not repeat under the sheet what the profile already marks «Para revisar» on its own cards", () => {
    const markup = render("Lucía Pérez", true);
    expect(markup).toContain('<span class="sr-only">Descargar en </span>Word</button>');
    expect(markup).toContain('<span class="sr-only">Descargar en </span>Pdf</button>');
    expect(markup).not.toContain("sin revisar");
    expect(markup).not.toContain("/perfil?revisar=1");
  });
});
