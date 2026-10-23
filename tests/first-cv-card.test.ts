import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FirstCvCard } from "@/components/profile/FirstCvCard";
import { GENERATE_STEPS, TOUR_HREF, TOUR_PARAM } from "@/components/wizard/postular-tour";
import { RULES } from "@/lib/voice";

/**
 * The card the profile offers after the first reading left something marked (the clean one is told in «Tu perfil está listo»): the three steps, the
 * tour of Postular one press away, and a way to put it off. Where it is drawn, and when, is a function of the address and the profile.
 */

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/<!-- -->/g, "");
const words = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const source = (path: string) => readFileSync(path, "utf8");

describe("the card for the first CV", () => {
  const markup = html(createElement(FirstCvCard));

  it("says the three steps in order, the same ones «Tu perfil está listo» says", () => {
    const text = words(markup);
    let at = -1;
    for (const step of GENERATE_STEPS) {
      const next = text.indexOf(step.title);
      expect(next, step.title).toBeGreaterThan(at);
      at = next;
    }
  });

  it("leads to Postular with the tour on, and can be put off", () => {
    expect(markup).toMatch(new RegExp(`<a[^>]*href="${TOUR_HREF.replace("?", "\\?")}"[^>]*>Guiame paso a paso</a>`));
    expect(markup).toMatch(/<button[^>]*>Ahora no<\/button>/);
  });

  it("has a name for whoever cannot see it", () => {
    expect(markup).toMatch(/<section[^>]*aria-labelledby="first-cv-title"/);
    expect(markup).toContain('id="first-cv-title"');
  });

  it("speaks in the product's voice", () => {
    for (const rule of RULES) expect(rule.not.test(words(markup)), `${rule.use}: «${words(markup)}»`).toBe(false);
  });
});

describe("when the profile offers it", () => {
  it("is asked for by the address a marked first reading leaves for, and only that one", () => {
    expect(source("components/onboarding/Onboarding.tsx")).toContain("`/perfil?revisar=1&${TOUR_PARAM}=1`");
    expect(TOUR_PARAM).toBe("guia");
  });

  it("is drawn for a profile with a name and something to show, and not otherwise", () => {
    const hub = source("components/profile/ProfileHub.tsx");
    expect(hub).toMatch(/guide === true && !empty && isPreviewReady\(profile\) && profile\.contact\.fullName\.value\.trim\(\)\.length > 0/);
    expect(hub).toContain("{offerGuide ? <FirstCvCard /> : null}");
  });
});
