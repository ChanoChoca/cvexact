import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GooglePhotoNotice, GoogleRowNotice, GoogleSetupNotice } from "@/components/ai/GoogleNotice";
import { ByokSetup, glossOf } from "@/components/billing/ByokSetup";
import {
  GOOGLE_EUROPE,
  GOOGLE_FREE_FACTS,
  GOOGLE_PAID_FACTS,
  GOOGLE_PAID_STEPS,
  GOOGLE_TERMS_IN_FORCE,
  GOOGLE_TERMS_READ_ON,
  GOOGLE_TERMS_READ_ON_TEXT,
  GOOGLE_TERMS_URL,
  UNDER_EIGHTEEN,
  WHAT_WE_DO,
  WITHOUT_AI,
  hasGoogleKey,
} from "@/lib/ai/google-terms";
import { READ } from "@/lib/legal/data-flow";

/**
 * What a person is told before they turn on the free tier of Google's API (e5, O6): the three things its terms say, the way out of each, and
 * that each sentence is kept next to the one of the terms it comes from, in Google's words, so that whoever changes one is shown the other.
 */

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/<!-- -->/g, "");
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("what is said, and where it is said from", () => {
  it("is each sentence beside the sentence of the terms it comes from", () => {
    const from = Object.fromEntries([...GOOGLE_FREE_FACTS, ...GOOGLE_PAID_FACTS].map((fact) => [fact.id, fact.from]));
    expect(from.used).toContain("Google uses the content you submit to the Services");
    expect(from.used).toContain("improve, and develop Google products");
    expect(from.read).toContain("human reviewers may read, annotate, and process your API input and output");
    expect(from.personal).toBe("Do not submit sensitive, confidential, or personal information to the Unpaid Services.");
    expect(from.adults).toBe("You must be 18 years of age or older to use the APIs.");
    expect(from["not-used"]).toContain("doesn't use your prompts");
    expect(from["not-used"]).toContain("to improve our products");
    expect(from.logged).toContain("for a limited period of time, solely for detecting and preventing violations of the Prohibited Use Policy");
    expect(GOOGLE_EUROPE.from).toContain("European Economic Area, Switzerland, or the United Kingdom");
  });

  it("says in Spanish what each of them says", () => {
    const says = Object.fromEntries([...GOOGLE_FREE_FACTS, ...GOOGLE_PAID_FACTS].map((fact) => [fact.id, fact.says]));
    expect(says.used).toMatch(/mejorar sus productos/);
    expect(says.read).toMatch(/Personas de Google pueden leerlo/);
    expect(says.personal).toMatch(/sensible, confidencial ni personal/);
    expect(says.adults).toMatch(/18 años o más/);
    expect(says["not-used"]).toMatch(/no usa lo que mandás para mejorar sus productos/);
    expect(says.logged).toMatch(/tiempo limitado, solo para detectar usos prohibidos/);
    expect(GOOGLE_EUROPE.says).toMatch(/Espacio Económico Europeo, Suiza o el Reino Unido/);
  });

  it("carries the day the terms came into force and the day they were read, and the address to read them at", () => {
    expect(GOOGLE_TERMS_IN_FORCE).toBe("23 de marzo de 2026");
    expect(GOOGLE_TERMS_READ_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(GOOGLE_TERMS_URL).toBe("https://ai.google.dev/gemini-api/terms");
  });

  it("says the day it was read in the words of the policy, and they are the same day", () => {
    const [year, month, day] = GOOGLE_TERMS_READ_ON.split("-").map(Number);
    const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    expect(GOOGLE_TERMS_READ_ON_TEXT).toBe(`${day} de ${months[month! - 1]} de ${year}`);
  });

  it("says what the browser does before a text is read in the one sentence the data-flow facts say it, which is the policy's", () => {
    expect(WHAT_WE_DO.masked).toBe(READ.masked);
  });

  it("says how the paid tier is reached in steps that are Google's, and that it asks for a card", () => {
    expect(GOOGLE_PAID_STEPS.map((step) => step.title)).toEqual(["Abrí Google AI Studio", "Tocá «Set up billing»", "Copiá la key de ese proyecto"]);
    expect(GOOGLE_PAID_STEPS[1]!.body).toMatch(/tarjeta/);
  });

  it("says what works with no model and what does not", () => {
    expect(WITHOUT_AI.works).toMatch(/perfil/);
    expect(WITHOUT_AI.works).toMatch(/CV base/);
    expect(WITHOUT_AI.needs).toMatch(/Adaptar el CV a un aviso/);
    // Every kind of document the models write is named, so that nobody finds out one needs a key by looking for it.
    for (const kind of ["respuestas del formulario", "email de presentación", "entrevista", "guion del video"]) expect(WITHOUT_AI.needs, kind).toContain(kind);
  });
});

describe("the notice before the free key", () => {
  const markup = html(createElement(GoogleSetupNotice));

  it("says the three things, the one for whoever is not of age, what the product does about them and what it cannot", () => {
    const said = text(markup);
    for (const fact of GOOGLE_FREE_FACTS) expect(said, fact.id).toContain(fact.says);
    expect(said).toContain(UNDER_EIGHTEEN);
    expect(said).toContain(WHAT_WE_DO.masked);
    expect(said).toContain(WHAT_WE_DO.travels);
    expect(said).toContain(GOOGLE_EUROPE.says);
    expect(said).toContain(GOOGLE_TERMS_IN_FORCE);
  });

  it("links to the terms, to be read where Google wrote them", () => {
    expect(markup).toContain(`href="${GOOGLE_TERMS_URL}"`);
    expect(markup).toMatch(/rel="noopener noreferrer"/);
  });

  it("is a warning, said once and in a few lines, with no push in it", () => {
    expect(markup).toContain("data-google-notice=\"setup\"");
    expect(text(markup)).not.toMatch(/gratis, sin límite|aprovech|no te lo pierdas|chances/i);
  });
});

describe("the notice before the free key, as it is read (U37)", () => {
  const markup = html(createElement(GoogleSetupNotice));
  /** What is on the screen before anything is tapped: the notice without what is folded. */
  const folded = markup.match(/<details[\s\S]*?<\/details>/g) ?? [];
  const visible = text(markup.replace(/<details[\s\S]*?<\/details>/g, ""));
  const asked = (id: string) => GOOGLE_FREE_FACTS.find((fact) => fact.id === id)!.says;

  it("says first what Google asks of whoever uses the key —18 years, nothing personal— and then what it does with what is sent, each in its own sentence of the terms", () => {
    const items = [...markup.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((item) => text(item[1]!).trim());
    expect(items).toHaveLength(4);
    expect(items[0]).toContain(asked("adults"));
    expect(items[1]).toBe(asked("personal"));
    expect(items[2]).toBe(asked("used"));
    expect(items[3]).toBe(asked("read"));
  });

  it("tells the one who is not of age, in the same line, not to activate it, and that nothing here needs the key", () => {
    const first = text([...markup.matchAll(/<li>([\s\S]*?)<\/li>/g)][0]![1]!).trim();
    expect(first).toBe(`${asked("adults")} ${UNDER_EIGHTEEN}`);
  });

  it("keeps the four sentences, the one for whoever is not of age and the link to the terms on the screen — and not behind a tap", () => {
    for (const fact of GOOGLE_FREE_FACTS) expect(visible, fact.id).toContain(fact.says);
    expect(visible).toContain(UNDER_EIGHTEEN);
    expect(visible).toContain("Ver los términos de Google");
  });

  it("folds what the product does about it, who Google treats differently and the day of the terms, under «Qué mandamos y qué no», closed", () => {
    expect(markup).toContain("data-google-fold");
    expect(folded).toHaveLength(1);
    expect(markup).not.toMatch(/<details[^>]*\sopen/);
    const inside = text(folded[0]!);
    expect(inside).toContain("Qué mandamos y qué no");
    expect(inside).toContain(WHAT_WE_DO.masked);
    expect(inside).toContain(WHAT_WE_DO.travels);
    expect(inside).toContain(GOOGLE_EUROPE.says);
    expect(inside).toContain(GOOGLE_TERMS_IN_FORCE);
    // …and none of it is on the screen before the tap.
    for (const piece of [WHAT_WE_DO.masked, WHAT_WE_DO.travels, GOOGLE_EUROPE.says, GOOGLE_TERMS_IN_FORCE]) expect(visible).not.toContain(piece);
  });

  it("is short where it is read: it was two hundred words in a box, and what is on the screen is under a hundred", () => {
    const words = visible.trim().split(/\s+/).length;
    expect(words).toBeLessThan(100);
  });
});

describe("the notice in the row, once it was read (U38)", () => {
  it("is the same notice in full, for whoever is about to paste a key and has not been told", () => {
    const markup = html(createElement(GoogleRowNotice));
    expect(markup).toContain('data-google-notice="row"');
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("Ver las condiciones");
  });

  it("is a line that opens, with the same words inside and nothing said twice, where it was read already", () => {
    const markup = html(createElement(GoogleRowNotice, { startFolded: true }));
    expect(markup).toContain("data-google-notice-folded");
    expect(markup).not.toMatch(/<details[^>]*\sopen/);
    const said = text(markup);
    expect(said).toContain("Condiciones de Google");
    expect(said).toContain("Ver las condiciones");
    expect(said).toContain("Ocultar las condiciones");
    for (const fact of [...GOOGLE_FREE_FACTS, ...GOOGLE_PAID_FACTS]) expect(said, fact.id).toContain(fact.says);
    expect(markup.match(/data-google-notice="row"/g)).toHaveLength(1);
  });
});

describe("the steps that name a button of Google's, which is in English there (U40)", () => {
  it("says beside each what it means, and leaves the rest of the steps as they are", () => {
    expect(glossOf("Tocá «Create API key»")).toBe("crear clave de API");
    expect(glossOf(GOOGLE_PAID_STEPS[1]!.title)).toBe("configurar la facturación");
    expect(glossOf(GOOGLE_PAID_STEPS[0]!.title)).toBeUndefined();
    expect(glossOf(GOOGLE_PAID_STEPS[2]!.title)).toBeUndefined();
    expect(glossOf("Abrí Google AI Studio")).toBeUndefined();
  });
});

describe("the guided setup", () => {
  const markup = html(createElement(ByokSetup, {}));

  it("begins with what Google says and three ways on that weigh the same, and asks for nothing yet", () => {
    expect(markup).toContain("data-byok-choice");
    expect(text(markup)).toContain("Antes de usar la key gratuita de Google");
    const buttons = [...markup.matchAll(/<button[^>]*class="([^"]*)"[^>]*>(Sigo con la key gratuita|Uso una key del nivel pago|Sigo sin IA)<\/button>/g)];
    expect(buttons.map((button) => button[2])).toEqual(["Sigo con la key gratuita", "Uso una key del nivel pago", "Sigo sin IA"]);
    expect(new Set(buttons.map((button) => button[1])).size).toBe(1);
    // No box to paste a key into, no step to make one, before one of the three is chosen.
    expect(markup).not.toContain("Tu API key de Google AI Studio");
    expect(markup).not.toContain("Create API key");
  });

  it("does not call the key free before it has said what Google asks of it", () => {
    expect(text(markup)).not.toMatch(/es gratis|gratis, sin|Armar mi key, es gratis/i);
  });

  it("says where another provider is chosen, with its own conditions", () => {
    expect(markup).toContain('href="/ajustes"');
    expect(text(markup)).toMatch(/cada uno tiene sus propias condiciones/);
  });
});

describe("the notice in the row of Ajustes, and over the photo", () => {
  it("says what the free tier does, what changes with the paid one, and what the product does and cannot", () => {
    const said = text(html(createElement(GoogleRowNotice)));
    for (const fact of GOOGLE_FREE_FACTS) expect(said, fact.id).toContain(fact.says);
    for (const fact of GOOGLE_PAID_FACTS) expect(said, fact.id).toContain(fact.says);
    expect(said).toContain("Con una key del nivel pago eso cambia");
    expect(said).toContain(WHAT_WE_DO.masked);
  });

  it("says over a photo that it goes whole, and what to do instead", () => {
    const said = text(html(createElement(GooglePhotoNotice)));
    expect(said).toContain("Una de tus keys es de Google");
    expect(said).toContain("Una foto de un CV va entera, con todo lo que se ve");
    expect(said).toContain("copiá el texto de la foto y pegalo");
    expect(said).toMatch(/mejorar sus productos/);
  });
});

describe("whether one of the keys is Google's", () => {
  it("is so only for a Google key with something in it", () => {
    expect(hasGoogleKey([{ provider: "google", apiKey: "AIza123" }])).toBe(true);
    expect(hasGoogleKey([{ provider: "groq", apiKey: "gsk_1" }, { provider: "google", apiKey: " AIza123 " }])).toBe(true);
    expect(hasGoogleKey([{ provider: "google", apiKey: "  " }])).toBe(false);
    expect(hasGoogleKey([{ provider: "groq", apiKey: "gsk_1" }])).toBe(false);
    expect(hasGoogleKey([])).toBe(false);
  });
});
