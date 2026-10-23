import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialog";
import { FirstValueStep } from "@/components/onboarding/FirstValueStep";
import { IntakeStep } from "@/components/onboarding/IntakeStep";
import { TrustLine } from "@/components/onboarding/TrustLine";
import { emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { RULES } from "@/lib/voice";
import { SPANISH_BULLETS } from "./fixtures/cv-samples";
import { profileFrom } from "./helpers/cv-profile";

/**
 * The new start (stage 2 of «la nueva carga del perfil»): one place to bring a document, one way on without it and three things said once;
 * «listo» when a reading had nothing to look at twice, and the profile, with its tags «Para revisar», when it did. What is checked is what a person
 * reads: that the three promises are the ones that are true, that nothing the start used to say twice is left, and that every line is in the voice.
 */

// What the AI will do, and whether «Sigo sin IA» was said: the key prompt of «Tu perfil está listo» reads both, and the ways on do not wait for either.
const aiNow = vi.hoisted(() => ({ ai: { tone: "ok", message: "IA con tu key · sin límite", actionable: false, byok: true } as { tone: string; message: string; actionable: boolean; byok: boolean } | null, withoutAi: false }));
vi.mock("@/lib/ai/availability", () => ({ useAiAvailability: () => aiNow.ai }));
vi.mock("@/lib/storage/ai-choice", () => ({ useWithoutAi: () => aiNow.withoutAi }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }), usePathname: () => "/perfil/empezar" }));
// Bringing a copy back asks to confirm and to say what it did; neither has a page here, and what it reads is `recover-copy.test.ts`'s.
vi.mock("@/components/onboarding/useRecoverHere", () => ({ useRecoverHere: () => ({ recoverFile: async () => {}, error: null }) }));

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/<!-- -->/g, "");
const words = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const inTheVoice = (markup: string) => {
  for (const rule of RULES) expect(rule.not.test(words(markup)), `${rule.use}: «${words(markup)}»`).toBe(false);
};

describe("the three things said under the place to bring a document", () => {
  const markup = html(createElement(TrustLine));

  it("are the three that are true, in this order", () => {
    const items = [...markup.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((match) => words(match[1]!));
    expect(items).toEqual(["Se leen en tu navegador: no se suben", "Sin cuenta: queda en este navegador", "Lo borrás cuando quieras"]);
  });

  it("each have a drawing that is not read out, and none of them is a lock", () => {
    expect(markup.match(/<svg[^>]*aria-hidden="true"/g)).toHaveLength(3);
    expect(markup).not.toMatch(/lock|candado|256|RGPD/i);
  });

  it("speak in the product's voice", () => inTheVoice(markup));
});

describe("the start", () => {
  const props = { mailAvailable: true, turnstileSiteKey: "", guideOpen: false, onImported: () => {}, onScratch: () => {}, onManual: () => {} };
  const start = (over: Partial<typeof props> = {}) => html(createElement(ConfirmDialogProvider, null, createElement(IntakeStep, { ...props, ...over })));

  it("has the title, the place to bring a document, one way on without it and the three things — and nothing of what the start used to say twice", () => {
    const markup = start();
    expect(markup).toContain("Vamos a construir tu perfil profesional");
    expect(markup).toMatch(/type="file"[^>]*accept="[^"]*application\/json/);
    expect(markup).toMatch(/<button[^>]*>Crear perfil vacío<\/button>/);
    expect(markup).toContain("data-trust-line");
    for (const gone of ["Empezar sin documento", "Ir a mi perfil vacío", "Ya tenías un perfil", "Recuperalo con tu copia", "No hace falta cuenta", "Ingresá", "Cómo sacar tu perfil de LinkedIn"]) {
      expect(markup, gone).not.toContain(gone);
    }
  });

  it("says in the drop zone that a copy of the profile is taken there, and says nothing of where the files are read: that is one of the three", () => {
    const hint = words(start());
    expect(hint).toContain("copia de tu perfil de cvexact (.json), también la recuperás acá");
    expect(hint.match(/no se suben/g)).toHaveLength(1);
  });

  it("opens the LinkedIn guide only for the link that asked for it", () => {
    expect(start({ guideOpen: true })).toContain("LinkedIn");
    expect(start({ guideOpen: true }).length).toBeGreaterThan(start().length);
  });

  it("speaks in the product's voice", () => inTheVoice(start()));
});

describe("«Tu perfil está listo»", () => {
  const markup = (profile: StoredProfile) => html(createElement(FirstValueStep, { profile, onFinish: () => {} }));

  it("says the three things it takes to have a CV for an offer, in order, and the two ways on", () => {
    const text = words(markup(profileFrom(SPANISH_BULLETS)));
    expect(text).toContain("Tu perfil está listo");
    expect(text.indexOf("Pegás el aviso")).toBeLessThan(text.indexOf("Revisás lo que armamos"));
    expect(text.indexOf("Revisás lo que armamos")).toBeLessThan(text.indexOf("Lo bajás en PDF o Word"));
    expect(markup(profileFrom(SPANISH_BULLETS))).toMatch(/<button[^>]*>Guiame paso a paso<\/button>.*<button[^>]*>Lo hago yo<\/button>/);
  });

  const noKey = { tone: "bad", message: "Sin IA disponible · poné tu key en Ajustes", actionable: true, byok: false };
  const withKey = { tone: "ok", message: "IA con tu key · sin límite", actionable: false, byok: true };
  const withPlan = { tone: "ok", message: "IA incluida en tu suscripción", actionable: false, byok: false };
  /** The step as it reads under this AI: the key (or its absence, or not knowing yet) and whether «Sigo sin IA» was said. */
  const under = (profile: StoredProfile, ai: typeof aiNow.ai, withoutAi = false) => {
    Object.assign(aiNow, { ai, withoutAi });
    try {
      return markup(profile);
    } finally {
      Object.assign(aiNow, { ai: withKey, withoutAi: false });
    }
  };

  it("shows the ways on from the start after a document —the tour asks for the key at its second step—, with a key, without one and before it is known", () => {
    const profile = profileFrom(SPANISH_BULLETS);
    for (const markupOf of [under(profile, withKey), under(profile, noKey), under(profile, null), under(profile, noKey, true)]) expect(markupOf).toMatch(/Guiame paso a paso.*Lo hago yo/);
  });

  describe("after a profile built by hand", () => {
    const byHand = (): StoredProfile => {
      const profile = profileFrom(SPANISH_BULLETS);
      return { ...profile, sources: [] };
    };

    it("waits for an AI to show the ways on: without a key, and before the server has said", () => {
      for (const ai of [noKey, null]) {
        const markupOf = under(byHand(), ai);
        expect(markupOf, String(ai?.tone)).not.toContain("Guiame paso a paso");
        expect(markupOf).not.toContain("Lo hago yo");
        // What it does show is what to do: the steps, and the key to make.
        expect(markupOf).toContain("Tu perfil está listo");
      }
    });

    it("shows them once there is a key of their own or a plan that includes the AI", () => {
      for (const ai of [withKey, withPlan]) expect(under(byHand(), ai), ai.message).toMatch(/Guiame paso a paso.*Lo hago yo/);
    });

    it("shows them to whoever said «Sigo sin IA»: the profile and its CV work without one", () => {
      expect(under(byHand(), noKey, true)).toMatch(/Guiame paso a paso.*Lo hago yo/);
    });
  });

  it("says what each document gave when there was one, and leaves that out when the profile was built by hand", () => {
    expect(words(markup(profileFrom(SPANISH_BULLETS)))).toMatch(/Leímos «cv\.pdf»: \d+ puestos?/);
    expect(words(markup(emptyStoredProfile()))).not.toContain("Leímos");
  });

  it("no longer asks for an account, a copy or a sign-in: «Para hacer» in the profile does", () => {
    const text = words(markup(profileFrom(SPANISH_BULLETS)));
    for (const gone of ["Subir mi perfil", "Bajar una copia", "¿Guardamos tu perfil", "Mejorarlo con unas preguntas", "Así queda tu CV", "Ya quiero un CV para una oferta"]) {
      expect(text, gone).not.toContain(gone);
    }
  });

  it("speaks in the product's voice", () => inTheVoice(markup(profileFrom(SPANISH_BULLETS))));
});
