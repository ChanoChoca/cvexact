import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CVEditor } from "@/components/cv/CVEditor";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialog";
import { profileJobFor } from "@/lib/cv/invented";
import { cvDocumentSchema } from "@/lib/schemas/cv";
import { profileSchema } from "@/lib/schemas/profile";

/** UI-3 and UI-6: each job of the CV is shown beside what the profile says of it, and its dates and place are said to be the profile's. */

const profile = profileSchema.parse({
  fullName: "Bruno",
  experience: [
    { id: "a", company: "Pagaluz SA", role: "Desarrollador", start: "Octubre 2022", end: "Diciembre 2022", bullets: ["Armé el pipeline de builds.", "Escribí tests."], tags: [] },
    { id: "b", company: "Nubesur Estudio", role: "Dev", start: "2023", bullets: ["Maqueté pantallas."], tags: [] },
  ],
});

const cv = cvDocumentSchema.parse({
  language: "es",
  header: { fullName: "Bruno", location: "" },
  summary: "Resumen.",
  sections: [
    {
      kind: "experience",
      title: "EXPERIENCIA",
      items: [
        { company: "Pagaluz", role: "Desarrollador", location: "Rosario, Argentina", dateRange: "Octubre 2022 – Diciembre 2022", bullets: ["Automaticé los builds."] },
        { company: "Otra", role: "Dev", location: "", dateRange: "", bullets: ["Uno."] },
      ],
    },
  ],
  coverage: { requirements: [], omitted: [] },
});

const render = (withProfile: boolean) =>
  renderToStaticMarkup(
    createElement(ConfirmDialogProvider, null, createElement(CVEditor, { cv, onChange: () => undefined, edited: false, open: true, onClose: () => undefined, ...(withProfile ? { profile } : {}) })),
  );

describe("the job of the profile a CV job is", () => {
  it("is found by the company it names, however it is written", () => {
    expect(profileJobFor("Pagaluz", profile)?.id).toBe("a");
    expect(profileJobFor("NUBESUR estudio", profile)?.id).toBe("b");
    expect(profileJobFor("Otra", profile)).toBeUndefined();
    expect(profileJobFor("", profile)).toBeUndefined();
  });
});

describe("the editor beside the profile", () => {
  it("lists what the profile says of the job, under «Lo que escribiste»", () => {
    const html = render(true);
    expect(html.match(/Lo que escribiste/g)).toHaveLength(1);
    expect(html).toContain("<li>Armé el pipeline de builds.</li>");
    expect(html).toContain("<li>Escribí tests.</li>");
  });

  it("says the dates and the place are the profile's, and shows no box for them", () => {
    const html = render(true);
    expect(html).toContain("Octubre 2022 – Diciembre 2022 · Rosario, Argentina — se toman de tu perfil.");
    expect(html).not.toContain('value="Octubre 2022');
  });

  it("works without a profile, as before", () => {
    expect(render(false)).not.toContain("Lo que escribiste");
  });
});
