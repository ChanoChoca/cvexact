import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InterviewQuestion } from "@/app/(app)/postulaciones/InterviewQuestion";
import { INTERVIEW_HINT, INTERVIEW_QUESTION, INTERVIEW_TEXT_MAX, interviewAsks, reachedInterview } from "@/lib/jobs/interview";
import { ENGINE } from "@/lib/onboarding/config";
import { declineThings } from "@/lib/profile/declined";
import { toPlainProfile } from "@/lib/profile/project";
import { emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { FakeStorage, installBrowser, uninstallBrowser } from "./helpers/browser-storage";
import { NOW, withJob } from "./helpers/profiles";

/**
 * O12: when an application reaches the interview, one optional question about what they were asked, read as the lines of an offer are read and
 * turned into a question for each thing it names — never a fact, never in the CV. Asked once for each application.
 */

const DAY = 86_400_000;
const asks = (said: string, stored: StoredProfile = emptyStoredProfile()) => interviewAsks({ said, profile: toPlainProfile(stored), stored, now: NOW });

describe("when an application reaches the interview", () => {
  it("is when it was not there and now is: back and forth is not twice, and nothing else is an interview", () => {
    expect(reachedInterview("postulado", "entrevista")).toBe(true);
    expect(reachedInterview(undefined, "entrevista")).toBe(true);
    expect(reachedInterview("entrevista", "entrevista")).toBe(false);
    expect(reachedInterview("entrevista", "evaluacion")).toBe(false);
    expect(reachedInterview("postulado", "rechazado")).toBe(false);
    expect(reachedInterview("postulado", "sin_respuesta")).toBe(false);
    expect(reachedInterview("entrevista", "oferta")).toBe(false);
  });
});

describe("what they say they were asked", () => {
  it("becomes a question for each thing it names, in the words of the question of an offer", () => {
    const found = asks("Me preguntaron si manejaba Tango Gestión y si tenía licencia de conducir B1.");
    expect(found.map((ask) => [ask.kind, ask.thing, ask.question])).toEqual([
      ["license", "Licencia de conducir", "¿Tenés licencia de conducir?"],
      ["tool", "Tango Gestión", "¿Usaste Tango Gestión en algún trabajo, curso o proyecto?"],
    ]);
  });

  it("keeps the words they used as the line beside it, and never says an offer asked", () => {
    const [ask] = asks("Querían saber si tengo el carnet de manipulación de alimentos");
    expect(ask).toMatchObject({ kind: "credential", type: "credential", question: "¿Tenés esa credencial?", obligation: "unstated" });
    expect(ask!.fragment.toLowerCase()).toContain("carnet de manipulación de alimentos");
  });

  it("asks what is worth knowing first first, and at most three, one at a time and never a list", () => {
    const found = asks("Me hablaron de Excel, de SAP, de Photoshop y de Tango Gestión, y de la licencia de conducir y la libreta sanitaria.");
    expect(found).toHaveLength(ENGINE.interview.maxAsks);
    expect(found.map((ask) => ask.kind)).toEqual(["credential", "license", "tool"]);
  });

  it("says each thing once, however many times they said it", () => {
    expect(asks("Me preguntaron por Excel. Y otra vez por Excel, y por Excel avanzado.").map((ask) => ask.thing)).toEqual(["Excel"]);
  });

  it("is nothing when they said nothing, or nothing that an offer could have asked", () => {
    expect(asks("")).toEqual([]);
    expect(asks("   \n  ")).toEqual([]);
    expect(asks("Me preguntaron cómo me llevo con la gente y qué me gusta hacer")).toEqual([]);
  });

  it("is nothing for what the profile already says, and nothing for what they said no to — until a year has gone by, and then once", () => {
    const said = emptyStoredProfile();
    withJob(said, { company: "Acme", role: "Analista", from: { year: 2020 }, to: "current", facts: [{ text: "Armé los informes mensuales en Excel" }] });
    expect(asks("Me preguntaron por Excel", said)).toEqual([]);

    const refused = emptyStoredProfile();
    declineThings(refused, "requirement", ["Tango Gestión"], { quote: "Manejo de Tango Gestión" }, { newId: () => "d1", now: new Date(NOW.getTime() - 90 * DAY).toISOString() });
    expect(asks("Me preguntaron si manejaba Tango Gestión", refused)).toEqual([]);

    const old = emptyStoredProfile();
    const day = new Date(NOW.getTime() - 400 * DAY).toISOString();
    declineThings(old, "requirement", ["Tango Gestión"], { quote: "Manejo de Tango Gestión" }, { newId: () => "d2", now: day });
    expect(asks("Me preguntaron si manejaba Tango Gestión", old)[0]).toMatchObject({ thing: "Tango Gestión", again: day });
  });

  it("reads no more than a few hundred characters of what they said", () => {
    expect(INTERVIEW_TEXT_MAX).toBe(600);
    const long = `Me preguntaron por Excel. ${"relleno ".repeat(200)} y por SAP al final`;
    expect(asks(long).map((ask) => ask.thing)).toEqual(["Excel"]);
  });

  it("is said in fixed words, with no example in them: an example is what gets copied", () => {
    expect(INTERVIEW_QUESTION).toBe("¿Te preguntaron por algo que no está en tu perfil?");
    expect(INTERVIEW_HINT).toBe("Contalo en una frase. Es opcional.");
    expect(INTERVIEW_QUESTION + INTERVIEW_HINT).not.toMatch(/\bpor ejemplo\b|\bej\.|chances|te falta|las empresas/i);
  });
});

describe("the card", () => {
  const html = renderToStaticMarkup(createElement(InterviewQuestion, { application: { id: "app-1", label: "Gasista · Acme" }, onClose: () => undefined })).replace(/<!-- -->/g, "");
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("says which application reached the interview, asks the one question, and has three ways to answer that weigh the same", () => {
    expect(text).toContain("Pasó a entrevista");
    expect(text).toContain("Gasista · Acme");
    expect(text).toContain(INTERVIEW_QUESTION);
    expect(text).toContain(INTERVIEW_HINT);
    const buttons = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);
    expect(buttons).toEqual(["Contar", "Nada nuevo", "Ahora no"]);
    const classes = [...html.matchAll(/<button[^>]*class="([^"]*)"/g)].map((match) => match[1]!.replace(/disabled:[^ ]+/g, "").replace(/\s+/g, " ").trim());
    expect(new Set(classes).size).toBe(1);
  });

  it("says, where «Ahora no» is read, what it does: it closes, and this application is not asked again (U45)", () => {
    expect(html).toContain("data-put-off-note");
    expect(text).toContain("Con «Ahora no» se cierra, y no te lo volvemos a preguntar de esta postulación.");
  });

  it("shows no receipt before there is an answer to tell: it is above the card once one is given", () => {
    expect(html).not.toContain("data-answer-receipt");
    const source = readFileSync("app/(app)/postulaciones/InterviewQuestion.tsx", "utf8");
    expect(source).toContain("<AnswerReceipt receipt={receipt.text} onUndo={undo} />");
    // «Deshacer» gives back the profile as it was before the answer and the step it was given at, and nothing earlier.
    expect(source).toMatch(/if \(receipt\.before\) restoreProfile\(receipt\.before\);\s*setStage\(receipt\.back\);/);
    // The last answer says what it did like all the others: «Listo» alone left the person to find out where it went.
    expect(source).not.toContain("Lo que contestaste quedó en tu perfil");
  });

  it("is for a person, not a score: it does not push, count or promise", () => {
    expect(text).not.toMatch(/chances|tasa|porcentaje|mejorá|aumentá|la empresa busca|las empresas/i);
  });
});

describe("once for each application", () => {
  afterEach(() => {
    uninstallBrowser();
    vi.resetModules();
  });

  async function store() {
    vi.resetModules();
    installBrowser({ local: new FakeStorage() });
    return import("@/lib/storage/interview-asked");
  }

  it("remembers which were asked, in this browser, and not the others", async () => {
    const { markInterviewAsked, wasInterviewAsked } = await store();
    expect(wasInterviewAsked("a")).toBe(false);
    markInterviewAsked("a", NOW);
    expect(wasInterviewAsked("a")).toBe(true);
    expect(wasInterviewAsked("b")).toBe(false);
  });

  it("keeps the last few hundred, forgetting the oldest first", async () => {
    const { markInterviewAsked, wasInterviewAsked } = await store();
    for (let index = 0; index < 305; index += 1) markInterviewAsked(`app-${index}`, new Date(NOW.getTime() + index * 1000));
    expect(wasInterviewAsked("app-0")).toBe(false);
    expect(wasInterviewAsked("app-4")).toBe(false);
    expect(wasInterviewAsked("app-5")).toBe(true);
    expect(wasInterviewAsked("app-304")).toBe(true);
  });

  it("survives what a browser keeps wrong: nothing is asked twice by a corrupt entry, and nothing throws", async () => {
    const { wasInterviewAsked } = await store();
    const local = new FakeStorage();
    installBrowser({ local });
    local.setItem("cvexact.interviewAsked.v1", "{no es un json");
    expect(() => wasInterviewAsked("a")).not.toThrow();
    expect(wasInterviewAsked("a")).toBe(false);
    local.setItem("cvexact.interviewAsked.v1", JSON.stringify(["a"]));
    expect(wasInterviewAsked("a")).toBe(false);
  });

  it("is forgotten with the rest when the data of this browser is cleared", async () => {
    vi.resetModules();
    const local = new FakeStorage();
    installBrowser({ local });
    const api = await import("@/lib/storage/local");
    const { markInterviewAsked } = await import("@/lib/storage/interview-asked");
    markInterviewAsked("a", NOW);
    expect(local.getItem(api.INTERVIEW_ASKED_KEY)).not.toBeNull();
    await api.clearBrowserData();
    expect(local.getItem(api.INTERVIEW_ASKED_KEY)).toBeNull();
  });
});
