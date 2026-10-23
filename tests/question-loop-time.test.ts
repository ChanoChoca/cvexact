import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnswerReceipt } from "@/components/onboarding/AnswerReceipt";
import { QuestionCard, putOffNote } from "@/components/onboarding/QuestionCard";
import { QuestionLoop } from "@/components/onboarding/QuestionLoop";
import type { RuleId } from "@/lib/onboarding/config";
import { certificationSchema, emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, fromSource, profileWith } from "./helpers/profiles";

/**
 * The questions about time answered in the card (U17): «¿Seguís en…?», the renewal of a credential, what they said of how they can work and «desde … no hay nada»
 * have their answers inside, of the same weight, with «Ahora no» among them — and no row of ways not to under the card, since «No aplica» is for something that
 * stops applying, and nothing about a date does because a question was put off. What the card says instead is when the question comes back. And a review of a few
 * questions counts them the way it said them: «Pregunta 1 de 3». What happens when a button is pressed is walked through in the browser (`e2e-ux3`).
 */

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/<!-- -->/g, "");

/** The card as `createElement` sees it with its control passed as an argument: where the control is a prop, it is an argument here. */
const Card = QuestionCard as ComponentType<{ text: string; putOffLabel?: string; onDefer?: () => void; children?: ReactNode }>;
const countOf = (markup: string, label: string) => (markup.match(new RegExp(`>${label}<`, "g")) ?? []).length;
const loop = (stored: StoredProfile, rules: RuleId[], extra: Record<string, unknown> = {}) =>
  // With the label the session gives its way out —«Dejar por hoy», which is not a way of putting off a question—, so that what is counted is the card's.
  html(createElement(QuestionLoop, { profile: stored, now: NOW, rules: new Set(rules), onExhausted: () => undefined, dismissLabel: "Dejar por hoy", ...extra }));

const OLD_AT = "2025-01-10T12:00:00.000Z";

/** A job that is going on and that nobody has looked at for months. */
function goingOn(): StoredProfile {
  const stored = profileWith({ company: "Logística Sur", role: "Encargada de depósito", from: { year: 2022, month: 3 }, to: "current", facts: [{ text: "Armo los pedidos del depósito" }] });
  fromSource(stored.experience[0]!, { kind: "manual", at: OLD_AT });
  return stored;
}

function withLapsedCredential(): StoredProfile {
  const stored = emptyStoredProfile();
  stored.certifications.push(
    certificationSchema.parse({ id: "c1", name: { value: "Habilitación de autoelevador", status: "confirmed" }, expires: { value: { year: 2026, month: 3 }, status: "confirmed" } }),
  );
  return stored;
}

function withStalePractical(): StoredProfile {
  const stored = emptyStoredProfile();
  stored.legacy.practical = {
    value: { availability: "Tiempo completo", driverLicense: "B1", ownVehicle: true, willingToRelocate: false, workEligibility: "" },
    status: "confirmed",
    source: { kind: "answer", at: "2026-01-01T12:00:00.000Z" },
  };
  return stored;
}

function withNothingSince(): StoredProfile {
  return profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2018, month: 3 }, to: { year: 2021, month: 5 }, facts: [{ text: "Atendía clientes" }] });
}

describe("the card of a question that puts itself off", () => {
  it("says when it comes back instead of drawing the row of ways not to, in the words of the button that was pressed", () => {
    expect(putOffNote()).toBe("Con «Ahora no» te lo volvemos a preguntar la próxima vez que vengas.");
    expect(putOffNote("Todavía no")).toBe("Con «Todavía no» te lo volvemos a preguntar la próxima vez que vengas.");
    const own = html(createElement(Card, { text: "¿Seguís en Logística Sur?", putOffLabel: "Ahora no" }, createElement("div")));
    expect(own).toContain("data-put-off-note");
    expect(own).toContain("Con «Ahora no» te lo volvemos a preguntar la próxima vez que vengas.");
    expect(own).not.toContain("No aplica");
  });

  it("draws the row of ways not to when the question does not have its own, and not the note", () => {
    const generic = html(createElement(Card, { text: "¿Querés dejar anotado lo práctico?", onDefer: () => undefined }, createElement("div")));
    expect(generic).toContain("No aplica");
    expect(generic).not.toContain("data-put-off-note");
  });
});

describe("«¿Seguís en…?»", () => {
  it("has «Ahora no» among its answers, of the same weight, and says when it comes back; «No aplica» is not one of them", () => {
    const markup = loop(goingOn(), ["current_job_review"]);
    expect(markup).toContain("¿Seguís en Logística Sur?");
    for (const label of ["Sí, sigo", "Ya terminé", "Cambió algo", "Ahora no"]) expect(countOf(markup, label)).toBe(1);
    expect(countOf(markup, "No aplica")).toBe(0);
    expect(markup).toContain("Con «Ahora no» te lo volvemos a preguntar la próxima vez que vengas.");
    // The four are one group of buttons, and not three answers with the fourth apart.
    const chips = [...markup.matchAll(/<button[^>]*class="([^"]*)"[^>]*>(Sí, sigo|Ya terminé|Cambió algo|Ahora no)<\/button>/g)];
    expect(chips.map((chip) => chip[2])).toEqual(["Sí, sigo", "Ya terminé", "Cambió algo", "Ahora no"]);
    expect(new Set(chips.map((chip) => chip[1])).size).toBe(1);
  });
});

describe("the renewal of a credential", () => {
  it("has «Todavía no» as its own answer, of the same weight, and says it is the one that brings it back", () => {
    const markup = loop(withLapsedCredential(), ["credential_expiry"]);
    expect(markup).toContain("¿Hiciste la renovación?");
    for (const label of ["Sí, la hice", "Todavía no", "Ya no corresponde"]) expect(countOf(markup, label)).toBe(1);
    expect(countOf(markup, "Ahora no")).toBe(0);
    expect(countOf(markup, "No aplica")).toBe(0);
    expect(markup).toContain("Con «Todavía no» te lo volvemos a preguntar la próxima vez que vengas.");
  });
});

describe("what they said of how they can work", () => {
  it("has «Sigue igual», «Cambió algo» and «Ahora no» of the same weight: the easy one is not the one that stands out", () => {
    const markup = loop(withStalePractical(), ["conditions_review"]);
    expect(markup).toContain("¿Sigue igual lo que anotaste para trabajar?");
    const chips = [...markup.matchAll(/<button[^>]*class="([^"]*)"[^>]*>(Sigue igual|Cambió algo|Ahora no)<\/button>/g)];
    expect(chips.map((chip) => chip[2])).toEqual(["Sigue igual", "Cambió algo", "Ahora no"]);
    expect(new Set(chips.map((chip) => chip[1])).size).toBe(1);
    expect(countOf(markup, "No aplica")).toBe(0);
    expect(markup).toContain("Con «Ahora no» te lo volvemos a preguntar la próxima vez que vengas.");
  });
});

describe("«desde … no hay nada»", () => {
  it("has «Nada que agregar» and «Ahora no» of the same weight, beside the kinds of thing that can be added", () => {
    const markup = loop(withNothingSince(), ["since_last"]);
    expect(markup).toContain("no hay nada cargado. ¿Hiciste algo que quieras agregar?");
    const chips = [...markup.matchAll(/<button[^>]*class="([^"]*)"[^>]*>(Nada que agregar|Ahora no)<\/button>/g)];
    expect(chips.map((chip) => chip[2])).toEqual(["Nada que agregar", "Ahora no"]);
    expect(new Set(chips.map((chip) => chip[1])).size).toBe(1);
    expect(countOf(markup, "No aplica")).toBe(0);
  });
});

describe("what keeps its own row", () => {
  it("a question that is not about time and has no answers of its own still has «Ahora no» and «No aplica» under the card", () => {
    const stored = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2021, month: 3 }, to: "current" });
    const markup = loop(stored, ["no_content"]);
    expect(countOf(markup, "Ahora no")).toBe(1);
    expect(countOf(markup, "No aplica")).toBe(1);
    expect(markup).not.toContain("data-put-off-note");
  });
});

describe("counting the questions of a review the way it said them (U22)", () => {
  it("says which it is of how many, when it is a review of a few: «Pregunta 1 de 3»", () => {
    const stored = goingOn();
    stored.certifications.push(
      certificationSchema.parse({ id: "c1", name: { value: "Habilitación de autoelevador", status: "confirmed" }, expires: { value: { year: 2026, month: 3 }, status: "confirmed" } }),
    );
    stored.legacy.practical = withStalePractical().legacy.practical;
    const markup = loop(stored, ["current_job_review", "credential_expiry", "conditions_review"], { limit: 3, showRemaining: true });
    expect(markup).toContain("Pregunta 1 de 3");
    expect(markup).not.toMatch(/Quedan unas|preguntas? por hoy/);
  });

  it("counts what there is when there are fewer than the limit: it does not say «de 3» of two", () => {
    const markup = loop(goingOn(), ["current_job_review"], { limit: 3, showRemaining: true });
    expect(markup).toContain("Pregunta 1 de 1");
  });

  it("says the session's own estimate without calling a session of hours «hoy»", () => {
    const markup = loop(goingOn(), ["current_job_review"], { showRemaining: true });
    expect(markup).toMatch(/Última pregunta\.|Quedan unas \d+ preguntas\./);
    expect(markup).not.toMatch(/preguntas? por hoy/);
  });
});

describe("what an answer did, said wherever it was given (U20)", () => {
  it("is a line with the way back, and the way to see it where it went on a narrow screen", () => {
    const only = html(createElement(AnswerReceipt, { receipt: "Guardado: terminó en agosto de 2026." }));
    expect(only).toContain("data-answer-receipt");
    expect(only).toContain("Guardado: terminó en agosto de 2026.");
    expect(only).not.toContain("Deshacer");
    const full = html(createElement(AnswerReceipt, { receipt: "Listo.", onUndo: () => undefined, onShowProfile: () => undefined }));
    expect(full).toContain("Deshacer");
    expect(full).toContain("Ver en tu perfil");
  });
});
