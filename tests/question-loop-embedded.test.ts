import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuestionLoop } from "@/components/onboarding/QuestionLoop";
import { saveCycle } from "@/lib/onboarding/resume";
import { ACHIEVEMENT_TYPES } from "@/lib/onboarding/questions";
import type { Gap } from "@/lib/onboarding/gaps";
import { emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, withJob } from "./helpers/profiles";

/**
 * The loop asked inside another page — beside the CV, on the page of an application (U10, U12, U13): one «Ahora no», that of the question's own card, and not a
 * second one under it that does something else; the achievements the person was telling have their own, which is the way to leave them for another day. What it does
 * when answered (a round, not a session; no scrolling) is walked through in the browser, since a click is not a thing to render here.
 */

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/<!-- -->/g, "");
const countOf = (markup: string, label: string) => (markup.match(new RegExp(`>${label}<`, "g")) ?? []).length;

function profile(): { stored: StoredProfile; jobId: string } {
  const stored = emptyStoredProfile();
  const job = withJob(stored, { company: "Logística Sur", role: "Encargada de depósito", from: { year: 2022, month: 3 }, to: "current", facts: [{ text: "Armo los pedidos del depósito" }, { text: "Controlo el stock semanal" }] });
  return { stored, jobId: job.id };
}

const loop = (stored: StoredProfile, jobId: string, extra: Record<string, unknown> = {}) =>
  html(createElement(QuestionLoop, { profile: stored, now: NOW, only: jobId, onExhausted: () => undefined, ...extra }));

describe("the loop on its own page, asking one thing after another", () => {
  it("draws its dismissal under the card, with the label it is given: «Dejar por hoy», which is not a way of putting off a question", () => {
    const { stored, jobId } = profile();
    const markup = loop(stored, jobId, { dismissLabel: "Dejar por hoy" });
    expect(countOf(markup, "Ahora no")).toBe(1);
    expect(countOf(markup, "Dejar por hoy")).toBe(1);
  });
});

describe("the loop inside another page", () => {
  it("has one «Ahora no» and not two: the card's own, which is the one that is kept", () => {
    const { stored, jobId } = profile();
    const markup = loop(stored, jobId, { embedded: true });
    expect(markup).toContain("¿Hubo algo que mejorara gracias a tu trabajo en Logística Sur?");
    expect(countOf(markup, "Ahora no")).toBe(1);
    expect(countOf(markup, "No aplica")).toBe(1);
  });

  it("not even with the label the page used to give it: two buttons with the same name that did different things", () => {
    const { stored, jobId } = profile();
    expect(countOf(loop(stored, jobId, { embedded: true, dismissLabel: "Ahora no" }), "Ahora no")).toBe(1);
  });

  it("says what it is for above the question, when the page that has it says so", () => {
    const { stored, jobId } = profile();
    const markup = loop(stored, jobId, { embedded: true, heading: createElement("p", { "data-heading": "" }, "Para tu perfil") });
    expect(markup).toContain('data-heading=""');
    expect(markup.indexOf("Para tu perfil")).toBeLessThan(markup.indexOf("¿Hubo algo que mejorara"));
  });

  it("keeps the way to leave the achievements for another day while they are being told: the card that tells them has no «Ahora no» of its own", () => {
    const { stored, jobId } = profile();
    const type = ACHIEVEMENT_TYPES[0]!;
    const gap: Gap = { id: `no_achievements:${jobId}`, rule: "no_achievements", priority: "medium", experienceId: jobId, payload: {} };
    saveCycle(stored, { gap, experienceId: jobId, remaining: [type.value], created: 0 });
    const markup = loop(stored, jobId, { embedded: true });
    expect(markup).toContain("¿qué hiciste y qué pasó?");
    expect(markup).toContain("Saltar este");
    // One, and it is the page's: the way to leave the whole of it, which is kept where it was.
    expect(countOf(markup, "Ahora no")).toBe(1);
  });
});
