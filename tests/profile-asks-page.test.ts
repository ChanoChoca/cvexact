import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InventedFigures } from "@/components/wizard/InventedFigures";
import { PROFILE_ASKS_SAVED, ProfileAskHeading } from "@/components/wizard/ProfileAskHeading";
import { inventedFigures } from "@/lib/ai/verify";
import { cvDocumentSchema, type CVDocument } from "@/lib/schemas/cv";
import { NOW } from "./helpers/profiles";
import { devProfile } from "./fixtures";

/**
 * What a page of an application says when it asks about the profile (U14), and the one button that must never be dead (U12): «Es real: cargarla en mi perfil»,
 * either asks about that figure or takes the person to the jobs of their profile.
 */

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/<!-- -->/g, "");

const FILL = ["React, TypeScript y Git.", "Optimización de bundles y tiempos de carga.", "Trabajo por sprints con diseño y backend.", "Atención al público y manejo de caja.", "Control de stock y reposición de mercadería.", "Voluntariado en un comedor comunitario."];

function cv(): CVDocument {
  return cvDocumentSchema.parse({
    language: "es",
    header: { fullName: devProfile.fullName, location: "Rosario, Argentina", phone: devProfile.phone, email: devProfile.email, links: devProfile.links },
    summary: "Desarrollador con cuatro años de experiencia.",
    sections: [
      {
        kind: "experience",
        title: "EXPERIENCIA PROFESIONAL",
        items: [
          {
            company: "Talleres Digitales SRL",
            role: "Desarrollador Frontend",
            location: "Rosario, Argentina",
            dateRange: "Marzo 2021 – Agosto 2024",
            bullets: ["Desarrollé la interfaz del panel de clientes.", "Reduje los costos un 40 % en el primer semestre."],
          },
        ],
      },
      { kind: "education", title: "EDUCACIÓN", items: [{ institution: "Universidad Nacional de Rosario", degree: "Analista en Sistemas", location: "Rosario, Argentina", date: "2020", honors: "" }] },
      { kind: "bullets", title: "HABILIDADES", bullets: FILL },
    ],
    coverage: { requirements: [], omitted: [] },
  });
}

describe("what is said above every question about the profile", () => {
  it("says it is for the profile, and what becomes of the answer", () => {
    const markup = html(createElement(ProfileAskHeading, {}));
    expect(markup).toContain("data-profile-asks");
    expect(markup).toContain("Para tu perfil");
    expect(markup).toContain(PROFILE_ASKS_SAVED);
    expect(PROFILE_ASKS_SAVED).toBe("Lo que contestes queda en tu perfil y sirve para las próximas postulaciones.");
  });

  it("says what the question is for when it was asked for something in particular", () => {
    const markup = html(createElement(ProfileAskHeading, { about: "Para cargar «40 %» en tu perfil, contanos de este puesto con tus palabras." }));
    expect(markup).toContain("Para cargar «40 %» en tu perfil");
    expect(markup).not.toContain(PROFILE_ASKS_SAVED);
  });

  it("is not a title the question's own heading competes with: no heading element, so the focus goes to the question", () => {
    expect(html(createElement(ProfileAskHeading, {}))).not.toMatch(/<h[1-6]/);
  });
});

describe("«Es real: cargarla en mi perfil»", () => {
  const text = cv();
  const invented = inventedFigures(text, devProfile);
  const draw = (canAsk: (roleId: string) => boolean) =>
    html(createElement(InventedFigures, { cv: text, profile: devProfile, invented, now: NOW, canAsk, onAsk: () => undefined, onEdit: () => undefined }));

  it("asks about that job when there is something to ask", () => {
    const markup = draw(() => true);
    expect(markup).toMatch(/<button[^>]*>Es real: cargarla en mi perfil<\/button>/);
    expect(markup).not.toContain("/perfil#experiencia");
  });

  it("takes the person to the jobs of their profile when there is nothing left to ask: never a button that does nothing", () => {
    const markup = draw(() => false);
    expect(markup).not.toMatch(/<button[^>]*>Es real/);
    expect(markup).toMatch(/<a[^>]*href="\/perfil#experiencia"[^>]*>Es real: cargarla en mi perfil<\/a>/);
  });
});
