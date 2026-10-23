import { readFileSync } from "node:fs";
import ts from "typescript";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FirstValueStep } from "@/components/onboarding/FirstValueStep";
import { Button } from "@/components/ui";
import { PostularGuide, TourCard } from "@/components/wizard/PostularGuide";
import { POSTING_MIN, TOUR, TOUR_HREF, TOUR_KEY, TOUR_PARAM, loadStep, postingIsEnough, revealDelta, saveStep, settleStep, stopOf, type Here } from "@/components/wizard/postular-tour";
import { emptyStoredProfile } from "@/lib/schemas/profile-v2";
import { RULES } from "@/lib/voice";
import { sourcesUnder } from "./helpers/copy";
import { FakeStorage, installBrowser, uninstallBrowser } from "./helpers/browser-storage";

/**
 * Stage 6 of «la nueva carga del perfil»: «Guiame» as a tour of Postular. What is checked is what the tour decides without a browser — its steps, where it stands
 * given what the page shows, how far it scrolls, what it keeps for the tab — and what a person reads on its card; the outline, the scroll and the advance on their
 * own are the journeys' (`e2e-carga6`).
 */

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/<!-- -->/g, "");
const words = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const inTheVoice = (text: string) => {
  for (const rule of RULES) expect(rule.not.test(text), `${rule.use}: «${text}»`).toBe(false);
};

/** A page that shows these parts of the wizard. */
const page = (...targets: string[]): Here => (target) => targets.includes(target);
/** Before the CV: the paste box and the button. */
const PASTING = page("aviso", "generar");
/** Before the CV, with no key: the prompt for one is below the button. */
const NO_KEY = page("aviso", "generar", "clave");
/** After it. */
const WRITTEN = page("revision", "descargas");

describe("the steps", () => {
  it("are four, in the order of getting a CV: paste the posting, generate, review, download", () => {
    expect(TOUR).toHaveLength(4);
    expect(TOUR.map((stops) => stops[0]!.target)).toEqual(["aviso", "clave", "revision", "descargas"]);
    expect(TOUR[1]!.map((stop) => stop.target)).toEqual(["clave", "generar"]);
  });

  it("each say what to do in a title and a sentence, and every target is its own", () => {
    const stops = TOUR.flat();
    for (const stop of stops) {
      expect(stop.title.length, stop.target).toBeGreaterThan(3);
      expect(stop.text.length, stop.target).toBeGreaterThan(20);
    }
    expect(new Set(stops.map((stop) => stop.target)).size).toBe(stops.length);
  });

  it("promise nothing the product does not do: no figures, no free key, no interviews", () => {
    const said = words(TOUR.flat().map((stop) => `${stop.title} ${stop.text} ${stop.then ?? ""}`).join(" "));
    expect(said).not.toMatch(/\d/);
    expect(said).not.toMatch(/gratis|segundos|garantiz|entrevista|sin límite/i);
  });

  it("speak in the product's voice", () => {
    for (const stop of TOUR.flat()) inTheVoice(words(`${stop.title} ${stop.text} ${stop.then ?? ""}`));
  });

  it("only the steps that wait for something have a line to say in place of «Siguiente»: the posting to be pasted, the CV to be written", () => {
    expect(TOUR[0]!.every((stop) => stop.then)).toBe(true);
    expect(TOUR[1]!.every((stop) => stop.then)).toBe(true);
    expect([TOUR[2], TOUR[3]].every((stops) => stops!.every((stop) => !stop.then))).toBe(true);
  });

  it("only the first has work of its own, which the tour goes on from by itself: the others wait for the page to show the next part", () => {
    expect(TOUR[0]!.every((stop) => stop.ready)).toBe(true);
    expect(TOUR.slice(1).flat().every((stop) => !stop.ready)).toBe(true);
  });
});

describe("the posting that completes the first step", () => {
  it("is enough at the least the wizard generates from, counted the way it counts", () => {
    expect(postingIsEnough("")).toBe(false);
    expect(postingIsEnough("x".repeat(POSTING_MIN - 1))).toBe(false);
    expect(postingIsEnough("x".repeat(POSTING_MIN))).toBe(true);
    // Blanks and line breaks collapse, and the ends do not count: a box of spaces is not a posting.
    expect(postingIsEnough(`   ${"\n".repeat(20)}   `)).toBe(false);
    expect(postingIsEnough(`${"a ".repeat(14)}\n\n\n  ${"b"}`)).toBe(false);
    expect(postingIsEnough(`${"a ".repeat(15)}\n\n\n  b`)).toBe(true);
  });

  it("is the number `canGenerate` asks for in the wizard", () => {
    expect(readFileSync("app/(app)/postular/Wizard.tsx", "utf8")).toContain(`.trim().length >= ${POSTING_MIN}`);
  });

  it("is what the first step waits for, read on the paste box", () => {
    const ready = TOUR[0]![0]!.ready!;
    const box = (value: string) => ({ value }) as unknown as Element;
    expect(ready(box(""))).toBe(false);
    expect(ready(box("Buscamos una persona para ventas"))).toBe(true);
    // A part with no text to read (the page changed under the card) is not done.
    expect(ready({} as Element)).toBe(false);
  });
});

describe("what a step points at", () => {
  it("is the part it names", () => {
    expect(stopOf(1, PASTING)?.target).toBe("aviso");
    expect(stopOf(3, WRITTEN)?.target).toBe("revision");
    expect(stopOf(4, WRITTEN)?.target).toBe("descargas");
  });

  it("is the key when one is missing, and the button when it is not", () => {
    expect(stopOf(2, PASTING)?.target).toBe("generar");
    expect(stopOf(2, NO_KEY)?.target).toBe("clave");
  });

  it("is nothing when the page has none of it", () => {
    expect(stopOf(1, WRITTEN)).toBeNull();
    expect(stopOf(3, PASTING)).toBeNull();
    expect(stopOf(0, PASTING)).toBeNull();
    expect(stopOf(5, WRITTEN)).toBeNull();
  });
});

describe("where the tour stands", () => {
  it("stays where it is while that step has something to point at", () => {
    expect(settleStep(1, PASTING)).toBe(1);
    expect(settleStep(2, PASTING)).toBe(2);
    expect(settleStep(2, NO_KEY)).toBe(2);
    expect(settleStep(3, WRITTEN)).toBe(3);
    expect(settleStep(4, WRITTEN)).toBe(4);
  });

  it("goes on by itself when the CV is written: the button is gone and the review is there", () => {
    expect(settleStep(2, WRITTEN)).toBe(3);
  });

  it("goes on to the first step that has something, whichever it was on", () => {
    // Opened on a posting that already has its CV.
    expect(settleStep(1, WRITTEN)).toBe(3);
    // Generated without waiting for the card.
    expect(settleStep(1, page("revision"))).toBe(3);
    expect(settleStep(3, page("descargas"))).toBe(4);
  });

  it("is over when the page went back to before it: a new posting was started, and the tour goes one way", () => {
    expect(settleStep(3, PASTING)).toBeNull();
    expect(settleStep(4, PASTING)).toBeNull();
    expect(settleStep(4, NO_KEY)).toBeNull();
  });

  it("stays where it was when the page shows none of it: it is loading, or the address is changing", () => {
    for (const step of [1, 2, 3, 4]) expect(settleStep(step, page())).toBe(step);
    expect(settleStep(2, page("otra-cosa"))).toBe(2);
  });
});

describe("how far to scroll", () => {
  // A phone: 76 px of bar over the page and a card from 640 down, with a margin of 12 on each side.
  const [top, bottom] = [88, 628];

  it("is none for what is in sight already", () => {
    expect(revealDelta({ top: 120, bottom: 220 }, top, bottom)).toBe(0);
    expect(revealDelta({ top: 88, bottom: 628 }, top, bottom)).toBe(0);
  });

  it("brings what is below to the middle of the room there is, and what is above too", () => {
    // 100 px tall in 540 of room: 220 spare, 110 each side.
    expect(revealDelta({ top: 900, bottom: 1000 }, top, bottom)).toBe(900 - top - 220);
    expect(revealDelta({ top: -400, bottom: -300 }, top, bottom)).toBe(-400 - top - 220);
    // Once scrolled by that, its middle is the middle of the room.
    const delta = revealDelta({ top: 900, bottom: 1000 }, top, bottom);
    expect((900 - delta + 1000 - delta) / 2).toBe((top + bottom) / 2);
  });

  it("brings what is half hidden under the card up to the middle", () => {
    const delta = revealDelta({ top: 560, bottom: 700 }, top, bottom);
    expect(delta).toBeGreaterThan(0);
    expect((560 - delta + 700 - delta) / 2).toBe((top + bottom) / 2);
  });

  it("puts the top of what is taller than the room at the top of it, and does not centre it", () => {
    expect(revealDelta({ top: 400, bottom: 1500 }, top, bottom)).toBe(400 - top);
    expect(revealDelta({ top: -200, bottom: 900 }, top, bottom)).toBe(-200 - top);
  });

  it("is a whole number of pixels, and never asks to centre in a room that is not there", () => {
    expect(Number.isInteger(revealDelta({ top: 901.4, bottom: 1000.3 }, top, bottom))).toBe(true);
    // The keyboard left no room at all: the top, as for what is taller.
    expect(revealDelta({ top: 500, bottom: 600 }, 88, 80)).toBe(500 - 88);
  });
});

describe("what the tab keeps", () => {
  afterEach(() => uninstallBrowser());

  it("is the step, and forgets it when the tour is over", () => {
    const { session } = installBrowser();
    expect(loadStep()).toBeNull();
    saveStep(2);
    expect(session.getItem(TOUR_KEY)).toBe("2");
    expect(loadStep()).toBe(2);
    saveStep(null);
    expect(session.has(TOUR_KEY)).toBe(false);
    expect(loadStep()).toBeNull();
  });

  it("is in the tab and not in the browser: the tour is not offered again tomorrow", () => {
    const { local } = installBrowser();
    saveStep(3);
    expect(local.length).toBe(0);
  });

  it("is nothing for what is not a step", () => {
    const { session } = installBrowser();
    for (const junk of ["0", "5", "-1", "2.5", "abc", ""]) {
      session.setItem(TOUR_KEY, junk);
      expect(loadStep(), junk).toBeNull();
    }
  });

  it("never throws for a browser that will not keep it: the tour lasts as long as the page", () => {
    installBrowser({ session: new FakeStorage(1) });
    expect(() => saveStep(2)).not.toThrow();
    expect(loadStep()).toBeNull();
    uninstallBrowser();
    expect(() => saveStep(2)).not.toThrow();
    expect(loadStep()).toBeNull();
  });
});

describe("the card", () => {
  const noop = () => {};
  const card = (step: number, next: boolean, target = TOUR[step - 1]![0]!.target) =>
    html(createElement(TourCard, { view: { step, stop: TOUR[step - 1]!.find((stop) => stop.target === target)!, next }, onNext: noop, onExit: noop }));

  it("says which step it is, what to do and a way on and a way out — in a region that announces the change", () => {
    const markup = card(1, true);
    const text = words(markup);
    expect(text).toContain("Paso 1 de 4");
    expect(text).toContain("Pegá el aviso");
    expect(markup).toMatch(/<button[^>]*>Siguiente<\/button>/);
    expect(markup).toMatch(/<button[^>]*aria-keyshortcuts="Escape"[^>]*>Salir del recorrido<\/button>/);
    expect(markup).toMatch(/aria-live="polite"/);
    expect(markup).toMatch(/<section[^>]*aria-label="Recorrido de Postular"/);
  });

  it("says «Paso N de 4» in a way that cannot be taken for the wizard's own «Paso 1 de 3» above it", () => {
    expect(words(card(2, true, "generar"))).toContain("Recorrido · Paso 2 de 4");
  });

  it("has a line in place of «Siguiente» while the next part is not on the page: the CV is still being written", () => {
    const markup = card(2, false, "generar");
    expect(markup).not.toContain("Siguiente");
    expect(words(markup)).toContain("Seguimos cuando termine de armarse.");
    expect(markup).toContain("Salir del recorrido");
  });

  it("waits for the posting on the first step, with a line instead of «Siguiente»", () => {
    const markup = card(1, false);
    expect(markup).not.toContain("Siguiente");
    expect(words(markup)).toContain("Seguimos cuando pegues el aviso.");
    expect(markup).toContain("Salir del recorrido");
  });

  it("points at the key, with its own words, when that is what the step points at", () => {
    const text = words(card(2, false, "clave"));
    expect(text).toContain("Primero, una key");
    expect(text).toContain("Seguimos cuando la tengas.");
  });

  it("ends with «Listo» on the last step, and nothing else to press", () => {
    const markup = card(4, false);
    expect(markup).toMatch(/<button[^>]*>Listo<\/button>/);
    expect(markup).not.toContain("Siguiente");
    expect(markup).not.toContain("Salir del recorrido");
  });

  it("stands on the bar of tabs on a phone and at the foot of the screen from `chrome`", () => {
    const markup = card(1, true);
    expect(markup).toContain("fixed");
    expect(markup).toContain("bottom-[calc(var(--tab-h)+0.75rem)]");
    expect(markup).toContain("chrome:bottom-6");
  });

  it("has a button of every size a thumb can press", () => {
    // `Button` grows to 44 px where the pointer is coarse; a card that wrote its own buttons would have to say so again.
    expect(card(1, true).match(/pointer-coarse:min-h-11/g)?.length).toBe(2);
  });

  it("speaks in the product's voice", () => {
    for (const [index, stops] of TOUR.entries()) for (const stop of stops) inTheVoice(words(card(index + 1, true, stop.target)));
  });
});

describe("the guide", () => {
  it("draws nothing from the server: it is switched on and followed in the browser, and a card from the server would not match", () => {
    expect(html(createElement(PostularGuide, { start: true }))).toBe("");
    expect(html(createElement(PostularGuide, { start: false }))).toBe("");
  });
});

describe("«Guiame»", () => {
  it("leads to Postular with the tour on, and «Lo hago yo» to the profile", () => {
    expect(TOUR_HREF).toBe(`/postular?${TOUR_PARAM}=1`);
    const onFinish = vi.fn();
    const tree = FirstValueStep({ profile: emptyStoredProfile(), onFinish });
    const pressing = (label: string) => {
      const button = find(tree, (element) => element.type === Button && element.props.children === label);
      expect(button, label).not.toBeNull();
      (button!.props as unknown as { onClick: () => void }).onClick();
    };
    pressing("Guiame paso a paso");
    expect(onFinish).toHaveBeenLastCalledWith(TOUR_HREF);
    pressing("Lo hago yo");
    expect(onFinish).toHaveBeenLastCalledWith("/perfil");
  });
});

/** The first element of a tree that a test can name, looking inside what is passed to components as children. */
function find(node: ReactNode, match: (element: ReactElement<{ children?: ReactNode }>) => boolean): ReactElement<{ children?: ReactNode }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, match);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return null;
  return match(node) ? node : find(node.props.children, match);
}

describe("what the page marks", () => {
  /** The `data-tour` attributes of a file, as the parser reads them: a comment or a template that names one is not one. */
  const marksIn = (file: string): string[] => {
    const text = readFileSync(file, "utf8");
    if (!text.includes("data-tour")) return [];
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const found: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(source) === "data-tour" && node.initializer && ts.isStringLiteral(node.initializer)) found.push(node.initializer.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  };
  const marked = [...sourcesUnder("app"), ...sourcesUnder("components")].flatMap((file) => marksIn(file).map((target) => ({ file, target })));
  const count = (target: string) => marked.filter((mark) => mark.target === target).length;

  it("has every part the tour points at: the wizard's four once each, and the key in both of the prompt's ways of having no AI", () => {
    for (const target of ["aviso", "generar", "revision", "descargas"]) expect(count(target), target).toBe(1);
    expect(count("clave")).toBe(2);
  });

  it("has no mark the tour does not know: a typo would leave a step with nothing to point at", () => {
    const known = new Set(TOUR.flat().map((stop) => stop.target));
    expect(marked.filter((mark) => !known.has(mark.target))).toEqual([]);
  });

  it("puts them where the steps are: the paste box, the button, the CV and the downloads in the wizard, and the key in its prompt", () => {
    const wizard = "app/(app)/postular/Wizard.tsx";
    expect(marked.filter((mark) => mark.file === wizard).map((mark) => mark.target).sort()).toEqual(["aviso", "descargas", "generar", "revision"]);
    expect(marked.filter((mark) => mark.target === "clave").map((mark) => mark.file)).toEqual(["components/ai/AiKeyPrompt.tsx", "components/ai/AiKeyPrompt.tsx"]);
  });
});
