import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CorrectionsCard, correctionsTitle } from "@/components/wizard/CorrectionsCard";
import { CorrectionsSection } from "@/components/wizard/CorrectionsSection";
import type { Correction } from "@/lib/cv/corrections";
import { setItemBullet } from "@/lib/cv/edit";
import { cvDocumentSchema } from "@/lib/schemas/cv";
import { profileSchema } from "@/lib/schemas/profile";
import { FakeStorage, installBrowser, uninstallBrowser } from "./helpers/browser-storage";
import { NOW } from "./helpers/profiles";

/**
 * O11, the card: one card after the editing, with the same three answers of the same weight for each thing, each saying where it goes before it is
 * chosen — and nothing at all while the switch is off, which is the way everyone has it.
 */

const tool: Correction = { key: "tool:tableau", kind: "tool", text: "Tableau", field: "sections[0].items[0].bullets[1]", line: "Preparo los informes mensuales con Tableau." };
const credential: Correction = { key: "credential:meta", kind: "credential", text: "Meta Certified Marketing Associate", value: "Meta, 2024", field: "sections[1].items[0]", line: "Meta Certified Marketing Associate: Meta, 2024" };
const role: Correction = { key: "role:gerente", kind: "role", text: "Gerente Comercial", field: "sections[0].items[0].role", line: "Gerente Comercial · Nubia Retail", against: { experienceId: "e1", current: "Analista de Marketing" } };
const figure: Correction = { key: "figure:45", kind: "figure", text: "45", field: "sections[0].items[0].bullets[1]", line: "Informes para 45 clientes." };

const html = (list: Correction[], canSave: (correction: Correction) => boolean = () => true) =>
  renderToStaticMarkup(createElement(CorrectionsCard, { corrections: list, canSave, onSave: () => undefined, onHere: () => undefined, onMistake: () => undefined })).replace(/<!-- -->/g, "");
const textOf = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("what the card says it is", () => {
  it("counts what they did and nothing about what it is worth", () => {
    expect(correctionsTitle([tool])).toBe("En este CV agregaste 1 cosa que tu perfil no tiene.");
    expect(correctionsTitle([tool, credential])).toBe("En este CV agregaste 2 cosas que tu perfil no tiene.");
    expect(correctionsTitle([role])).toBe("En este CV cambiaste 1 cosa que tu perfil dice distinto.");
    expect(correctionsTitle([tool, role, credential])).toBe("En este CV agregaste 2 cosas que tu perfil no tiene y cambiaste 1 cosa que tu perfil dice distinto.");
  });
});

describe("the card", () => {
  it("shows each thing with the line it is in, and for a title what the profile says", () => {
    const text = textOf(html([tool, credential, role]));
    expect(text).toContain("Herramienta Tableau");
    expect(text).toContain("Preparo los informes mensuales con Tableau.");
    expect(text).toContain("Credencial Meta Certified Marketing Associate · Meta, 2024");
    expect(text).toContain("Puesto Gerente Comercial");
    expect(text).toContain("Tu perfil dice «Analista de Marketing».");
  });

  it("gives each thing the same three answers, in the same order, and none weighs more than another", () => {
    const markup = html([tool, credential]);
    const buttons = [...markup.matchAll(/<button[^>]*class="([^"]*)"[^>]*>([^<]*)<\/button>/g)];
    expect(buttons.map((match) => match[2])).toEqual(["Guardar en el perfil", "Solo en este CV", "Era un error", "Guardar en el perfil", "Solo en este CV", "Era un error"]);
    expect(new Set(buttons.map((match) => match[1]!.replace(/\s+/g, " "))).size).toBe(1);
  });

  it("says where each one goes before it is chosen", () => {
    const text = textOf(html([tool, credential, role, figure]));
    expect(text).toContain("Si la guardás, queda entre tus habilidades.");
    expect(text).toContain("Si la guardás, queda entre tus certificaciones.");
    expect(text).toContain("queda como un desacuerdo para que lo revises en tu perfil: no cambia el puesto que tenés.");
    expect(text).toContain("te preguntamos de dónde sale y queda en tu perfil.");
    expect(text).toContain("Lo que dejes solo en este CV no cambia tu perfil, y no se vuelve a preguntar para este CV.");
  });

  it("leaves out «Guardar en el perfil» for what cannot be saved now, and does not leave the others without a way", () => {
    const markup = html([figure, tool], (correction) => correction.kind !== "figure");
    const labels = [...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);
    expect(labels).toEqual(["Solo en este CV", "Era un error", "Guardar en el perfil", "Solo en este CV", "Era un error"]);
  });

  it("does not push: no chances, no promises, no what companies want", () => {
    expect(textOf(html([tool, credential, role, figure]))).not.toMatch(/chances|las empresas|te falta|aumentá|mejorá tu|conseguir/i);
  });
});

describe("the section, while the switch is off", () => {
  afterEach(() => {
    uninstallBrowser();
    vi.resetModules();
  });

  const original = cvDocumentSchema.parse({
    language: "es",
    header: { fullName: "Lucía Pérez", location: "Córdoba, Argentina", phone: "", email: "lucia@example.com", links: [] },
    summary: "Analista de marketing.",
    sections: [{ kind: "experience", title: "EXPERIENCIA PROFESIONAL", items: [{ company: "Nubia Retail", role: "Analista de Marketing", location: "Córdoba", dateRange: "2021 – Actualidad", bullets: ["Llevo las campañas.", "Preparo los informes."] }] }],
  });
  const profile = profileSchema.parse({ fullName: "Lucía Pérez", experience: [{ id: "e1", company: "Nubia Retail", role: "Analista de Marketing", bullets: ["Llevo las campañas", "Preparo los informes"] }] });

  it("renders nothing for a CV that was edited and has something to offer: it is not asked, and nothing is read", () => {
    installBrowser({ local: new FakeStorage() });
    const edited = setItemBullet(original, 0, 0, 1, "Preparo los informes con Tableau.");
    const markup = renderToStaticMarkup(
      createElement(CorrectionsSection, {
        application: { id: "app-1", label: "Analista · Acme", cvOriginal: original, cvEdited: true, analysis: undefined },
        cv: edited,
        profile,
        editorOpen: false,
        canAsk: () => true,
        onAsk: () => undefined,
        onEdit: () => undefined,
      }),
    );
    expect(markup).toBe("");
    expect(NOW.getTime()).toBeGreaterThan(0);
  });
});
