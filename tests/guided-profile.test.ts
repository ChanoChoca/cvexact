import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuidedProfile } from "@/components/onboarding/GuidedProfile";
import { emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { RULES } from "@/lib/voice";
import { saveBuilder } from "@/lib/onboarding/resume";

/**
 * Stage 3 of the profile's new first load: «de cero» as four parts, one open at a time, with a bar that says which. What is checked is what a person
 * reads and what the browser is told: that the parts are folds of one group, that the one open is the one the profile says, and that nothing the
 * old lists said is left.
 */

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/<!-- -->/g, "");
const words = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const noop = () => {};

const guided = (profile: StoredProfile) => html(createElement(GuidedProfile, { profile, onBack: noop, onDone: noop }));
/** The folds of the group, in order, each with whether it is open. */
const parts = (markup: string) => [...markup.matchAll(/<details id="paso-(\d)" name="guided-step"([^>]*)>/g)].map((match) => ({ n: Number(match[1]), open: /\sopen(?:=|\s|$)/.test(match[2]!) }));

describe("the guided profile", () => {
  const markup = guided(emptyStoredProfile());

  it("has four parts, in the order of what a person has at hand, as folds of one group — so opening one shuts the other", () => {
    expect(parts(markup).map((part) => part.n)).toEqual([1, 2, 3, 4]);
    expect(markup.match(/name="guided-step"/g)).toHaveLength(4);
    const titles = [...markup.matchAll(/<details id="paso-\d"[^>]*><summary[^>]*>(.*?)<\/summary>/g)].map((match) => words(match[1]!));
    expect(titles.map((title) => title.replace(/^\d\s*/, "").replace(/\s*▸$/, ""))).toEqual(["Datos personales", "Experiencia laboral y formación", "Proyectos", "Habilidades, idiomas y certificaciones"]);
  });

  it("opens the first when nothing was kept, and only that one", () => {
    expect(parts(markup).map((part) => part.open)).toEqual([true, false, false, false]);
  });

  it("opens the one the profile says it is on", () => {
    for (const index of [1, 2, 3]) {
      const profile = emptyStoredProfile();
      saveBuilder(profile, index);
      expect(parts(guided(profile)).map((part) => part.open), String(index)).toEqual([0, 1, 2, 3].map((at) => at === index));
    }
  });

  it("does not open one that is past the last: it keeps the person on a part that exists", () => {
    const profile = emptyStoredProfile();
    saveBuilder(profile, 9);
    expect(parts(guided(profile)).map((part) => part.open)).toEqual([false, false, false, true]);
  });

  it("says which part it is as a bar, in numbers and in words", () => {
    expect(markup).toMatch(/<div role="progressbar"[^>]*aria-valuemin="1"[^>]*aria-valuemax="4"[^>]*aria-valuenow="1"[^>]*aria-valuetext="Paso 1 de 4"/);
    const profile = emptyStoredProfile();
    saveBuilder(profile, 2);
    const third = guided(profile);
    expect(third).toMatch(/aria-valuenow="3"[^>]*aria-valuetext="Paso 3 de 4"/);
    expect(words(third)).toContain("Paso 3 de 4");
    // The fill is how far along it is: three fourths.
    expect(third).toContain('style="width:75%"');
  });

  it("goes on with «Siguiente» at the foot of each part but the last, which ends with «Terminar»", () => {
    expect(markup.match(/<button[^>]*>Siguiente<\/button>/g)).toHaveLength(3);
    expect(markup.match(/<button[^>]*>Terminar<\/button>/g)).toHaveLength(1);
  });

  it("ends each part with a card on what the profile is for, before its button: one a part, in the order a person meets them", () => {
    const chunks = markup.split('<details id="paso-').slice(1);
    expect(chunks.map((chunk) => chunk.match(/data-illustration="([a-z]+)"/)?.[1])).toEqual(["tiempo", "ats", "respuestas", "semana"]);
    for (const chunk of chunks) {
      expect(chunk.match(/<figure/g)).toHaveLength(1);
      expect(chunk.indexOf("<figure"), "the card comes before the button").toBeLessThan(chunk.search(/<button[^>]*>(?:Siguiente|Terminar)<\/button>/));
    }
  });

  it("holds the profile's own sections: who they are and what they are after, jobs and studies, projects, skills and languages", () => {
    const text = words(markup);
    for (const part of ["Nombre y apellido", "Email", "Puesto que buscás", "Experiencia laboral", "Formación", "Proyectos · opcional", "Habilidades, idiomas y certificaciones"]) expect(text, part).toContain(part);
    // The sections are the ones the profile has, with their ids: a jump to «experiencia» lands on the same fold.
    for (const id of ["experiencia", "estudios", "proyectos", "habilidades"]) expect(markup, id).toContain(`<details id="${id}"`);
    // And they start open in it: the part is the place to fill them in.
    expect(markup.match(/<details id="(?:experiencia|estudios|proyectos|habilidades)"[^>]* open/g)).toHaveLength(4);
  });

  it("has nothing to press to keep a job, a study, a language or a certification: their forms are there, and the dates are in view", () => {
    // The four forms, open (there is no «+ Agregar …» to open them), and none of them with an «Agregar» or a «Cancelar». The projects keep theirs: they were not asked for.
    for (const label of ["Puesto o tarea principal", "Título o estudio", "Nivel del idioma", "Certificación"]) expect(markup, label).toContain(label);
    expect(markup).not.toMatch(/<button[^>]*>\s*(?:\+ Agregar (?:experiencia|estudios|idioma|certificación)|Agregar|Cancelar)\s*<\/button>/);
    // To start another one there is a button, below each form and off while its form is empty; it is there from the start, so that giving a form to the profile does not move it.
    for (const label of ["+ Agregar otra experiencia", "+ Agregar otros estudios", "+ Agregar otro idioma", "+ Agregar otra certificación"]) {
      expect(markup, label).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${label.replace("+", "\\+")}</button>`));
    }
    // The months and years of a job and of a study are not behind a fold.
    expect(markup).not.toContain("Elegir con los desplegables");
    expect(markup.match(/aria-label="Desde: mes"/g)).toHaveLength(2);
  });

  it("shows the CV it is turning out to be beside it, and a sheet for a phone that starts whole and says what it is for", () => {
    // The sheet of paper of the profile (`BaseCvPreview`), and not the text panel the questions use: empty it is a blank page that fills as the parts are filled in.
    expect(markup).toContain('class="cv-document"');
    expect(markup).not.toContain('aria-label="Tu perfil"');
    expect(markup).toContain('aria-label="Armar tu perfil"');
    expect(markup).toContain('data-stop="full"');
  });

  it("writes what is filled in on that sheet", () => {
    const profile = emptyStoredProfile();
    profile.contact.fullName = { ...profile.contact.fullName, value: "Lucía Paz" };
    expect(guided(profile)).toMatch(/<h1 class="cv-name">Lucía Paz<\/h1>/);
  });

  it("has a way back and a title, and none of what the lists asked", () => {
    const text = words(markup);
    expect(text).toContain("Armemos tu perfil");
    expect(markup).toContain("← Atrás");
    for (const gone of ["Lista 1 de", "Contámelo a mi manera", "No tengo más", "Listo, ver lo que armamos", "qué momento", "Lo que contaste"]) expect(text, gone).not.toContain(gone);
  });

  it("speaks in the product's voice", () => {
    for (const rule of RULES) expect(rule.not.test(words(markup)), `${rule.use}: «${words(markup)}»`).toBe(false);
  });
});
