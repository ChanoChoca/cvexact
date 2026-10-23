import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoveragePanel, InferredSkillsPanel } from "@/components/wizard/panels";
import { declineThings } from "@/lib/profile/declined";
import { emptyProfile } from "@/lib/schemas/profile";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP } from "./helpers/profiles";

/**
 * «Qué pide el puesto» and «Habilidades deducidas», with a «no» that has a date: what is offered to someone who said no before, in two
 * answers of the same weight, and what is left alone.
 */

const DAY = 86_400_000;
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/<!-- -->/g, "");
const iso = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();
const ctx = (now: string = STAMP) => ({ now, newId: () => `c-${now}` });

const coverage = (...requirements: string[]) => ({
  requirements: requirements.map((requirement) => ({ requirement, covered: false, evidence: "El CV no dice nada de esto.", inferred: false })),
  omitted: [],
});

const noop = () => {};
const panel = (requirements: string[], extra: Partial<Parameters<typeof CoveragePanel>[0]> = {}) =>
  html(createElement(CoveragePanel, { coverage: coverage(...requirements), profile: emptyProfile(), now: NOW, onClaim: noop, onDecline: noop, onKeep: noop, ...extra }));

describe("what the offer asks for, and the profile has nothing about", () => {
  it("offers two answers of the same weight: «Sí, usé» and «No lo tengo»", () => {
    const markup = panel(["Manejo de SAP"]);
    expect(markup).toContain("Sí, usé SAP");
    expect(markup).toContain("No lo tengo");
    const buttons = [...markup.matchAll(/<button[^>]*class="([^"]*)"[^>]*>(?:Sí, usé SAP|No lo tengo)<\/button>/g)].map((match) => match[1]);
    expect(buttons).toHaveLength(2);
    expect(new Set(buttons).size).toBe(1);
    // Putting it off is not one of the ways out here.
    expect(markup).not.toContain("Ahora no");
  });

  it("is quiet about what the person said no to: the day, and «Ya lo tengo», and no offer", () => {
    const profile = emptyStoredProfile();
    declineThings(profile, "requirement", ["SAP"], { quote: "Manejo de SAP" }, ctx(iso(0)));
    const markup = panel(["Manejo de SAP"], { declined: profile.declined, now: new Date(NOW.getTime() + 30 * DAY) });
    expect(markup).toContain("data-declined-note");
    expect(markup).toContain("Anotaste el 21 de septiembre que no tenés SAP.");
    expect(markup).toContain("Ya lo tengo");
    expect(markup).not.toContain("No lo tengo");
    expect(markup).not.toContain("Sí, usé SAP");
    expect(markup).not.toContain("Ahora no");
  });

  it("asks for what the person did not say no to, in a line that asks for both", () => {
    const profile = emptyStoredProfile();
    declineThings(profile, "requirement", ["SAP"], {}, ctx(iso(0)));
    const markup = panel(["Manejo de SAP y Photoshop"], { declined: profile.declined, now: new Date(NOW.getTime() + 30 * DAY) });
    expect(markup).toContain("Sí, usé Photoshop");
    expect(markup).not.toContain("Sí, usé SAP");
    expect(markup).not.toContain("data-declined-note");
  });

  it("asks once more after a year, with the day it was said, and gives the second «no» its own words", () => {
    const profile = emptyStoredProfile();
    declineThings(profile, "requirement", ["SAP"], {}, ctx(iso(0)));
    const markup = panel(["Manejo de SAP"], { declined: profile.declined, now: new Date(NOW.getTime() + 400 * DAY) });
    expect(markup).toContain("data-declined-again");
    expect(markup).toContain("Anotaste el 21 de septiembre de 2026 que no lo tenías. ¿Sigue siendo así?");
    expect(markup).toContain("Sí, usé SAP");
    expect(markup).toContain("Sigue siendo no");
    expect(markup).not.toContain("No lo tengo");
  });

  it("does not ask a third time", () => {
    const profile = emptyStoredProfile();
    declineThings(profile, "requirement", ["SAP"], {}, ctx(iso(0)));
    profile.declined[0]!.offeredAgainAt = iso(401);
    const markup = panel(["Manejo de SAP"], { declined: profile.declined, now: new Date(NOW.getTime() + 800 * DAY) });
    expect(markup).toContain("data-declined-note");
    expect(markup).not.toContain("Sigue siendo no");
  });

  it("leaves alone what a saved application put off, and what was taken back is offered like anything else", () => {
    expect(panel(["Manejo de SAP"], { dismissed: ["Manejo de SAP"] })).not.toContain("Sí, usé SAP");

    const profile = emptyStoredProfile();
    const [entry] = declineThings(profile, "requirement", ["SAP"], {}, ctx(iso(0)));
    profile.declined[0] = { ...entry!, withdrawnAt: iso(5) };
    // The panel is given what is active; one taken back is not in it.
    expect(panel(["Manejo de SAP"], { declined: [] })).toContain("Sí, usé SAP");
  });
});

describe("the skills the app deduced", () => {
  const skills = [
    { skill: "Excel avanzado", derivedFrom: "Armo reportes con tablas dinámicas", confidence: "high" as const, rationale: "Lo que armás con tablas dinámicas es Excel avanzado." },
    { skill: "Atención al cliente", derivedFrom: "Atiendo el mostrador", confidence: "medium" as const, rationale: "Atender un mostrador es atención al cliente." },
  ];
  const render = (extra: Partial<Parameters<typeof InferredSkillsPanel>[0]> = {}) =>
    html(createElement(InferredSkillsPanel, { skills, rejected: [], onToggle: noop, onScope: noop, ...extra }));

  it("says, for one that was vetoed in the profile, that it was, and offers to keep the veto to this posting", () => {
    const markup = render({ vetoed: ["Excel avanzado"] });
    expect(markup).toContain('data-veto-scope="profile"');
    expect(markup).toContain("Anotado en tu perfil: no la tenés.");
    expect(markup).toContain("Solo para esta postulación");
    expect(markup.match(/data-veto-scope/g)).toHaveLength(1);
  });

  it("says, for one vetoed in this posting only, that it is, and offers to make it for all", () => {
    const markup = render({ rejected: ["Excel avanzado"] });
    expect(markup).toContain('data-veto-scope="application"');
    expect(markup).toContain("Solo en esta postulación.");
    expect(markup).toContain("Para todas mis postulaciones");
  });

  it("says nothing of a skill that is not vetoed, and draws it checked", () => {
    const markup = render();
    expect(markup).not.toContain("data-veto-scope");
    expect(markup.match(/checked=""/g)).toHaveLength(2);
  });

  it("draws a vetoed skill unchecked and struck out, whichever way it was vetoed", () => {
    const markup = render({ vetoed: ["Excel avanzado"], rejected: ["Atención al cliente"] });
    expect(markup.match(/checked=""/g) ?? []).toHaveLength(0);
    expect(markup.match(/line-through/g)).toHaveLength(2);
  });
});
